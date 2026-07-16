/* StratNinja Journal — UI + storage layer.
 * Storage abstraction (window.Store) keeps raw fills + manual trades in
 * localStorage, keyed per account. Swapping to a server backend later means
 * reimplementing Store with the same methods — the UI stays untouched.
 */
(function () {
  "use strict";
  const E = window.Engine;

  // ---- Storage -----------------------------------------------------------
  const KEY = "stratninja_journal_v1";
  const Store = {
    _read() {
      try { return JSON.parse(localStorage.getItem(KEY)) || { fills: [], manual: [] }; }
      catch (e) { return { fills: [], manual: [] }; }
    },
    _write(d) { localStorage.setItem(KEY, JSON.stringify(d)); },
    getFills() { return this._read().fills; },
    getManual() { return this._read().manual; },
    /* add fills, skipping exact duplicates. returns #added */
    addFills(fills) {
      const d = this._read();
      const seen = new Set(d.fills.map(E.fillKey));
      let added = 0;
      fills.forEach(f => { const k = E.fillKey(f); if (!seen.has(k)) { seen.add(k); d.fills.push(f); added++; } });
      this._write(d);
      return added;
    },
    addManual(t) { const d = this._read(); d.manual.push(t); this._write(d); },
    updateManual(t) { const d = this._read(); const i = d.manual.findIndex(m => m.id === t.id); if (i >= 0) d.manual[i] = t; else d.manual.push(t); this._write(d); },
    deleteManual(id) { const d = this._read(); d.manual = d.manual.filter(m => m.id !== id); this._write(d); },
    /* remove raw fills by their fillKey (used to delete a CSV-derived round-trip) */
    deleteFills(keys) {
      const set = new Set(keys);
      const d = this._read();
      const before = d.fills.length;
      d.fills = d.fills.filter(f => !set.has(E.fillKey(f)));
      this._write(d);
      return before - d.fills.length;
    },
    clearAccount(acct) {
      const d = this._read();
      d.fills = d.fills.filter(f => (f.account || "").trim() !== acct);
      d.manual = d.manual.filter(m => (m.account || "").trim() !== acct);
      this._write(d);
    },
    clearAll() { this._write({ fills: [], manual: [] }); },
    /* rename an account across all its fills + manual trades */
    renameAccount(oldName, newName) {
      const on = (oldName || "").trim(), nn = (newName || "").trim();
      if (!on || !nn || on === nn) return;
      const d = this._read();
      d.fills.forEach(f => { if ((f.account || "").trim() === on) f.account = nn; });
      d.manual.forEach(m => { if ((m.account || "").trim() === on) m.account = nn; });
      this._write(d);
    },
    exportData() { return this._read(); },
    /* merge a backup object into storage without clobbering existing data */
    importData(obj) {
      const d = this._read();
      const seen = new Set(d.fills.map(E.fillKey));
      let fills = 0, manual = 0;
      (obj.fills || []).forEach(f => { const k = E.fillKey(f); if (!seen.has(k)) { seen.add(k); d.fills.push(f); fills++; } });
      const ids = new Set(d.manual.map(m => m.id));
      (obj.manual || []).forEach(m => { if (!ids.has(m.id)) { ids.add(m.id); d.manual.push(m); manual++; } });
      this._write(d);
      return { fills, manual };
    },
    accounts() {
      const d = this._read();
      const set = new Set();
      d.fills.forEach(f => set.add((f.account || "").trim()));
      d.manual.forEach(m => set.add((m.account || "").trim()));
      const named = Array.from(set).filter(a => a !== "").sort();
      if (named.length) return named;                 // real accounts exist → hide the blank bucket
      // only blank-account data (e.g. a broker CSV with no account column) → keep it selectable,
      // otherwise the imported trades would have no account to show under and vanish silently
      return set.size ? [""] : [];
    },
  };
  window.Store = Store;

  // ---- App state ---------------------------------------------------------
  const ALL = "__ALL__";    // pseudo-account: combined view of every account
  const state = { account: null, tab: "calendar", monthIdx: 0, months: [], sortKey: "exitDate", sortDir: -1 };
  let manualEditId = null;  // when editing a manual trade, its id; null = adding new
  const OPEN_WARN = 5;      // discipline nudge: warn at this many concurrent open positions
  let _lastOpenCount = 0;   // to fire the crossing popup only once per crossing
  let openPosMin = false;   // collapse the open-positions panel
  try { openPosMin = localStorage.getItem("sn_openpos_min") === "1"; } catch (e) {}
  let _openSort = { col: null, dir: 1 };   // open-positions table sort (click a header)
  // live-stream privacy: hide the trades on entry (toggle persisted); _peek = temporarily revealed
  let _journalPrivate = false;
  try { _journalPrivate = localStorage.getItem("sn_journal_private") === "1"; } catch (e) {}
  let _journalPeek = false;

  // ---- Helpers -----------------------------------------------------------
  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const HEB = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  const DOW = ["א'","ב'","ג'","ד'","ה'","ו'","ש'"];
  function money(v, dec) {
    const d = dec == null ? 0 : dec;
    const s = "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return v < 0 ? "-" + s : s;
  }
  const cls = v => v > 0 ? "pos" : (v < 0 ? "neg" : "zero");
  function toast(msg) {
    const t = el("div", "toast", msg); document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* unified trades for ONE account */
  function _tradesForOne(acct) {
    const csvFills = Store.getFills().filter(f => (f.account || "").trim() === acct);
    const { trades, openPositions } = E.computeTrades(csvFills);
    const manual = Store.getManual().filter(m => (m.account || "").trim() === acct).map(E.manualToTrade);
    return { trades: trades.concat(manual.filter(t => !t.open)), openPositions: openPositions || [], manualOpen: manual.filter(t => t.open) };
  }
  /* unified trades for the active account — or ALL accounts combined.
     Each account is computed separately (so FIFO round-trips never mix across
     accounts) and the results are merged. */
  function tradesForAccount() {
    if (state.account === ALL) {
      const out = { trades: [], openPositions: [], manualOpen: [] };
      Store.accounts().forEach(a => {
        const r = _tradesForOne(a);
        out.trades = out.trades.concat(r.trades);
        out.openPositions = out.openPositions.concat(r.openPositions);
        out.manualOpen = out.manualOpen.concat(r.manualOpen);
      });
      return out;
    }
    return _tradesForOne(state.account);
  }

  // ---- live prices for Unrealized P&L (from the scanner_data snapshot) ----
  let livePrices = null, livePricesTs = 0, _openPriceTimer = null;
  async function ensureLivePrices() {
    if (livePrices && Date.now() - livePricesTs < 30000) return livePrices;
    const cfg = window.SN_CONFIG;
    if (!cfg || !cfg.SUPABASE_URL) return {};
    try {
      // the compact LIVE-prices feed (id='prices') — {sym:[price,chg]} for the whole US market,
      // refreshed every ~1 min. Tiny vs the 0.5 MB scanner feed, and much fresher for Unrealized P&L.
      const r = await fetch(cfg.SUPABASE_URL + "/rest/v1/market_snapshot?id=eq.prices&select=data",
        { cache: "no-store", headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, "Cache-Control": "no-cache" } });
      if (!r.ok) return livePrices || {};
      const j = await r.json();
      const prices = (j && j[0] && j[0].data && j[0].data.prices) || {};
      const map = {};
      Object.keys(prices).forEach(sym => { const v = prices[sym]; const p = Array.isArray(v) ? v[0] : v; if (p) map[sym] = p; });
      if (Object.keys(map).length) { livePrices = map; livePricesTs = Date.now(); }
      return livePrices || {};
    } catch (e) { return livePrices || {}; }
  }
  function unrealizedPnl(t, cp) {
    const gross = (t.direction === "short" ? (t.entryPrice - cp) : (cp - t.entryPrice)) * t.qty * (t.mult || 1);
    return gross - (t.fees || 0);
  }
  // options have no live price feed (it covers stocks only) → the trader types the current premium.
  // stored per-position id in localStorage (transient current price, not part of the trade record).
  function _optPrices() { try { return JSON.parse(localStorage.getItem("sn_opt_cur_prices") || "{}"); } catch (e) { return {}; } }
  function _setOptPrice(id, px) {
    const m = _optPrices();
    if (px === "" || px == null || isNaN(+px)) delete m[id]; else m[id] = +px;
    try { localStorage.setItem("sn_opt_cur_prices", JSON.stringify(m)); } catch (e) {}
  }

  // ---- Rendering ---------------------------------------------------------
  // clickable ticker → opens the same multi-timeframe chart used across the site (pages.js exposes it)
  function chartSym(sym) {
    if (!sym) return "—";
    return '<span class="jsym" data-jchart="' + String(sym).replace(/"/g, "&quot;") + '" title="הצג גרף">' + sym + "</span>";
  }
  // one delegated capture-phase listener: a symbol click opens the chart and never triggers the row's edit
  function _wireJournalCharts() {
    if (window.__snJChartWired) return;
    window.__snJChartWired = true;
    document.addEventListener("click", e => {
      const el = e.target.closest && e.target.closest("[data-jchart]");
      if (el) { e.stopPropagation(); e.preventDefault(); if (window._snOpenChart) window._snOpenChart(el.dataset.jchart); }
    }, true);
  }
  function render() {
    _wireJournalCharts();
    const root = $("#view");
    root.innerHTML = "";
    const accts = Store.accounts();
    // normalize the active account BEFORE syncing the dropdown, so the
    // selector and the rendered data can never desync on load.
    if (accts.length && state.account !== ALL && (!state.account || accts.indexOf(state.account) < 0)) state.account = accts[0];
    renderAccountBar();
    if (!accts.length) { root.appendChild(emptyState()); return; }

    const { trades, openPositions, manualOpen } = tradesForAccount();

    // discipline nudge — too many concurrent open positions
    const openCount = (openPositions ? openPositions.length : 0) + (manualOpen ? manualOpen.length : 0);
    if (openCount >= OPEN_WARN) root.appendChild(disciplineBanner(openCount));
    if (openCount >= OPEN_WARN && _lastOpenCount < OPEN_WARN) setTimeout(() => disciplineModal(openCount), 350);
    _lastOpenCount = openCount;

    // live-stream privacy toggle — always visible so it can be flipped
    const privBar = el("div", "jr-privbar");
    privBar.innerHTML = '<button class="btn ghost" id="jrPrivToggle" title="הסתר את העסקאות בכניסה — נוח ללייבים. כבוי = הכל גלוי מיד">' +
      (_journalPrivate ? "🔒 מצב לייב פעיל · עסקאות מוסתרות בכניסה" : "👁️ עסקאות גלויות") + "</button>";
    root.appendChild(privBar);
    { const pt = privBar.querySelector("#jrPrivToggle"); if (pt) pt.onclick = () => { _journalPrivate = !_journalPrivate; try { localStorage.setItem("sn_journal_private", _journalPrivate ? "1" : "0"); } catch (e) {} _journalPeek = false; render(); }; }

    const content = el("div", "jr-content");
    content.appendChild(renderStatCards(trades));
    if (manualOpen && manualOpen.length) content.appendChild(renderOpenPositions(manualOpen));
    content.appendChild(renderAssetBreakdown(trades));
    if (state.tab === "calendar") content.appendChild(renderCalendar(trades));
    else if (state.tab === "equity") content.appendChild(renderEquity(trades));
    else if (state.tab === "trades") content.appendChild(renderTrades(trades, openPositions));

    if (_journalPrivate && !_journalPeek) {
      const shell = el("div", "jr-private-shell");
      content.classList.add("jr-blurred");
      const cover = el("div", "jr-cover");
      cover.innerHTML = '<div class="jr-cover-in"><div style="font-size:38px">🔒</div>' +
        '<h3 style="margin:8px 0 4px">העסקאות מוסתרות · מצב לייב</h3>' +
        '<p class="muted" style="margin:0 0 14px;max-width:340px">מוסתר אוטומטית בכל כניסה כל עוד המצב פעיל. לחץ להצגה זמנית.</p>' +
        '<button class="btn primary" id="jrReveal">👁️ הצג עסקאות</button></div>';
      shell.appendChild(content); shell.appendChild(cover);
      root.appendChild(shell);
      { const rb = cover.querySelector("#jrReveal"); if (rb) rb.onclick = () => { _journalPeek = true; render(); }; }
    } else {
      root.appendChild(content);
    }

    // keep open-position prices LIVE — load once, then refresh from the scanner every 45s while the
    // journal is open (previously fetched only once → prices froze at whatever they were on open)
    const anyOpen = (openPositions && openPositions.length) || (manualOpen && manualOpen.length);
    if (anyOpen) {
      if (!livePrices) ensureLivePrices().then(m => { if (m && Object.keys(m).length) render(); });
      if (!_openPriceTimer) _openPriceTimer = setInterval(refreshOpenPrices, 45000);
    } else if (_openPriceTimer) { clearInterval(_openPriceTimer); _openPriceTimer = null; }
  }
  function refreshOpenPrices() {
    const jc = document.getElementById("journalContainer");
    if (!jc || jc.classList.contains("hidden") || document.getElementById("modalBg")) return;  // not visible / mid-edit
    livePricesTs = 0;                                    // force a fresh fetch (bypass the 2-min cache)
    const before = livePrices;
    ensureLivePrices().then(m => { if (m && before && JSON.stringify(m) !== JSON.stringify(before)) render(); });
  }

  // discipline nudge — persistent banner + one-time popup when open positions pile up
  function disciplineBanner(count) {
    const d = el("div", "panel discipline-warn");
    d.innerHTML = '<span class="dw-ico">⚠️</span><div><b>שים לב — ' + count + ' עסקאות פתוחות במקביל.</b>' +
      '<div class="dw-sub">אתה יכול להמשיך, אבל זו לא מעט חשיפה בו-זמנית. קח רגע — האם כל אחת עומדת בכללי הכניסה שלך? עדיף איכות על כמות. 🎯</div></div>';
    return d;
  }
  function disciplineModal(count) {
    modal("⚠️ ריבוי עסקאות פתוחות",
      '<div style="font-size:15px;line-height:1.65">' +
      '<b>היי — יש לך כרגע ' + count + ' עסקאות פתוחות במקביל.</b><br><br>' +
      'אתה יכול להמשיך — אבל ' + count + ' פוזיציות פתוחות בו-זמנית זו לא מעט חשיפה. זה הרגע לעצור ולחשוב פעמיים:<br><br>' +
      '• האם כל עסקה עומדת בכללי הכניסה שלך?<br>' +
      '• האם הסיכון הכולל שלך עדיין בשליטה?<br>' +
      '• אולי עדיף לחכות שאחת תיסגר לפני שנכנסים לעוד?<br><br>' +
      '<b>משמעת מנצחת כמות.</b> 🎯</div>');
  }

  function renderOpenPositions(openTrades) {
    const wrap = el("div", "panel open-pos");
    const showAcct = state.account === ALL;   // combined view → show which account each position is in
    const posValOf = t => (+t.entryPrice || 0) * (+t.qty || 0) * (t.mult || 1);   // entry notional
    // derive per-position values first (live prices are STOCK prices — not an option's premium,
    // so Unrealized P&L is only computable for stocks). Needed for both display AND sorting.
    const optPx = _optPrices();
    const items = openTrades.map(t => {
      const isOpt = t.assetType === "option";
      // stocks → live feed price · options → the price the trader typed in (if any)
      const cp = isOpt ? (optPx[t.id] != null ? optPx[t.id] : null) : (livePrices ? livePrices[t.symbol] : null);
      const un = (cp != null) ? unrealizedPnl(t, cp) : null;
      return { t: t, isOpt: isOpt, cp: cp, un: un };
    });
    if (_openSort.col) {
      const sv = it => {
        switch (_openSort.col) {
          case "account": return (it.t.account || "").toUpperCase();
          case "symbol": return (it.t.symbol || "").toUpperCase();
          case "entryDate": return it.t.entryDate || "";
          case "direction": return it.t.direction || "";
          case "qty": return +it.t.qty || 0;
          case "entryPrice": return +it.t.entryPrice || 0;
          case "posValue": return posValOf(it.t);
          case "cp": return it.cp == null ? -Infinity : it.cp;
          case "un": return it.un == null ? -Infinity : it.un;
          default: return 0;
        }
      };
      items.sort((a, b) => { const va = sv(a), vb = sv(b); return typeof va === "string" ? _openSort.dir * va.localeCompare(vb) : _openSort.dir * (va - vb); });
    }
    let totUn = 0, haveAll = true, hasOpt = false;
    const rows = items.map(function (it) {
      const t = it.t, isOpt = it.isOpt, cp = it.cp;
      let pnlHtml, cpHtml;
      if (isOpt) {
        hasOpt = true;
        // no live option-price feed → let the trader type the current premium; P&L updates live
        cpHtml = '<input class="opt-px" data-optpx="' + t.id + '" type="number" step="0.01" min="0" placeholder="הזן מחיר" value="' + (cp != null ? cp : "") + '">';
        if (cp != null && it.un != null) { totUn += it.un; pnlHtml = '<span class="' + cls(it.un) + '">' + money(it.un, 2) + "</span>"; }
        else { pnlHtml = '<span class="muted" title="הזן את מחיר האופציה הנוכחי כדי לחשב רווח/הפסד לא ממומש">הזן מחיר ←</span>'; }
      } else if (cp != null) {
        totUn += it.un;
        pnlHtml = '<span class="' + cls(it.un) + '">' + money(it.un, 2) + "</span>";
        cpHtml = money(cp, 2);
      } else { haveAll = false; pnlHtml = '<span class="muted">' + (livePrices ? "אין מחיר" : "טוען…") + "</span>"; cpHtml = "—"; }
      return "<tr data-editopen='" + t.id + "' style='cursor:pointer'>" +
        (showAcct ? "<td class='muted' style='white-space:nowrap'>" + (t.account || "—") + "</td>" : "") +
        "<td class='muted' style='white-space:nowrap'>" + (t.entryDate || "—") + "</td>" +
        "<td class='sym'>" + chartSym(t.symbol) +
        '<span class="pill ' + (t.assetType === "option" ? "opt" : "stk") + '" style="margin-inline-start:6px">' + (t.assetType === "option" ? "אופ׳" : "מניה") + "</span></td>" +
        "<td>" + (t.direction === "long" ? "🟢 לונג" : "🔴 שורט") + "</td><td>" + t.qty + "</td><td>" + money(t.entryPrice, 2) + "</td><td>" + money(posValOf(t), 0) + "</td><td>" + cpHtml + "</td><td>" + pnlHtml + "</td>" +
        "<td>" + (t.img ? "<button class='btn ghost' data-img='" + t.id + "' title='צפה בצילום הגרף' style='padding:4px 8px'>📷</button> " : "") +
          "<button class='btn ghost' data-closepos='" + t.id + "' style='font-size:12px;padding:4px 10px'>סגירה ✎</button> " +
          "<button class='btn ghost' data-delpos='" + t.id + "' title='מחק פוזיציה' style='padding:4px 8px'>🗑</button></td></tr>";
    }).join("");
    // sortable header (click a column to sort)
    const _sh = (col, label, start) => "<th class='jsort' data-jsort='" + col + "' style='cursor:pointer" + (start ? ";text-align:start" : "") + "'>" + label + (_openSort.col === col ? (_openSort.dir === 1 ? " ▲" : " ▼") : "") + "</th>";
    const _thead = "<tr>" + (showAcct ? _sh("account", "חשבון", true) : "") + _sh("entryDate", "תאריך רכישה", true) + _sh("symbol", "סימבול", true) + _sh("direction", "כיוון") + _sh("qty", "כמות") + _sh("entryPrice", "כניסה") + _sh("posValue", "שווי פוזיציה") + _sh("cp", "מחיר נוכחי") + _sh("un", "Unrealized") + "<th></th></tr>";
    const footSpan = 7 + (showAcct ? 1 : 0);   // columns before the Unrealized-total cell
    const totHtml = haveAll ? '<span class="' + cls(totUn) + '">' + money(totUn, 2) + "</span>" : '<span class="muted">—</span>';
    const optNote = hasOpt ? ' · <span style="color:#e0b341">אופציות: אין מחיר חי — הזן מחיר נוכחי ידנית לחישוב P&L</span>' : "";
    const count = openTrades.length;
    const toggleBtn = "<button class='btn ghost' id='openPosToggle' style='font-size:12px;padding:4px 12px;margin-inline-start:auto'>" + (openPosMin ? "▸ הצג" : "▾ מזער") + "</button>";
    const minSummary = openPosMin ? ' <span class="muted" style="font-size:12px;font-weight:400">· ' + count + " פוזיציות · Unrealized " + totHtml + "</span>" : "";
    wrap.innerHTML =
      "<h3 style='display:flex;align-items:center;gap:8px;flex-wrap:wrap'><span>📌 פוזיציות פתוחות" + (openPosMin ? "" : " · Unrealized P&L") + "</span>" +
        (openPosMin ? minSummary : '<span class="muted" style="font-size:12px;font-weight:400">מחיר חי מהסורק (מניות בלבד) · לחץ על שורה לעדכון/סגירה' + optNote + "</span>") + toggleBtn + "</h3>" +
      (openPosMin ? "" :
        "<div class='tablewrap'><table class='scan-table'><thead>" + _thead + "</thead>" +
        "<tbody>" + rows + "</tbody><tfoot><tr><td colspan='" + footSpan + "' style='text-align:start;font-weight:700;padding-top:10px'>סה\"כ Unrealized</td><td style='font-weight:800;padding-top:10px'>" + totHtml + "</td><td></td></tr></tfoot></table></div>");
    { const tg = wrap.querySelector("#openPosToggle"); if (tg) tg.onclick = () => { openPosMin = !openPosMin; try { localStorage.setItem("sn_openpos_min", openPosMin ? "1" : "0"); } catch (e) {} render(); }; }
    wrap.querySelectorAll("[data-jsort]").forEach(th => th.onclick = () => {
      const c = th.dataset.jsort;
      if (_openSort.col === c) _openSort.dir *= -1;
      else { _openSort.col = c; _openSort.dir = (c === "symbol" || c === "entryDate" || c === "direction") ? 1 : -1; }
      render();
    });
    // wire the manual option-price inputs (typing a premium → live Unrealized P&L)
    wrap.querySelectorAll("[data-optpx]").forEach(inp => {
      inp.onclick = e => e.stopPropagation();          // focusing the field must not open the row-edit
      inp.onchange = () => { _setOptPrice(inp.dataset.optpx, inp.value); render(); };
    });
    // wire: click row or close button -> open the edit form (add exit price to close)
    wrap.querySelectorAll("[data-editopen]").forEach(tr => tr.onclick = () => editOpenTrade(tr.dataset.editopen));
    wrap.querySelectorAll("[data-closepos]").forEach(b => b.onclick = e => { e.stopPropagation(); editOpenTrade(b.dataset.closepos); });
    wrap.querySelectorAll("[data-delpos]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const t = openTrades.find(x => x.id === b.dataset.delpos);
      if (!confirm("למחוק את הפוזיציה הפתוחה " + (t ? t.symbol : "") + "? פעולה זו אינה הפיכה.")) return;
      Store.deleteManual(b.dataset.delpos); render();
    });
    wrap.querySelectorAll("[data-img]").forEach(b => b.onclick = e => { e.stopPropagation(); const t = openTrades.find(x => x.id === b.dataset.img); if (t && t.img) viewTradeImg(t); });
    return wrap;
  }
  function editOpenTrade(id) {
    const m = Store.getManual().find(x => x.id === id);
    if (m) openManual(E.manualToTrade(m));
  }

  function emptyState() {
    const d = el("div", "empty-state");
    d.innerHTML = '<div class="big">📈</div><h2>אין עדיין נתונים</h2>' +
      '<p>העלה קובץ CSV מהברוקר או הוסף עסקה ידנית כדי להתחיל.</p>';
    const b = el("button", "btn primary", "העלאת CSV");
    b.onclick = openImport;
    const b2 = el("button", "btn", "הזנה ידנית");
    b2.style.marginRight = "8px";
    b2.onclick = () => openManual();
    d.appendChild(b); d.appendChild(b2);
    return d;
  }

  function renderAccountBar() {
    const accts = Store.accounts();
    const sel = $("#acctSel");
    sel.innerHTML = "";
    accts.forEach(a => { const o = el("option"); o.value = a; o.textContent = a; sel.appendChild(o); });
    // combined view — only worth offering when there are 2+ accounts
    if (accts.length >= 2) { const o = el("option"); o.value = ALL; o.textContent = "📊 כל החשבונות (משולב)"; sel.appendChild(o); }
    if (state.account) sel.value = state.account;
    sel.parentElement.style.display = accts.length ? "" : "none";
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === state.tab));
  }

  function renderStatCards(trades) {
    const s = E.stats(trades);
    const wrap = el("div", "cards");
    const pf = s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2);
    const items = [
      ["רווח/הפסד נטו", money(s.net, 2), cls(s.net)],
      ["Win Rate", s.winRate + "%", ""],
      ["Profit Factor", pf, s.profitFactor >= 1 ? "pos" : "neg"],
      ["מס' עסקאות", s.count, ""],
      ["רווח ממוצע", money(s.avgWin, 0), "pos"],
      ["הפסד ממוצע", money(-s.avgLoss, 0), "neg"],
      ["העסקה הטובה", money(s.bestTrade, 0), "pos"],
      ["העסקה הגרועה", money(s.worstTrade, 0), "neg"],
    ];
    items.forEach(([l, v, c]) => {
      const card = el("div", "card");
      card.appendChild(el("div", "lbl", l));
      card.appendChild(el("div", "val " + (c || ""), String(v)));
      wrap.appendChild(card);
    });
    return wrap;
  }

  /* compact Stocks vs Options breakdown */
  function renderAssetBreakdown(trades) {
    const wrap = el("div", "cards");
    const groups = [["stock", "📊 מניות"], ["option", "🎯 אופציות"]];
    let shown = 0;
    groups.forEach(([key, label]) => {
      const sub = trades.filter(t => t.assetType === key);
      if (!sub.length) return;
      shown++;
      const s = E.stats(sub);
      const pf = s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2);
      const card = el("div", "card");
      card.style.gridColumn = "span 2";
      card.innerHTML =
        '<div class="lbl">' + label + " · " + s.count + " עסקאות</div>" +
        '<div class="val ' + cls(s.net) + '">' + money(s.net, 0) + "</div>" +
        '<div class="sub">Win Rate ' + s.winRate + "% · Profit Factor " + pf + "</div>";
      wrap.appendChild(card);
    });
    if (shown < 1) wrap.style.display = "none";
    return wrap;
  }

  // ---- Calendar view -----------------------------------------------------
  function renderCalendar(trades) {
    const days = E.dailyFromTrades(trades);
    const monthsSet = new Set(Object.keys(days).map(k => k.slice(0, 7)));
    const months = Array.from(monthsSet).sort();
    state.months = months;
    if (state.monthIdx >= months.length) state.monthIdx = months.length - 1;
    if (state.monthIdx < 0) state.monthIdx = months.length - 1;

    const wrap = el("div");
    const bar = el("div", "calbar");
    const nav = el("div", "nav");
    const prev = el("button", null, "‹"), next = el("button", null, "›");
    const label = el("div", "mlabel");
    prev.onclick = () => { if (state.monthIdx > 0) { state.monthIdx--; render(); } };
    next.onclick = () => { if (state.monthIdx < months.length - 1) { state.monthIdx++; render(); } };
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
    const todayBtn = el("button", "btn", "לאחרון");
    todayBtn.onclick = () => { state.monthIdx = months.length - 1; render(); };
    bar.appendChild(nav); bar.appendChild(todayBtn);
    bar.appendChild(el("div", "spacer"));
    const monTot = el("span", "badge"), monDays = el("span", "badge days");
    bar.appendChild(el("span", "badge lbl", "סטטיסטיקה חודשית:"));
    bar.appendChild(monTot); bar.appendChild(monDays);
    wrap.appendChild(bar);

    if (!months.length) { wrap.appendChild(el("div", "note", "אין עסקאות סגורות בחשבון זה עדיין.")); return wrap; }

    const ym = months[state.monthIdx];
    const [y, m] = ym.split("-").map(Number);
    label.textContent = HEB[m - 1] + " " + y;
    const first = new Date(y, m - 1, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m, 0).getDate();

    const grid = el("div", "grid");
    for (let i = 0; i < 7; i++) grid.appendChild(el("div", "dow", DOW[i]));
    grid.appendChild(el("div", "dow dow-wk", "שבוע"));   // dow-wk → hidden on mobile (weekly col drops)

    let monTotal = 0, monActive = 0, day = 1, weekNo = 0;
    const weeks = Math.ceil((startDow + daysInMonth) / 7);
    for (let w = 0; w < weeks; w++) {
      let wkTotal = 0, wkDays = 0;
      for (let c = 0; c < 7; c++) {
        const cellIndex = w * 7 + c;
        if (cellIndex < startDow || day > daysInMonth) { grid.appendChild(el("div", "cell empty")); continue; }
        const key = ym + "-" + String(day).padStart(2, "0");
        const info = days[key];
        const cell = el("div", "cell");
        let inner = '<div class="dnum">' + day + "</div>";
        if (info) {
          const c2 = info.net > 0 ? "pos" : (info.net < 0 ? "neg" : "");
          if (c2) cell.classList.add(c2);
          cell.classList.add("clickable");
          const dkey = key;
          cell.onclick = () => openDay(dkey);
          inner += '<div class="pnl ' + (info.net >= 0 ? "pos" : "neg") + '">' + money(info.net) + "</div>";
          inner += '<div class="tcount">' + info.trades + " trades</div>";
          inner += '<div class="sub">Ø ' + money(info.net / info.trades, 2) + " · " + info.win.toFixed(0) + "%</div>";
          monTotal += info.net; monActive++; wkTotal += info.net; wkDays++;
        }
        cell.innerHTML += inner;
        grid.appendChild(cell);
        day++;
      }
      weekNo++;
      const wk = el("div", "wk");
      wk.innerHTML = '<div class="wlab">שבוע ' + weekNo + "</div>" +
        '<div class="wval ' + cls(wkTotal) + '">' + money(wkTotal) + "</div>" +
        '<div class="wdays">' + wkDays + " ימים</div>";
      grid.appendChild(wk);
    }
    wrap.appendChild(grid);
    monTot.textContent = money(monTotal); monTot.className = "badge " + (monTotal >= 0 ? "pos" : "neg");
    monDays.textContent = monActive + " ימים";
    return wrap;
  }

  function openDay(dateKey) {
    // recompute fresh so the modal reflects any edits/deletes
    const { trades } = tradesForAccount();
    const dayTrades = trades.filter(t => t.exitDate === dateKey);
    if (!dayTrades.length) { closeModal(); render(); return; }
    const net = dayTrades.reduce((s, t) => s + t.pnl, 0);
    const rows = dayTrades.map(t => tradeRow(t)).join("");
    const body =
      '<div style="margin-bottom:12px" class="' + cls(net) + '"><b style="font-size:18px">' + money(net, 2) + "</b> · " + dayTrades.length + " עסקאות</div>" +
      '<div class="tablebox"><table><thead><tr>' +
      "<th>סימבול</th><th>כיוון</th><th>כמות</th><th>כניסה</th><th>יציאה</th><th>נטו</th><th></th></tr></thead><tbody>" +
      rows + "</tbody></table></div>" +
      '<div class="note">✏️ עריכה — לעסקאות ידניות · 🗑 מחיקה — לכולן (מחיקת עסקת CSV מסירה את פקודות הביצוע שמרכיבות אותה).</div>';
    modal("עסקאות · " + dateKey, body);
    wireTradeActions($("#modalBg"), dayTrades, () => openDay(dateKey));
  }
  function tradeRow(t) {
    const actions =
      (t.img ? '<button class="btn ghost" data-img="' + t.id + '" title="צפה בצילום הגרף">📷</button> ' : "") +
      (t.source === "manual" ? '<button class="btn ghost" data-edit="' + t.id + '" title="ערוך">✏️</button> ' : "") +
      '<button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>';
    return "<tr><td>" + chartSym(t.symbol) + '</td><td><span class="pill ' + t.direction + '">' +
      (t.direction === "long" ? "לונג" : "שורט") + "</span></td><td>" + t.qty + "</td><td>" +
      money(t.entryPrice, 2) + "</td><td>" + money(t.exitPrice, 2) + '</td><td class="' + cls(t.pnl) +
      '">' + money(t.pnl, 2) + "</td><td>" + actions + "</td></tr>";
  }
  /* wire ✏️/🗑 buttons within a container to a list of trades. `reopen` (optional)
     is called after a successful change to refresh a modal view. */
  function wireTradeActions(container, tradesList, reopen) {
    const byId = {};
    tradesList.forEach(t => { byId[t.id] = t; });
    container.querySelectorAll("button[data-edit]").forEach(b => {
      b.onclick = () => { const t = byId[b.dataset.edit]; if (t) { closeModal(); openManual(t); } };
    });
    container.querySelectorAll("button[data-del]").forEach(b => {
      b.onclick = () => deleteTrade(byId[b.dataset.del], reopen);
    });
    container.querySelectorAll("button[data-img]").forEach(b => {
      b.onclick = e => { e.stopPropagation(); const t = byId[b.dataset.img]; if (t && t.img) viewTradeImg(t); };
    });
  }
  function viewTradeImg(t) {
    modal("📷 " + t.symbol + " · צילום גרף", '<img src="' + t.img + '" alt="צילום גרף" style="max-width:100%;max-height:70vh;border-radius:8px;display:block;margin:0 auto">' +
      (t.notes ? '<div class="note" style="margin-top:10px">' + t.notes + "</div>" : ""), []);
  }
  function deleteTrade(t, reopen) {
    if (!t) return;
    const label = t.symbol + " · " + money(t.pnl, 2);
    if (t.source === "manual") {
      if (!confirm("למחוק את העסקה הידנית?\n" + label)) return;
      Store.deleteManual(t.id);
    } else {
      if (!confirm("למחוק את עסקת ה-CSV?\n" + label + "\n\nזה יסיר את פקודות הביצוע (fills) שמרכיבות אותה מהיומן.")) return;
      Store.deleteFills(t.fillKeys || []);
    }
    render();
    toast("נמחק");
    if (reopen) reopen();
  }

  // ---- Equity curve ------------------------------------------------------
  let eqMode = "abs";   // "abs" ($) | "pct" (% of portfolio size)
  function eqBaseKey(acct) { return "sn_eq_base_" + (acct || "_"); }
  function getEqBase(acct) { try { const v = parseFloat(localStorage.getItem(eqBaseKey(acct))); return v > 0 ? v : null; } catch (e) { return null; } }
  function setEqBase(acct, v) { try { localStorage.setItem(eqBaseKey(acct), String(v)); } catch (e) {} }
  // estimate portfolio size = peak capital deployed at once (sum of open trades' cost basis over time)
  function peakCapital(trades) {
    const evts = [];
    trades.forEach(t => {
      const cost = Math.abs((t.entryPrice || 0) * (t.qty || 0) * (t.mult || 1));
      if (cost > 0 && t.entryDate && t.exitDate) { evts.push([t.entryDate, cost]); evts.push([t.exitDate, -cost]); }
    });
    evts.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] - b[1]));   // same day: releases before adds
    let cur = 0, peak = 0;
    evts.forEach(e => { cur += e[1]; if (cur > peak) peak = cur; });
    return Math.round(peak);
  }
  function renderEquity(trades) {
    const box = el("div", "chartbox");
    const acct = state.account;
    const autoBase = peakCapital(trades);
    const base = getEqBase(acct) || autoBase || 0;
    // header: title + $/% toggle
    const head = el("div", "eq-head");
    head.innerHTML = '<h3>עקומת הון (רווח/הפסד מצטבר)</h3>' +
      '<span class="eq-modes"><button class="eq-mode-btn' + (eqMode === "abs" ? " on" : "") + '" data-eqmode="abs">$</button>' +
      '<button class="eq-mode-btn' + (eqMode === "pct" ? " on" : "") + '" data-eqmode="pct">%</button></span>';
    box.appendChild(head);
    head.querySelectorAll("[data-eqmode]").forEach(b => b.onclick = () => {
      if (eqMode === b.dataset.eqmode) return; eqMode = b.dataset.eqmode; render();
    });
    // in % mode: editable portfolio-size base (the % denominator)
    if (eqMode === "pct") {
      const baseRow = el("div", "eq-base-row");
      baseRow.innerHTML = '<label>גודל תיק: $<input type="number" class="eq-base-inp" value="' + base + '" min="1" step="100"></label>' +
        '<span class="muted">' + (getEqBase(acct) == null ? "הערכה אוטומטית (ההון המרבי שהיה בשוק) — ניתן לערוך" : "האחוזים מחושבים מהערך הזה") + "</span>";
      box.appendChild(baseRow);
      const inp = baseRow.querySelector(".eq-base-inp");
      inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) { setEqBase(acct, v); render(); } };
    }
    const pts = E.equityCurve(trades);
    if (pts.length < 2) { box.appendChild(el("div", "note", "צריך לפחות שני ימי מסחר כדי לצייר עקומה.")); return box; }
    const pctMode = eqMode === "pct" && base > 0;
    const toVal = eq => pctMode ? eq / base * 100 : eq;                       // $ → % of portfolio
    const fmtVal = v => pctMode ? (v >= 0 ? "+" : "") + v.toFixed(2) + "%" : money(v, 0);
    const W = 1500, H = 420, pad = 46;   // ~3.6:1 aspect (not squished); scaled with "meet" → no distortion
    const eq = pts.map(p => toVal(p.equity));
    const minY = Math.min(0, Math.min.apply(null, eq)), maxY = Math.max(0, Math.max.apply(null, eq));
    const rng = (maxY - minY) || 1;
    const X = i => pad + (i / (pts.length - 1)) * (W - pad * 2);
    const Y = v => H - pad - ((v - minY) / rng) * (H - pad * 2);
    let dpath = "", apath = "";
    pts.forEach((p, i) => { const x = X(i), y = Y(eq[i]); dpath += (i ? "L" : "M") + x + " " + y + " "; });
    apath = dpath + "L" + X(pts.length - 1) + " " + Y(minY) + " L" + X(0) + " " + Y(minY) + " Z";
    const zeroY = Y(0);
    const last = eq[eq.length - 1];
    const svg =
      '<svg class="eqsvg" viewBox="0 0 ' + W + " " + H + '" width="100%" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#7c6cf0" stop-opacity=".35"/><stop offset="1" stop-color="#7c6cf0" stop-opacity="0"/></linearGradient></defs>' +
      '<line class="axis" x1="' + pad + '" y1="' + zeroY + '" x2="' + (W - pad) + '" y2="' + zeroY + '"/>' +
      '<path class="eqarea" d="' + apath + '"/>' +
      '<path class="eqline" d="' + dpath + '"/>' +
      '<text x="' + (W - pad) + '" y="' + (Y(last) - 8) + '" text-anchor="end" fill="' + (last >= 0 ? "#16b877" : "#e0524f") +
      '" font-size="15" font-weight="700">' + fmtVal(last) + "</text>" +
      // hover crosshair: vertical line + dot on the curve, P&L label on top, date label at bottom
      '<g class="eqhover" style="opacity:0">' +
        '<line class="eqcross" x1="0" y1="' + pad + '" x2="0" y2="' + (H - pad) + '"/>' +
        '<circle class="eqdot" cx="0" cy="0" r="5"/>' +
        '<rect class="eqtipbg eqtop" x="0" y="4" width="120" height="26" rx="7"/>' +
        '<text class="eqtiptext eqtoptext" x="0" y="22" text-anchor="middle">—</text>' +
        '<rect class="eqtipbg eqbot" x="0" y="' + (H - 27) + '" width="100" height="23" rx="7"/>' +
        '<text class="eqtiptext eqbottext" x="0" y="' + (H - 11) + '" text-anchor="middle">—</text>' +
      "</g>" +
      "</svg>";
    box.insertAdjacentHTML("beforeend", svg);   // append WITHOUT reserializing box (keeps toggle/input handlers)
    // ---- hover interaction ----
    const svgEl = box.querySelector(".eqsvg");
    const g = svgEl.querySelector(".eqhover");
    const cross = svgEl.querySelector(".eqcross"), dot = svgEl.querySelector(".eqdot");
    const tTxt = svgEl.querySelector(".eqtoptext"), bTxt = svgEl.querySelector(".eqbottext");
    const tBg = svgEl.querySelector(".eqtop"), bBg = svgEl.querySelector(".eqbot");
    const clampX = (cx, w) => Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, cx));
    function moveTo(clientX) {
      const rect = svgEl.getBoundingClientRect();
      if (!rect.width) return;
      const sx = (clientX - rect.left) / rect.width * W;
      let i = Math.round((sx - pad) / (W - pad * 2) * (pts.length - 1));
      i = Math.max(0, Math.min(pts.length - 1, i));
      const x = X(i), val = eq[i], y = Y(val);
      const posCol = val >= 0 ? "#16b877" : "#e0524f";
      cross.setAttribute("x1", x); cross.setAttribute("x2", x);
      dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("fill", posCol);
      // top label = cumulative P&L at this point ($ or % of portfolio)
      const topStr = fmtVal(val);
      tTxt.textContent = topStr;
      const wT = Math.max(70, topStr.length * 11 + 20);
      tBg.setAttribute("width", wT); tBg.setAttribute("x", clampX(x, wT) - wT / 2); tBg.setAttribute("fill", posCol);
      tTxt.setAttribute("x", clampX(x, wT));
      // bottom label = date
      bTxt.textContent = pts[i].date;
      const wB = Math.max(84, pts[i].date.length * 9 + 16);
      bBg.setAttribute("width", wB); bBg.setAttribute("x", clampX(x, wB) - wB / 2);
      bTxt.setAttribute("x", clampX(x, wB));
      g.style.opacity = "1";
    }
    svgEl.addEventListener("mousemove", e => moveTo(e.clientX));
    svgEl.addEventListener("mouseleave", () => { g.style.opacity = "0"; });
    svgEl.addEventListener("touchmove", e => { if (e.touches && e.touches[0]) moveTo(e.touches[0].clientX); }, { passive: true });
    return box;
  }

  // ---- Trades table ------------------------------------------------------
  function renderTrades(trades, openPositions) {
    const wrap = el("div");
    // position value = entry notional (qty × entry price × multiplier). Precomputed so the column sorts.
    const withPv = trades.map(t => Object.assign({}, t, { posValue: (t.entryPrice || 0) * (t.qty || 0) * (t.mult || 1) }));
    const sorted = withPv.sort((a, b) => {
      let av = a[state.sortKey], bv = b[state.sortKey];
      if (typeof av === "string") { return (av < bv ? -1 : av > bv ? 1 : 0) * state.sortDir; }
      return (av - bv) * state.sortDir;
    });
    const showAcct = state.account === ALL;   // combined view → show which account each trade is in
    const cols = [
      ...(showAcct ? [["account", "חשבון"]] : []),
      ["exitDate", "תאריך יציאה"], ["symbol", "סימבול"], ["assetType", "סוג"],
      ["direction", "כיוון"], ["qty", "כמות"], ["entryPrice", "כניסה"], ["posValue", "שווי פוזיציה"],
      ["exitPrice", "יציאה"], ["fees", "עמלות"], ["pnl", "נטו"], ["source", "מקור"],
    ];
    let head = "<tr>";
    cols.forEach(([k, l]) => {
      const arrow = state.sortKey === k ? (state.sortDir < 0 ? " ▾" : " ▴") : "";
      head += '<th data-k="' + k + '">' + l + arrow + "</th>";
    });
    head += "<th></th></tr>";
    let rows = "";
    sorted.forEach(t => {
      rows += "<tr>" +
        (showAcct ? '<td class="muted" style="white-space:nowrap">' + (t.account || "—") + "</td>" : "") +
        "<td>" + t.exitDate + "</td>" +
        "<td>" + chartSym(t.symbol) + "</td>" +
        '<td><span class="pill ' + (t.assetType === "option" ? "opt" : "stk") + '">' + (t.assetType === "option" ? "אופ׳" : "מניה") + "</span></td>" +
        '<td><span class="pill ' + t.direction + '">' + (t.direction === "long" ? "לונג" : "שורט") + "</span></td>" +
        "<td>" + t.qty + "</td>" +
        "<td>" + money(t.entryPrice, 2) + "</td>" +
        "<td>" + money(t.posValue, 0) + "</td>" +
        "<td>" + money(t.exitPrice, 2) + "</td>" +
        '<td class="zero">' + money(-t.fees, 2) + "</td>" +
        '<td class="' + cls(t.pnl) + '">' + money(t.pnl, 2) + "</td>" +
        '<td><span class="pill src">' + (t.source === "manual" ? "ידני" : "CSV") + "</span></td>" +
        "<td>" +
          (t.img ? '<button class="btn ghost" data-img="' + t.id + '" title="צפה בצילום הגרף">📷</button> ' : "") +
          (t.source === "manual" ? '<button class="btn ghost" data-edit="' + t.id + '" title="ערוך">✏️</button> ' : "") +
          '<button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>' +
        "</td>" +
        "</tr>";
    });
    const box = el("div", "tablebox");
    box.innerHTML = "<table><thead>" + head + "</thead><tbody>" + rows + "</tbody></table>";
    box.querySelectorAll("th[data-k]").forEach(th => {
      th.onclick = () => {
        const k = th.dataset.k;
        if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = -1; }
        render();
      };
    });
    wireTradeActions(box, sorted, null);
    wrap.appendChild(box);

    if (openPositions && openPositions.length) {
      const op = el("div", "note");
      op.innerHTML = "<b>פוזיציות פתוחות (לא נסגרו, לא נכללות ברווח/הפסד):</b> " +
        openPositions.map(p => p.symbol + " " + (p.qty > 0 ? "+" : "") + p.qty).join(" · ");
      wrap.appendChild(op);
    }
    return wrap;
  }

  // ---- Import modal ------------------------------------------------------
  function openImport() {
    const body =
      '<div class="drop" id="drop"><div class="big" style="font-size:34px">📥</div>' +
      "<b>גרור לכאן קובץ CSV</b> מהברוקר<br><span style=\"font-size:12px\">או לחץ לבחירת קובץ · אפשר כמה קבצים יחד</span></div>" +
      '<input type="file" id="fileInput" accept=".csv" multiple class="hidden">' +
      '<div class="note">כפילויות מזוהות אוטומטית לפי זמן ביצוע — אפשר להעלות קבצים חופפים בלי דאגה.</div>';
    modal("העלאת נתונים", body);
    const drop = $("#drop"), input = $("#fileInput");
    drop.onclick = () => input.click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("hot"); };
    drop.ondragleave = () => drop.classList.remove("hot");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("hot"); handleFiles(e.dataTransfer.files); };
    input.onchange = () => handleFiles(input.files);
  }
  function handleFiles(files) {
    let pending = files.length, totalAdded = 0, errs = [];
    const importedAccts = new Set();   // accounts that received data → so we can switch the view to them
    if (!pending) return;
    Array.from(files).forEach(file => {
      const rd = new FileReader();
      rd.onload = () => {
        const res = E.parseCSV(rd.result);
        if (res.errors.length) errs = errs.concat(res.errors.slice(0, 3));
        totalAdded += Store.addFills(res.fills);
        (res.fills || []).forEach(f => importedAccts.add((f.account || "").trim()));
        if (--pending === 0) finishImport(totalAdded, errs, Array.from(importedAccts));
      };
      rd.onerror = () => { if (--pending === 0) finishImport(totalAdded, errs, Array.from(importedAccts)); };
      rd.readAsText(file);
    });
  }
  function finishImport(added, errs, importedAccts) {
    closeModal();
    const accts = Store.accounts();
    // switch the view to the imported account so the new trades are actually VISIBLE — otherwise, if
    // the user already had another account selected, the import lands elsewhere and looks like nothing
    // happened. Prefer an imported account that now exists; fall back to first account / combined view.
    if (added) {
      const target = (importedAccts || []).find(a => accts.indexOf(a) >= 0);
      if (target) state.account = target;
      else if (!state.account && accts.length) state.account = accts[0];
      else if (accts.length > 1) state.account = ALL;
    } else if (!state.account && accts.length) {
      state.account = accts[0];
    }
    render();
    if (added) {
      const r = tradesForAccount();
      const closed = r.trades.length;
      const open = (r.openPositions ? r.openPositions.length : 0) + (r.manualOpen ? r.manualOpen.length : 0);
      if (closed > 0) {
        toast("נוספו " + added + " ביצועים · " + closed + " עסקאות סגורות" + (open ? " · " + open + " פוזיציות פתוחות" : ""));
      } else {
        // fills imported but every one is still OPEN (e.g. a year of buys whose sells are in a later
        // file) — say so, otherwise the empty stats/calendar look like the import failed
        alert("נוספו " + added + " ביצועים — אבל כולם פוזיציות שעדיין פתוחות (טרם נסגרו), לכן אין עדיין עסקאות סגורות בסטטיסטיקה ובלוח (רק בפאנל \"פוזיציות פתוחות\").\n\n💡 כדי לראות אותן כעסקאות מלאות, ייבא גם את הקובץ של השנה שבה סגרת אותן — היומן מחבר קנייה→מכירה גם בין קבצים שונים.");
      }
    } else if (errs.length) {
      const noTrades = errs.some(e => e.indexOf("אין בו עסקאות") >= 0);
      if (noTrades) {
        // an IBKR statement for a period with no trades — informational, not a failure
        alert("ℹ️ " + errs[0]);
      } else {
        // show the REAL reason (unsupported format / bad dates), not a misleading "duplicates?"
        alert("הייבוא נכשל:\n\n" + errs.slice(0, 4).join("\n") +
          "\n\n💡 הקובץ צריך לכלול עמודות: תאריך · סימבול · כמות · מחיר (ו-Side או כמות עם +/−). נתמכים גם קובצי Interactive Brokers.");
      }
    } else {
      toast("לא נוספו ביצועים חדשים (כנראה כפילויות של ביצועים שכבר ביומן)");
    }
    if (errs.length) console.warn("Import warnings:", errs);
  }

  // ---- Manual entry: attached chart image (paste / upload) ---------------
  let manualImg = null;  // data URL of the attached image (null = none)
  function _compressImg(dataUrl, cb) {
    const img = new Image();
    img.onload = () => {
      const MAX = 1100; let w = img.width, h = img.height;
      if (Math.max(w, h) > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      try { cb(cv.toDataURL("image/jpeg", 0.72)); } catch (e) { cb(dataUrl); }
    };
    img.onerror = () => cb(null);
    img.src = dataUrl;
  }
  function _readImgFile(file) {
    if (!file || file.type.indexOf("image") !== 0) return;
    const r = new FileReader();
    r.onload = () => _compressImg(r.result, setManualImg);
    r.readAsDataURL(file);
  }
  function setManualImg(dataUrl) {
    manualImg = dataUrl || null;
    const prev = document.getElementById("m_imgpreview"), empty = document.getElementById("m_imgempty"), clr = document.getElementById("m_imgclear");
    if (!prev) return;
    if (manualImg) { prev.src = manualImg; prev.classList.remove("hidden"); if (empty) empty.classList.add("hidden"); if (clr) clr.classList.remove("hidden"); }
    else { prev.removeAttribute("src"); prev.classList.add("hidden"); if (empty) empty.classList.remove("hidden"); if (clr) clr.classList.add("hidden"); }
  }
  let _pasteHooked = false;
  function _hookPaste() {
    if (_pasteHooked) return; _pasteHooked = true;
    document.addEventListener("paste", e => {
      if (!document.getElementById("m_imgzone")) return;  // only while the manual modal is open
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image") === 0) { const f = items[i].getAsFile(); if (f) { e.preventDefault(); _readImgFile(f); return; } }
      }
    });
  }

  // ---- Manual entry wizard (2 steps: OPEN → CLOSE) -----------------------
  let _mData = null;        // in-progress values, kept across step switches
  let _mStep = 1;           // 1 = open trade, 2 = close trade
  function openManual(existing) {
    manualEditId = existing && existing.source === "manual" ? existing.id : null;
    _mData = {
      account: existing ? existing.account : (state.account === ALL ? "" : (state.account || "")),
      symbol: existing ? existing.symbol : "",
      assetType: existing ? existing.assetType : "stock",
      direction: existing ? existing.direction : "long",
      qty: existing && existing.qty != null ? existing.qty : "",
      entryPrice: existing && existing.entryPrice != null ? existing.entryPrice : "",
      exitPrice: existing && existing.exitPrice != null ? existing.exitPrice : "",
      entryDate: existing ? (existing.entryDate || "") : "",
      exitDate: existing && existing.exitDate ? existing.exitDate : "",
      fees: existing && existing.fees != null ? existing.fees : lastFee(),
      notes: existing ? (existing.notes || "") : "",
      closeType: "full", closeQty: "",
    };
    manualImg = (existing && existing.img) || null;
    _mStep = 1;
    renderManualStep();
  }
  // pull whatever inputs exist in the CURRENT step into _mData (never clobber a
  // field whose input isn't on screen this step)
  function syncFromDOM() {
    const g = id => { const e = document.getElementById(id); return e ? e.value : undefined; };
    const set = (k, id) => { const v = g(id); if (v !== undefined) _mData[k] = v; };
    set("entryDate", "m_ed"); set("account", "m_acct"); set("symbol", "m_sym"); set("assetType", "m_asset");
    set("direction", "m_dir"); set("qty", "m_qty"); set("entryPrice", "m_ep"); set("notes", "m_notes");
    set("exitDate", "m_xd"); set("exitPrice", "m_xp"); set("fees", "m_fee");
    set("closeType", "m_closetype"); set("closeQty", "m_closeqty");
  }
  function gotoStep(n) { syncFromDOM(); _mStep = n; renderManualStep(); }
  function renderManualStep() {
    const d = _mData, accts = Store.accounts();
    const opt = (v, cur, lbl) => '<option value="' + v + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + lbl + "</option>";
    let body, title, actions;
    if (_mStep === 1) {
      const acctField = accts.length
        ? '<select id="m_acct">' + accts.map(a => '<option value="' + a + '"' + (a === d.account ? " selected" : "") + ">" + a + "</option>").join("") +
          '<option value="__new"' + (d.account === "" ? " selected" : "") + ">➕ חשבון חדש…</option></select>"
        : '<input id="m_acct" placeholder="שם/מספר חשבון" value="' + (d.account || "") + '">';
      title = manualEditId ? "עריכת עסקה · פתיחה" : "עסקה חדשה · פתיחה";
      body =
        '<div class="wiz-steps"><span class="wiz-dot on">1 · פתיחה</span><span class="wiz-arrow">→</span><span class="wiz-dot">2 · סגירה</span></div>' +
        '<div class="form">' +
        field("תאריך כניסה", '<input id="m_ed" type="date" value="' + (d.entryDate || "") + '">') +
        field("חשבון", acctField, true) +
        field("סימבול", '<input id="m_sym" placeholder="AAPL" style="text-transform:uppercase" value="' + (d.symbol || "") + '">') +
        field("סוג נכס", '<select id="m_asset">' + opt("stock", d.assetType, "מניה") + opt("option", d.assetType, "אופציה (×100)") + "</select>") +
        field("כיוון", '<select id="m_dir">' + opt("long", d.direction, "לונג") + opt("short", d.direction, "שורט") + "</select>") +
        field("כמות", '<input id="m_qty" type="number" step="any" placeholder="100" value="' + (d.qty === "" ? "" : d.qty) + '">') +
        field("מחיר כניסה", '<input id="m_ep" type="number" step="any" value="' + (d.entryPrice === "" ? "" : d.entryPrice) + '">') +
        field("הערות", '<textarea id="m_notes" placeholder="למה נכנסתי? מה למדתי?">' + (d.notes || "") + "</textarea>", true) +
        field("📷 צילום גרף (אופציונלי)",
          '<div id="m_imgzone" class="img-zone" tabindex="0">' +
            '<input type="file" id="m_imgfile" accept="image/*" style="display:none">' +
            '<div class="img-zone-empty" id="m_imgempty">גרור / הדבק (Ctrl+V) / לחץ להעלאת צילום מסך של הגרף</div>' +
            '<img id="m_imgpreview" class="img-preview hidden" alt="צילום גרף">' +
            '<button type="button" id="m_imgclear" class="img-clear hidden" title="הסר תמונה">✕</button>' +
          "</div>", true) +
        "</div>" +
        '<div class="pnlpreview" id="m_preview" style="margin-top:14px"></div>' +
        '<div class="price-warn hidden" id="m_pricewarn"></div>';
      const hasExitSeed = d.exitPrice !== "" && d.exitPrice != null;
      actions = [
        { label: hasExitSeed ? "💾 שמור עסקה" : "💾 שמור כפוזיציה פתוחה", cls: "primary", fn: () => saveManual(false) },
        { label: "לסגירת העסקה →", cls: "", fn: () => gotoStep(2) },
      ];
    } else {
      const q = Math.abs(parseFloat(d.qty) || 0);
      const dirHe = d.direction === "short" ? "🔴 שורט" : "🟢 לונג";
      title = "עסקה · סגירה";
      body =
        '<div class="wiz-steps"><span class="wiz-dot done">1 · פתיחה</span><span class="wiz-arrow">→</span><span class="wiz-dot on">2 · סגירה</span></div>' +
        '<div class="note" style="margin:0 0 12px">סוגר: <b>' + (d.symbol || "—").toUpperCase() + "</b> · " + dirHe + " · " + (q || "?") + " יח׳ @ " + (d.entryPrice || "?") + "$ · כניסה " + (d.entryDate || "—") + "</div>" +
        '<div class="form">' +
        field("סוג סגירה", '<select id="m_closetype">' + opt("full", d.closeType, "מלאה — כל הפוזיציה") + opt("partial", d.closeType, "חלקית — חלק מהכמות") + "</select>") +
        field("כמות שנסגרה", '<input id="m_closeqty" type="number" step="any" min="0" max="' + (q || "") + '" placeholder="כמה יח׳ נסגרו" value="' + (d.closeQty === "" ? "" : d.closeQty) + '"' + (d.closeType === "partial" ? "" : " disabled") + '>', false) +
        field("תאריך יציאה", '<input id="m_xd" type="date" value="' + (d.exitDate || "") + '">') +
        field("מחיר יציאה", '<input id="m_xp" type="number" step="any" placeholder="מחיר הסגירה" value="' + (d.exitPrice === "" ? "" : d.exitPrice) + '">') +
        field("עמלות", '<input id="m_fee" type="number" step="any" value="' + (d.fees == null ? "0" : d.fees) + '">') +
        "</div>" +
        '<div class="pnlpreview" id="m_preview" style="margin-top:14px"></div>' +
        '<div class="price-warn hidden" id="m_pricewarn"></div>';
      actions = [
        { label: "✓ שמור סגירה", cls: "primary", fn: () => saveManual(true) },
        { label: "← חזרה לפתיחה", cls: "", fn: () => gotoStep(1) },
      ];
    }
    modal(title, body, actions);
    // wire common preview + validation
    ["m_asset", "m_dir", "m_qty", "m_ep", "m_xp", "m_fee", "m_closetype", "m_closeqty"].forEach(id => {
      const e = document.getElementById(id); if (e) { e.oninput = updatePreview; e.onchange = updatePreview; }
    });
    ["m_sym", "m_ed", "m_ep", "m_xd", "m_xp"].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.addEventListener("change", scheduleValidatePrices); e.addEventListener("blur", scheduleValidatePrices); }
    });
    if (_mStep === 2) {
      const ct = document.getElementById("m_closetype"), cq = document.getElementById("m_closeqty");
      if (ct && cq) ct.onchange = () => { cq.disabled = ct.value !== "partial"; if (ct.value !== "partial") cq.value = ""; updatePreview(); };
    }
    if (_mStep === 1) {
      const acctSel = document.getElementById("m_acct");
      if (acctSel && acctSel.tagName === "SELECT") acctSel.onchange = () => {
        if (acctSel.value === "__new") {
          const name = prompt("שם/מספר החשבון החדש:");
          if (name) { const o = el("option"); o.value = name; o.textContent = name; acctSel.insertBefore(o, acctSel.lastChild); o.selected = true; }
          else acctSel.selectedIndex = 0;
        }
      };
      _hookPaste();
      const zone = document.getElementById("m_imgzone"), imgFile = document.getElementById("m_imgfile");
      if (zone && imgFile) {
        zone.onclick = e => { if (e.target.id !== "m_imgclear") imgFile.click(); };
        imgFile.onchange = () => { if (imgFile.files && imgFile.files[0]) _readImgFile(imgFile.files[0]); };
        zone.ondragover = e => { e.preventDefault(); zone.classList.add("drag"); };
        zone.ondragleave = () => zone.classList.remove("drag");
        zone.ondrop = e => { e.preventDefault(); zone.classList.remove("drag"); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) _readImgFile(f); };
        const clr = document.getElementById("m_imgclear");
        if (clr) clr.onclick = e => { e.stopPropagation(); setManualImg(null); };
        setManualImg(manualImg);
      }
    }
    updatePreview();
  }
  // ---- soft price validation (was the entered price within that day's range?) ----
  let _priceTimer = null;
  function scheduleValidatePrices() { clearTimeout(_priceTimer); _priceTimer = setTimeout(validateManualPrices, 450); }
  async function validateManualPrices() {
    const warnEl = document.getElementById("m_pricewarn");
    if (!warnEl) return;
    const cfg = window.SN_CONFIG;
    const gv = id => { const e = document.getElementById(id); return e ? e.value : ""; };
    const sym = (gv("m_sym") || "").toUpperCase().trim();
    const isOpt = gv("m_asset") === "option"; // option premium isn't the stock's price → skip the range check
    if (!cfg || !cfg.SUPABASE_URL || !sym) { warnEl.classList.add("hidden"); return; }
    const checks = [
      { label: "כניסה", price: parseFloat(gv("m_ep")), date: gv("m_ed") },
      { label: "יציאה", price: parseFloat(gv("m_xp")), date: gv("m_xd") },
    ];
    const warns = [];
    for (const c of checks) {
      if (!c.date || !c.price || isNaN(c.price)) continue;
      try {
        const r = await fetch(cfg.SUPABASE_URL + "/functions/v1/super-processor?symbol=" + encodeURIComponent(sym) + "&date=" + c.date,
          { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY } });
        if (!r.ok) continue;
        const d = await r.json();
        if (!d.found || d.low == null || d.high == null) {
          warns.push("אין נתוני מסחר ל-" + sym + " בתאריך ה" + c.label + " (" + c.date + ") — יום סגור / חג, או תאריך שגוי");
          continue;
        }
        const tol = 0.005, lo = d.low * (1 - tol), hi = d.high * (1 + tol);
        if (!isOpt && (c.price < lo || c.price > hi)) {
          warns.push("מחיר ה" + c.label + " (" + c.price + "$) מחוץ לטווח של " + sym + " ב-" + c.date +
            " (נע בין " + d.low + "$ ל-" + d.high + "$)");
        }
      } catch (e) { /* function not deployed / offline — stay silent */ }
    }
    if (warns.length) {
      warnEl.innerHTML = "⚠️ " + warns.join("<br>") + "<br><span style='opacity:.75;font-weight:400'>אפשר להמשיך בכל זאת — זו רק בדיקת ודאות.</span>";
      warnEl.classList.remove("hidden");
    } else {
      warnEl.classList.add("hidden");
    }
  }
  function field(label, control, full) {
    return '<div class="field' + (full ? " full" : "") + '"><label>' + label + "</label>" + control + "</div>";
  }
  function readManual() {
    syncFromDOM();
    const d = _mData;
    return {
      id: manualEditId || undefined,
      account: (d.account || "").trim(),
      symbol: d.symbol, assetType: d.assetType, direction: d.direction,
      qty: d.qty, entryPrice: d.entryPrice, exitPrice: d.exitPrice,
      entryDate: d.entryDate, exitDate: d.exitDate || d.entryDate, fees: d.fees, notes: d.notes,
      img: manualImg || undefined,
    };
  }
  function updatePreview() {
    syncFromDOM();
    const p = document.getElementById("m_preview");
    if (!p) return;
    const d = _mData;
    const hasExit = d.exitPrice !== "" && d.exitPrice != null && !isNaN(parseFloat(d.exitPrice));
    if (!hasExit) {
      p.className = "pnlpreview";
      p.textContent = d.assetType === "option"
        ? "📌 פוזיציה פתוחה — טרם נסגרה. לאופציות אין מחיר חי, אז ה-P&L יחושב בסגירה (לפי מחיר היציאה ×100)."
        : "📌 פוזיציה פתוחה — טרם נסגרה. ה-Unrealized P&L יוצג ביומן לפי מחיר חי.";
      return;
    }
    const fullQty = Math.abs(parseFloat(d.qty) || 0);
    const partial = d.closeType === "partial";
    const cq = partial ? Math.abs(parseFloat(d.closeQty) || 0) : fullQty;
    const useQty = cq || fullQty;
    const t = E.manualToTrade({ account: d.account, symbol: d.symbol, assetType: d.assetType, direction: d.direction, qty: useQty, entryPrice: d.entryPrice, exitPrice: d.exitPrice, entryDate: d.entryDate, exitDate: d.exitDate || d.entryDate, fees: d.fees });
    p.className = "pnlpreview " + cls(t.pnl);
    const extra = (partial && cq && cq < fullQty) ? (" · נשארות " + (fullQty - cq) + " יח׳ פתוחות") : "";
    p.textContent = "רווח/הפסד משוער: " + money(t.pnl, 2) + extra;
  }
  // remember the last commission the user entered, so it prefills next time
  function lastFee() { try { return localStorage.getItem("sn_last_fee") || "0"; } catch (e) { return "0"; } }
  function finishSave(kind, account) {
    manualEditId = null;
    if (account && account !== ALL) state.account = account;
    closeModal();
    render();
    toast(kind === "partial" ? "נסגר חלקית — השארית נשמרה כפוזיציה פתוחה"
      : kind === "open" ? "נשמרה כפוזיציה פתוחה"
      : kind === "edit" ? "העסקה עודכנה" : "העסקה נשמרה");
  }
  function saveManual(isClose) {
    syncFromDOM();
    const d = _mData;
    const account = (d.account || "").trim();
    if (!account || account === "__new") { alert("צריך לבחור/להזין חשבון"); return; }
    if (!d.symbol) { alert("צריך סימבול"); return; }
    if (!d.entryDate) { alert("צריך תאריך כניסה"); return; }
    const fullQty = Math.abs(parseFloat(d.qty) || 0);
    if (!fullQty) { alert("צריך כמות"); return; }
    const hasExit = d.exitPrice !== "" && d.exitPrice != null && !isNaN(parseFloat(d.exitPrice));
    try { localStorage.setItem("sn_last_fee", String(d.fees == null ? 0 : d.fees)); } catch (e) {}
    const base = { account: account, symbol: d.symbol, assetType: d.assetType, direction: d.direction, entryPrice: d.entryPrice, entryDate: d.entryDate, notes: d.notes, img: manualImg || undefined };
    // partial close → a closed record for the sold qty + a remaining OPEN record
    if (isClose && hasExit && d.closeType === "partial") {
      const cq = Math.abs(parseFloat(d.closeQty) || 0);
      if (!cq) { alert("כמה יחידות נסגרו? הזן כמות."); return; }
      if (cq < fullQty) {
        Store.addManual(E.manualToTrade(Object.assign({}, base, { qty: cq, exitPrice: d.exitPrice, exitDate: d.exitDate || d.entryDate, fees: d.fees })));
        const remain = E.manualToTrade(Object.assign({}, base, { id: manualEditId || undefined, qty: fullQty - cq, exitPrice: "", exitDate: "", fees: 0 }));
        if (manualEditId) Store.updateManual(remain); else Store.addManual(remain);
        finishSave("partial", account); return;
      }
      // cq >= fullQty → treat as a full close (fall through)
    }
    const t = E.manualToTrade(Object.assign({}, base, { id: manualEditId || undefined, qty: fullQty, exitPrice: hasExit ? d.exitPrice : "", exitDate: hasExit ? (d.exitDate || d.entryDate) : "", fees: d.fees }));
    if (manualEditId) Store.updateManual(t); else Store.addManual(t);
    finishSave(manualEditId ? "edit" : (hasExit ? "closed" : "open"), account);
  }

  // ---- Modal infra -------------------------------------------------------
  function modal(title, bodyHtml, actions) {
    closeModal();
    const bg = el("div", "modal-bg"); bg.id = "modalBg";
    const m = el("div", "modal");
    m.innerHTML = "<h2>" + title + "</h2>" + bodyHtml;
    const act = el("div", "modal-actions");
    (actions || []).forEach(a => { const b = el("button", "btn " + (a.cls || ""), a.label); b.onclick = a.fn; act.appendChild(b); });
    const close = el("button", "btn ghost", "סגור"); close.onclick = closeModal; act.appendChild(close);
    m.appendChild(act); bg.appendChild(m);
    let downOnBg = false;
    bg.addEventListener("mousedown", e => { downOnBg = (e.target === bg); });
    bg.onclick = e => { if (e.target === bg && downOnBg) closeModal(); };
    document.body.appendChild(bg);
  }
  function closeModal() { const b = $("#modalBg"); if (b) b.remove(); }

  // ---- Wire up -----------------------------------------------------------
  function init() {
    $("#importBtn").onclick = openImport;
    $("#manualBtn").onclick = () => openManual();
    $("#acctSel").onchange = e => { state.account = e.target.value; state.monthIdx = 999; render(); };
    document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
      state.tab = t.dataset.tab;
      render();
      // on phones the stat cards are identical & tall — scroll to the tab's own view
      if (window.innerWidth <= 640) {
        const v = $("#view");
        if (v && v.lastElementChild) v.lastElementChild.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    $("#menuBtn").onclick = openMenu;
    state.monthIdx = 999;
    render();
  }
  function openMenu() {
    const accts = Store.accounts();
    const d = Store.exportData();
    const body =
      '<div class="note" style="margin:0 0 14px">ניהול נתונים. הכול נשמר מקומית בדפדפן זה בלבד — <b>מומלץ לייצא גיבוי מדי פעם</b> (הנתונים נמחקים אם מנקים את הדפדפן).</div>' +
      (accts.length ? '<div style="margin-bottom:6px"><b>חשבונות:</b> ' + accts.join(" · ") + "</div>" : "") +
      '<div class="note" style="margin:0 0 12px">מאוחסן: ' + (d.fills ? d.fills.length : 0) + " ביצועי CSV · " + (d.manual ? d.manual.length : 0) + " עסקאות ידניות</div>" +
      '<input type="file" id="restoreInput" accept=".json" class="hidden">';
    modal("הגדרות / נתונים", body, [
      { label: "⬇️ ייצוא גיבוי", cls: "primary", fn: exportBackup },
      { label: "⬆️ שחזור מגיבוי", cls: "", fn: () => { const inp = $("#restoreInput"); inp.onchange = () => { if (inp.files[0]) restoreBackup(inp.files[0]); }; inp.click(); } },
      { label: "✏️ שנה שם חשבון", cls: "", fn: () => {
          if (!state.account || state.account === ALL) { alert("בחר חשבון ספציפי (לא 'כל החשבונות') כדי לשנות את שמו."); return; }
          const nn = (prompt('שם חדש לחשבון "' + state.account + '":', state.account) || "").trim();
          if (!nn || nn === state.account) return;
          if (Store.accounts().indexOf(nn) >= 0) { alert("כבר קיים חשבון בשם הזה — בחר שם אחר."); return; }
          Store.renameAccount(state.account, nn); state.account = nn; closeModal(); render(); toast("שם החשבון עודכן ל-" + nn);
        } },
      { label: "מחק חשבון נוכחי", cls: "", fn: () => { if (state.account && state.account !== ALL && confirm("למחוק את כל הנתונים של " + state.account + "?")) { Store.clearAccount(state.account); state.account = null; closeModal(); render(); toast("נמחק"); } } },
      { label: "מחק הכול", cls: "", fn: () => { if (confirm("למחוק את כל הנתונים מכל החשבונות?")) { Store.clearAll(); state.account = null; closeModal(); render(); toast("הכול נמחק"); } } },
    ]);
  }
  function exportBackup() {
    const data = Store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    const a = document.createElement("a");
    a.href = url; a.download = "stratninja-journal-backup-" + stamp + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast("הגיבוי הורד ✓");
  }
  function restoreBackup(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const obj = JSON.parse(rd.result);
        if (!obj || (!obj.fills && !obj.manual)) { alert("הקובץ אינו גיבוי תקין של היומן"); return; }
        const res = Store.importData(obj);
        closeModal(); render();
        toast("שוחזר: " + res.fills + " ביצועים, " + res.manual + " עסקאות ידניות");
      } catch (e) { alert("קובץ גיבוי לא תקין (JSON פגום)"); }
    };
    rd.readAsText(file);
  }

  // expose a re-render hook so the cloud-sync layer can refresh the UI after
  // pulling the user's data from Supabase.
  window.Journal = {
    rerender: function () { try { render(); } catch (e) {} },
    // called by the main app when the journal tab is entered — re-hides trades if live-mode is on
    onEnter: function () { try { _journalPeek = false; render(); } catch (e) {} },
    // current-view performance summary (for the share card in the main app)
    summary: function () {
      try {
        const r = tradesForAccount();
        const s = E.stats(r.trades || []);
        // total Unrealized P&L across open positions (stocks: live feed · options: manually-typed price)
        const optPx = _optPrices();
        let un = 0, unHave = false;
        (r.manualOpen || []).forEach(t => {
          const isOpt = t.assetType === "option";
          const cp = isOpt ? (optPx[t.id] != null ? optPx[t.id] : null) : (livePrices ? livePrices[t.symbol] : null);
          if (cp != null) { un += unrealizedPnl(t, cp); unHave = true; }
        });
        return { net: s.net, winRate: s.winRate, profitFactor: s.profitFactor, count: s.count,
          bestTrade: s.bestTrade, worstTrade: s.worstTrade,
          open: (r.openPositions || []).length + (r.manualOpen || []).length,
          unrealized: unHave ? un : null };
      } catch (e) { return null; }
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
