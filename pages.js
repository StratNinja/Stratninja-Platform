/* StratNinja Platform — scanner pages + sidebar navigation.
 * Pages render with DEMO data; live data (Massive/Polygon) will be wired next.
 * Candle color = direction (close vs open): green=up, red=down, gray=doji —
 * applied to ALL Strat types (1/2U/2D/3), which reveals "conflict" candles.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);

  // ---------- helpers ----------
  function cell(t, c) { return { t: t, c: c }; }
  function tf(x) {
    const c = x && x.c ? x.c : "doji";
    const t = x && x.t ? x.t : "1";
    return '<span class="tf ' + c + '">' + t + "</span>";
  }
  const DEMO = '<div class="demo-flag">🧪 נתוני דמו — יחובר למפתח Massive/Polygon החי בשלב הבא</div>';
  function money(v, d) { d = d == null ? 2 : d; return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(v) { const s = (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '">' + s + "</span>"; }
  function star(sym) {
    const on = window.Prefs && window.Prefs.isFav(sym);
    return '<button class="starbtn' + (on ? " on" : "") + '" data-star="' + sym + '" title="מועדפים">' + (on ? "★" : "☆") + "</button>";
  }

  // ---------- demo data ----------
  const INDICES = [
    { sym: "SPY", name: "S&P 500", Y: cell("2U", "up"), Q: cell("1", "up"), M: cell("1", "down"), W: cell("2U", "up"), D: cell("3", "down") },
    { sym: "QQQ", name: "NASDAQ 100", Y: cell("2U", "up"), Q: cell("1", "up"), M: cell("1", "up"), W: cell("1", "down"), D: cell("2D", "down") },
    { sym: "IWM", name: "Russell 2000", Y: cell("2U", "up"), Q: cell("2U", "up"), M: cell("2U", "down"), W: cell("2U", "up"), D: cell("2D", "down") },
    { sym: "DIA", name: "Dow Jones", Y: cell("2U", "up"), Q: cell("2U", "up"), M: cell("2U", "up"), W: cell("2U", "down"), D: cell("2U", "up") },
  ];
  const BREADTH_IDX = [
    { sym: "S5FD", desc: "מעל SMA50" }, { sym: "S5OF", desc: "מעל SMA100" }, { sym: "S5FI", desc: "מעל SMA150" },
    { sym: "S5OH", desc: "מעל SMA200" }, { sym: "S5TW", desc: "מעל SMA20" }, { sym: "S5TH", desc: "שיאים/שפל" },
  ];
  const DIST = [
    { k: "3 (חיצוני)", n: 41, dot: "p" }, { k: "2D (יורד)", n: 116, dot: "r" },
    { k: "1 (פנימי)", n: 34, dot: "gray" }, { k: "2U (עולה)", n: 309, dot: "g" },
  ];

  // ticker universe (demo) — includes conflict candles, dojis, green/red 1s & 3s
  const TICKERS = [
    tk("NVDA", "NVIDIA", "Technology", 187.16, 1.24, "2U", "up", "marubozu", 8.9, 1.4, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["2U", "up"]),
    tk("AAPL", "Apple", "Technology", 231.30, -0.42, "2U", "down", "hammer", 4.1, 0.9, false, ["2U", "up"], ["1", "up"], ["2U", "up"], ["2U", "up"]),
    tk("MSFT", "Microsoft", "Technology", 438.20, 0.31, "1", "up", "doji", 6.3, 0.8, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["1", "up"]),
    tk("AVGO", "Broadcom", "Technology", 356.40, -1.10, "2D", "down", "normal", 12.1, 1.1, false, ["2U", "up"], ["2U", "up"], ["2D", "down"], ["2D", "down"]),
    tk("AMD", "AMD", "Technology", 168.90, 2.05, "3", "up", "normal", 7.2, 1.6, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["3", "up"]),
    tk("PLTR", "Palantir", "Technology", 74.56, 3.90, "2U", "up", "marubozu", 3.4, 2.3, true, ["3", "up"], ["2U", "up"], ["2U", "up"], ["2U", "up"]),
    tk("INTC", "Intel", "Technology", 24.30, -2.10, "2D", "up", "hammer", 1.1, 1.9, false, ["2D", "down"], ["2D", "down"], ["2U", "up"], ["2D", "up"]),
    tk("ORCL", "Oracle", "Technology", 178.20, 0.15, "1", "down", "doji", 5.0, 0.7, true, ["2U", "up"], ["2U", "up"], ["1", "up"], ["1", "down"]),

    tk("JPM", "JPMorgan", "Financials", 268.10, 0.62, "2U", "up", "normal", 4.8, 0.9, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["2U", "up"]),
    tk("BAC", "Bank of America", "Financials", 46.20, -0.30, "2D", "down", "normal", 1.0, 0.8, false, ["2U", "up"], ["2U", "up"], ["2D", "down"], ["2D", "down"]),
    tk("GS", "Goldman Sachs", "Financials", 612.40, 1.02, "3", "down", "shooter", 14.2, 1.2, false, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["3", "down"]),

    tk("XOM", "Exxon Mobil", "Energy", 118.30, -0.88, "2D", "down", "normal", 2.6, 1.0, false, ["2U", "up"], ["1", "down"], ["2D", "down"], ["2D", "down"]),
    tk("CVX", "Chevron", "Energy", 158.90, 0.44, "2U", "down", "hammer", 3.1, 0.9, false, ["1", "up"], ["2U", "down"], ["2U", "up"], ["2U", "down"]),
    tk("CTRA", "Coterra", "Energy", 32.56, -8.62, "2D", "down", "normal", 1.4, 3.1, false, ["1", "down"], ["1", "down"], ["2U", "up"], ["2D", "down"]),

    tk("UNH", "UnitedHealth", "Health Care", 512.10, -1.50, "2D", "down", "normal", 11.0, 1.3, false, ["2D", "down"], ["2D", "down"], ["2D", "down"], ["2D", "down"]),
    tk("LLY", "Eli Lilly", "Health Care", 842.30, 0.90, "2U", "up", "normal", 18.4, 1.1, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["2U", "up"]),
    tk("MRNA", "Moderna", "Health Care", 28.40, 4.10, "3", "up", "hammer", 1.8, 2.4, false, ["2D", "down"], ["2D", "down"], ["1", "down"], ["3", "up"]),

    tk("TSLA", "Tesla", "Consumer Disc.", 412.90, 2.80, "2U", "up", "normal", 12.7, 1.8, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["2U", "up"]),
    tk("AMZN", "Amazon", "Consumer Disc.", 224.10, -0.20, "1", "down", "doji", 4.9, 0.8, true, ["2U", "up"], ["2U", "up"], ["2U", "up"], ["1", "down"]),
    tk("HD", "Home Depot", "Consumer Disc.", 408.60, 0.10, "1", "up", "doji", 5.5, 0.6, false, ["2U", "up"], ["1", "up"], ["1", "up"], ["1", "up"]),

    tk("SMCI", "Super Micro", "Technology", 75.23, 12.45, "2U", "up", "marubozu", 4.2, 4.8, true, ["2D", "down"], ["3", "up"], ["1", "up"], ["2U", "up"]),
    tk("SNAP", "Snap", "Communication", 11.43, -7.89, "2D", "down", "normal", 0.7, 3.3, false, ["2U", "up"], ["1", "up"], ["3", "down"], ["2D", "down"]),
    tk("NIO", "NIO", "Consumer Disc.", 5.23, -4.56, "2D", "up", "hammer", 0.3, 2.1, false, ["1", "up"], ["2U", "up"], ["3", "down"], ["2D", "up"]),
    tk("MARA", "Marathon", "Financials", 22.87, 6.78, "3", "up", "normal", 1.6, 3.9, true, ["1", "up"], ["3", "up"], ["2U", "up"], ["3", "up"]),
  ];
  function tk(sym, name, sector, price, chg, ccT, ccC, shape, atr, rvol, ftfc, Y, Q, M, W) {
    return { sym, name, sector, price, chg, cc: cell(ccT, ccC), shape, atr, rvol, ftfc,
      Y: cell(Y[0], Y[1]), Q: cell(Q[0], Q[1]), M: cell(M[0], M[1]), W: cell(W[0], W[1]), D: cell(ccT, ccC) };
  }

  const SECTOR_DEFS = [
    { name: "טכנולוגיה", etf: "XLK" }, { name: "פיננסים", etf: "XLF" }, { name: "בריאות", etf: "XLV" },
    { name: "אנרגיה", etf: "XLE" }, { name: "מוצרי צריכה מחזוריים", etf: "XLY" }, { name: "תקשורת", etf: "XLC" },
    { name: "תעשייה", etf: "XLI" }, { name: "מוצרי צריכה בסיסיים", etf: "XLP" }, { name: "חומרי גלם", etf: "XLB" },
    { name: "נדל\"ן", etf: "XLRE" }, { name: "שירותים", etf: "XLU" },
  ];
  // deterministic pseudo-breadth per sector (demo)
  function sectorBreadth(seed) {
    const rows = ["D", "W", "M"];
    const out = {};
    rows.forEach((r, i) => {
      const base = (seed * 7 + i * 13) % 20;
      const u2 = 8 + (base % 12), d2 = 6 + ((base + 5) % 10), three = 1 + (base % 4), one = 3 + ((base + 2) % 5);
      out[r] = { u2, d2, one, three };
    });
    return out;
  }
  const SECTORS = SECTOR_DEFS.map((s, i) => ({ ...s, breadth: sectorBreadth(i + 1), total: 22 + (i * 3) % 40 }));

  const GAPPERS = {
    up: [
      { sym: "SMCI", name: "Super Micro", price: 75.23, gd: 8.32, gp: 12.45, vol: "45.2M" },
      { sym: "PLTR", name: "Palantir", price: 74.56, gd: 5.67, gp: 8.23, vol: "32.1M" },
      { sym: "MARA", name: "Marathon", price: 22.87, gd: 1.45, gp: 6.78, vol: "18.9M" },
      { sym: "RIVN", name: "Rivian", price: 14.78, gd: 0.72, gp: 5.12, vol: "22.1M" },
    ],
    down: [
      { sym: "SNAP", name: "Snap", price: 11.43, gd: -0.98, gp: -7.89, vol: "28.4M" },
      { sym: "LCID", name: "Lucid", price: 3.10, gd: -0.21, gp: -6.34, vol: "15.6M" },
      { sym: "NIO", name: "NIO", price: 5.23, gd: -0.25, gp: -4.56, vol: "12.3M" },
      { sym: "PARA", name: "Paramount", price: 12.67, gd: -0.42, gp: -3.21, vol: "8.9M" },
    ],
  };

  // ---------- shared renderers ----------
  function tfHeadCols() { return "<th>Y</th><th>Q</th><th>M</th><th>W</th><th>D</th>"; }
  function tfCells(t) { return "<td>" + tf(t.Y) + "</td><td>" + tf(t.Q) + "</td><td>" + tf(t.M) + "</td><td>" + tf(t.W) + "</td><td>" + tf(t.D) + "</td>"; }

  // ========== MARKET ==========
  function renderMarket() {
    const idxRows = INDICES.map(r =>
      '<tr><td class="sym"><span class="tsym">' + r.sym + '</span> <span class="tname">' + r.name + "</span></td>" + tfCells(r) + "</tr>").join("");
    const dist = DIST.map(d => '<div class="tile"><div class="k"><span class="dot ' + d.dot + '"></span>' + d.k + '</div><div class="v">' + d.n + "</div></div>").join("");
    const breadth = BREADTH_IDX.map(b => '<div class="tile"><div class="k">' + b.sym + " · " + b.desc + '</div><div class="v muted">—</div></div>').join("");
    const rank = (arr, cls) => arr.map((s, i) => '<div class="lead-row ' + cls + '"><span>' + s + '</span><span class="rank">#' + (i + 1) + "</span></div>").join("");
    return (
      '<div class="page-head"><h1>סקירת שוק</h1><div class="sub">נתוני שוק בזמן אמת עבור סוחרי The Strat</div></div>' + DEMO +
      '<div class="cols2">' +
        '<div class="panel"><h3>מדדים ראשיים</h3><table class="idx-table"><thead><tr><th style="text-align:start">סימבול</th>' + tfHeadCols() + "</tr></thead><tbody>" + idxRows + "</tbody></table>" + colorLegend() + "</div>" +
        '<div class="panel"><h3>VIX <span class="muted" style="font-size:12px">תנודתיות</span></h3><div class="tile"><div class="k">מדד הפחד</div><div class="v muted">—</div></div><div class="muted" style="font-size:12px;margin-top:10px">VIX גבוה = פחד · נמוך = רוגע</div></div>' +
      "</div>" +
      '<div class="panel"><h3>התפלגות נרות S&P 500 (יומי)</h3><div class="tiles">' + dist + "</div></div>" +
      '<div class="panel"><h3>מדדי רוחב שוק (מאקרו · חישוב ידני)</h3><div class="tiles">' + breadth + "</div></div>" +
      '<div class="cols2"><div class="panel"><h3>🟢 סקטורים מובילים</h3>' + rank(["חומרי גלם · XLB", "תקשורת · XLC", "אנרגיה · XLE"], "up") + "</div>" +
      '<div class="panel"><h3>🔴 סקטורים בפיגור</h3>' + rank(["מוצרי צריכה · XLY", "בריאות · XLV", "שירותים · XLU"], "down") + "</div></div>" +
      '<div class="cols2"><div class="panel"><h3>🟢 מניות מובילות</h3>' + rank(["SMCI", "PLTR", "MARA"], "up") + "</div>" +
      '<div class="panel"><h3>🔴 מניות בפיגור</h3>' + rank(["SNAP", "LCID", "NIO"], "down") + "</div></div>"
    );
  }
  function colorLegend() {
    return '<div class="muted" style="font-size:11px;margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">' +
      '<span>הצבע = כיוון הנר · הטקסט = סוג Strat:</span>' +
      '<span>' + tf(cell("2U", "up")) + ' סגירה מעל הפתיחה</span>' +
      '<span>' + tf(cell("2U", "down")) + ' מתחת (קונפליקט)</span>' +
      '<span>' + tf(cell("1", "doji")) + " דוג'י</span></div>";
  }

  // ========== SCANNER ==========
  const scanState = { tf: "D", patterns: [], dir: "all", sector: "all", sym: "", ftfc: false };
  function renderScanner() {
    const sectors = Array.from(new Set(TICKERS.map(t => t.sector)));
    const patBtn = p => '<button class="chip' + (scanState.patterns.indexOf(p) >= 0 ? " on" : "") + '" data-pat="' + p + '">' + p + "</button>";
    const tfBtn = f => '<button class="chip' + (scanState.tf === f ? " on" : "") + '" data-tff="' + f + '">' + f + "</button>";
    const dirBtn = (v, l) => '<button class="chip' + (scanState.dir === v ? " on" : "") + '" data-dir="' + v + '">' + l + "</button>";
    const filters =
      '<div class="panel filters"><h3>פילטרים</h3><div class="frow">' +
        '<div class="fgrp"><label>טיימפריים</label><div class="chips">' + ["D", "W", "M", "Q", "Y"].map(tfBtn).join("") + "</div></div>" +
        '<div class="fgrp"><label>תבנית</label><div class="chips">' + ["1", "2U", "2D", "3"].map(patBtn).join("") + "</div></div>" +
        '<div class="fgrp"><label>צבע נר</label><div class="chips">' + dirBtn("all", "הכל") + dirBtn("up", "🟢 ירוק") + dirBtn("down", "🔴 אדום") + "</div></div>" +
        '<div class="fgrp"><label>סקטור</label><select id="scanSector"><option value="all">הכל</option>' + sectors.map(s => '<option' + (scanState.sector === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select></div>" +
        '<div class="fgrp"><label>סימבול</label><input id="scanSym" placeholder="AAPL" value="' + scanState.sym + '"></div>' +
        '<div class="fgrp"><label>FTFC</label><button class="chip' + (scanState.ftfc ? " on" : "") + '" id="scanFtfc">' + (scanState.ftfc ? "מלא ✓" : "הכל") + "</button></div>" +
        '<div class="fgrp" style="align-self:flex-end"><button class="btn ghost" id="scanReset">איפוס</button></div>' +
      "</div></div>";

    const rows = filteredTickers();
    const body = rows.map(t =>
      "<tr>" +
        "<td>" + star(t.sym) + "</td>" +
        '<td class="sym"><span class="tsym">' + t.sym + '</span> <span class="tname">' + t.sector + "</span></td>" +
        "<td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" +
        tfCells(t) +
        "<td>" + (t.ftfc ? '<span class="badge-ftfc">FTFC</span>' : "—") + "</td>" +
        '<td class="muted">' + t.shape + "</td><td>" + t.atr.toFixed(1) + "</td><td>" + t.rvol.toFixed(1) + "</td>" +
        '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td>' +
      "</tr>").join("");

    return (
      '<div class="page-head"><h1>סורק עסקאות</h1><div class="sub">חפש תבניות Strat לפי טיימפריים, סוג נר ותבנית</div></div>' + DEMO +
      filters +
      '<div class="panel"><h3>תוצאות <span class="muted" style="font-size:12px">' + rows.length + " מתוך " + TICKERS.length + "</span></h3>" +
      '<div class="tablewrap"><table class="scan-table"><thead><tr><th></th><th style="text-align:start">סימבול</th><th>מחיר</th><th>%</th>' + tfHeadCols() + "<th>FTFC</th><th>צורה</th><th>ATR</th><th>RVOL</th><th></th></tr></thead><tbody>" +
      (rows.length ? body : '<tr><td colspan="14" class="muted" style="text-align:center;padding:30px">אין תוצאות לפילטרים האלה</td></tr>') +
      "</tbody></table></div>" + colorLegend() + "</div>"
    );
  }
  function filteredTickers() {
    return TICKERS.filter(t => {
      if (scanState.sector !== "all" && t.sector !== scanState.sector) return false;
      if (scanState.sym && t.sym.indexOf(scanState.sym.toUpperCase()) < 0) return false;
      if (scanState.ftfc && !t.ftfc) return false;
      const c = t[scanState.tf] || t.D;
      if (scanState.patterns.length && scanState.patterns.indexOf(c.t) < 0) return false;
      if (scanState.dir !== "all" && c.c !== scanState.dir) return false;
      return true;
    });
  }
  function wireScanner() {
    document.querySelectorAll("[data-tff]").forEach(b => b.onclick = () => { scanState.tf = b.dataset.tff; reRender(); });
    document.querySelectorAll("[data-pat]").forEach(b => b.onclick = () => { const p = b.dataset.pat, i = scanState.patterns.indexOf(p); if (i >= 0) scanState.patterns.splice(i, 1); else scanState.patterns.push(p); reRender(); });
    document.querySelectorAll("[data-dir]").forEach(b => b.onclick = () => { scanState.dir = b.dataset.dir; reRender(); });
    const sec = $("#scanSector"); if (sec) sec.onchange = () => { scanState.sector = sec.value; reRender(); };
    const sym = $("#scanSym"); if (sym) sym.oninput = () => { scanState.sym = sym.value; reRender(); };
    const ftfc = $("#scanFtfc"); if (ftfc) ftfc.onclick = () => { scanState.ftfc = !scanState.ftfc; reRender(); };
    const reset = $("#scanReset"); if (reset) reset.onclick = () => { scanState.tf = "D"; scanState.patterns = []; scanState.dir = "all"; scanState.sector = "all"; scanState.sym = ""; scanState.ftfc = false; reRender(); };
  }

  // ========== SECTORS ==========
  function renderSectors() {
    const seg = (b) => {
      const tot = b.u2 + b.d2 + b.one + b.three || 1;
      const w = n => (n / tot * 100).toFixed(1) + "%";
      return '<div class="breadth"><span class="bseg up" style="width:' + w(b.u2) + '"></span><span class="bseg one" style="width:' + w(b.one) + '"></span><span class="bseg three" style="width:' + w(b.three) + '"></span><span class="bseg down" style="width:' + w(b.d2) + '"></span></div>';
    };
    const cards = SECTORS.map((s, i) =>
      '<div class="panel sector-card" data-sector="' + i + '"><h3>' + s.name + ' <span class="muted" style="font-size:12px">' + s.etf + " · " + s.total + " מניות</span></h3>" +
      ["D", "W", "M"].map(r => '<div class="brow"><span class="btf">' + r + "</span>" + seg(s.breadth[r]) + "</div>").join("") +
      '<div class="bkey"><span><i class="up"></i>2U ' + s.breadth.D.u2 + "</span><span><i class='one'></i>1 " + s.breadth.D.one + "</span><span><i class='three'></i>3 " + s.breadth.D.three + "</span><span><i class='down'></i>2D " + s.breadth.D.d2 + "</span></div></div>"
    ).join("");
    return (
      '<div class="page-head"><h1>סקטורים</h1><div class="sub">11 סקטורי SPDR · לחץ על סקטור לפירוט המניות והטיימפריימים</div></div>' + DEMO +
      '<div class="sector-grid">' + cards + "</div>"
    );
  }
  function wireSectors() { document.querySelectorAll(".sector-card").forEach(c => c.onclick = () => openSectorDrill(+c.dataset.sector)); }
  function openSectorDrill(idx) {
    const s = SECTORS[idx];
    // demo: pick tickers "in" this sector (fallback to a rotating slice)
    let members = TICKERS.filter(t => sectorMatch(t.sector, s.name));
    if (!members.length) members = TICKERS.slice((idx * 3) % TICKERS.length).concat(TICKERS).slice(0, 8);
    const rows = members.map(t =>
      "<tr><td>" + star(t.sym) + '</td><td class="sym"><span class="tsym">' + t.sym + '</span> <span class="tname">' + t.name + "</span></td><td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" + tfCells(t) + "</tr>").join("");
    modal(s.name + " · " + s.etf, '<div class="tablewrap"><table class="scan-table"><thead><tr><th></th><th style="text-align:start">סימבול</th><th>מחיר</th><th>%</th>' + tfHeadCols() + "</tr></thead><tbody>" + rows + "</tbody></table></div>" + colorLegend());
  }
  function sectorMatch(tSector, sName) {
    const map = { "טכנולוגיה": "Technology", "פיננסים": "Financials", "בריאות": "Health Care", "אנרגיה": "Energy", "מוצרי צריכה מחזוריים": "Consumer Disc.", "תקשורת": "Communication" };
    return map[sName] === tSector;
  }

  // ========== GAPPERS ==========
  function renderGappers() {
    const tbl = (arr, cls, title) => {
      const rows = arr.map(g =>
        "<tr><td>" + star(g.sym) + '</td><td class="sym"><span class="tsym">' + g.sym + '</span> <span class="tname">' + g.name + "</span></td><td>" + money(g.price) + "</td><td class='" + cls + "'>" + (g.gd >= 0 ? "+" : "") + money(g.gd) + "</td><td>" + pct(g.gp) + "</td><td class='muted'>" + g.vol + "</td></tr>").join("");
      return '<div class="panel"><h3>' + title + " <span class='muted' style='font-size:12px'>" + arr.length + "</span></h3><div class='tablewrap'><table class='scan-table'><thead><tr><th></th><th style='text-align:start'>סימבול</th><th>מחיר</th><th>$Gap</th><th>%Gap</th><th>נפח</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
    };
    return '<div class="page-head"><h1>גאפרים</h1><div class="sub">גאפים בפרימרקט / אפטרמרקט</div></div>' + DEMO +
      tbl(GAPPERS.up, "pos", "🟢 גאפ למעלה") + tbl(GAPPERS.down, "neg", "🔴 גאפ למטה");
  }

  // ========== FAVORITES ==========
  function renderFavorites() {
    const favs = window.Prefs ? window.Prefs.favorites() : [];
    const list = favs.map(sym => TICKERS.find(t => t.sym === sym) || { sym, name: "", sector: "", price: 0, chg: 0, shape: "", atr: 0, rvol: 0, Y: cell("1", "doji"), Q: cell("1", "doji"), M: cell("1", "doji"), W: cell("1", "doji"), D: cell("1", "doji") });
    let body;
    if (!favs.length) {
      body = '<div class="panel"><div class="stub"><div class="big">⭐</div><h2>אין עדיין מועדפים</h2><p>לחץ על הכוכב ⭐ ליד מניות בסורק, בסקטורים או בגאפרים כדי להוסיף אותן לכאן.</p><button class="btn primary" id="goScanner">לסורק העסקאות</button></div></div>';
    } else {
      const rows = list.map(t =>
        "<tr><td>" + star(t.sym) + '</td><td class="sym"><span class="tsym">' + t.sym + '</span> <span class="tname">' + (t.name || "") + "</span></td><td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" + tfCells(t) + '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td></tr>').join("");
      body = '<div class="panel"><h3>רשימת המעקב שלי <span class="muted" style="font-size:12px">' + favs.length + " מניות</span></h3><div class='tablewrap'><table class='scan-table'><thead><tr><th></th><th style='text-align:start'>סימבול</th><th>מחיר</th><th>%</th>" + tfHeadCols() + "<th></th></tr></thead><tbody>" + rows + "</tbody></table></div>" + colorLegend() + "</div>";
    }
    return '<div class="page-head"><h1>מועדפים</h1><div class="sub">רשימת המעקב האישית שלך · נשמרת בענן</div></div>' + body;
  }
  function wireFavorites() { const g = $("#goScanner"); if (g) g.onclick = () => setPage("scanner"); }

  // ========== ALERTS ==========
  function renderAlerts() {
    const alerts = window.Prefs ? window.Prefs.alerts() : [];
    const rows = alerts.map(a =>
      '<tr><td class="tsym">' + a.symbol + "</td><td>" + a.tf + "</td><td>" + tf(cell(a.pattern, a.dir === "up" ? "up" : a.dir === "down" ? "down" : "doji")) + "</td><td>" + (a.channel === "discord" ? "דיסקורד" : "מייל") + '</td><td><button class="btn ghost" data-delalert="' + a.id + '">🗑</button></td></tr>').join("");
    const form =
      '<div class="panel"><h3>התראה חדשה</h3><div class="frow">' +
        '<div class="fgrp"><label>סימבול</label><input id="alSym" placeholder="AAPL" style="text-transform:uppercase"></div>' +
        '<div class="fgrp"><label>טיימפריים</label><select id="alTf"><option>D</option><option>W</option><option>M</option><option>Q</option><option>Y</option></select></div>' +
        '<div class="fgrp"><label>תבנית</label><select id="alPat"><option>2U</option><option>2D</option><option>3</option><option>1</option></select></div>' +
        '<div class="fgrp"><label>צבע נר</label><select id="alDir"><option value="any">הכל</option><option value="up">🟢 ירוק</option><option value="down">🔴 אדום</option></select></div>' +
        '<div class="fgrp"><label>שליחה אל</label><select id="alCh"><option value="email">מייל</option><option value="discord">דיסקורד</option></select></div>' +
        '<div class="fgrp" style="align-self:flex-end"><button class="btn primary" id="alAdd">הוסף התראה</button></div>' +
      "</div><div class='note' style='margin-top:8px'>🔗 השליחה בפועל (מייל/דיסקורד) תחובר לבוט הדיסקורד הקיים בשלב הבא.</div></div>";
    const table = alerts.length
      ? "<div class='panel'><h3>ההתראות שלי <span class='muted' style='font-size:12px'>" + alerts.length + "</span></h3><div class='tablewrap'><table class='scan-table'><thead><tr><th style='text-align:start'>סימבול</th><th>TF</th><th>תבנית</th><th>ערוץ</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div></div>"
      : "<div class='panel'><div class='stub'><div class='big'>🔔</div><h2>אין עדיין התראות</h2><p>צור התראה למעלה כדי לקבל עדכון כשתבנית מבשילה.</p></div></div>";
    return '<div class="page-head"><h1>התראות</h1><div class="sub">התראות על מניות למייל או לדיסקורד</div></div>' + form + table;
  }
  function wireAlerts() {
    const add = $("#alAdd");
    if (add) add.onclick = () => {
      const sym = ($("#alSym").value || "").toUpperCase().trim();
      if (!sym) { alert("צריך סימבול"); return; }
      window.Prefs.addAlert({ symbol: sym, tf: $("#alTf").value, pattern: $("#alPat").value, dir: $("#alDir").value, channel: $("#alCh").value });
      reRender();
    };
    document.querySelectorAll("[data-delalert]").forEach(b => b.onclick = () => { window.Prefs.deleteAlert(b.dataset.delalert); reRender(); });
  }

  // ---------- modal (pages-local) ----------
  function modal(title, bodyHtml) {
    closeModal();
    const bg = document.createElement("div"); bg.className = "modal-bg"; bg.id = "pgModal";
    const m = document.createElement("div"); m.className = "modal wide";
    m.innerHTML = '<h2 style="display:flex;justify-content:space-between;align-items:center">' + title + '<button class="btn ghost" id="pgModalX">✕</button></h2>' + bodyHtml;
    bg.appendChild(m); bg.onclick = e => { if (e.target === bg) closeModal(); };
    document.body.appendChild(bg);
    m.querySelector("#pgModalX").onclick = closeModal;
    wireStars(m);
  }
  function closeModal() { const b = $("#pgModal"); if (b) b.remove(); }

  // ---------- favorites star wiring ----------
  function wireStars(scope) {
    (scope || document).querySelectorAll("[data-star]").forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        window.Prefs.toggleFav(b.dataset.star);
        b.classList.toggle("on");
        b.textContent = b.classList.contains("on") ? "★" : "☆";
        if (state.page === "favorites") reRender();
      };
    });
  }

  // ---------- router ----------
  const PAGES = {
    market: { render: renderMarket, wire: null },
    scanner: { render: renderScanner, wire: wireScanner },
    sectors: { render: renderSectors, wire: wireSectors },
    gappers: { render: renderGappers, wire: null },
    favorites: { render: renderFavorites, wire: wireFavorites },
    alerts: { render: renderAlerts, wire: wireAlerts },
  };
  const state = { page: "market" };

  function reRender() {
    const p = PAGES[state.page]; if (!p) return;
    $("#page").innerHTML = p.render();
    if (p.wire) p.wire();
    wireStars($("#page"));
  }

  function setPage(name) {
    document.querySelectorAll(".side-nav a").forEach(a => a.classList.toggle("active", a.dataset.page === name));
    const jc = $("#journalContainer"), pg = $("#page");
    if (name === "journal") { pg.classList.add("hidden"); jc.classList.remove("hidden"); state.page = "journal"; }
    else { jc.classList.add("hidden"); pg.classList.remove("hidden"); state.page = PAGES[name] ? name : "market"; reRender(); }
    try { localStorage.setItem("sn_last_page", state.page); } catch (e) {}
  }
  window.setPageExternal = setPage;

  function initNav() {
    document.querySelectorAll(".side-nav a").forEach(a => a.onclick = () => setPage(a.dataset.page));
    if (window.Prefs) window.Prefs.onChange(() => { if (state.page === "favorites" || state.page === "alerts") reRender(); });
    let last = "market";
    try { last = localStorage.getItem("sn_last_page") || "market"; } catch (e) {}
    setPage((PAGES[last] || last === "journal") ? last : "market");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initNav);
  else initNav();
})();
