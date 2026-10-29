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
    /* remove ONLY the imported CSV fills (and their derived open positions), keeping manual trades */
    clearFills() { const d = this._read(); d.fills = []; this._write(d); },
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
    /* is there data under a blank/unnamed account? (e.g. a broker CSV with no account column) */
    hasBlank() { const d = this._read(); return d.fills.some(f => !(f.account || "").trim()) || d.manual.some(m => !(m.account || "").trim()); },
  };
  window.Store = Store;

  // ---- App state ---------------------------------------------------------
  const ALL = "__ALL__";    // pseudo-account: combined view of every account
  const state = { account: null, tab: "dashboard", monthIdx: 0, months: [], sortKey: "exitDate", sortDir: -1,
    aggTrades: (function () { try { return localStorage.getItem("sn_agg_trades") !== "0"; } catch (e) { return true; } })(),
    calGran: (function () { try { return localStorage.getItem("sn_cal_gran") || "month"; } catch (e) { return "month"; } })(),
    tradeFilter: "",   // ticker filter text for the closed-trades table
    calYear: null, calQ: null };   // anchor for the quarterly / yearly calendar views
  let manualEditId = null;  // when editing a manual trade, its id; null = adding new
  const OPEN_WARN = 5;      // discipline nudge: warn at this many concurrent open positions
  let _lastOpenCount = 0;   // to fire the crossing popup only once per crossing
  let openPosMin = false;   // collapse the open-positions panel
  try { openPosMin = localStorage.getItem("sn_openpos_min") === "1"; } catch (e) {}
  let _openSort = { col: null, dir: 1 };   // open-positions table sort (click a header)
  let _openAgg = false;   // aggregate duplicate tickers in the open-positions table (weighted-avg entry)
  let _periodSort = { col: "date", dir: 1 };   // calendar "period trades" modal sort (click a header)
  try { _openAgg = localStorage.getItem("sn_openpos_agg") === "1"; } catch (e) {}
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
      // include EVERY bucket that holds data — the named accounts AND the blank ("") bucket when it
      // has any. accounts() hides "" from the selector once named accounts exist, but blank-account
      // trades must still surface in the combined view; otherwise an orphaned blank-account position
      // is invisible here yet still counted elsewhere (e.g. the favorites "open position" badge).
      const buckets = Store.accounts().slice();
      const hasBlank = (Store.getFills() || []).some(f => !(f.account || "").trim()) ||
                       (Store.getManual() || []).some(m => !(m.account || "").trim());
      if (hasBlank && buckets.indexOf("") < 0) buckets.push("");
      buckets.forEach(a => {
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
  let livePrices = null, liveChg = {}, livePricesTs = 0, _openPriceTimer = null, _feedUpdated = "";
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
      const map = {}, chgMap = {};
      Object.keys(prices).forEach(sym => { const v = prices[sym]; const p = Array.isArray(v) ? v[0] : v; if (p) map[sym] = p; if (Array.isArray(v) && v[1] != null) chgMap[sym] = v[1]; });
      if (Object.keys(map).length) { livePrices = map; liveChg = chgMap; livePricesTs = Date.now(); _feedUpdated = (j[0].data && j[0].data.updated) || _feedUpdated; }
      return livePrices || {};
    } catch (e) { return livePrices || {}; }
  }
  function unrealizedPnl(t, cp) {
    const gross = (t.direction === "short" ? (t.entryPrice - cp) : (cp - t.entryPrice)) * t.qty * (t.mult || 1);
    return gross - (t.fees || 0);
  }
  // options have no live price feed (it covers stocks only) → the trader types the current premium.
  // stored per-position id in localStorage (transient current price, not part of the trade record).
  // typed option "current price" marks. Stored INSIDE the synced journal blob (data.optCur) so a price
  // typed on the desktop shows up on the phone too (was a device-local key that never synced).
  function _optPrices() {
    const d = Store._read();
    let m = (d && d.optCur) || {};
    // legacy fallback: still SHOW prices from the old device-local key until they're migrated on next edit
    if (!Object.keys(m).length) { try { const old = JSON.parse(localStorage.getItem("sn_opt_cur_prices") || "{}"); if (Object.keys(old).length) m = old; } catch (e) {} }
    return m;
  }
  function _setOptPrice(id, px) {
    const d = Store._read();
    const m = d.optCur || {};
    // one-time fold-in of any legacy device-local prices, then retire the old key
    try { const old = JSON.parse(localStorage.getItem("sn_opt_cur_prices") || "{}"); Object.keys(old).forEach(k => { if (m[k] == null) m[k] = old[k]; }); if (Object.keys(old).length) localStorage.removeItem("sn_opt_cur_prices"); } catch (e) {}
    if (px === "" || px == null || isNaN(+px)) delete m[id]; else m[id] = +px;
    d.optCur = m;
    Store._write(d);   // synced blob → cloudsync pushes to user_journal → appears on other devices
  }
  // ---- automatic option premiums (FREE CBOE delayed quotes via the /api/options proxy) ----
  // keyed by the OCC contract symbol (stable across id/aggregation changes), stored in the synced blob.
  function _optAuto() { const d = Store._read(); return (d && d.optAuto) || {}; }
  function _setOptAuto(occ, px) {
    const d = Store._read(); const m = d.optAuto || {};
    if (px == null || isNaN(+px)) delete m[occ]; else m[occ] = +px;
    d.optAuto = m; Store._write(d);
  }
  // theta (time-decay per share/day) per OCC contract + the underlying STOCK price per symbol,
  // both pulled free from CBOE alongside the premium — powers the breakeven / daily-decay columns.
  function _optTheta() { const d = Store._read(); return (d && d.optTheta) || {}; }
  function _optUnder() { const d = Store._read(); return (d && d.optUnder) || {}; }
  // OCC option symbol: UNDERLYING + YYMMDD + C/P + strike×1000 (8 digits). null when strike/expiry missing.
  function _occSymbol(t) {
    if (!t || t.assetType !== "option" || t.strike == null || !t.expiry) return null;
    const u = String(t.symbol || "").split(" ")[0].toUpperCase();
    const m = String(t.expiry).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!u || !m) return null;
    return u + m[1].slice(2) + m[2] + m[3] + (t.optType === "put" ? "P" : "C") + String(Math.round((+t.strike) * 1000)).padStart(8, "0");
  }
  // fetch delayed premiums from the CBOE proxy and fill every open option position that has strike+expiry.
  // One fetch per underlying (edge-cached), price = bid/ask midpoint (else last). Re-renders when done.
  let _optFetchBusy = false, _optAutoTs = 0;
  async function refreshOptionPrices(silent) {
    if (_optFetchBusy) return;
    _optAutoTs = Date.now();   // throttle clock for the silent auto-refresh (set before the await so re-renders don't re-trigger)
    const all = tradesForAccount();
    const opens = (all.manualOpen || []).concat(all.openPositions || []);
    const optPos = opens.filter(t => t.assetType === "option");
    if (!optPos.length) { if (!silent) toast("אין פוזיציות אופציה פתוחות"); return; }
    const withOcc = optPos.map(t => ({ t: t, occ: _occSymbol(t) })).filter(x => x.occ);
    if (!withOcc.length) { if (!silent) toast("הוסף סטרייק + תאריך פקיעה לאופציות כדי למשוך מחיר אוטומטי"); return; }
    _optFetchBusy = true;
    const btn = document.getElementById("optRefreshBtn"); if (btn) { btn.disabled = true; btn.textContent = "🔄 מושך…"; }
    try {
      const unders = Array.from(new Set(withOcc.map(x => String(x.t.symbol || "").split(" ")[0].toUpperCase())));
      const chains = {}, underPx = {};
      await Promise.all(unders.map(async function (u) {
        try { const r = await fetch("/api/options?sym=" + encodeURIComponent(u)); if (r.ok) { const j = await r.json(); const map = {}; (j.opts || []).forEach(o => { map[o.o] = o; }); chains[u] = map; if (j.px != null && +j.px > 0) underPx[u] = +j.px; } else chains[u] = null; }
        catch (e) { chains[u] = null; }
      }));
      let filled = 0, missing = 0;
      const dd = Store._read(); dd.optAuto = dd.optAuto || {}; dd.optCur = dd.optCur || {}; dd.optTheta = dd.optTheta || {}; dd.optUnder = dd.optUnder || {};
      Object.keys(underPx).forEach(u => { dd.optUnder[u] = underPx[u]; });   // live STOCK price per underlying (for breakeven gap)
      withOcc.forEach(function (x) {
        const u = String(x.t.symbol || "").split(" ")[0].toUpperCase();
        const c = chains[u] && chains[u][x.occ];
        if (c) {
          if (c.th != null && !isNaN(+c.th)) dd.optTheta[x.occ] = +c.th;   // theta (per share/day) for the decay column
          const b = +c.b, a = +c.a, l = +c.l;
          // REALISTIC exit value (matches the broker): a LONG is marked at the BID (what you'd get selling),
          // a SHORT at the ASK (what you'd pay to buy back). Fall back to last / the other side when a quote is 0.
          const _short = x.t.direction === "short";
          const px = _short
            ? (a > 0 ? a : (l > 0 ? l : (b > 0 ? b : null)))
            : (b > 0 ? b : (l > 0 ? l : (a > 0 ? a : null)));
          if (px != null) {
            dd.optAuto[x.occ] = Math.round(px * 100) / 100;
            // an explicit 🔄 refresh is AUTHORITATIVE → drop any manual override (raw id + aggregated id)
            // so the fresh CBOE price wins (this fixes: typed 5, refreshed, but it stayed 5 not 5.4).
            delete dd.optCur[x.t.id];
            delete dd.optCur["aggopen|" + (x.t.symbol || "") + "|" + (x.t.account || "") + "|" + (x.t.direction || "") + "|" + (x.t.optType || "")];
            filled++;
          } else missing++;
        } else missing++;
      });
      dd.optFetchedAt = Date.now();                 // when these CBOE quotes were pulled (for the freshness label)
      Store._write(dd);
      const noOcc = optPos.length - withOcc.length;
      if (!silent) toast("🔄 עודכנו " + filled + " מחירי אופציות" + (missing ? " · " + missing + " לא נמצאו" : "") + (noOcc ? " · " + noOcc + " חסרי סטרייק/פקיעה" : ""));
      render();
    } finally { _optFetchBusy = false; }
  }
  window.snRefreshOptionPrices = refreshOptionPrices;

  // Option-quote freshness indicator (Adi): CBOE is a FREE feed delayed ~15 min, so option marks lag the
  // broker — worst in the first ~30 min after the US open (the delayed feed is still showing yesterday's
  // close/open while the stock already gapped). Show HOW OLD the pull is + a loud warning near the bell so
  // the trader knows to trust the broker, not the site, at that time.
  function _optQuoteAgeHtml() {
    try {
      const d = Store._read();
      const fetched = d && d.optFetchedAt;
      const ageMin = fetched ? Math.max(0, Math.round((Date.now() - fetched) / 60000)) : null;
      const ageTxt = ageMin == null ? "" : (ageMin < 1 ? "נמשך עכשיו" : "נמשך לפני " + ageMin + " דק׳");
      let html = "<span class='muted' style='font-size:11px;font-weight:400' title='מחירי האופציות מגיעים מ-CBOE בפיד חינמי המושהה כ-15 דקות — לכן הם מפגרים אחרי הברוקר, במיוחד סמוך לפתיחה'>⏱ אופ׳: CBOE מושהה ~15 דק׳" + (ageTxt ? " · " + ageTxt : "") + "</span>";
      // US market clock (ET): flag the first 30 minutes after the open, when the delayed feed is least reliable.
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const etMin = et.getHours() * 60 + et.getMinutes(), day = et.getDay();
      const sinceOpen = etMin - (9 * 60 + 30);
      if (day >= 1 && day <= 5 && sinceOpen >= 0 && sinceOpen < 30) {
        html += " <span class='jsl none' style='font-size:11px' title='בחצי השעה הראשונה הפיד המושהה עדיין משקף את מחירי אתמול/הפתיחה. סמוך על הברוקר, או הקלד מחיר ידנית על פוזיציה חשובה'>⚠️ סמוך לפתיחה — ייתכן שהמחירים לא מעודכנים</span>";
      }
      return html;
    } catch (e) { return ""; }
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
  // dashboard section header (mockup): title + count + fading rule
  function _dashSecHdr(title, count) {
    const d = el("div", "jr-th");
    d.innerHTML = "<h2>" + title + "</h2>" + (count ? '<span class="jr-c">' + count + "</span>" : "") + '<span class="jr-line"></span>';
    return d;
  }
  // dashboard KPI row (mockup): 6 headline stats from the real engine, big display values + context line
  function renderDashKpis(trades, manualOpen, fifoOpen) {
    const s = E.stats(trades);
    const ud = v => (v > 0 ? "up" : (v < 0 ? "down" : ""));
    const pf = s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2);
    const wins = s.count ? Math.round((s.winRate / 100) * s.count) : 0;
    const items = [
      ["רווח נקי", money(s.net, 0), ud(s.net), "ממומש · כל הזמן"],
      ["אחוז הצלחה", s.winRate + "%", "", wins + " / " + s.count],
      ["Profit Factor", pf, s.profitFactor >= 1 ? "up" : "down", "רווח / הפסד"],
      ["מס' עסקאות", String(s.count), "", "סגורות"],
      ["רווח ממוצע", money(s.avgWin, 0), "up", "לעסקה מרוויחה"],
      ["העסקה הטובה", money(s.bestTrade, 0), "up", "שיא"],
    ];
    const wrap = el("div", "jr-kpis num");
    wrap.innerHTML = items.map(it =>
      '<div class="jr-stat"><div class="l">' + it[0] + '</div><div class="v ' + (it[2] || "") + '">' + it[1] + '</div><div class="d">' + it[3] + "</div></div>"
    ).join("");
    return wrap;
  }
  function render() {
    _wireJournalCharts();
    const root = $("#view");
    root.innerHTML = "";
    const accts = Store.accounts();
    // normalize the active account BEFORE syncing the dropdown, so the
    // selector and the rendered data can never desync on load.
    // NOTE: "" is a VALID selection (the blank/unnamed bucket) when it holds data — don't reset it away.
    const blankOk = state.account === "" && Store.hasBlank();
    if (accts.length && state.account !== ALL && !blankOk && (!state.account || accts.indexOf(state.account) < 0)) state.account = accts[0];
    renderAccountBar();
    // guide-video area at the TOP of the page (most viewers don't scroll down)
    const appendGuide = () => { if (window.snGuide) { const gw = el("div"); gw.innerHTML = window.snGuide("journal"); if (gw.firstChild) root.insertBefore(gw.firstChild, root.firstChild); } };
    if (!accts.length) { root.appendChild(emptyState()); appendGuide(); return; }

    const { trades, openPositions, manualOpen } = tradesForAccount();

    // discipline nudge — too many concurrent open positions.
    // The inline banner shows ONLY on the open-positions tab (so it never pushes the calendar/equity
    // into a scroll); the popup still fires once when the count first crosses the threshold.
    const openCount = (openPositions ? openPositions.length : 0) + (manualOpen ? manualOpen.length : 0);
    if (openCount >= OPEN_WARN && state.tab === "positions") root.appendChild(disciplineBanner(openCount));
    if (openCount >= OPEN_WARN && _lastOpenCount < OPEN_WARN) setTimeout(() => disciplineModal(openCount), 350);
    _lastOpenCount = openCount;

    // live-stream privacy toggle — always visible so it can be flipped
    const privBar = el("div", "jr-privbar");
    privBar.innerHTML = '<button class="btn ghost" id="jrPrivToggle" title="הסתר את העסקאות בכניסה — נוח ללייבים. כבוי = הכל גלוי מיד">' +
      (_journalPrivate ? "🔒 מצב לייב פעיל · עסקאות מוסתרות בכניסה" : "👁️ עסקאות גלויות") + "</button>";
    root.appendChild(privBar);
    { const pt = privBar.querySelector("#jrPrivToggle"); if (pt) pt.onclick = () => { _journalPrivate = !_journalPrivate; try { localStorage.setItem("sn_journal_private", _journalPrivate ? "1" : "0"); } catch (e) {} _journalPeek = false; render(); }; }

    const content = el("div", "jr-content");
    // Each tab shows ONLY its own content. Open positions live in their own "positions" tab
    // (Adi: don't jam the open-positions panel on top of calendar/equity/etc.).
    if (state.tab === "dashboard") {
      // single-page overview (mockup): KPI row → equity + calendar side-by-side → open positions → recent trades
      content.appendChild(renderDashKpis(trades, manualOpen, openPositions));
      const jcols = el("div", "jr-jcols");
      jcols.appendChild(renderEquity(trades));
      const calWrap = el("div", "chartbox jr-calwrap");
      calWrap.appendChild(el("h3", null, "לוח רווחיות יומי"));
      calWrap.appendChild(renderCalendar(trades));
      jcols.appendChild(calWrap);
      content.appendChild(jcols);
      const posSec = el("div", "jr-dashsec");
      // the panel shows BOTH manual opens AND CSV/FIFO-derived opens (imported buys with no matching
      // sell) — otherwise an imported leftover showed "open" in the trades table yet was missing here.
      const _dashOpen = (manualOpen || []).concat(_csvOpensAsTrades(openPositions));
      posSec.appendChild(_dashSecHdr("פוזיציות פתוחות", _dashOpen.length + " פתוחות"));
      if (_dashOpen.length) posSec.appendChild(renderOpenPositions(_dashOpen));
      else { const n = el("div", "note"); n.innerHTML = "📌 אין פוזיציות פתוחות כרגע."; posSec.appendChild(n); }
      content.appendChild(posSec);
      const trSec = el("div", "jr-dashsec");
      trSec.appendChild(_dashSecHdr("עסקאות אחרונות", "סגורות"));
      trSec.appendChild(renderTrades(trades, openPositions, manualOpen));
      content.appendChild(trSec);
    } else if (state.tab === "positions") {
      content.appendChild(renderTotalPnl(trades, manualOpen, openPositions));
      const _posOpen = (manualOpen || []).concat(_csvOpensAsTrades(openPositions));
      if (_posOpen.length) content.appendChild(renderOpenPositions(_posOpen));
      else { const n = el("div", "note"); n.style.marginTop = "12px"; n.innerHTML = "📌 אין פוזיציות פתוחות כרגע. פוזיציות שתפתח (או תייבא ולא נסגרו) יופיעו כאן עם ה-P&L הלא-ממומש בזמן אמת."; content.appendChild(n); }
    } else if (state.tab === "trades") {
      content.appendChild(renderStatCards(trades));
      content.appendChild(renderTotalPnl(trades, manualOpen, openPositions));
      content.appendChild(renderAssetBreakdown(trades));
      content.appendChild(renderTrades(trades, openPositions, manualOpen));
    } else if (state.tab === "calendar") {
      content.appendChild(renderCalendar(trades));
    } else if (state.tab === "equity") {
      content.appendChild(renderEquity(trades));
    } else if (state.tab === "yearly") {
      content.appendChild(renderYearly(trades));
    }

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

    appendGuide();   // guide-video area (outside the privacy blur — it's not trade data)

    // keep open-position prices LIVE — load once, then refresh from the scanner every 30s while the
    // journal is open (previously fetched only once → prices froze at whatever they were on open)
    const anyOpen = (openPositions && openPositions.length) || (manualOpen && manualOpen.length);
    if (anyOpen) {
      if (!livePrices) ensureLivePrices().then(m => { if (m && Object.keys(m).length) render(); });
      if (!_openPriceTimer) _openPriceTimer = setInterval(refreshOpenPrices, 30000);
      _autoRefreshOpts();   // keep CBOE option premiums fresh on open (the 30s interval refreshes them too)
    } else if (_openPriceTimer) { clearInterval(_openPriceTimer); _openPriceTimer = null; }
  }
  // silently pull fresh CBOE option premiums so they don't go stale between manual 🔄 clicks (Adi). Throttled
  // to ~2 min (CBOE quotes are ~15-min delayed + edge-cached → cheap, and this keeps the journal current).
  function _autoRefreshOpts() {
    try {
      if (_optFetchBusy || (Date.now() - _optAutoTs) < 120000) return;
      const all = tradesForAccount();
      const opens = (all.manualOpen || []).concat(all.openPositions || []);
      if (opens.some(t => t.assetType === "option" && _occSymbol(t))) refreshOptionPrices(true);
    } catch (e) {}
  }
  function refreshOpenPrices() {
    const jc = document.getElementById("journalContainer");
    if (!jc || jc.classList.contains("hidden") || document.getElementById("modalBg")) return;  // not visible / mid-edit
    _autoRefreshOpts();   // also refresh option premiums (throttled)
    const prev = _feedUpdated;
    livePricesTs = 0;                                    // force a fresh fetch (bypass the cache)
    // re-render only when the SERVER feed actually advanced (cheap timestamp check, not a 12k-ticker diff)
    ensureLivePrices().then(m => { if (m && Object.keys(m).length && _feedUpdated !== prev) render(); });
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

  // merge already-priced open-position items (each {t, isOpt, cp, un}) that share a ticker/direction/
  // contract into one synthetic position: summed qty, weighted-avg entry, summed exposure & Unrealized.
  function _aggOpenItems(items) {
    const groups = {};
    items.forEach(it => {
      const t = it.t;
      const k = (t.symbol || "") + "|" + (t.account || "") + "|" + (t.direction || "") + "|" + (t.optType || "");
      (groups[k] = groups[k] || []).push(it);
    });
    return Object.keys(groups).map(k => {
      const g = groups[k];
      if (g.length === 1) { const it = g[0]; return { t: Object.assign({}, it.t, { _n: 1 }), isOpt: it.isOpt, cp: it.cp, un: it.un }; }
      const f = g[0].t;
      const qty = g.reduce((s, x) => s + (+x.t.qty || 0), 0);
      const wavgEntry = qty ? g.reduce((s, x) => s + (+x.t.entryPrice || 0) * (+x.t.qty || 0), 0) / qty : 0;
      const dates = g.map(x => x.t.entryDate).filter(Boolean).sort();
      const entryDate = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : dates[0] + " … " + dates[dates.length - 1]) : "";
      const allCp = g.every(x => x.cp != null);
      const cp = (allCp && qty) ? g.reduce((s, x) => s + (+x.cp || 0) * (+x.t.qty || 0), 0) / qty : null;   // weighted-avg current price
      const un = g.every(x => x.un != null) ? g.reduce((s, x) => s + x.un, 0) : null;
      const mt = {
        id: "aggopen|" + k, symbol: f.symbol, account: f.account, direction: f.direction,
        assetType: f.assetType, optType: f.optType, strike: f.strike, expiry: f.expiry, mult: f.mult, qty: qty, entryPrice: wavgEntry,
        entryDate: entryDate, _n: g.length,
      };
      return { t: mt, isOpt: f.assetType === "option", cp: cp, un: un };
    });
  }
  // CSV/FIFO-derived open positions → trade-shaped rows for the open-positions panel (same normalization
  // renderTrades uses for its pinned rows). Each keeps its composing fillKeys so the panel can DELETE it,
  // or convert-to-manual (editCsvTrade) to add an exit price. source:"csv" routes the panel's actions.
  function _csvOpensAsTrades(openPositions) {
    return (openPositions || []).map(p => ({
      id: "csvopen|" + ((p.fillKeys && p.fillKeys[0]) || (p.account + "|" + p.symbol + "|" + p.entryDate)),
      symbol: p.symbol, account: p.account, direction: p.direction,
      assetType: p.assetType, optType: p.optType || null,
      strike: p.strike != null ? p.strike : null, expiry: p.expiry || null,
      qty: p.qty, entryPrice: p.avgPrice, mult: p.mult || (p.assetType === "option" ? 100 : 1),
      entryDate: p.entryDate, exitDate: "", fees: 0,
      source: "csv", fillKeys: (p.fillKeys || []).slice(), _open: true,
    }));
  }
  function renderOpenPositions(openTrades) {
    const wrap = el("div", "panel open-pos");
    const showAcct = state.account === ALL;   // combined view → show which account each position is in
    const posValOf = t => (+t.entryPrice || 0) * (+t.qty || 0) * (t.mult || 1);   // entry notional
    // $ risked per trade = |entry − stop| × qty × mult. null when no stop, or aggregated (per-lot SL unknown).
    const riskValOf = t => {
      if ((t._n || 1) > 1) return null;
      if (t.sl == null || t.sl === "") return null;
      return Math.abs((+t.entryPrice || 0) - (+t.sl)) * (+t.qty || 0) * (t.mult || 1);
    };
    // derive per-position values first (live prices are STOCK prices — not an option's premium,
    // so Unrealized P&L is only computable for stocks). Needed for both display AND sorting.
    const optPx = _optPrices(), autoPx = _optAuto();
    let items = openTrades.map(t => {
      const isOpt = t.assetType === "option";
      // stocks → live feed price · options → the price the trader typed in (if any)
      const _occ = isOpt ? _occSymbol(t) : null;
      const cp = isOpt ? (optPx[t.id] != null ? optPx[t.id] : (_occ && autoPx[_occ] != null ? autoPx[_occ] : null)) : (livePrices ? livePrices[t.symbol] : null);
      const un = (cp != null) ? unrealizedPnl(t, cp) : null;
      return { t: t, isOpt: isOpt, cp: cp, un: un };
    });
    // aggregate duplicate tickers → one row per (symbol·account·direction·optType) with the
    // WEIGHTED-AVERAGE entry price and summed quantity/exposure/Unrealized. Same key as the
    // closed-trades aggregation. e.g. 100@$1 + 200@$2 → 300 @ $1.67.
    if (_openAgg) items = _aggOpenItems(items);
    const _theta = _optTheta(), _under = _optUnder();   // CBOE theta per contract + underlying px per symbol (used by the sort below + the cells)
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
          case "stop": return (it.t.sl != null && it.t.sl !== "" && (it.t._n || 1) === 1) ? +it.t.sl : -Infinity;
          case "risk": { const r = riskValOf(it.t); return r == null ? -Infinity : r; }
          case "cp": return it.cp == null ? -Infinity : it.cp;
          case "daychg": { const d = it.isOpt ? null : (liveChg ? liveChg[String(it.t.symbol || "").split(" ")[0]] : null); return d == null ? -Infinity : d; }
          case "dte": { const d = _dte(it.t); return d == null ? Infinity : d; }               // ascending (dir=1) → nearest expiry first; non-options sink to the end
          case "theta": { const p = _thetaPerDay(it.t); return p == null ? -Infinity : Math.abs(p); }   // descending (dir=-1) → biggest daily decay first; non-options sink to the end
          case "be": { const g = _beGap(it.t); return g == null ? -Infinity : g; }   // descending (dir=-1) → furthest from BE (most to move) first; past-BE cushions sink to the bottom
          case "un": return it.un == null ? -Infinity : it.un;
          case "unpct": { const pv = posValOf(it.t); return (it.un != null && pv > 0) ? it.un / pv * 100 : -Infinity; }
          default: return 0;
        }
      };
      items.sort((a, b) => { const va = sv(a), vb = sv(b); return typeof va === "string" ? _openSort.dir * va.localeCompare(vb) : _openSort.dir * (va - vb); });
    }
    let totUn = 0, totInv = 0, totPosVal = 0, haveAll = true, hasOpt = false;
    let totRisk = 0, totCurVal = 0, noStopCount = 0;   // risk column + live portfolio value (for "% מהתיק")
    let totThetaDay = 0, haveTheta = false;            // sum of daily time-decay across option positions
    // alerts ↔ open positions: which saved scans each position currently matches (+ direction conflicts)
    const posSignals = (window._snPositionSignals) ? window._snPositionSignals(openTrades.map(t => ({ sym: String(t.symbol || "").split(" ")[0], direction: t.direction }))) : {};
    const sigBadge = t => {
      const hits = posSignals[String(t.symbol || "").split(" ")[0]];
      if (!hits || !hits.length) return "";
      const conf = hits.filter(h => h.conflict);
      if (conf.length) return ' <span class="jsig conflict" title="' + ("קונפליקט כיוון: פוזיציית " + (t.direction === "long" ? "לונג" : "שורט") + " שנכנסה לסריקה בכיוון הפוך — " + conf.map(h => h.name).join(" · ")).replace(/"/g, "&quot;") + '">⚠️ קונפליקט</span>';
      return ' <span class="jsig" title="' + ("נכנסה לסריקות: " + hits.map(h => h.name).join(" · ")).replace(/"/g, "&quot;") + '">🔔 בסריקה</span>';
    };
    // SL/TP display + red flag when no stop-loss was set (risk management)
    const slBadge = t => {
      const hasSL = t.sl != null && t.sl !== "";
      if (!hasSL) return ' <span class="jsl none" title="לא הוצב סטופ לוס לעסקה זו — סיכון לא מוגן">🛑 אין SL</span>';
      return ' <span class="jsl" title="ניהול סיכון">🛑 ' + money(t.sl, 2) + (t.tp != null && t.tp !== "" ? ' · 🎯 ' + money(t.tp, 2) : "") + "</span>";
    };
    const pctCell = (un, posVal) => (un != null && posVal > 0)
      ? '<td class="' + cls(un) + '">' + (un >= 0 ? "+" : "") + (un / posVal * 100).toFixed(2) + "%</td>"
      : '<td class="muted">—</td>';
    // ── option-only columns (Adi) ──────────────────────────────────────────────
    // breakeven-at-expiry GAP: how far the STOCK must move from here to break even if held to
    // expiry. BE = strike + premium paid (call) / strike − premium paid (put); gap = BE − stock price.
    // (_theta / _under are defined above the sort block so the DTE/theta sort can use them too.)
    // signed "distance to breakeven" as a number for sorting: + = stock still has to move to reach BE
    // (higher = further / more at risk), − = already past BE (cushion). null when no option/underlying data.
    function _beGap(t) {
      if (t.assetType !== "option" || t.strike == null || t.strike === "" || t.entryPrice == null) return null;
      const u = String(t.symbol || "").split(" ")[0].toUpperCase();
      const under = _optUnder()[u];
      if (under == null || !(+under > 0)) return null;
      const isPut = t.optType === "put";
      const be = isPut ? (+t.strike - +t.entryPrice) : (+t.strike + +t.entryPrice);
      const movePct = (be / under - 1) * 100;
      const past = isPut ? (+under <= be) : (+under >= be);   // beyond breakeven = cushion
      return past ? -Math.abs(movePct) : Math.abs(movePct);
    }
    function _beCell(t) {
      if (t.assetType !== "option" || t.strike == null || t.strike === "" || t.entryPrice == null) return "<td class='muted'>—</td>";
      const u = String(t.symbol || "").split(" ")[0].toUpperCase();
      const under = _under[u];
      if (under == null || !(+under > 0)) return "<td class='muted' title='לחץ 🔄 מחירי אופציות כדי למשוך את מחיר המניה מ-CBOE'>—</td>";
      const isPut = t.optType === "put";
      const be = isPut ? (+t.strike - +t.entryPrice) : (+t.strike + +t.entryPrice);
      const gap = be - under;                        // breakeven − current stock price ($)
      const movePct = (be / under - 1) * 100;        // signed % the stock must move to reach BE
      const past = isPut ? (under <= be) : (under >= be);   // already beyond breakeven = cushion
      const arrow = isPut ? "↓" : "↑";
      const main = past
        ? "<span class='pos'>✓ מעבר ל-BE</span>"
        : "<span class='" + (Math.abs(movePct) > 8 ? "neg" : "") + "'>" + arrow + " " + Math.abs(movePct).toFixed(1) + "%</span>";
      return "<td style='white-space:nowrap;font-family:Heebo,Rubik,sans-serif' title='Breakeven בפקיעה = " + money(be, 2) + " · מחיר מניה " + money(+under, 2) + "'>" + main +
        "<div class='muted' style='font-size:11px'>BE " + money(be, 2) + " · פער " + money(Math.abs(gap), 2) + "</div></td>";
    }
    // daily time-decay ($/day) as a number: theta × 100 × contracts. LONG premium = loss (−); SHORT = gain (+).
    function _thetaPerDay(t) {
      if (t.assetType !== "option") return null;
      const occ = _occSymbol(t);
      const th = occ ? _theta[occ] : null;
      if (th == null || isNaN(+th)) return null;
      const qty = Math.abs(+t.qty || 0), m = (+t.mult || 100);
      return (+th) * m * qty * (t.direction === "short" ? -1 : 1);
    }
    // calendar days left to expiry (null for non-options / no expiry). ≤7 → paints red (expiry risk).
    function _dte(t) {
      if (t.assetType !== "option" || !t.expiry) return null;
      const m = String(t.expiry).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const exp = new Date(+m[1], +m[2] - 1, +m[3]), today = new Date(); today.setHours(0, 0, 0, 0);
      return Math.round((exp - today) / 86400000);
    }
    function _thetaCell(t) {
      if (t.assetType !== "option") return "<td class='muted'>—</td>";
      const perDay = _thetaPerDay(t);
      // days-to-expiry sub-line: red in the final week (≤7 days), muted otherwise.
      const d = _dte(t);
      let dteSub = "";
      if (d != null) {
        const txt = d < 0 ? "פג" : d === 0 ? "פוקע היום" : d + " ימים לפקיעה";
        dteSub = "<div class='" + (d <= 7 ? "neg" : "muted") + "' style='font-size:11px'>⏳ " + txt + "</div>";
      }
      if (perDay == null) {
        const occ = _occSymbol(t);
        const hint = occ ? "לחץ 🔄 מחירי אופציות כדי למשוך Theta מ-CBOE" : "הוסף סטרייק + תאריך פקיעה";
        return "<td class='muted' style='white-space:nowrap;font-family:Heebo,Rubik,sans-serif' title='" + hint + "'>—" + dteSub + "</td>";
      }
      const occ = _occSymbol(t), th = occ ? _theta[occ] : null, qty = Math.abs(+t.qty || 0), m = (+t.mult || 100);
      const cl = perDay >= 0 ? "pos" : "neg";
      return "<td class='" + cl + "' style='white-space:nowrap;font-family:Heebo,Rubik,sans-serif' title='Theta " + (th != null ? (+th).toFixed(4) : "") + " × " + m + " × " + qty + " חוזים" + (t.direction === "short" ? " (שורט — לטובתך)" : "") + "'>" +
        (perDay >= 0 ? "+" : "") + money(perDay, 2) + "<span class='muted' style='font-size:11px'>/יום</span>" + dteSub + "</td>";
    }
    const rows = items.map(function (it) {
      const t = it.t, isOpt = it.isOpt, cp = it.cp, posVal = posValOf(t);
      const merged = (t._n || 1) > 1;   // aggregated row (several lots of the same ticker)
      totPosVal += posVal;
      { const _tpd = _thetaPerDay(t); if (_tpd != null) { totThetaDay += _tpd; haveTheta = true; } }   // daily-decay total
      const mult = (t.mult || 1);
      totCurVal += (cp != null ? cp * (+t.qty || 0) * mult : posVal);   // live portfolio value (falls back to entry notional)
      // stop-loss column (was an inline badge) + $ risked per trade
      const hasSL = !merged && t.sl != null && t.sl !== "";
      const risk = riskValOf(t);
      if (risk != null) totRisk += risk; else if (!merged) noStopCount++;
      const tpTag = (!merged && t.tp != null && t.tp !== "") ? "<div class='muted' style='font-size:11px'>🎯 " + money(t.tp, 2) + "</div>" : "";
      const stopHtml = merged
        ? "<td class='muted'>—</td>"
        : (hasSL ? "<td style='white-space:nowrap'>🛑 " + money(t.sl, 2) + tpTag + "</td>"
                 : "<td><span class='jsl none' title='לא הוצב סטופ לוס לעסקה זו — סיכון לא מוגן'>🛑 אין</span>" + tpTag + "</td>");
      const riskHtml = risk != null
        ? "<td class='risk-cell' style='white-space:nowrap' title='סכום ההפסד אם תיגע בסטופ'>" + money(risk, 0) + "</td>"
        : "<td class='muted'>—</td>";
      let pnlHtml, cpHtml, pctHtml;
      if (isOpt) {
        hasOpt = true;
        // price SOURCE tag so the trader knows if a premium is the auto CBOE pull or their own typed value.
        const _occ2 = _occSymbol(t);
        const _srcAuto = _occ2 && autoPx[_occ2] != null && optPx[t.id] == null;   // auto only when no manual override
        const _srcManual = optPx[t.id] != null;
        const _srcTag = _srcAuto ? " <span class='opt-src auto' title='מחיר אוטומטי מ-CBOE · מושהה ~15 דק׳'>🔄 CBOE</span>"
          : _srcManual ? " <span class='opt-src manual' title='מחיר שהזנת ידנית (גובר על האוטומטי)'>✏️ ידני</span>"
          : (_occ2 ? " <span class='opt-src none' title='לא נמצא מחיר ב-CBOE — לחץ 🔄 מחירי אופציות, או הזן ידנית'>—</span>" : "");
        // no live option-price feed → let the trader type the current premium; P&L updates live.
        // merged rows can't edit per-lot → show the weighted-avg premium read-only.
        cpHtml = merged
          ? (cp != null ? money(cp, 2) + _srcTag : "—")
          : '<input class="opt-px" data-optpx="' + t.id + '" type="number" step="0.01" min="0" placeholder="הזן מחיר" value="' + (cp != null ? cp : "") + '">' + _srcTag;
        if (cp != null && it.un != null) { totUn += it.un; totInv += posVal; pnlHtml = '<span class="' + cls(it.un) + '">' + money(it.un, 2) + "</span>"; pctHtml = pctCell(it.un, posVal); }
        else { pnlHtml = '<span class="muted" title="הזן את מחיר האופציה הנוכחי כדי לחשב רווח/הפסד לא ממומש">הזן מחיר ←</span>'; pctHtml = '<td class="muted">—</td>'; }
      } else if (cp != null) {
        totUn += it.un; totInv += posVal;
        pnlHtml = '<span class="' + cls(it.un) + '">' + money(it.un, 2) + "</span>";
        cpHtml = money(cp, 2); pctHtml = pctCell(it.un, posVal);
      } else { haveAll = false; pnlHtml = '<span class="muted">' + (livePrices ? "אין מחיר" : "טוען…") + "</span>"; cpHtml = "—"; pctHtml = '<td class="muted">—</td>'; }
      // today's move of the STOCK (from the live feed) — separate from the position's unrealized P&L,
      // so a position bought low still shows GREEN P&L even on a red day, without confusion.
      const dayChg = isOpt ? null : (liveChg ? liveChg[String(t.symbol || "").split(" ")[0]] : null);
      const dayChgHtml = (dayChg != null)
        ? "<td class='" + cls(dayChg) + "' style='white-space:nowrap'>" + (dayChg >= 0 ? "+" : "") + dayChg.toFixed(2) + "%</td>"
        : "<td class='muted'>—</td>";
      const nBadge = merged ? ' <span class="agg-badge" title="' + t._n + ' לוטים מאוגדים · מחיר כניסה = ממוצע משוקלל — כבה \'אגד\' כדי לנהל/לסגור כל לוט בנפרד">×' + t._n + "</span>" : "";
      // 📸 share THIS live position as a ninja card. Stocks use the live quote; options use the
      // current premium the trader typed (cp) — so an option is shareable ONCE a current price is entered.
      const _sBase = String(t.symbol || "").split(" ")[0];
      const shareBtn = (!merged && cp != null)
        ? "<button class='btn ghost' data-sharepos='1' data-sp-sym='" + _sBase + "' data-sp-dir='" + (t.direction || "long") +
          "' data-sp-qty='" + (t.qty || "") + "' data-sp-atype='" + (t.assetType === "option" ? "Options" : "Stock") +
          "' data-sp-entry='" + (t.entryPrice || 0) + "' data-sp-cp='" + cp + "' title='שתף פוזיציה ככרטיס נינג׳ה' style='padding:4px 8px'>📸</button> "
        : "";
      const actions = merged
        ? '<span class="muted" style="font-size:11px" title="כבה \'אגד טיקרים\' כדי לסגור/למחוק לוט בודד">🧬 מאוגד</span>'
        : (shareBtn + (t.img ? "<button class='btn ghost' data-img='" + t.id + "' title='צפה בצילום הגרף' style='padding:4px 8px'>📷</button> " : "") +
           "<button class='btn ghost' data-closepos='" + t.id + "' style='font-size:12px;padding:4px 10px'>סגירה ✎</button> " +
           "<button class='btn ghost' data-delpos='" + t.id + "' title='מחק פוזיציה' style='padding:4px 8px'>🗑</button>");
      const _isFav = !!(window.Prefs && window.Prefs.isFav(_sBase));
      const favBtn = "<button class='starbtn" + (_isFav ? " on" : "") + "' data-favpos='" + _sBase + "' title='" + (_isFav ? "הסר ממועדפים" : "הוסף למועדפים") + "' style='margin-inline-start:6px'>" + (_isFav ? "★" : "☆") + "</button>";
      return "<tr" + (merged ? "" : " data-editopen='" + t.id + "' style='cursor:pointer'") + ">" +
        (showAcct ? "<td class='muted' style='white-space:nowrap'>" + (t.account || "—") + "</td>" : "") +
        "<td class='muted' style='white-space:nowrap'>" + (t.entryDate || "—") + "</td>" +
        "<td class='sym'>" + favBtn + chartSym(t.symbol) + nBadge +
        '<span class="pill ' + (t.assetType === "option" ? "opt" : "stk") + '" style="margin-inline-start:6px">' + (t.assetType === "option" ? "אופ׳" + (t.optType ? " · " + t.optType.toUpperCase() : "") : "מניה") + "</span>" + sigBadge(t) + "</td>" +
        "<td>" + (t.direction === "long" ? "🟢 לונג" : "🔴 שורט") + "</td><td>" + t.qty + "</td><td>" + money(t.entryPrice, 2) + "</td>" + stopHtml + riskHtml + "<td>" + money(posVal, 0) + "</td><td>" + cpHtml + "</td>" + _beCell(t) + _thetaCell(t) + dayChgHtml + "<td>" + pnlHtml + "</td>" + pctHtml +
        "<td>" + actions + "</td></tr>";
    }).join("");
    // sortable header (click a column to sort)
    const _sh = (col, label, start) => "<th class='jsort' data-jsort='" + col + "' style='cursor:pointer" + (start ? ";text-align:start" : "") + "'>" + label + (_openSort.col === col ? (_openSort.dir === 1 ? " ▲" : " ▼") : "") + "</th>";
    const _thead = "<tr>" + (showAcct ? _sh("account", "חשבון", true) : "") + _sh("entryDate", "תאריך רכישה", true) + _sh("symbol", "סימבול", true) + _sh("direction", "כיוון") + _sh("qty", "כמות") + _sh("entryPrice", "כניסה") + _sh("stop", "סטופ") + _sh("risk", "סיכון") + _sh("posValue", "חשיפה") + _sh("cp", "מחיר נוכחי") + "<th class='jsort' data-jsort='be' style='cursor:pointer' title='כמה המניה צריכה לזוז עד הפקיעה כדי לצאת באפס (Breakeven − מחיר המניה הנוכחי) · רק אופציות · מבוסס CBOE · לחץ למיון מהרחוק ביותר מ-BE לקרוב'>פער ל-BE" + (_openSort.col === "be" ? (_openSort.dir === 1 ? " ▲" : " ▼") : "") + "</th>" + "<th class='jsort' data-jsortopt='1' style='cursor:pointer;font-family:Heebo,Rubik,sans-serif' title='לחיצה: מיין לפי ימים לפקיעה · לחיצה נוספת: מיין לפי ההפסד ליום'>שחיקה ליום ⏳" + (_openSort.col === "dte" ? " <span class='muted' style='font-size:10px'>ימים ▲</span>" : _openSort.col === "theta" ? " <span class='muted' style='font-size:10px'>$ ▼</span>" : "") + "</th>" + _sh("daychg", "תנועת היום") + _sh("un", "Unrealized") + _sh("unpct", "%") + "<th></th></tr>";
    const labelSpan = 5 + (showAcct ? 1 : 0);   // entryDate..entryPrice (before the חשיפה column)
    const totHtml = haveAll ? '<span class="' + cls(totUn) + '">' + money(totUn, 2) + "</span>" : '<span class="muted">—</span>';
    const totPct = (haveAll && totInv > 0) ? '<span class="' + cls(totUn) + '">' + (totUn >= 0 ? "+" : "") + (totUn / totInv * 100).toFixed(2) + "%</span>" : '<span class="muted">—</span>';
    // total $ risked across all open positions, as % of the live portfolio value ("% מהתיק")
    const totRiskPct = totCurVal > 0 ? (totRisk / totCurVal * 100).toFixed(1) : "0.0";
    const totRiskHtml = "🛑 " + money(totRisk, 0) + ' <span class="muted" style="font-weight:600">(' + totRiskPct + "% מהתיק)</span>"
      + (noStopCount ? " <span class='jsl none' style='font-size:11px' title='" + noStopCount + " פוזיציות ללא סטופ — לא נכללות בסיכום הסיכון'>· " + noStopCount + " ללא SL</span>" : "");
    const optNote = hasOpt ? ' · <span style="color:#7ee2b8">אופציות: מחיר אוטומטי מ-CBOE (מושהה ~15 דק׳) בלחיצה על 🔄 מחירי אופציות — או הזן ידנית</span>' : "";
    const count = openTrades.length;
    // live-price freshness: show WHEN the market feed last updated + a manual refresh button, so it's
    // obvious the Unrealized P&L is tracking the market (not frozen at whatever loaded on open).
    let pxTimeTxt = "";
    try { if (_feedUpdated) pxTimeTxt = new Date(_feedUpdated).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }); } catch (e) {}
    const pxTimeHtml = pxTimeTxt
      ? "<span class='muted' style='font-size:11px;font-weight:400' title='זמן עדכון מחירי השוק מהשרת'>🕐 מחירים: " + pxTimeTxt + "</span>"
      : "";
    const refreshBtn = "<button class='btn ghost' id='openPxRefresh' style='font-size:12px;padding:4px 10px' title='רענן מחירים עכשיו'>🔄 רענן</button>";
    const optRefreshBtn = hasOpt ? "<button class='btn ghost' id='optRefreshBtn' style='font-size:12px;padding:4px 10px' title='משוך מחירי אופציות אוטומטית מ-CBOE (מושהה ~15 דק׳) — צריך סטרייק + תאריך פקיעה'>🔄 מחירי אופציות</button>" : "";
    const gridBtn = "<button class='btn ghost' id='openPosGrid' style='font-size:12px;padding:4px 12px' title='ראה גרפים של כל הפוזיציות הפתוחות'>📊 גרפים</button>" +
      "<button class='btn ghost' id='openPosCopy' style='font-size:12px;padding:4px 12px' title='העתק את רשימת הפוזיציות הפתוחות ללוח'>📋 העתק</button>" +
      "<button class='btn ghost" + (_openAgg ? " on" : "") + "' id='openPosAgg' style='font-size:12px;padding:4px 12px' title='אחד לוטים כפולים של אותו טיקר לשורה אחת עם מחיר כניסה ממוצע משוקלל'>🧬 " + (_openAgg ? "מאוגד" : "אגד טיקרים") + "</button>";
    const toggleBtn = "<button class='btn ghost' id='openPosToggle' style='font-size:12px;padding:4px 12px;margin-inline-start:auto'>" + (openPosMin ? "▸ הצג" : "▾ מזער") + "</button>";
    const minSummary = openPosMin ? ' <span class="muted" style="font-size:12px;font-weight:400">· ' + count + " פוזיציות · שווי " + money(totPosVal, 0) + " · סיכון 🛑 " + money(totRisk, 0) + " (" + totRiskPct + "%) · Unrealized " + totHtml + "</span>" : "";
    wrap.innerHTML =
      "<h3 style='display:flex;align-items:center;gap:8px;flex-wrap:wrap'><span>📌 פוזיציות פתוחות" + (openPosMin ? "" : " · Unrealized P&L") + "</span>" +
        (openPosMin ? minSummary : '<span class="muted" style="font-size:12px;font-weight:400">מחיר חי מהסורק (מניות בלבד) · לחץ על שורה לעדכון/סגירה' + optNote + "</span>") + (openPosMin ? "" : (pxTimeHtml + refreshBtn + optRefreshBtn + (hasOpt ? _optQuoteAgeHtml() : "") + gridBtn)) + toggleBtn + "</h3>" +
      (openPosMin ? "" :
        "<div class='tablewrap'><table class='scan-table'><thead>" + _thead + "</thead>" +
        "<tbody>" + rows + "</tbody><tfoot><tr>" +
          "<td colspan='" + labelSpan + "' style='text-align:start;font-weight:700;padding-top:10px'>סה\"כ</td>" +
          "<td style='padding-top:10px'></td>" +
          "<td class='risk-cell' style='font-weight:800;padding-top:10px' title='סך הסיכון בכל הפוזיציות · באחוזים משווי התיק הפתוח כרגע'>" + totRiskHtml + "</td>" +
          "<td style='font-weight:800;padding-top:10px' title='סך שווי הפוזיציות הפתוחות'>" + money(totPosVal, 0) + "</td>" +
          "<td style='padding-top:10px'></td>" +
          "<td style='padding-top:10px'></td>" +
          "<td class='" + (totThetaDay >= 0 ? "pos" : "neg") + "' style='font-weight:800;padding-top:10px;font-family:Heebo,Rubik,sans-serif' title='סך שחיקת הזמן היומית של כל פוזיציות האופציה הפתוחות'>" + (haveTheta ? (totThetaDay >= 0 ? "+" : "") + money(totThetaDay, 2) + "<span class='muted' style='font-size:11px'>/יום</span>" : "") + "</td>" +
          "<td style='padding-top:10px'></td>" +
          "<td style='font-weight:800;padding-top:10px'>" + totHtml + "</td>" +
          "<td style='font-weight:800;padding-top:10px'>" + totPct + "</td>" +
          "<td></td></tr></tfoot></table></div>");
    { const rb = wrap.querySelector("#openPxRefresh"); if (rb) rb.onclick = () => {
        rb.textContent = "⏳ מרענן…"; rb.disabled = true;
        livePricesTs = 0;                                // bypass cache → pull the freshest feed now
        ensureLivePrices().then(() => render());
      }; }
    { const ob = wrap.querySelector("#optRefreshBtn"); if (ob) ob.onclick = () => refreshOptionPrices(false); }
    { const gb = wrap.querySelector("#openPosGrid"); if (gb) gb.onclick = () => {
        const seen = {};
        const grows = openTrades.map(t => {
          const u = String(t.symbol || "").split(" ")[0]; const lp = livePrices && livePrices[u];
          return { sym: u, price: (lp && lp[0]) || (+t.entryPrice || 0), chg: (lp && lp[1]) || 0 };
        }).filter(r => r.sym && !seen[r.sym] && (seen[r.sym] = 1));   // unique underlyings
        if (grows.length && window._snOpenChartGrid) window._snOpenChartGrid(grows, { title: "פוזיציות פתוחות" });
      }; }
    { const cb = wrap.querySelector("#openPosCopy"); if (cb) cb.onclick = () => {
        const syms = openTrades.map(t => t.symbol).filter(Boolean).join(", ");
        if (!syms) return;
        const o = cb.textContent, done = () => { cb.textContent = "✓ הועתקו " + openTrades.length; setTimeout(() => cb.textContent = o, 1500); };
        const fallback = () => { try { const ta = document.createElement("textarea"); ta.value = syms; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); done(); } catch (e) {} };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(syms).then(done).catch(fallback); else fallback();
      }; }
    { const tg = wrap.querySelector("#openPosToggle"); if (tg) tg.onclick = () => { openPosMin = !openPosMin; try { localStorage.setItem("sn_openpos_min", openPosMin ? "1" : "0"); } catch (e) {} render(); }; }
    { const ag = wrap.querySelector("#openPosAgg"); if (ag) ag.onclick = () => { _openAgg = !_openAgg; try { localStorage.setItem("sn_openpos_agg", _openAgg ? "1" : "0"); } catch (e) {} render(); }; }
    wrap.querySelectorAll("[data-jsort]").forEach(th => th.onclick = () => {
      const c = th.dataset.jsort;
      if (_openSort.col === c) _openSort.dir *= -1;
      else { _openSort.col = c; _openSort.dir = (c === "symbol" || c === "entryDate" || c === "direction") ? 1 : -1; }
      render();
    });
    // "שחיקה ליום" header is a 2-state toggle (Adi): 1st click → sort by DTE (nearest expiry first),
    // next click → sort by the daily $ decay (biggest first), then back.
    { const tth = wrap.querySelector("[data-jsortopt]"); if (tth) tth.onclick = () => {
        if (_openSort.col === "dte") { _openSort.col = "theta"; _openSort.dir = -1; }
        else { _openSort.col = "dte"; _openSort.dir = 1; }
        render();
      }; }
    // wire the manual option-price inputs (typing a premium → live Unrealized P&L)
    wrap.querySelectorAll("[data-optpx]").forEach(inp => {
      inp.onclick = e => e.stopPropagation();          // focusing the field must not open the row-edit
      inp.onchange = () => { _setOptPrice(inp.dataset.optpx, inp.value); render(); };
    });
    // wire: click row or close button -> open the edit form (add exit price to close)
    // a CSV-derived open (imported, unmatched) has no manual record — close/edit it by converting to a
    // manual trade (editCsvTrade), and delete it by removing its fills (deleteTrade handles both).
    wrap.querySelectorAll("[data-editopen]").forEach(tr => tr.onclick = () => {
      const t = openTrades.find(x => x.id === tr.dataset.editopen);
      if (t && t.source === "csv") editCsvTrade(t); else editOpenTrade(tr.dataset.editopen);
    });
    wrap.querySelectorAll("[data-closepos]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const t = openTrades.find(x => x.id === b.dataset.closepos);
      if (t && t.source === "csv") editCsvTrade(t); else editOpenTrade(b.dataset.closepos);
    });
    wrap.querySelectorAll("[data-delpos]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const t = openTrades.find(x => x.id === b.dataset.delpos);
      if (t && t.source === "csv") { deleteTrade(t); return; }   // confirms + removes the composing fills
      if (!confirm("למחוק את הפוזיציה הפתוחה " + (t ? t.symbol : "") + "? פעולה זו אינה הפיכה.")) return;
      Store.deleteManual(b.dataset.delpos); render();
    });
    wrap.querySelectorAll("[data-img]").forEach(b => b.onclick = e => { e.stopPropagation(); const t = openTrades.find(x => x.id === b.dataset.img); if (t && t.img) viewTradeImg(t); });
    // 📸 share ONE live position as a ninja card (live=unrealized ROI, "מחיר נוכחי")
    wrap.querySelectorAll("[data-sharepos]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const dir = b.dataset.spDir === "short" ? "short" : "long";
      const entry = parseFloat(b.dataset.spEntry), cp = parseFloat(b.dataset.spCp);
      if (!entry || cp == null || isNaN(cp)) { toast("אין מחיר חי לפוזיציה זו"); return; }
      const roi = dir === "short" ? (entry - cp) / entry * 100 : (cp - entry) / entry * 100;
      const today = new Date().toISOString().slice(0, 10);
      if (window.snShareTradeCard) window.snShareTradeCard({ sym: b.dataset.spSym, dir: dir, qty: b.dataset.spQty, atype: b.dataset.spAtype, entry: entry, exit: cp, roi: roi, dateStr: today, live: true });
      else toast("כלי השיתוף עדיין נטען");
    });
    // ⭐ add/remove an open-position ticker to the site favorites (⭐ watchlist). Keeps every lot of
    // the same ticker in sync, and updates in place (no full re-render → no scroll jump).
    wrap.querySelectorAll("[data-favpos]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const sym = b.dataset.favpos;
      if (window.Prefs) window.Prefs.toggleFav(sym);
      wrap.querySelectorAll("[data-favpos]").forEach(x => {
        const on = !!(window.Prefs && window.Prefs.isFav(x.dataset.favpos));
        x.classList.toggle("on", on); x.textContent = on ? "★" : "☆";
        x.title = on ? "הסר ממועדפים" : "הוסף למועדפים";
      });
      const nowFav = !!(window.Prefs && window.Prefs.isFav(sym));
      toast(nowFav ? ("★ " + sym + " נוסף למועדפים") : (sym + " הוסר מהמועדפים"));
    });
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
    // blank/unnamed bucket (e.g. imported CSV with no account column): keep it SELECTABLE when it holds
    // data, so those positions are visible & manageable — not silently counted only in the combined view.
    const hasBlank = Store.hasBlank();
    if (hasBlank && accts.indexOf("") < 0) { const o = el("option"); o.value = ""; o.textContent = "🗂️ ללא שם חשבון (מיובא)"; sel.appendChild(o); }
    // combined view — worth offering when there are 2+ selectable buckets
    if (accts.length + (hasBlank && accts.indexOf("") < 0 ? 1 : 0) >= 2) { const o = el("option"); o.value = ALL; o.textContent = "📊 כל החשבונות (משולב)"; sel.appendChild(o); }
    if (state.account != null) sel.value = state.account;
    sel.parentElement.style.display = (accts.length || hasBlank) ? "" : "none";
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === state.tab));
  }

  // total unrealized P&L across ALL open positions — manual AND FIFO/CSV-derived. Stocks priced from
  // the live feed; options only when a current price was typed in. Returns {un, missing}.
  function totalUnrealized(manualOpen, fifoOpen) {
    const optPx = _optPrices(), autoPx = _optAuto();
    let un = 0, missing = 0;
    (manualOpen || []).forEach(t => {
      const isOpt = t.assetType === "option";
      const _occ = isOpt ? _occSymbol(t) : null;
      const cp = isOpt ? (optPx[t.id] != null ? optPx[t.id] : (_occ && autoPx[_occ] != null ? autoPx[_occ] : null)) : (livePrices ? livePrices[t.symbol] : null);
      if (cp != null) un += unrealizedPnl(t, cp); else missing++;
    });
    (fifoOpen || []).forEach(p => {
      const isOpt = p.assetType === "option";
      const cp = isOpt ? null : (livePrices ? livePrices[p.symbol] : null);   // no live/typed price for FIFO option opens
      if (cp != null) un += (cp - p.avgPrice) * p.qty * (isOpt ? 100 : 1);    // qty is signed → works for shorts too
      else missing++;
    });
    return { un: un, missing: missing };
  }
  // "P&L כולל" banner = realized (closed trades) + unrealized (open positions) — the figure that
  // reconciles with a broker's mark-to-market Net P&L (which counts open positions too).
  function renderTotalPnl(trades, manualOpen, fifoOpen) {
    const realized = E.stats(trades).net;
    const u = totalUnrealized(manualOpen, fifoOpen);
    const combined = realized + u.un;
    const wrap = el("div", "panel jr-totalpnl");
    const note = u.missing ? " · <span style='font-size:11px'>" + u.missing + " פוזיציות בלי מחיר חי (לרוב אופציות) לא נכללו</span>" : "";
    wrap.innerHTML =
      "<div class='jtp-top'><span class='jtp-lbl'>💰 P&L כולל <span class='muted' style='font-weight:400;font-size:12px'>· כל הזמן (ממומש + לא-ממומש)</span></span>" +
        "<span class='jtp-val " + cls(combined) + "'>" + money(combined, 2) + "</span></div>" +
      "<div class='jtp-sub'>ממומש (עסקאות סגורות): <b class='" + cls(realized) + "'>" + money(realized, 2) + "</b>  +  לא-ממומש (פוזיציות פתוחות): <b class='" + cls(u.un) + "'>" + money(u.un, 2) + "</b>" + note + "</div>";
    return wrap;
  }
  function renderStatCards(trades) {
    const s = E.stats(trades);
    const box = el("div", "jr-statwrap");
    box.appendChild(el("div", "jr-scope-lbl", "📊 סטטיסטיקה כללית · כל הזמן (סיכום כל החודשים) — לוח השנה למטה מציג חודש אחד בכל פעם"));
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
    box.appendChild(wrap);
    return box;
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

  // ---- Yearly P&L view (year × month|quarter grid + per-year totals) -----
  let _yearlyQ = (function () { try { return localStorage.getItem("sn_yearly_q") === "1"; } catch (e) { return false; } })();
  function renderYearly(trades) {
    const wrap = el("div", "panel");
    const byYear = {};
    (trades || []).forEach(t => {
      const d = t.exitDate; if (!d || d.length < 7) return;
      const y = d.slice(0, 4), m = parseInt(d.slice(5, 7), 10) - 1;
      if (isNaN(m) || m < 0 || m > 11) return;
      if (!byYear[y]) byYear[y] = { m: new Array(12).fill(0), mN: new Array(12).fill(0), total: 0, n: 0, wins: 0 };
      const o = byYear[y];
      o.m[m] += (t.pnl || 0); o.mN[m]++;
      o.total += (t.pnl || 0); o.n++; if ((t.pnl || 0) > 0) o.wins++;
    });
    const years = Object.keys(byYear).sort((a, b) => b - a);
    const q = _yearlyQ;
    const toggle = "<span class='flow-tf yr-gran'>" +
      [["month", "חודשי"], ["quarter", "רבעוני"]].map(x => "<button class='flow-tf-btn" + ((x[0] === "quarter") === q ? " on" : "") + "' data-yrgran='" + x[0] + "'>" + x[1] + "</button>").join("") + "</span>";
    const heading = "<h3 style='display:flex;align-items:center;gap:10px;flex-wrap:wrap'><span>📆 P&L שנתי <span class='muted' style='font-size:12px;font-weight:400'>· רווח/הפסד לפי " + (q ? "רבעון" : "חודש") + " ושנה</span></span>" + toggle + "</h3>";
    const wire = () => wrap.querySelectorAll("[data-yrgran]").forEach(b => b.onclick = () => { _yearlyQ = b.dataset.yrgran === "quarter"; try { localStorage.setItem("sn_yearly_q", _yearlyQ ? "1" : "0"); } catch (e) {} render(); });
    if (!years.length) {
      wrap.innerHTML = heading + '<div class="muted" style="padding:14px">אין עדיין עסקאות סגורות. ייבא דוח או הזן עסקה כדי לראות סיכום שנתי.</div>';
      wire(); return wrap;
    }
    const COLS = q ? ["Q1", "Q2", "Q3", "Q4"] : ["ינו", "פבר", "מרץ", "אפר", "מאי", "יונ", "יול", "אוג", "ספט", "אוק", "נוב", "דצמ"];
    const valAt = (o, i) => q ? (o.m[i * 3] + o.m[i * 3 + 1] + o.m[i * 3 + 2]) : o.m[i];
    const nAt = (o, i) => q ? (o.mN[i * 3] + o.mN[i * 3 + 1] + o.mN[i * 3 + 2]) : o.mN[i];
    const cellOf = (v, has) => has ? '<td class="' + cls(v) + '">' + money(v, 0) + "</td>" : '<td class="muted">—</td>';
    const colTot = COLS.map(() => 0), colN = COLS.map(() => 0);
    let grand = 0, grandN = 0, grandWins = 0;
    years.forEach(y => { const o = byYear[y]; COLS.forEach((_, i) => { colTot[i] += valAt(o, i); colN[i] += nAt(o, i); }); grand += o.total; grandN += o.n; grandWins += o.wins; });
    const head = "<tr><th style='text-align:start'>שנה</th>" + COLS.map(c => "<th>" + c + "</th>").join("") + "<th>סה\"כ שנתי</th><th>Win%</th><th>עסקאות</th></tr>";
    const rows = years.map(y => {
      const o = byYear[y];
      const cells = COLS.map((_, i) => cellOf(valAt(o, i), nAt(o, i) > 0)).join("");
      const win = o.n ? Math.round(100 * o.wins / o.n) : 0;
      return "<tr><td style='font-weight:800;text-align:start'>" + y + "</td>" + cells +
        '<td class="' + cls(o.total) + '" style="font-weight:800">' + money(o.total, 0) + "</td><td>" + win + "%</td><td class='muted'>" + o.n + "</td></tr>";
    }).join("");
    const gwin = grandN ? Math.round(100 * grandWins / grandN) : 0;
    const foot = years.length > 1
      ? "<tr><td style='font-weight:800;text-align:start'>כל השנים</td>" + colTot.map((v, i) => cellOf(v, colN[i] > 0)).join("") +
        '<td class="' + cls(grand) + '" style="font-weight:800">' + money(grand, 0) + "</td><td>" + gwin + "%</td><td class='muted'>" + grandN + "</td></tr>"
      : "";
    wrap.innerHTML = heading +
      "<div class='tablewrap'><table class='scan-table yearly-table'><thead>" + head + "</thead><tbody>" + rows + "</tbody>" +
      (foot ? "<tfoot>" + foot + "</tfoot>" : "") + "</table></div>";
    wire();
    return wrap;
  }

  // ---- Calendar view (month day-grid · quarter / year month-grid) --------
  // monthly P&L aggregate ("YYYY-MM" → {net, n, wins}), for the quarter/year views + month cells
  function calByMonth(trades) {
    const m = {};
    (trades || []).forEach(t => {
      const d = t.exitDate; if (!d || d.length < 7) return;
      const ym = d.slice(0, 7);
      if (!m[ym]) m[ym] = { net: 0, n: 0, wins: 0 };
      m[ym].net += (t.pnl || 0); m[ym].n++; if ((t.pnl || 0) > 0) m[ym].wins++;
    });
    return m;
  }
  function calGranBar(gran) {
    const bar = el("div", "cal-granbar");
    bar.innerHTML = "<span class='flow-tf cal-gran'>" +
      [["month", "חודשי"], ["quarter", "רבעוני"], ["year", "שנתי"]].map(x =>
        "<button class='flow-tf-btn" + (x[0] === gran ? " on" : "") + "' data-calgran='" + x[0] + "'>" + x[1] + "</button>").join("") + "</span>";
    bar.querySelectorAll("[data-calgran]").forEach(b => b.onclick = () => {
      const g = b.dataset.calgran;
      if (g !== "month") {   // entering a period view → anchor it on the month currently shown
        const ym = (state.months || [])[state.monthIdx] || "";
        if (ym) { state.calYear = +ym.slice(0, 4); state.calQ = Math.floor((+ym.slice(5, 7) - 1) / 3) + 1; }
      }
      state.calGran = g; try { localStorage.setItem("sn_cal_gran", g); } catch (e) {}
      render();
    });
    return bar;
  }
  function calMonthCell(ym, a) {
    const mm = +ym.slice(5, 7), yy = ym.slice(0, 4);
    const cell = el("div", "cal-mcell" + (a ? (a.net > 0 ? " pos" : a.net < 0 ? " neg" : "") : " empty"));
    let inner = "<div class='cm-name'>" + HEB[mm - 1] + " " + yy + "</div>";
    if (a && a.n) {
      inner += "<div class='cm-pnl " + cls(a.net) + "'>" + money(a.net) + "</div>" +
        "<div class='cm-sub'>" + a.n + " עסקאות · " + Math.round(100 * a.wins / a.n) + "%</div>";
      cell.classList.add("clickable");
      cell.onclick = () => { state.calGran = "month"; try { localStorage.setItem("sn_cal_gran", "month"); } catch (e) {} const i = (state.months || []).indexOf(ym); if (i >= 0) state.monthIdx = i; render(); };
    } else {
      inner += "<div class='cm-pnl muted'>—</div><div class='cm-sub muted'>אין עסקאות</div>";
    }
    cell.innerHTML = inner;
    return cell;
  }
  function renderCalPeriod(gran, byMonth) {
    const wrap = el("div");
    wrap.appendChild(calGranBar(gran));
    const years = Array.from(new Set(Object.keys(byMonth).map(k => k.slice(0, 4)))).sort();
    if (!years.length) { wrap.appendChild(el("div", "note", "אין עסקאות סגורות בחשבון זה עדיין.")); return wrap; }
    const minY = +years[0], maxY = +years[years.length - 1];
    let cy = Math.max(minY, Math.min(maxY, state.calYear != null ? state.calYear : maxY));
    let cq = Math.max(1, Math.min(4, state.calQ != null ? state.calQ : 1));
    state.calYear = cy; state.calQ = cq;
    let ymList, plabel;
    if (gran === "year") { ymList = []; for (let mm = 1; mm <= 12; mm++) ymList.push(cy + "-" + String(mm).padStart(2, "0")); plabel = String(cy); }
    else { const s = (cq - 1) * 3 + 1; ymList = [0, 1, 2].map(k => cy + "-" + String(s + k).padStart(2, "0")); plabel = "Q" + cq + " · " + cy; }
    const bar = el("div", "calbar");
    const nav = el("div", "nav"), prev = el("button", null, "‹"), next = el("button", null, "›"), label = el("div", "mlabel");
    label.textContent = plabel;
    const step = dir => {
      if (gran === "year") { const ny = cy + dir; if (ny < minY || ny > maxY) return; state.calYear = ny; }
      else { let q = cq + dir, y = cy; if (q > 4) { q = 1; y++; } if (q < 1) { q = 4; y--; } if (y < minY || y > maxY) return; state.calYear = y; state.calQ = q; }
      render();
    };
    prev.onclick = () => step(-1); next.onclick = () => step(1);
    nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
    const lastBtn = el("button", "btn", "לאחרון");
    lastBtn.onclick = () => { const lm = years.length ? Object.keys(byMonth).sort().slice(-1)[0] : null; state.calYear = maxY; if (lm) state.calQ = Math.floor((+lm.slice(5, 7) - 1) / 3) + 1; render(); };
    bar.appendChild(nav); bar.appendChild(lastBtn); bar.appendChild(el("div", "spacer"));
    let pTot = 0, pN = 0, pWins = 0;
    ymList.forEach(ym => { const a = byMonth[ym]; if (a) { pTot += a.net; pN += a.n; pWins += a.wins; } });
    bar.appendChild(el("span", "badge lbl", gran === "year" ? "סה\"כ שנתי:" : "סה\"כ רבעוני:"));
    bar.appendChild(el("span", "badge " + (pTot >= 0 ? "pos" : "neg"), money(pTot)));
    bar.appendChild(el("span", "badge days", pN + " עסקאות · " + (pN ? Math.round(100 * pWins / pN) : 0) + "%"));
    if (pN) {
      const perTradesBtn = el("button", "btn", "📋 עסקאות " + (gran === "year" ? "השנה" : "הרבעון"));
      perTradesBtn.onclick = () => openPeriod(ymList[0] + "-01", ymList[ymList.length - 1] + "-31", "עסקאות · " + plabel);
      bar.appendChild(perTradesBtn);
    }
    wrap.appendChild(bar);
    const grid = el("div", "cal-mgrid" + (gran === "quarter" ? " q" : ""));
    ymList.forEach(ym => grid.appendChild(calMonthCell(ym, byMonth[ym])));
    wrap.appendChild(grid);
    return wrap;
  }
  function renderCalendar(trades) {
    const days = E.dailyFromTrades(trades);
    const monthsSet = new Set(Object.keys(days).map(k => k.slice(0, 7)));
    const months = Array.from(monthsSet).sort();
    state.months = months;
    if (state.monthIdx >= months.length) state.monthIdx = months.length - 1;
    if (state.monthIdx < 0) state.monthIdx = months.length - 1;

    const gran = state.calGran || "month";
    if (gran !== "month") return renderCalPeriod(gran, calByMonth(trades));

    const wrap = el("div");
    wrap.appendChild(calGranBar("month"));
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
    const monLbl = el("span", "badge lbl", "סטטיסטיקה חודשית:");
    bar.appendChild(monLbl);
    bar.appendChild(monTot); bar.appendChild(monDays);
    const monTradesBtn = el("button", "btn", "📋 עסקאות החודש");
    bar.appendChild(monTradesBtn);
    wrap.appendChild(bar);

    if (!months.length) { wrap.appendChild(el("div", "note", "אין עסקאות סגורות בחשבון זה עדיין.")); return wrap; }

    const ym = months[state.monthIdx];
    const [y, m] = ym.split("-").map(Number);
    label.textContent = HEB[m - 1] + " " + y;
    monLbl.textContent = "סטטיסטיקה של " + HEB[m - 1] + " " + y + " בלבד:";
    monTradesBtn.onclick = () => openPeriod(ym + "-01", ym + "-31", "עסקאות · " + HEB[m - 1] + " " + y);
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
    const posVal = t => Math.abs((+t.entryPrice || 0) * (+t.qty || 0) * (+t.mult || 1));
    const net = dayTrades.reduce((s, t) => s + t.pnl, 0);
    const totalPos = dayTrades.reduce((s, t) => s + posVal(t), 0);
    const retPct = totalPos ? net / totalPos * 100 : 0;   // capital-weighted: net ÷ total capital deployed
    const pctS = (retPct >= 0 ? "+" : "−") + Math.abs(retPct).toFixed(1) + "%";
    const rows = dayTrades.map(t => tradeRow(t)).join("");
    const body =
      '<div style="margin-bottom:12px" class="' + cls(net) + '"><b style="font-size:18px">' + money(net, 2) + "</b> · " + dayTrades.length + " עסקאות · הושקע " + money(totalPos, 0) + ' · <b>' + pctS + "</b> תשואה על ההון</div>" +
      '<div class="tablebox" style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table><thead><tr>' +
      "<th>סימבול</th><th>כיוון</th><th>כמות</th><th>כניסה</th><th>שווי פוזיציה</th><th>יציאה</th><th>נטו</th><th></th></tr></thead><tbody>" +
      rows + "</tbody>" +
      '<tfoot><tr class="jr-day-total"><td colspan="4" style="text-align:start;font-weight:700">סה"כ · ' + dayTrades.length + ' עסקאות</td><td style="font-weight:700">' + money(totalPos, 0) + '</td><td></td><td class="' + cls(net) + '" style="font-weight:700">' + money(net, 2) + ' <span style="font-size:11px;opacity:.85">(' + pctS + ')</span></td><td></td></tr></tfoot>' +
      "</table></div>" +
      '<div class="note">✏️ עריכה — לעסקאות ידניות · 🗑 מחיקה — לכולן (מחיקת עסקת CSV מסירה את פקודות הביצוע שמרכיבות אותה).</div>';
    modal("עסקאות · " + dateKey, body, null, "modal-trades");
    wireTradeActions($("#modalBg"), dayTrades, () => openDay(dateKey));
  }
  // all closed trades in a date RANGE (a month / quarter / year) — table + a footer that sums the
  // capital that entered trades ("חשיפה") over the whole period.
  function openPeriod(fromKey, toKey, title) {
    const { trades } = tradesForAccount();
    const list = trades.filter(t => t.exitDate && t.exitDate >= fromKey && t.exitDate <= toKey)
      .sort((a, b) => (a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0));
    if (!list.length) { modal(title, '<div class="note">אין עסקאות סגורות בתקופה הזו.</div>', []); return; }
    const posVal = t => Math.abs((+t.entryPrice || 0) * (+t.qty || 0) * (+t.mult || 1));
    // sortable table: value per column + apply the current sort (click a header to change)
    const PSORT = { date: t => t.exitDate || "", symbol: t => (t.symbol || "").toUpperCase(), direction: t => t.direction || "", qty: t => +t.qty || 0, entry: t => +t.entryPrice || 0, pos: t => posVal(t), exit: t => +t.exitPrice || 0, net: t => t.pnl || 0 };
    const _pf = PSORT[_periodSort.col] || PSORT.date;
    const sorted = list.slice().sort((a, b) => { const va = _pf(a), vb = _pf(b); const c = (typeof va === "string") ? (va < vb ? -1 : va > vb ? 1 : 0) : (va - vb); return c * _periodSort.dir; });
    const net = list.reduce((s, t) => s + t.pnl, 0);
    const totalPos = list.reduce((s, t) => s + posVal(t), 0);
    const retPct = totalPos ? net / totalPos * 100 : 0;   // capital-weighted: net ÷ total capital deployed
    const pctS = (retPct >= 0 ? "+" : "−") + Math.abs(retPct).toFixed(1) + "%";
    const dstr = d => (d ? d.split("-").reverse().join(".") : "—");
    const rows = sorted.map(t => {
      const actions =
        '<button class="btn ghost" data-sharetrade="' + t.id + '" title="שתף עסקה ככרטיס נינג׳ה">📸</button> ' +
        (_hasReflect(t) ? '<button class="btn ghost" data-reflect="' + t.id + '" title="רפלקציה">🧠</button> ' : "") +
        (t.img ? '<button class="btn ghost" data-img="' + t.id + '" title="צפה בצילום הגרף">📷</button> ' : "") +
        ((t.source === "manual" || (t.fillKeys && t.fillKeys.length)) ? '<button class="btn ghost" data-edit="' + t.id + '" title="' + (t.source === "manual" ? "ערוך" : "ערוך · המרה לעסקה ידנית") + '">✏️</button> ' : "") +
        '<button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>';
      const pv = posVal(t);
      return '<tr><td class="muted" style="white-space:nowrap">' + dstr(t.exitDate) + "</td><td>" + chartSym(t.symbol) +
        '</td><td><span class="pill ' + t.direction + '">' + (t.direction === "long" ? "לונג" : "שורט") + "</span></td><td>" + t.qty + "</td><td>" +
        money(t.entryPrice, 2) + "</td><td>" + money(pv, 0) + "</td><td>" + money(t.exitPrice, 2) + '</td><td class="' + cls(t.pnl) + '">' + money(t.pnl, 2) + "</td><td>" + actions + "</td></tr>";
    }).join("");
    const body =
      '<div style="margin-bottom:12px" class="' + cls(net) + '"><b style="font-size:18px">' + money(net, 2) + "</b> · " + list.length + " עסקאות · הושקע " + money(totalPos, 0) + " · <b>" + pctS + "</b> תשואה על ההון</div>" +
      '<div class="tablebox" style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table><thead><tr>' +
      [["date", "תאריך"], ["symbol", "סימבול"], ["direction", "כיוון"], ["qty", "כמות"], ["entry", "כניסה"], ["pos", "חשיפה"], ["exit", "יציאה"], ["net", "נטו"]].map(c => "<th class='jsort' data-psort='" + c[0] + "' style='cursor:pointer'>" + c[1] + (_periodSort.col === c[0] ? (_periodSort.dir === 1 ? " ▲" : " ▼") : "") + "</th>").join("") + "<th></th></tr></thead><tbody>" +
      rows + "</tbody>" +
      '<tfoot><tr class="jr-day-total"><td colspan="5" style="text-align:start;font-weight:700">סה"כ · ' + list.length + ' עסקאות</td><td style="font-weight:700">' + money(totalPos, 0) + '</td><td></td><td class="' + cls(net) + '" style="font-weight:700">' + money(net, 2) + ' <span style="font-size:11px;opacity:.85">(' + pctS + ')</span></td><td></td></tr></tfoot>' +
      "</table></div>" +
      '<div class="note">💰 "חשיפה" = ההון שנכנס לכל עסקה (מחיר כניסה × כמות). הסיכום למטה = <b>סך ההון שנכנס לעסקאות בתקופה</b>.</div>';
    modal(title, body, null, "modal-trades");
    $("#modalBg").querySelectorAll("[data-psort]").forEach(th => th.onclick = () => {
      const c = th.dataset.psort;
      if (_periodSort.col === c) _periodSort.dir *= -1;
      else _periodSort = { col: c, dir: (c === "date" || c === "symbol" || c === "direction") ? 1 : -1 };   // text→A-Z, numbers→high-first
      openPeriod(fromKey, toKey, title);   // re-render with the new sort
    });
    wireTradeActions($("#modalBg"), list, () => openPeriod(fromKey, toKey, title));
  }
  const _EXIT_REASON_HE = { stop: "🛑 Stop Loss", target: "🎯 Take Profit", emotion: "😰 רגש", plan: "📋 לפי התוכנית", other: "אחר" };
  const _MANAGED_HE = { yes: "✅ ניהול טוב", partial: "🟡 ניהול חלקי", no: "❌ ניהול לא טוב" };
  function _esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function _hasReflect(t) { return !!(t && (t.exitReason || t.managedWell || t.feeling)); }
  function _reflectHtml(t) {
    if (!_hasReflect(t)) return "";
    const chips = [];
    if (t.exitReason && _EXIT_REASON_HE[t.exitReason]) chips.push('<span class="rfl-chip">יציאה: ' + _EXIT_REASON_HE[t.exitReason] + "</span>");
    if (t.managedWell && _MANAGED_HE[t.managedWell]) chips.push('<span class="rfl-chip">' + _MANAGED_HE[t.managedWell] + "</span>");
    return '<div class="jr-reflect-view">' + (chips.length ? '<div class="rfl-chips">' + chips.join("") + "</div>" : "") +
      (t.feeling ? '<div class="rfl-feel">🧠 ' + _esc(t.feeling) + "</div>" : "") + "</div>";
  }
  function viewReflection(t) {
    modal("🧠 רפלקציה · " + (t.symbol || ""), _reflectHtml(t) || '<div class="note">אין רפלקציה לעסקה זו.</div>', []);
  }
  function tradeRow(t) {
    const actions =
      '<button class="btn ghost" data-sharetrade="' + t.id + '" title="שתף עסקה ככרטיס נינג׳ה">📸</button> ' +
      (_hasReflect(t) ? '<button class="btn ghost" data-reflect="' + t.id + '" title="רפלקציה — איך ניהלת את העסקה">🧠</button> ' : "") +
      (t.img ? '<button class="btn ghost" data-img="' + t.id + '" title="צפה בצילום הגרף">📷</button> ' : "") +
      ((t.source === "manual" || (t.fillKeys && t.fillKeys.length)) ? '<button class="btn ghost" data-edit="' + t.id + '" title="' + (t.source === "manual" ? "ערוך" : "ערוך · המרה לעסקה ידנית") + '">✏️</button> ' : "") +
      '<button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>';
    const posVal = Math.abs((+t.entryPrice || 0) * (+t.qty || 0) * (+t.mult || 1));   // capital deployed
    return "<tr><td>" + chartSym(t.symbol) + '</td><td><span class="pill ' + t.direction + '">' +
      (t.direction === "long" ? "לונג" : "שורט") + "</span></td><td>" + t.qty + "</td><td>" +
      money(t.entryPrice, 2) + "</td><td>" + money(posVal, 0) + "</td><td>" + money(t.exitPrice, 2) + '</td><td class="' + cls(t.pnl) +
      '">' + money(t.pnl, 2) + "</td><td>" + actions + "</td></tr>";
  }
  /* wire ✏️/🗑 buttons within a container to a list of trades. `reopen` (optional)
     is called after a successful change to refresh a modal view. */
  function wireTradeActions(container, tradesList, reopen) {
    const byId = {};
    tradesList.forEach(t => { byId[t.id] = t; });
    container.querySelectorAll("button[data-edit]").forEach(b => {
      b.onclick = () => {
        const t = byId[b.dataset.edit]; if (!t) return;
        if (t.source === "manual") { closeModal(); openManual(t); }
        else editCsvTrade(t);   // CSV/imported → convert to manual, then edit
      };
    });
    container.querySelectorAll("button[data-del]").forEach(b => {
      b.onclick = () => deleteTrade(byId[b.dataset.del], reopen);
    });
    container.querySelectorAll("button[data-img]").forEach(b => {
      b.onclick = e => { e.stopPropagation(); const t = byId[b.dataset.img]; if (t && t.img) viewTradeImg(t); };
    });
    container.querySelectorAll("button[data-reflect]").forEach(b => {
      b.onclick = e => { e.stopPropagation(); const t = byId[b.dataset.reflect]; if (t) viewReflection(t); };
    });
    // 📸 share ONE closed trade as a ninja card (realized ROI from entry/exit)
    container.querySelectorAll("button[data-sharetrade]").forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const t = byId[b.dataset.sharetrade]; if (!t) return;
        if (t.exitPrice == null || !t.entryPrice) { toast("אין נתוני כניסה/יציאה לעסקה זו"); return; }
        const dir = t.direction === "short" ? "short" : "long";
        // NET return on capital (P&L after fees ÷ cost) — matches the table's % column
        const pv = Math.abs((+t.entryPrice || 0) * (+t.qty || 0) * (+t.mult || 1));
        const roi = (pv && t.pnl != null) ? (t.pnl / pv * 100)
          : (dir === "short" ? (t.entryPrice - t.exitPrice) : (t.exitPrice - t.entryPrice)) / t.entryPrice * 100;
        if (window.snShareTradeCard) window.snShareTradeCard({ sym: String(t.symbol || "").split(" ")[0], dir: dir, qty: t.qty, atype: t.assetType === "option" ? "Options" : "Stock", entry: t.entryPrice, exit: t.exitPrice, roi: roi, dateStr: t.exitDate || "", live: false });
        else toast("כלי השיתוף עדיין נטען — נסה שוב");
      };
    });
  }
  function viewTradeImg(t) {
    modal("📷 " + t.symbol + " · צילום גרף", '<img src="' + t.img + '" alt="צילום גרף" style="max-width:100%;max-height:70vh;border-radius:8px;display:block;margin:0 auto">' +
      (t.notes ? '<div class="note" style="margin-top:10px">' + _esc(t.notes) + "</div>" : "") + _reflectHtml(t), []);
  }
  function deleteTrade(t, reopen) {
    if (!t) return;
    // Imported OPEN position (CSV-derived, not yet closed) — remove its composing fills. This is the way
    // to clean up a position that shows as "open" by mistake, e.g. only one side (a buy with no sell) was
    // imported, or buy/sell landed in different accounts.
    if (t._open && t.source !== "manual") {
      const q = Math.round((t.qty || 0) * 1e4) / 1e4;
      if (!(t.fillKeys && t.fillKeys.length)) { toast("אין פקודות ביצוע למחיקה"); return; }
      if (!confirm("למחוק את הפוזיציה הפתוחה המיובאת?\n" + t.symbol + " · " + q + " יח׳\n\nזה יסיר את פקודות הביצוע (fills) שמרכיבות אותה מהיומן.")) return;
      Store.deleteFills(t.fillKeys);
      render(); toast("הפוזיציה נמחקה"); if (reopen) reopen(); return;
    }
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
  // Edit a CSV-derived (imported) trade: convert it to a fully-editable MANUAL trade. We remove the raw
  // fills and add an equivalent manual trade with the same values, then open the manual editor on it. Done
  // atomically (convert on confirm) so cancelling the editor keeps the trade — it's just now "manual".
  function editCsvTrade(t) {
    if (!t) return;
    if (!(t.fillKeys && t.fillKeys.length)) { toast("לא ניתן לערוך עסקה זו (פצל קודם עסקה מאוגדת)"); return; }
    if (!confirm("לערוך עסקה מיובאת (CSV)?\n" + t.symbol + "\n\nהיא תומר לעסקה ידנית הניתנת לעריכה מלאה — הערכים יישמרו, ופקודות הביצוע המקוריות יוסרו.")) return;
    // for a parsed option, use the clean underlying as the symbol (strike/expiry/type live in their own
    // fields now) so the editor isn't cluttered with the packed broker string.
    const isOpt = t.assetType === "option";
    const sym = (isOpt && t.strike != null) ? String(t.symbol || "").split(" ")[0] : t.symbol;
    const m = E.manualToTrade({
      account: t.account, symbol: sym, assetType: t.assetType || "stock", optType: t.optType,
      strike: (t.strike != null ? t.strike : ""), expiry: (t.expiry || ""),
      direction: t.direction, qty: t.qty, entryPrice: t.entryPrice,
      exitPrice: (t.exitPrice != null && t.exitPrice !== "") ? t.exitPrice : "",
      entryDate: t.entryDate, exitDate: t.exitDate, fees: t.fees,
    });
    Store.deleteFills(t.fillKeys);
    Store.addManual(m);
    closeModal();
    openManual(m);   // m.source === "manual" + has id → the editor treats it as an edit (updates in place)
  }

  // ---- Equity curve ------------------------------------------------------
  let eqMode = "abs";   // "abs" ($) | "pct" (% of portfolio size)
  let eqPivots = false; try { eqPivots = localStorage.getItem("sn_eq_pivots") === "1"; } catch (e) {}   // PIVOT HIGH/LOW markers
  // equity-curve timeframe (which period to show) — modular + dynamic (Adi)
  let eqRange = "all"; try { eqRange = localStorage.getItem("sn_eq_range") || "all"; } catch (e) {}
  let eqFrom = "", eqTo = ""; try { eqFrom = localStorage.getItem("sn_eq_from") || ""; eqTo = localStorage.getItem("sn_eq_to") || ""; } catch (e) {}   // custom from/to date range
  const EQ_RANGES = [["1m", "חודש"], ["3m", "3ח'"], ["6m", "6ח'"], ["ytd", "השנה"], ["1y", "שנה"], ["all", "הכל"]];
  if (!EQ_RANGES.some(r => r[0] === eqRange)) eqRange = "all";
  function _eqCutoff(range) {
    const now = new Date();
    if (range === "1m") { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; }
    if (range === "3m") { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d; }
    if (range === "6m") { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d; }
    if (range === "ytd") return new Date(now.getFullYear(), 0, 1);
    if (range === "1y") { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; }
    return null;   // "all"
  }
  // how many trailing equity-curve points fall inside a preset range (→ the visible-window size)
  function _rangeCount(range, allPts) {
    const cut = _eqCutoff(range);
    if (!cut) return allPts.length;
    const cs = cut.toISOString().slice(0, 10);
    let c = 0;
    for (let i = allPts.length - 1; i >= 0; i--) { if (allPts[i].date >= cs) c++; else break; }
    return Math.max(2, c);
  }
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
    const _dateMode = !!(eqFrom || eqTo);
    head.innerHTML = '<h3>עקומת הון (רווח/הפסד מצטבר)</h3>' +
      '<span class="eq-ranges">' + EQ_RANGES.map(r =>
        '<button class="eq-range-btn' + (!_dateMode && eqRange === r[0] ? " on" : "") + '" data-eqrange="' + r[0] + '">' + r[1] + "</button>").join("") +
        '<span class="eq-daterange" title="בחר טווח מתאריך עד תאריך"><span class="eq-dr-lbl">מ־</span><input type="date" class="eq-date" id="eqFromInp" value="' + eqFrom + '"><span class="eq-dr-lbl">עד</span><input type="date" class="eq-date" id="eqToInp" value="' + eqTo + '"></span>' + "</span>" +
      '<span class="eq-modes">' +
        '<button class="eq-mode-btn eq-piv-btn' + (eqPivots ? " on" : "") + '" data-eqpiv="1" title="סמן שיאים ושפלים מקומיים (Pivot High/Low) לאורך העקומה">◆ פיבוטים</button>' +
        '<button class="eq-mode-btn' + (eqMode === "abs" ? " on" : "") + '" data-eqmode="abs">$</button>' +
        '<button class="eq-mode-btn' + (eqMode === "pct" ? " on" : "") + '" data-eqmode="pct">%</button></span>';
    box.appendChild(head);
    head.querySelectorAll("[data-eqmode]").forEach(b => b.onclick = () => {
      if (eqMode === b.dataset.eqmode) return; eqMode = b.dataset.eqmode; render();
    });
    { const pb = head.querySelector("[data-eqpiv]"); if (pb) pb.onclick = () => { eqPivots = !eqPivots; try { localStorage.setItem("sn_eq_pivots", eqPivots ? "1" : "0"); } catch (e) {} render(); }; }
    // in % mode: editable portfolio-size base (the % denominator)
    if (eqMode === "pct") {
      const baseRow = el("div", "eq-base-row");
      baseRow.innerHTML = '<label>גודל תיק: $<input type="number" class="eq-base-inp" value="' + base + '" min="1" step="100"></label>' +
        '<span class="muted">' + (getEqBase(acct) == null ? "הערכה אוטומטית (ההון המרבי שהיה בשוק) — ניתן לערוך" : "האחוזים מחושבים מהערך הזה") + "</span>";
      box.appendChild(baseRow);
      const inp = baseRow.querySelector(".eq-base-inp");
      inp.onchange = () => { const v = parseFloat(inp.value); if (v > 0) { setEqBase(acct, v); render(); } };
    }
    const allPts = E.equityCurve(trades);
    if (allPts.length < 2) { box.appendChild(el("div", "note", "צריך לפחות שני ימי מסחר כדי לצייר עקומה.")); return box; }
    const pctMode = eqMode === "pct" && base > 0;
    const toVal = eq => pctMode ? eq / base * 100 : eq;                       // $ → % of portfolio
    const fmtVal = v => pctMode ? (v >= 0 ? "+" : "") + v.toFixed(2) + "%" : money(v, 0);
    // VISIBLE WINDOW as an index range [winA, winB) — the single source of truth. Set by the preset buttons,
    // the from/to date pickers, or the mouse WHEEL (zoom) / Shift+WHEEL (pan). Redraws without a full re-render.
    let winA = 0, winB = allPts.length;
    function _initWin() {
      const total = allPts.length;
      if (eqFrom || eqTo) {
        let ia = 0, ib = total;
        if (eqFrom) { ia = allPts.findIndex(p => p.date >= eqFrom); if (ia < 0) ia = total - 2; }
        if (eqTo) { let j = total - 1; while (j >= 0 && allPts[j].date > eqTo) j--; ib = j + 1; }
        winA = Math.max(0, Math.min(ia, total - 2));
        winB = Math.max(winA + 2, Math.min(ib, total));
      } else {
        const n0 = _rangeCount(eqRange, allPts);
        winA = Math.max(0, total - n0); winB = total;
      }
    }
    _initWin();
    // Catmull-Rom → cubic-bezier smoothing so the line flows instead of jumping between points
    const smooth = P => {
      if (P.length < 2) return "";
      let d = "M" + P[0][0].toFixed(1) + " " + P[0][1].toFixed(1);
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
        const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
        const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += "C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
      }
      return d;
    };
    const chartWrap = el("div", "eq-wrap");
    box.appendChild(chartWrap);
    // draw at the container's REAL pixel size (viewBox == box → no text/shape distortion, exact hover mapping)
    function drawEq() {
      const w = Math.max(320, Math.round(chartWrap.clientWidth || box.clientWidth || 900));
      const h = Math.max(150, Math.round(Math.min(window.innerHeight * 0.30, 460)));
      const padX = 10, padTop = 26, padBot = 26;
      // slice the visible window [winA, winB) and derive this window's scale + pivots
      const total = allPts.length;
      winA = Math.max(0, Math.min(winA, total - 2));
      winB = Math.max(winA + 2, Math.min(winB, total));
      const pts = allPts.slice(winA, winB);
      // RE-BASE the whole curve to the window start: equity JUST BEFORE the first visible point (0 before any
      // trade). So the line, pivots, Y-axis AND headline all read as P&L SINCE the filtered start date — a
      // date-filtered view shows that window's performance, consistently (Adi: pivots were absolute cumulative
      // equity while the headline showed the window return → confusing).
      const _base0raw = winA > 0 ? allPts[winA - 1].equity : 0;
      const eq = pts.map(p => toVal(p.equity - _base0raw));
      const n = pts.length;
      const minY = Math.min(0, Math.min.apply(null, eq)), maxY = Math.max(0, Math.max.apply(null, eq));
      const rng = (maxY - minY) || 1;
      const L = 5, pivHi = [], pivLo = [];
      for (let i = 1; i < n - 1; i++) {
        let hi = true, lo = true;
        for (let j = Math.max(0, i - L); j <= Math.min(n - 1, i + L); j++) {
          if (j === i) continue;
          if (eq[j] >= eq[i]) hi = false;
          if (eq[j] <= eq[i]) lo = false;
        }
        if (hi) pivHi.push(i); else if (lo) pivLo.push(i);
      }
      const X = i => padX + (i / (n - 1)) * (w - padX * 2);
      const Y = v => padTop + (1 - (v - minY) / rng) * (h - padTop - padBot);
      const P = eq.map((v, i) => [X(i), Y(v)]);
      const dpath = smooth(P);
      const apath = dpath + " L" + X(n - 1).toFixed(1) + " " + Y(minY).toFixed(1) + " L" + X(0).toFixed(1) + " " + Y(minY).toFixed(1) + " Z";
      const zeroY = Y(0), last = eq[n - 1];
      // eq is already re-based to the window start, so the last point IS the P&L over the visible window.
      const winRet = last;
      const retStr = pctMode ? (winRet >= 0 ? "+" : "") + winRet.toFixed(2) + "%" : (winRet >= 0 ? "+" : "-") + money(Math.abs(winRet), 0);
      const pivMark = (arr, cls, dy) => arr.map(i =>
        '<g class="eq-piv ' + cls + '"><circle cx="' + X(i).toFixed(1) + '" cy="' + Y(eq[i]).toFixed(1) + '" r="4"/>' +
        '<text x="' + X(i).toFixed(1) + '" y="' + (Y(eq[i]) + dy).toFixed(1) + '" text-anchor="middle">' + fmtVal(eq[i]) + "</text></g>").join("");
      const pivMarks = eqPivots ? (pivMark(pivHi, "hi", -10) + pivMark(pivLo, "lo", 18)) : "";
      chartWrap.innerHTML =
        '<svg class="eqsvg" viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" preserveAspectRatio="none">' +
        '<defs><linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17c08a" stop-opacity=".35"/><stop offset="1" stop-color="#17c08a" stop-opacity="0"/></linearGradient></defs>' +
        '<line class="axis" x1="' + padX + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w - padX) + '" y2="' + zeroY.toFixed(1) + '"/>' +
        '<path class="eqarea" d="' + apath + '"/>' +
        '<path class="eqline" d="' + dpath + '"/>' + pivMarks +
        '<text x="' + (w - padX) + '" y="' + (Y(last) - 8).toFixed(1) + '" text-anchor="end" fill="' + (winRet >= 0 ? "#16b877" : "#e0524f") + '" font-size="15" font-weight="700">' + retStr + "</text>" +
        '<g class="eqhover" style="opacity:0">' +
          '<line class="eqcross" x1="0" y1="' + padTop + '" x2="0" y2="' + (h - padBot) + '"/>' +
          '<circle class="eqdot" cx="0" cy="0" r="5"/>' +
          '<rect class="eqtipbg eqtop" x="0" y="2" width="120" height="24" rx="7"/>' +
          '<text class="eqtiptext eqtoptext" x="0" y="19" text-anchor="middle">—</text>' +
          '<rect class="eqtipbg eqbot" x="0" y="' + (h - 24) + '" width="100" height="22" rx="7"/>' +
          '<text class="eqtiptext eqbottext" x="0" y="' + (h - 9) + '" text-anchor="middle">—</text>' +
        "</g></svg>";
      const svgEl = chartWrap.querySelector(".eqsvg");
      const line = svgEl.querySelector(".eqline");
      const g = svgEl.querySelector(".eqhover");
      const cross = svgEl.querySelector(".eqcross"), dot = svgEl.querySelector(".eqdot");
      const tTxt = svgEl.querySelector(".eqtoptext"), bTxt = svgEl.querySelector(".eqbottext");
      const tBg = svgEl.querySelector(".eqtop"), bBg = svgEl.querySelector(".eqbot");
      const clampX = (cx, wd) => Math.max(wd / 2 + 2, Math.min(w - wd / 2 - 2, cx));
      const ptOnLine = tx => {   // exact point on the SMOOTH curve at x=tx → dot flows along the line
        const len = line.getTotalLength(); if (!len) return { x: tx, y: Y(last) };
        let lo = 0, hi = len;
        for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; const p = line.getPointAtLength(mid); if (p.x < tx) lo = mid; else hi = mid; }
        return line.getPointAtLength((lo + hi) / 2);
      };
      function moveTo(clientX) {
        const rect = svgEl.getBoundingClientRect(); if (!rect.width) return;
        const cx = Math.max(padX, Math.min(w - padX, (clientX - rect.left) / rect.width * w));
        const p = ptOnLine(cx);
        let i = Math.round((cx - padX) / (w - padX * 2) * (n - 1)); i = Math.max(0, Math.min(n - 1, i));
        const val = eq[i], posCol = val >= 0 ? "#16b877" : "#e0524f";
        cross.setAttribute("x1", p.x); cross.setAttribute("x2", p.x);
        dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.setAttribute("fill", posCol);
        const topStr = fmtVal(val); tTxt.textContent = topStr;
        const wT = Math.max(70, topStr.length * 11 + 20);
        tBg.setAttribute("width", wT); tBg.setAttribute("x", clampX(p.x, wT) - wT / 2); tBg.setAttribute("fill", posCol);
        tTxt.setAttribute("x", clampX(p.x, wT));
        bTxt.textContent = pts[i].date;
        const wB = Math.max(84, pts[i].date.length * 9 + 16);
        bBg.setAttribute("width", wB); bBg.setAttribute("x", clampX(p.x, wB) - wB / 2);
        bTxt.setAttribute("x", clampX(p.x, wB));
        g.style.opacity = "1";
      }
      svgEl.addEventListener("mousemove", e => moveTo(e.clientX));
      svgEl.addEventListener("mouseleave", () => { g.style.opacity = "0"; });
      svgEl.addEventListener("touchmove", e => { if (e.touches && e.touches[0]) moveTo(e.touches[0].clientX); }, { passive: true });
    }
    // redraw + reflect the current window in the from/to date inputs (so they're a live readout too)
    function afterWindowChange(clearPreset) {
      drawEq();
      const vis = allPts.slice(Math.max(0, Math.min(winA, allPts.length - 2)), Math.max(0, Math.min(winB, allPts.length)));
      const fi = head.querySelector("#eqFromInp"), ti = head.querySelector("#eqToInp");
      if (fi && vis.length) fi.value = vis[0].date;
      if (ti && vis.length) ti.value = vis[vis.length - 1].date;
      if (clearPreset) head.querySelectorAll("[data-eqrange]").forEach(b => b.classList.remove("on"));
    }
    afterWindowChange(false);
    try { const ro = new ResizeObserver(() => drawEq()); ro.observe(chartWrap); } catch (e) {}
    // mouse WHEEL = zoom the visible window · Shift+WHEEL = pan through history (buttons / dates stay for presets)
    chartWrap.addEventListener("wheel", e => {
      e.preventDefault();
      const total = allPts.length, cnt = winB - winA;
      if (e.shiftKey) {
        const step = Math.max(1, Math.round(cnt * 0.12));
        let a = winA + (e.deltaY > 0 ? -step : step), b = winB + (e.deltaY > 0 ? -step : step);   // scroll down = older
        if (a < 0) { b -= a; a = 0; }
        if (b > total) { a -= (b - total); b = total; }
        winA = Math.max(0, a); winB = Math.min(total, b);
      } else {
        const ncnt = Math.max(5, Math.min(total, Math.round(cnt * (e.deltaY < 0 ? 1 / 1.18 : 1.18))));   // scroll up = zoom in
        winB = Math.min(total, winB); winA = Math.max(0, winB - ncnt);
        if (winB - winA < ncnt) winB = Math.min(total, winA + ncnt);
      }
      afterWindowChange(true);
    }, { passive: false });
    // preset range buttons → set the window (and clear any custom date range)
    head.querySelectorAll("[data-eqrange]").forEach(b => b.onclick = () => {
      eqRange = b.dataset.eqrange; eqFrom = ""; eqTo = "";
      try { localStorage.setItem("sn_eq_range", eqRange); localStorage.removeItem("sn_eq_from"); localStorage.removeItem("sn_eq_to"); } catch (e) {}
      const n0 = _rangeCount(eqRange, allPts); winA = Math.max(0, allPts.length - n0); winB = allPts.length;
      head.querySelectorAll("[data-eqrange]").forEach(x => x.classList.toggle("on", x === b));
      afterWindowChange(false);
    });
    // from/to date pickers → custom window
    { const fi = head.querySelector("#eqFromInp"), ti = head.querySelector("#eqToInp");
      const onDate = () => {
        eqFrom = (fi && fi.value) || ""; eqTo = (ti && ti.value) || "";
        try { eqFrom ? localStorage.setItem("sn_eq_from", eqFrom) : localStorage.removeItem("sn_eq_from"); eqTo ? localStorage.setItem("sn_eq_to", eqTo) : localStorage.removeItem("sn_eq_to"); } catch (e) {}
        _initWin();
        afterWindowChange(true);
      };
      if (fi) fi.onchange = onDate;
      if (ti) ti.onchange = onDate;
    }
    box.appendChild(el("div", "note eq-hint", "🖱️ גלגלת = זום · Shift+גלגלת = הזזה בזמן · כפתורים או מתאריך–עד־תאריך לטווח"));
    return box;
  }

  // ---- Trades table ------------------------------------------------------
  // aggregate closed trades on the same symbol + account + direction into ONE line (weighted-avg
  // prices, summed qty / fees / P&L) so partial fills of one order don't clutter the table. Each
  // aggregated row keeps its constituents in `_trades` for the "split" view.
  function aggregateTrades(trades) {
    const groups = {};
    trades.forEach(t => { const k = (t.symbol || "") + "|" + (t.account || "") + "|" + (t.direction || "") + "|" + (t.optType || ""); (groups[k] = groups[k] || []).push(t); });
    return Object.keys(groups).map(k => {
      const g = groups[k];
      if (g.length === 1) return Object.assign({}, g[0], { _n: 1 });
      const qty = g.reduce((s, t) => s + (+t.qty || 0), 0);
      const wavg = f => qty ? g.reduce((s, t) => s + (+t[f] || 0) * (+t.qty || 0), 0) / qty : 0;
      const src = g.every(t => t.source === "manual") ? "manual" : g.every(t => t.source !== "manual") ? "csv" : "mixed";
      const f = g[0];
      return {
        id: "agg|" + k, symbol: f.symbol, account: f.account, direction: f.direction, assetType: f.assetType, optType: f.optType, mult: f.mult,
        qty: qty, entryPrice: wavg("entryPrice"), exitPrice: wavg("exitPrice"),
        fees: g.reduce((s, t) => s + (+t.fees || 0), 0), pnl: g.reduce((s, t) => s + (+t.pnl || 0), 0),
        exitDate: g.map(t => t.exitDate).filter(Boolean).sort().slice(-1)[0] || "",
        source: src, _n: g.length, _agg: true,
      };
    });
  }
  // individual executions (raw fills), each tagged opening/closing a position. Answers "is this
  // a buy or sell / opening or closing?" and surfaces a raw entry (e.g. a 10-lot buy) that the
  // FIFO round-trip view splits across rows. Only CSV-imported fills (manual trades are whole trades).
  function renderFillsInto(wrap) {
    const acct = state.account;
    let csvFills = Store.getFills() || [];
    let manual = Store.getManual() || [];
    if (acct !== ALL) {
      csvFills = csvFills.filter(f => (f.account || "").trim() === acct);
      manual = manual.filter(m => (m.account || "").trim() === acct);
    }
    const fills = E.computeFills(csvFills).slice();   // CSV executions, FIFO-tagged open/close
    // MANUAL trades are entered as a whole round-trip → decompose each into an OPEN leg (buy for a
    // long / sell for a short) and, if it has an exit, a CLOSE leg. So a manual entry is visible
    // here as its raw buy/sell with an open/close tag, just like an imported fill.
    manual.forEach(m => {
      const isShort = m.direction === "short";
      const qty = Math.abs(parseFloat(m.qty) || 0);
      const hasExit = m.exitPrice !== "" && m.exitPrice != null && !isNaN(parseFloat(m.exitPrice));
      fills.push({ account: m.account, symbol: m.symbol, assetType: m.assetType, optType: m.optType,
        date: m.entryDate, side: isShort ? "S" : "B", qty: qty, price: parseFloat(m.entryPrice) || 0,
        kind: "open", openQty: qty, closeQty: 0, _manual: true });
      if (hasExit) fills.push({ account: m.account, symbol: m.symbol, assetType: m.assetType, optType: m.optType,
        date: m.exitDate || m.entryDate, side: isShort ? "B" : "S", qty: qty, price: parseFloat(m.exitPrice) || 0,
        kind: "close", openQty: 0, closeQty: qty, _manual: true });
    });
    // chronological (oldest first) so a position's פתיחה always precedes its סגירה; on the same
    // date, opens sort before flips before closes.
    const _kord = k => k === "open" ? 0 : k === "flip" ? 1 : 2;
    fills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (_kord(a.kind) - _kord(b.kind))));
    const info = el("div", "note");
    info.style.cssText = "margin:2px 0 10px;font-size:12px";
    info.innerHTML = "🔎 <b>ביצועים בודדים</b> — כל קנייה/מכירה בנפרד, מסומנת אם היא <b>פותחת</b> פוזיציה או <b>סוגרת</b> אותה. עסקאות ידניות מפורקות לרגל פתיחה (ורגל סגירה אם הוזן מחיר יציאה); ביצועים מיובאים מסומנים לפי סדר ה-FIFO. כך רואים כניסה גולמית (למשל קנייה ראשונית של 10 חוזים) שבעסקאות הסגורות מתפצלת.";
    wrap.appendChild(info);
    if (!fills.length) {
      wrap.appendChild(el("div", "note", "אין עדיין ביצועים/עסקאות בחשבון זה. (אם ה-AMZN שלך בחשבון אחר — החלף חשבון למעלה, או בחר 'כל החשבונות'.)"));
      return;
    }
    const showAcct = acct === ALL;
    const sideLbl = f => f.side === "B" ? '<span class="pill long">🟢 קנייה</span>' : '<span class="pill short">🔴 מכירה</span>';
    const kindLbl = r => r.kind === "flip"
      ? '<span class="pill" title="חלק סוגר פוזיציה קיימת וחלק פותח חדשה">🔄 סגירה ' + r.closeQty + " + פתיחה " + r.openQty + "</span>"
      : (r.kind === "close" ? '<span class="pill short">סגירה</span>' : '<span class="pill long">פתיחה</span>');
    const cols = (showAcct ? ["חשבון"] : []).concat(["תאריך", "סימבול", "סוג", "פעולה", "כמות", "מחיר", "פתיחה/סגירה"]);
    let head = "<tr>" + cols.map(c => "<th>" + c + "</th>").join("") + "</tr>";
    let rows = "";
    fills.forEach(f => {
      const isOpt = f.assetType === "option";
      rows += "<tr>" +
        (showAcct ? '<td class="muted" style="white-space:nowrap">' + (f.account || "—") + "</td>" : "") +
        '<td style="white-space:nowrap">' + (f.date || "—") + "</td>" +
        "<td>" + chartSym(f.symbol) + "</td>" +
        '<td><span class="pill ' + (isOpt ? "opt" : "stk") + '">' + (isOpt ? "אופ׳" + (f.optType ? " · " + f.optType.toUpperCase() : "") : "מניה") + "</span></td>" +
        "<td>" + sideLbl(f) + "</td>" +
        "<td>" + (Math.round((f.qty || 0) * 1e4) / 1e4) + "</td>" +
        "<td>" + money(f.price, 2) + "</td>" +
        "<td>" + kindLbl(f) + "</td>" +
        "</tr>";
    });
    const box = el("div", "tablebox");
    box.innerHTML = "<table><thead>" + head + "</thead><tbody>" + rows + "</tbody></table>";
    wrap.appendChild(box);
  }

  function renderTrades(trades, openPositions, manualOpen) {
    const wrap = el("div");
    // ticker filter for the closed-trades table (client-side; no re-render → keeps input focus)
    const filterBar = el("div", "trades-filterbar");
    filterBar.style.cssText = "margin:4px 0 8px";
    filterBar.innerHTML = '<input id="tradeFilter" type="text" placeholder="🔍 סינון לפי טיקר — הקלד למשל AMZN" autocomplete="off" style="padding:7px 11px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:inherit;font-family:Heebo,Rubik,sans-serif;font-size:13px;width:260px;max-width:100%">';
    wrap.appendChild(filterBar);
    const agg = state.aggTrades !== false;
    const base = agg ? aggregateTrades(trades) : trades;
    // exposure = entry notional (qty × entry price × multiplier); exit value = same at the exit price.
    const withPv = base.map(t => { const pv = (t.entryPrice || 0) * (t.qty || 0) * (t.mult || 1); const xv = (t.exitPrice || 0) * (t.qty || 0) * (t.mult || 1); return Object.assign({}, t, { posValue: pv, exitValue: xv, pnlPct: pv > 0 ? (t.pnl || 0) / pv * 100 : 0, _open: false }); });
    const sorted = withPv.sort((a, b) => {
      let av = a[state.sortKey], bv = b[state.sortKey];
      if (typeof av === "string") { return (av < bv ? -1 : av > bv ? 1 : 0) * state.sortDir; }
      return (av - bv) * state.sortDir;
    });
    // OPEN positions (bought, not yet sold) shown in the SAME table, tagged "פתוחה" and pinned on top,
    // so "open vs closed" is a single column. From the CSV-FIFO leftovers + manual open trades.
    const mkOpen = (p, src, entryPrice, mult) => ({
      id: p.id, symbol: p.symbol, account: p.account, direction: p.direction,
      assetType: p.assetType, optType: p.optType, strike: p.strike != null ? p.strike : null, expiry: p.expiry || null,
      qty: p.qty, mult: mult, entryPrice: entryPrice,
      entryDate: p.entryDate, exitDate: "", source: src, fillKeys: p.fillKeys || [],
      posValue: (entryPrice || 0) * (p.qty || 0) * (mult || 1), _open: true,
    });
    const openRows = (openPositions || []).map(p => mkOpen(p, "csv", p.avgPrice, p.assetType === "option" ? 100 : 1))
      .concat((manualOpen || []).map(p => mkOpen(p, "manual", p.entryPrice, p.mult || (p.assetType === "option" ? 100 : 1))));
    openRows.sort((a, b) => (a.entryDate < b.entryDate ? 1 : a.entryDate > b.entryDate ? -1 : 0));
    const allRows = openRows.concat(sorted);   // open positions always on top
    const showAcct = state.account === ALL;   // combined view → show which account each trade is in
    const cols = [
      ...(showAcct ? [["account", "חשבון"]] : []),
      ["_status", "פתיחה/סגירה"],
      ["exitDate", "תאריך יציאה"], ["symbol", "סימבול"], ["assetType", "סוג"],
      ["direction", "כיוון"], ["qty", "כמות"], ["entryPrice", "כניסה"], ["posValue", "חשיפה"],
      ["exitPrice", "יציאה"], ["exitValue", "שווי ביציאה"], ["fees", "עמלות"], ["pnl", "נטו"], ["pnlPct", "% נטו"], ["source", "מקור"],
    ];
    let head = "<tr>";
    cols.forEach(([k, l]) => {
      if (k.charAt(0) === "_") { head += "<th>" + l + "</th>"; return; }   // status column — not sortable
      const arrow = state.sortKey === k ? (state.sortDir < 0 ? " ▾" : " ▴") : "";
      head += '<th data-k="' + k + '">' + l + arrow + "</th>";
    });
    head += "<th></th></tr>";
    let rows = "";
    const em = "<td class='muted'>—</td>";   // empty cell for fields an open position doesn't have yet
    allRows.forEach(t => {
      const srcTxt = t.source === "mixed" ? "מעורב" : t.source === "manual" ? "ידני" : "CSV";
      const nBadge = (t._n > 1) ? ' <span class="agg-badge" title="' + t._n + ' עסקאות מאוגדות — כבה \'אגד\' כדי לפצל">×' + t._n + "</span>" : "";
      const statusCell = t._open
        ? '<td><span class="pill long" title="פוזיציה פתוחה — נקנתה וטרם נסגרה">🟢 פתוחה</span></td>'
        : '<td><span class="pill src" title="פוזיציה שנסגרה — נקנתה ונמכרה">✓ סגורה</span></td>';
      rows += '<tr data-sym="' + String(t.symbol || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "") + '">' +
        (showAcct ? '<td class="muted" style="white-space:nowrap">' + (t.account || "—") + "</td>" : "") +
        statusCell +
        "<td>" + (t._open ? '<span class="muted">—</span>' : t.exitDate) + "</td>" +
        "<td>" + chartSym(t.symbol) + nBadge + "</td>" +
        '<td><span class="pill ' + (t.assetType === "option" ? "opt" : "stk") + '">' + (t.assetType === "option" ? "אופ׳" + (t.optType ? " · " + t.optType.toUpperCase() : "") : "מניה") + "</span></td>" +
        '<td><span class="pill ' + t.direction + '">' + (t.direction === "long" ? "לונג" : "שורט") + "</span></td>" +
        "<td>" + (Math.round((t.qty || 0) * 1e4) / 1e4) + "</td>" +
        "<td>" + money(t.entryPrice, 2) + "</td>" +
        "<td>" + money(t.posValue, 0) + "</td>" +
        (t._open ? em : "<td>" + money(t.exitPrice, 2) + "</td>") +
        (t._open ? em : "<td>" + money(t.exitValue, 0) + "</td>") +
        (t._open ? em : '<td class="zero">' + money(-t.fees, 2) + "</td>") +
        (t._open ? em : '<td class="' + cls(t.pnl) + '">' + money(t.pnl, 2) + "</td>") +
        (t._open ? em : '<td class="' + cls(t.pnl) + '">' + (t.posValue > 0 ? (t.pnlPct >= 0 ? "+" : "") + t.pnlPct.toFixed(2) + "%" : "—") + "</td>") +
        '<td><span class="pill src">' + srcTxt + "</span></td>" +
        "<td>" +
          (t._open
            ? (t.source === "manual" && t.id
                ? '<button class="btn ghost" data-edit="' + t.id + '" title="ערוך / הוסף מחיר יציאה">✏️</button> <button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>'
                : ((t.fillKeys && t.fillKeys.length)
                    ? '<button class="btn ghost" data-del="' + t.id + '" title="מחק את הפוזיציה הפתוחה המיובאת">🗑</button>'
                    : '<span class="muted" style="font-size:11px">פתוחה</span>'))
            : (t._agg ? '<span class="muted" style="font-size:11px" title="פצל כדי לערוך/למחוק עסקה בודדת">מאוגד</span>' :
              ('<button class="btn ghost" data-sharetrade="' + t.id + '" title="שתף עסקה ככרטיס נינג׳ה">📸</button> ' +
               (_hasReflect(t) ? '<button class="btn ghost" data-reflect="' + t.id + '" title="רפלקציה — איך ניהלת את העסקה">🧠</button> ' : "") +
               (t.img ? '<button class="btn ghost" data-img="' + t.id + '" title="צפה בצילום הגרף">📷</button> ' : "") +
               ((t.source === "manual" || (t.fillKeys && t.fillKeys.length)) ? '<button class="btn ghost" data-edit="' + t.id + '" title="' + (t.source === "manual" ? "ערוך" : "ערוך · המרה לעסקה ידנית") + '">✏️</button> ' : "") +
               '<button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>'))) +
        "</td>" +
        "</tr>";
    });
    // aggregate/split toggle
    const aggBar = el("div", "trades-aggbar");
    aggBar.innerHTML = '<label class="agg-toggle"><input type="checkbox" id="aggToggle"' + (agg ? " checked" : "") + '><span>🧬 אגד עסקאות זהות</span></label>' +
      '<span class="muted" style="font-size:11px">אותו טיקר + חשבון + כיוון = שורה אחת. כבה כדי לראות כל רכישה/מכירה בנפרד עם ה-P&L שלה.</span>';
    wrap.appendChild(aggBar);
    const box = el("div", "tablebox");
    box.innerHTML = "<table><thead>" + head + "</thead><tbody>" + rows + "</tbody></table>";
    { const tg = aggBar.querySelector("#aggToggle"); if (tg) tg.onchange = () => { state.aggTrades = tg.checked; try { localStorage.setItem("sn_agg_trades", tg.checked ? "1" : "0"); } catch (e) {} render(); }; }
    box.querySelectorAll("th[data-k]").forEach(th => {
      th.onclick = () => {
        const k = th.dataset.k;
        if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = -1; }
        render();
      };
    });
    wireTradeActions(box, allRows, null);
    wrap.appendChild(box);
    // wire the ticker filter: show/hide rows by data-sym (keeps input focus; persists via state.tradeFilter)
    const _applyFilt = (q) => { q = String(q || "").toUpperCase().trim(); box.querySelectorAll("tbody tr").forEach(tr => { const s = tr.getAttribute("data-sym") || ""; tr.style.display = (!q || s.indexOf(q) >= 0) ? "" : "none"; }); };
    const _fi = filterBar.querySelector("#tradeFilter");
    if (_fi) { _fi.value = state.tradeFilter || ""; _fi.oninput = () => { state.tradeFilter = _fi.value; _applyFilt(_fi.value); }; }
    _applyFilt(state.tradeFilter);
    const lg = el("div", "note");
    lg.style.cssText = "margin-top:8px;font-size:12px";
    lg.innerHTML = "הטור <b>פתיחה/סגירה</b>: 🟢 <b>פתוחה</b> = פוזיציה שנקנתה וטרם נסגרה (מופיעה למעלה) · ✓ <b>סגורה</b> = נקנתה ונמכרה. פוזיציות פתוחות אינן נכללות ברווח/הפסד הממומש.";
    wrap.appendChild(lg);
    return wrap;
  }

  // ---- Import modal ------------------------------------------------------
  function openImport() {
    // Account selector — let the user pick which account the imported trades land in.
    // Default = the account currently being viewed (so the import is visible), else "by file".
    // Forcing ONE account also pairs buys↔sells across files (FIFO is per-account), which prevents
    // round-trips from showing as stuck "open" positions just because the two sides were in two files.
    const accts = Store.accounts();
    const active = (state.account && state.account !== ALL && accts.indexOf(state.account) >= 0) ? state.account : "";
    const optAccts = accts.map(a => '<option value="' + _esc(a) + '"' + (a === active ? " selected" : "") + ">" + _esc(a) + "</option>").join("");
    const acctSel =
      '<div class="imp-acct" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<label style="font-weight:700;font-size:13px">ייבא לחשבון:</label>' +
        '<select id="impAcct" style="min-width:170px;padding:7px 10px;border-radius:9px;background:var(--panel);color:var(--ink);border:1px solid var(--line);font-weight:600">' +
          optAccts +
          '<option value="__FILE__"' + (active ? "" : " selected") + ">📁 לפי הקובץ / הברוקר</option>" +
          '<option value="__NEW__">➕ חשבון חדש…</option>' +
        "</select>" +
        '<input id="impAcctNew" class="hidden" placeholder="שם חשבון חדש" style="min-width:150px;padding:7px 10px;border-radius:9px;background:var(--panel);color:var(--ink);border:1px solid var(--line)">' +
      "</div>";
    const body =
      acctSel +
      '<div class="drop" id="drop"><div class="big" style="font-size:34px">📥</div>' +
      "<b>גרור לכאן קובץ CSV</b> מהברוקר<br><span style=\"font-size:12px\">או לחץ לבחירת קובץ · אפשר כמה קבצים יחד</span></div>" +
      '<input type="file" id="fileInput" accept=".csv" multiple class="hidden">' +
      '<div class="note">כפילויות מזוהות אוטומטית לפי זמן ביצוע — אפשר להעלות קבצים חופפים בלי דאגה.<br>💡 בחירת חשבון מאחדת את כל הביצועים מהקבצים לאותו חשבון, כך שקנייה→מכירה מתחברות לעסקה סגורה אחת.</div>';
    modal("העלאת נתונים", body);
    const drop = $("#drop"), input = $("#fileInput");
    const sel = $("#impAcct"), newInp = $("#impAcctNew");
    if (sel) sel.onchange = () => {
      const isNew = sel.value === "__NEW__";
      if (newInp) { newInp.classList.toggle("hidden", !isNew); if (isNew) newInp.focus(); }
    };
    drop.onclick = () => input.click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("hot"); };
    drop.ondragleave = () => drop.classList.remove("hot");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("hot"); handleFiles(e.dataTransfer.files); };
    input.onchange = () => handleFiles(input.files);
  }
  function handleFiles(files) {
    // Resolve the chosen target account (if any) BEFORE the modal closes.
    let forceAcct = null;
    const sel = document.getElementById("impAcct");
    if (sel) {
      if (sel.value === "__NEW__") { const nv = (document.getElementById("impAcctNew") || {}).value; forceAcct = (nv || "").trim() || null; }
      else if (sel.value && sel.value !== "__FILE__") forceAcct = sel.value;
    }
    let pending = files.length, errs = [], allFills = [];
    if (!pending) return;
    Array.from(files).forEach(file => {
      const rd = new FileReader();
      rd.onload = () => {
        const res = E.parseCSV(rd.result);
        if (res.errors.length) errs = errs.concat(res.errors.slice(0, 3));
        if (forceAcct) {
          // user picked (or created) a target account → stamp EVERY fill with it, so all files
          // merge into the one account and buys↔sells pair correctly.
          (res.fills || []).forEach(f => { f.account = forceAcct; });
        } else if ((res.fills || []).some(f => !(f.account || "").trim())) {
          // "by file": some exports (e.g. Colmex "tradeHistory_COLH97415.csv") have NO account column —
          // the account number lives only in the FILENAME. Stamp it so the trades group under a named
          // account and stay visible (a blank account gets hidden whenever a named account exists).
          const m = String(file.name || "").match(/COL[A-Z]?\d+/i);
          const fromName = m ? m[0].toUpperCase()
            : (String(file.name || "").replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24) || "CSV");
          res.fills.forEach(f => { if (!(f.account || "").trim()) f.account = fromName; });
        }
        allFills = allFills.concat(res.fills || []);
        if (--pending === 0) showImportSummary(allFills, errs);
      };
      rd.onerror = () => { if (--pending === 0) showImportSummary(allFills, errs); };
      rd.readAsText(file);
    });
  }

  // Preview the POST-import state for the accounts this import touches: how many round-trips close,
  // how many stay open (bought, not sold), and how many SELLS have no matching buy ("orphans" — almost
  // always closing a position opened BEFORE this file's date window, which FIFO would otherwise show as
  // a phantom SHORT). Runs FIFO on existing + new fills so a sell matched by a buy already in the
  // journal is NOT counted as an orphan.
  function _importPreview(newFills) {
    const affected = new Set(newFills.map(f => (f.account || "").trim()));
    const pool = Store.getFills().concat(newFills).filter(f => affected.has((f.account || "").trim()));
    const byAcct = {};
    pool.forEach(f => { const a = (f.account || "").trim(); (byAcct[a] = byAcct[a] || []).push(f); });
    let closed = 0, openLong = 0; const orphans = [];
    Object.keys(byAcct).forEach(a => {
      const c = E.computeTrades(byAcct[a]);
      closed += c.trades.length;
      (c.openPositions || []).forEach(p => { if (p.qty > 0) openLong++; else if (p.qty < 0) orphans.push(p); });
    });
    return { closed: closed, openLong: openLong, orphans: orphans };
  }
  // (account|symbol) keys that are pure orphan sells in the combined set (zero buys, net short) — the
  // NEW fills under these keys are what "ייבא בלי יתומות" drops, so no phantom short is created.
  function _orphanFillKeys(newFills) {
    const affected = new Set(newFills.map(f => (f.account || "").trim()));
    const pool = Store.getFills().concat(newFills).filter(f => affected.has((f.account || "").trim()));
    const g = {};
    pool.forEach(f => { const k = (f.account || "") + "|" + f.symbol; const o = g[k] || (g[k] = { b: 0, s: 0 }); if (f.side === "S") o.s += (+f.qty || 0); else o.b += (+f.qty || 0); });
    const keys = new Set();
    Object.keys(g).forEach(k => { if (g[k].b === 0 && g[k].s > 0) keys.add(k); });
    return keys;
  }
  function showImportSummary(allFills, errs) {
    if (!allFills.length) { finishImport(0, errs, []); return; }   // nothing parsed → existing error path
    const exKeys = new Set(Store.getFills().map(E.fillKey));
    const dupCount = allFills.filter(f => exKeys.has(E.fillKey(f))).length;
    const pv = _importPreview(allFills);
    const orphans = pv.orphans;
    const orphanList = orphans.length
      ? '<div style="max-height:120px;overflow:auto;margin:8px 0;padding:8px 10px;background:var(--panel2,rgba(255,255,255,.03));border-radius:8px;font-size:12.5px">' +
        orphans.map(p => '<div>🔴 ' + _esc(p.symbol) + ' · ' + Math.abs(p.qty) + " יח׳</div>").join("") + "</div>"
      : "";
    const row = (emoji, n, label) => '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)"><span>' + emoji + " " + label + '</span><b style="font-size:16px">' + n + "</b></div>";
    const body =
      '<div style="font-size:13.5px;line-height:1.5">' +
        '<p style="margin:0 0 10px">נמצאו <b>' + allFills.length + "</b> ביצועים" +
          (dupCount ? ' · <span class="muted">' + dupCount + " כבר קיימים ויידלגו</span>" : "") + ".</p>" +
        row("✅", pv.closed, "עסקאות סגורות (קנייה+מכירה הותאמו)") +
        row("🟢", pv.openLong, "פוזיציות פתוחות (קנית, טרם מכרת)") +
        (orphans.length ? row("🔴", orphans.length, "מכירות ללא קנייה תואמת") : "") +
        (orphans.length
          ? '<div class="note" style="margin-top:10px">🔴 למכירות האלה אין קנייה תואמת בקובץ — כנראה סגירה של פוזיציות שפתחת <b>לפני</b> התקופה שבקובץ. אם לא היבאת אותן כשורט אמיתי, עדיף לא לייבא אותן (אחרת יוצגו כפוזיציות שורט פתוחות שגויות).' + orphanList + "</div>"
          : '<div class="note" style="margin-top:10px">הכול מתחבר יפה — אין מכירות יתומות.</div>') +
      "</div>" +
      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px">' +
        '<button class="btn ghost" id="impCancel">ביטול</button>' +
        (orphans.length ? '<button class="btn ghost" id="impAll">ייבא הכול (כולל שורט)</button>' : "") +
        '<button class="btn primary" id="impGo">' + (orphans.length ? "ייבא בלי היתומות ✓" : "ייבא ✓") + "</button>" +
      "</div>";
    modal("📋 סיכום הייבוא", body);
    const go = $("#impGo"), all = $("#impAll"), cancel = $("#impCancel");
    if (cancel) cancel.onclick = () => closeModal();
    if (go) go.onclick = () => {
      const drop = orphans.length ? _orphanFillKeys(allFills) : null;
      const toAdd = drop ? allFills.filter(f => !drop.has((f.account || "") + "|" + f.symbol)) : allFills;
      commitImport(toAdd, errs);
    };
    if (all) all.onclick = () => commitImport(allFills, errs);
  }
  function commitImport(fills, errs) {
    const added = Store.addFills(fills);
    const importedAccts = Array.from(new Set(fills.map(f => (f.account || "").trim())));
    finishImport(added, errs || [], importedAccts);
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
      optType: existing && existing.optType ? existing.optType : "call",   // call/put — only meaningful for options
      strike: existing && existing.strike != null ? existing.strike : "",   // option strike (for auto price via CBOE)
      expiry: existing && existing.expiry ? existing.expiry : "",           // option expiry YYYY-MM-DD (for auto price)
      direction: existing ? existing.direction : "long",
      qty: existing && existing.qty != null ? existing.qty : "",
      entryPrice: existing && existing.entryPrice != null ? existing.entryPrice : "",
      sl: existing && existing.sl != null ? existing.sl : "",   // stop-loss price (optional but strongly encouraged)
      tp: existing && existing.tp != null ? existing.tp : "",   // take-profit price (optional)
      exitPrice: existing && existing.exitPrice != null ? existing.exitPrice : "",
      entryDate: existing ? (existing.entryDate || "") : "",
      exitDate: existing && existing.exitDate ? existing.exitDate : "",
      fees: existing && existing.fees != null ? existing.fees : lastFee(),
      notes: existing ? (existing.notes || "") : "",
      exitReason: existing ? (existing.exitReason || "") : "",
      managedWell: existing ? (existing.managedWell || "") : "",
      feeling: existing ? (existing.feeling || "") : "",
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
    set("optType", "m_optt"); set("strike", "m_strike"); set("expiry", "m_expiry"); set("direction", "m_dir"); set("qty", "m_qty"); set("entryPrice", "m_ep"); set("sl", "m_sl"); set("tp", "m_tp"); set("notes", "m_notes");
    set("exitDate", "m_xd"); set("exitPrice", "m_xp"); set("fees", "m_fee");
    set("closeType", "m_closetype"); set("closeQty", "m_closeqty");
    set("exitReason", "m_exitreason"); set("managedWell", "m_managed"); set("feeling", "m_feeling");
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
        field("תאריך כניסה", '<div class="jr-date-row"><input id="m_ed" type="date" value="' + (d.entryDate || "") + '"><button type="button" id="m_ed_today" class="btn ghost jr-today-btn">📅 היום</button></div>') +
        field("חשבון", acctField, true) +
        field("סימבול", '<input id="m_sym" placeholder="AAPL" style="text-transform:uppercase" value="' + (d.symbol || "") + '">') +
        field("סוג נכס", '<select id="m_asset">' + opt("stock", d.assetType, "מניה") + opt("option", d.assetType, "אופציה (×100)") + "</select>") +
        '<div id="m_opt_fields" style="' + (d.assetType === "option" ? "" : "display:none") + '">' +
          '<div class="field"><label>סוג אופציה</label><select id="m_optt">' + opt("call", d.optType, "📈 CALL (קול)") + opt("put", d.optType, "📉 PUT (פוט)") + "</select></div>" +
          field("סטרייק (Strike)", '<input id="m_strike" type="number" step="any" placeholder="245" value="' + (d.strike === "" ? "" : d.strike) + '">') +
          field("תאריך פקיעה (Expiry)", '<input id="m_expiry" type="date" value="' + (d.expiry || "") + '">') +
          '<div class="muted" style="font-size:11px;margin:-2px 0 8px">💡 סטרייק + פקיעה מאפשרים <b>משיכת מחיר אוטומטית</b> (CBOE · מושהה ~15 דק׳)</div>' +
        "</div>" +
        field("כיוון", '<select id="m_dir">' + opt("long", d.direction, "קנייה (לונג)") + opt("short", d.direction, "מכירה (שורט)") + "</select>") +
        field("כמות", '<input id="m_qty" type="number" step="any" placeholder="100" value="' + (d.qty === "" ? "" : d.qty) + '">') +
        field("מחיר כניסה", '<input id="m_ep" type="number" step="any" value="' + (d.entryPrice === "" ? "" : d.entryPrice) + '">') +
        field("🛑 סטופ לוס (SL)", '<input id="m_sl" type="number" step="any" placeholder="מומלץ מאוד — ניהול סיכון" value="' + (d.sl === "" ? "" : d.sl) + '"' + (d.sl === "" ? ' class="sl-missing"' : "") + '><div id="m_risk" class="jr-risk"></div>') +
        field("🎯 טייק פרופיט (TP)", '<input id="m_tp" type="number" step="any" placeholder="אופציונלי" value="' + (d.tp === "" ? "" : d.tp) + '">') +
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
        '<div class="jr-reflect"><div class="jr-reflect-h">🧠 רפלקציה — איך ניהלת את העסקה?</div><div class="form">' +
        field("מה גרם ליציאה?", '<select id="m_exitreason">' + opt("", d.exitReason, "— בחר —") + opt("stop", d.exitReason, "🛑 Stop Loss") + opt("target", d.exitReason, "🎯 Take Profit") + opt("emotion", d.exitReason, "😰 רגש / פחד / חמדנות") + opt("plan", d.exitReason, "📋 לפי התוכנית") + opt("other", d.exitReason, "אחר") + "</select>") +
        field("ניהלת נכון?", '<select id="m_managed">' + opt("", d.managedWell, "— בחר —") + opt("yes", d.managedWell, "✅ כן") + opt("partial", d.managedWell, "🟡 חלקית") + opt("no", d.managedWell, "❌ לא") + "</select>") +
        field("איך הרגשת עם הפוזיציה?", '<textarea id="m_feeling" placeholder="מה עבר לי בראש? האם פעלתי לפי התוכנית או מתוך רגש? מה אלמד לפעם הבאה?">' + (d.feeling || "") + "</textarea>", true) +
        "</div></div>" +
        '<div class="pnlpreview" id="m_preview" style="margin-top:14px"></div>' +
        '<div class="price-warn hidden" id="m_pricewarn"></div>';
      actions = [
        { label: "✓ שמור סגירה", cls: "primary", fn: () => saveManual(true) },
        { label: "← חזרה לפתיחה", cls: "", fn: () => gotoStep(1) },
      ];
    }
    modal(title, body, actions);
    // wire common preview + validation
    ["m_asset", "m_optt", "m_dir", "m_qty", "m_ep", "m_sl", "m_tp", "m_xp", "m_fee", "m_closetype", "m_closeqty"].forEach(id => {
      const e = document.getElementById(id); if (e) { e.oninput = updatePreview; e.onchange = updatePreview; }
    });
    // SL field turns red while empty (missing risk management) — live feedback as they type
    { const sl = document.getElementById("m_sl"); if (sl) sl.oninput = () => { sl.classList.toggle("sl-missing", !sl.value.trim()); updatePreview(); }; }
    // show the option fields (type / strike / expiry) only when the asset is an option
    { const a = document.getElementById("m_asset"), row = document.getElementById("m_opt_fields");
      if (a && row) a.addEventListener("change", () => { row.style.display = a.value === "option" ? "" : "none"; }); }
    ["m_sym", "m_ed", "m_ep", "m_xd", "m_xp"].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.addEventListener("change", scheduleValidatePrices); e.addEventListener("blur", scheduleValidatePrices); }
    });
    if (_mStep === 2) {
      const ct = document.getElementById("m_closetype"), cq = document.getElementById("m_closeqty");
      if (ct && cq) ct.onchange = () => { cq.disabled = ct.value !== "partial"; if (ct.value !== "partial") cq.value = ""; updatePreview(); };
    }
    if (_mStep === 1) {
      { const tb = document.getElementById("m_ed_today"); if (tb) tb.onclick = () => { const ed = document.getElementById("m_ed"); if (ed) { const dt = new Date(); ed.value = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); ed.dispatchEvent(new Event("change")); updatePreview(); } }; }
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
  // live risk readout under the SL field: how much we risk in $ and as % of the trade
  function updateRisk() {
    const el = document.getElementById("m_risk"); if (!el) return;
    const d = _mData;
    const ep = parseFloat(d.entryPrice), sl = parseFloat(d.sl), qty = Math.abs(parseFloat(d.qty) || 0);
    const mult = d.assetType === "option" ? 100 : 1;
    if (isNaN(ep) || isNaN(sl) || !ep || !qty) { el.className = "jr-risk"; el.innerHTML = ""; return; }
    // SL on the "profit side" of entry (long: above entry · short: below) isn't a mistake — it's a stop
    // RAISED into profit (locking gains). Celebrate it + show the locked-in profit, instead of warning.
    const profitLock = (d.direction === "short") ? (sl < ep) : (sl > ep);
    if (profitLock) {
      const lockShare = Math.abs(sl - ep), lockGain = lockShare * qty * mult, lockPct = lockShare / ep * 100;
      el.className = "jr-risk good";
      el.innerHTML = "✅ כל הכבוד על ניהול סיכונים! אתה בצד המרוויח — נעלת רווח של <b>" + money(lockGain, 2) + "</b> (<b>" + lockPct.toFixed(2) + "%</b>)";
      return;
    }
    const perShare = Math.abs(ep - sl), risk = perShare * qty * mult, riskPct = perShare / ep * 100;
    el.className = "jr-risk";
    el.innerHTML = "🛑 סיכון: <b>" + money(risk, 2) + "</b> · <b>" + riskPct.toFixed(2) + "%</b> מהעסקה";
  }
  function updatePreview() {
    syncFromDOM();
    updateRisk();
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
    // risk-management nudge: no stop-loss → force an explicit acknowledgement (Adi's request)
    const hasSL = d.sl !== "" && d.sl != null && !isNaN(parseFloat(d.sl));
    if (!hasSL) {
      if (!confirm('🛑 לא הצבת סטופ לוס.\n\n"אני מודע לסיכונים של לא לשים סטופ לוס ולמרות זאת אני בוחר לא להציב."\n\nאישור = המשך בלי SL · ביטול = חזור והוסף סטופ.')) return;
    }
    const hasExit = d.exitPrice !== "" && d.exitPrice != null && !isNaN(parseFloat(d.exitPrice));
    try { localStorage.setItem("sn_last_fee", String(d.fees == null ? 0 : d.fees)); } catch (e) {}
    const base = { account: account, symbol: d.symbol, assetType: d.assetType, optType: d.optType, strike: d.strike, expiry: d.expiry, direction: d.direction, entryPrice: d.entryPrice, sl: d.sl, tp: d.tp, entryDate: d.entryDate, notes: d.notes, img: manualImg || undefined,
      exitReason: hasExit ? d.exitReason : "", managedWell: hasExit ? d.managedWell : "", feeling: hasExit ? d.feeling : "" };
    // partial close → a closed record for the sold qty + a remaining OPEN record
    if (isClose && hasExit && d.closeType === "partial") {
      const cq = Math.abs(parseFloat(d.closeQty) || 0);
      if (!cq) { alert("כמה יחידות נסגרו? הזן כמות."); return; }
      if (cq < fullQty) {
        Store.addManual(E.manualToTrade(Object.assign({}, base, { qty: cq, exitPrice: d.exitPrice, exitDate: d.exitDate || d.entryDate, fees: d.fees })));
        const remain = E.manualToTrade(Object.assign({}, base, { id: manualEditId || undefined, qty: fullQty - cq, exitPrice: "", exitDate: "", fees: 0, exitReason: "", managedWell: "", feeling: "" }));
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
  function modal(title, bodyHtml, actions, extraCls) {
    closeModal();
    const bg = el("div", "modal-bg"); bg.id = "modalBg";
    const m = el("div", "modal" + (extraCls ? " " + extraCls : ""));
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
      { label: "🗑️ מחק ביצועי CSV מיובאים (השאר עסקאות ידניות)", cls: "", fn: () => { const n = (Store.exportData().fills || []).length; if (!n) { alert("אין ביצועי CSV מאוחסנים — כל העסקאות שלך ידניות."); return; } if (confirm("למחוק את " + n + " ביצועי ה-CSV המיובאים?\n\nהעסקאות שהזנת ידנית יישארו. הפוזיציות ה\"פתוחות\" שמגיעות מהייבוא (ומנפחות את ה-P&L הלא-ממומש) ייעלמו.")) { Store.clearFills(); closeModal(); render(); toast("ביצועי CSV נמחקו — נשארו רק העסקאות הידניות"); } } },
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
    // CLOSED trades for the CURRENTLY-SELECTED account (or all, if "כל החשבונות") — so the share card
    // reflects the account the trader picked, not every account combined.
    closedTrades: function () { try { return (tradesForAccount().trades || []).filter(t => t.exitDate); } catch (e) { return []; } },
    // the selected account label (ALL sentinel when combined)
    account: function () { try { return state.account; } catch (e) { return null; } },
    // current-view performance summary (for the share card in the main app)
    summary: function () {
      try {
        const r = tradesForAccount();
        const s = E.stats(r.trades || []);
        // total Unrealized P&L across open positions (stocks: live feed · options: manually-typed price)
        const optPx = _optPrices(), autoPx = _optAuto();
        let un = 0, unHave = false;
        (r.manualOpen || []).forEach(t => {
          const isOpt = t.assetType === "option";
          const _occ = isOpt ? _occSymbol(t) : null;
      const cp = isOpt ? (optPx[t.id] != null ? optPx[t.id] : (_occ && autoPx[_occ] != null ? autoPx[_occ] : null)) : (livePrices ? livePrices[t.symbol] : null);
          if (cp != null) { un += unrealizedPnl(t, cp); unHave = true; }
        });
        return { net: s.net, winRate: s.winRate, profitFactor: s.profitFactor, count: s.count,
          bestTrade: s.bestTrade, worstTrade: s.worstTrade,
          open: (r.openPositions || []).length + (r.manualOpen || []).length,
          unrealized: unHave ? un : null };
      } catch (e) { return null; }
    },
    // enriched list of CURRENTLY-OPEN positions (for a "share open positions" card)
    openList: function () {
      try {
        const r = tradesForAccount();
        const optPx = _optPrices(), autoPx = _optAuto();
        const enrich = t => {
          const isOpt = t.assetType === "option";
          const _occ = isOpt ? _occSymbol(t) : null;
      const cp = isOpt ? (optPx[t.id] != null ? optPx[t.id] : (_occ && autoPx[_occ] != null ? autoPx[_occ] : null)) : (livePrices ? livePrices[t.symbol] : null);
          const cost = Math.abs((+t.entryPrice || 0) * (+t.qty || 0) * (+t.mult || 1));
          return { symbol: t.symbol, direction: t.direction || (t.qty > 0 ? "long" : "short"), qty: t.qty,
            entryPrice: t.entryPrice, mult: t.mult || 1, cp: cp, un: (cp != null) ? unrealizedPnl(t, cp) : null, cost: cost, isOption: isOpt };
        };
        return (r.manualOpen || []).map(enrich).concat((r.openPositions || []).map(enrich));
      } catch (e) { return []; }
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
