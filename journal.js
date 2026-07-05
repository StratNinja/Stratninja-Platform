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
      set.delete("");
      return Array.from(set).sort();
    },
  };
  window.Store = Store;

  // ---- App state ---------------------------------------------------------
  const state = { account: null, tab: "calendar", monthIdx: 0, months: [], sortKey: "exitDate", sortDir: -1 };
  let manualEditId = null;  // when editing a manual trade, its id; null = adding new

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

  /* unified trades for the active account */
  function tradesForAccount() {
    const acct = state.account;
    const csvFills = Store.getFills().filter(f => (f.account || "").trim() === acct);
    const { trades, openPositions } = E.computeTrades(csvFills);
    const manual = Store.getManual().filter(m => (m.account || "").trim() === acct).map(E.manualToTrade);
    const all = trades.concat(manual);
    return { trades: all, openPositions };
  }

  // ---- Rendering ---------------------------------------------------------
  function render() {
    const root = $("#view");
    root.innerHTML = "";
    const accts = Store.accounts();
    // normalize the active account BEFORE syncing the dropdown, so the
    // selector and the rendered data can never desync on load.
    if (accts.length && (!state.account || accts.indexOf(state.account) < 0)) state.account = accts[0];
    renderAccountBar();
    if (!accts.length) { root.appendChild(emptyState()); return; }

    const { trades, openPositions } = tradesForAccount();

    root.appendChild(renderStatCards(trades));
    root.appendChild(renderAssetBreakdown(trades));
    if (state.tab === "calendar") root.appendChild(renderCalendar(trades));
    else if (state.tab === "equity") root.appendChild(renderEquity(trades));
    else if (state.tab === "trades") root.appendChild(renderTrades(trades, openPositions));
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
    grid.appendChild(el("div", "dow", "שבוע"));

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
      (t.source === "manual" ? '<button class="btn ghost" data-edit="' + t.id + '" title="ערוך">✏️</button> ' : "") +
      '<button class="btn ghost" data-del="' + t.id + '" title="מחק">🗑</button>';
    return "<tr><td>" + t.symbol + '</td><td><span class="pill ' + t.direction + '">' +
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
  function renderEquity(trades) {
    const box = el("div", "chartbox");
    box.appendChild(el("h3", null, "עקומת הון (רווח/הפסד מצטבר)"));
    const pts = E.equityCurve(trades);
    if (pts.length < 2) { box.appendChild(el("div", "note", "צריך לפחות שני ימי מסחר כדי לצייר עקומה.")); return box; }
    const W = 1100, H = 340, pad = 44;
    const xs = pts.map((_, i) => i);
    const eq = pts.map(p => p.equity);
    const minY = Math.min(0, Math.min.apply(null, eq)), maxY = Math.max(0, Math.max.apply(null, eq));
    const rng = (maxY - minY) || 1;
    const X = i => pad + (i / (pts.length - 1)) * (W - pad * 2);
    const Y = v => H - pad - ((v - minY) / rng) * (H - pad * 2);
    let dpath = "", apath = "";
    pts.forEach((p, i) => { const x = X(i), y = Y(p.equity); dpath += (i ? "L" : "M") + x + " " + y + " "; });
    apath = dpath + "L" + X(pts.length - 1) + " " + Y(minY) + " L" + X(0) + " " + Y(minY) + " Z";
    const zeroY = Y(0);
    const last = eq[eq.length - 1];
    const svg =
      '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#7c6cf0" stop-opacity=".35"/><stop offset="1" stop-color="#7c6cf0" stop-opacity="0"/></linearGradient></defs>' +
      '<line class="axis" x1="' + pad + '" y1="' + zeroY + '" x2="' + (W - pad) + '" y2="' + zeroY + '"/>' +
      '<path class="eqarea" d="' + apath + '"/>' +
      '<path class="eqline" d="' + dpath + '"/>' +
      '<text x="' + (W - pad) + '" y="' + (Y(last) - 8) + '" text-anchor="end" fill="' + (last >= 0 ? "#16b877" : "#e0524f") +
      '" font-size="15" font-weight="700">' + money(last, 0) + "</text>" +
      "</svg>";
    box.innerHTML += svg;
    return box;
  }

  // ---- Trades table ------------------------------------------------------
  function renderTrades(trades, openPositions) {
    const wrap = el("div");
    const sorted = trades.slice().sort((a, b) => {
      let av = a[state.sortKey], bv = b[state.sortKey];
      if (typeof av === "string") { return (av < bv ? -1 : av > bv ? 1 : 0) * state.sortDir; }
      return (av - bv) * state.sortDir;
    });
    const cols = [
      ["exitDate", "תאריך יציאה"], ["symbol", "סימבול"], ["assetType", "סוג"],
      ["direction", "כיוון"], ["qty", "כמות"], ["entryPrice", "כניסה"],
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
        "<td>" + t.exitDate + "</td>" +
        "<td>" + t.symbol + "</td>" +
        '<td><span class="pill ' + (t.assetType === "option" ? "opt" : "stk") + '">' + (t.assetType === "option" ? "אופ׳" : "מניה") + "</span></td>" +
        '<td><span class="pill ' + t.direction + '">' + (t.direction === "long" ? "לונג" : "שורט") + "</span></td>" +
        "<td>" + t.qty + "</td>" +
        "<td>" + money(t.entryPrice, 2) + "</td>" +
        "<td>" + money(t.exitPrice, 2) + "</td>" +
        '<td class="zero">' + money(-t.fees, 2) + "</td>" +
        '<td class="' + cls(t.pnl) + '">' + money(t.pnl, 2) + "</td>" +
        '<td><span class="pill src">' + (t.source === "manual" ? "ידני" : "CSV") + "</span></td>" +
        "<td>" +
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
    if (!pending) return;
    Array.from(files).forEach(file => {
      const rd = new FileReader();
      rd.onload = () => {
        const res = E.parseCSV(rd.result);
        if (res.errors.length) errs = errs.concat(res.errors.slice(0, 3));
        totalAdded += Store.addFills(res.fills);
        if (--pending === 0) finishImport(totalAdded, errs);
      };
      rd.onerror = () => { if (--pending === 0) finishImport(totalAdded, errs); };
      rd.readAsText(file);
    });
  }
  function finishImport(added, errs) {
    closeModal();
    const accts = Store.accounts();
    if (!state.account && accts.length) state.account = accts[0];
    render();
    toast(added ? "נוספו " + added + " ביצועים חדשים" : "לא נוספו ביצועים חדשים (כפילויות?)");
    if (errs.length) console.warn("Import warnings:", errs);
  }

  // ---- Manual entry modal ------------------------------------------------
  function openManual(existing) {
    manualEditId = existing && existing.source === "manual" ? existing.id : null;
    const accts = Store.accounts();
    const selAcct = existing ? existing.account : state.account;
    const acctField = accts.length
      ? '<select id="m_acct">' + accts.map(a => '<option value="' + a + '"' + (a === selAcct ? " selected" : "") + ">" + a + "</option>").join("") +
        '<option value="__new">➕ חשבון חדש…</option></select>'
      : '<input id="m_acct" placeholder="שם/מספר חשבון" value="' + (existing ? existing.account : "") + '">';
    const body =
      '<div class="form">' +
      field("חשבון", acctField, true) +
      field("סימבול", '<input id="m_sym" placeholder="AAPL" style="text-transform:uppercase">') +
      field("סוג נכס", '<select id="m_asset"><option value="stock">מניה</option><option value="option">אופציה (×100)</option></select>') +
      field("כיוון", '<select id="m_dir"><option value="long">לונג</option><option value="short">שורט</option></select>') +
      field("כמות", '<input id="m_qty" type="number" step="any" placeholder="100">') +
      field("מחיר כניסה", '<input id="m_ep" type="number" step="any">') +
      field("מחיר יציאה", '<input id="m_xp" type="number" step="any">') +
      field("תאריך כניסה", '<input id="m_ed" type="date">') +
      field("תאריך יציאה", '<input id="m_xd" type="date">') +
      field("עמלות", '<input id="m_fee" type="number" step="any" value="0">') +
      field("הערות", '<textarea id="m_notes" placeholder="למה נכנסתי? מה למדתי?"></textarea>', true) +
      "</div>" +
      '<div class="pnlpreview" id="m_preview" style="margin-top:14px"></div>' +
      '<div class="price-warn hidden" id="m_pricewarn"></div>';
    modal(existing ? "עריכת עסקה ידנית" : "הזנת עסקה ידנית", body, [
      { label: existing ? "עדכן עסקה" : "שמור עסקה", cls: "primary", fn: saveManual },
    ]);
    // pre-fill when editing
    if (existing) {
      const set = (id, v) => { const e = document.getElementById(id); if (e != null && v != null) e.value = v; };
      set("m_sym", existing.symbol); set("m_asset", existing.assetType); set("m_dir", existing.direction);
      set("m_qty", existing.qty); set("m_ep", existing.entryPrice); set("m_xp", existing.exitPrice);
      set("m_ed", existing.entryDate); set("m_xd", existing.exitDate); set("m_fee", existing.fees);
      set("m_notes", existing.notes);
    }
    // live P&L preview
    const ids = ["m_asset", "m_dir", "m_qty", "m_ep", "m_xp", "m_fee"];
    ids.forEach(id => { const e = document.getElementById(id); e.oninput = updatePreview; e.onchange = updatePreview; });
    // price-in-range validation (soft warning) — on change/blur to limit API calls
    ["m_sym", "m_ed", "m_ep", "m_xd", "m_xp"].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.addEventListener("change", scheduleValidatePrices); e.addEventListener("blur", scheduleValidatePrices); }
    });
    // new-account handling
    const acctSel = document.getElementById("m_acct");
    if (acctSel.tagName === "SELECT") acctSel.onchange = () => {
      if (acctSel.value === "__new") {
        const name = prompt("שם/מספר החשבון החדש:");
        if (name) { const o = el("option"); o.value = name; o.textContent = name; acctSel.insertBefore(o, acctSel.lastChild); o.selected = true; }
        else acctSel.selectedIndex = 0;
      }
    };
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
        if (c.price < lo || c.price > hi) {
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
    const g = id => (document.getElementById(id) || {}).value;
    return {
      id: manualEditId || undefined,
      account: (g("m_acct") || "").trim(),
      symbol: g("m_sym"), assetType: g("m_asset"), direction: g("m_dir"),
      qty: g("m_qty"), entryPrice: g("m_ep"), exitPrice: g("m_xp"),
      entryDate: g("m_ed"), exitDate: g("m_xd") || g("m_ed"), fees: g("m_fee"), notes: g("m_notes"),
    };
  }
  function updatePreview() {
    const t = E.manualToTrade(readManual());
    const p = document.getElementById("m_preview");
    if (!p) return;
    p.className = "pnlpreview " + cls(t.pnl);
    p.textContent = "רווח/הפסד משוער: " + money(t.pnl, 2);
  }
  function saveManual() {
    const m = readManual();
    if (!m.account) { alert("צריך לבחור/להזין חשבון"); return; }
    if (!m.symbol) { alert("צריך סימבול"); return; }
    if (!m.entryDate) { alert("צריך תאריך כניסה"); return; }
    const t = E.manualToTrade(m);
    if (manualEditId) { Store.updateManual(t); } else { Store.addManual(t); }
    const wasEdit = !!manualEditId;
    manualEditId = null;
    state.account = m.account;
    closeModal();
    render();
    toast(wasEdit ? "העסקה עודכנה" : "העסקה נשמרה");
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
    document.querySelectorAll(".tab").forEach(t => t.onclick = () => { state.tab = t.dataset.tab; render(); });
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
      { label: "מחק חשבון נוכחי", cls: "", fn: () => { if (state.account && confirm("למחוק את כל הנתונים של " + state.account + "?")) { Store.clearAccount(state.account); state.account = null; closeModal(); render(); toast("נמחק"); } } },
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
  window.Journal = { rerender: function () { try { render(); } catch (e) {} } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
