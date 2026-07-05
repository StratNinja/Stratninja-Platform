/* StratNinja Platform — scanner pages + sidebar navigation.
 * Pages render with DEMO data; live data (Massive/Polygon) will be wired next.
 * Candle color = direction (close vs open): green=up, red=down, gray=doji —
 * applied to ALL Strat types (1/2U/2D/3), which reveals "conflict" candles.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  let LIVE = null;  // live market snapshot from Supabase (null = show demo)
  let SCAN = null;  // live per-ticker scanner data (null = show demo)

  // ---------- helpers ----------
  function cell(t, c) { return { t: t, c: c }; }
  function tf(x, sym, tfl) {
    const c = x && x.c ? x.c : "doji";
    const t = x && x.t ? x.t : "1";
    const clk = sym ? ' clickable" data-chart="' + sym + '" data-tf="' + tfl + '"' : '"';
    return '<span class="tf ' + c + clk + ">" + t + "</span>";
  }
  const DEMO = '<div class="demo-flag">🧪 נתוני דמו — יחובר למפתח Massive/Polygon החי בשלב הבא</div>';
  function money(v, d) { d = d == null ? 2 : d; return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function pct(v) { const s = (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '">' + s + "</span>"; }
  function copyToClipboard(text, done) {
    const finish = () => { if (done) done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
    } else { fallbackCopy(text, finish); }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove(); if (done) done();
  }
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
  function tfCells(t) {
    const s = t.sym;
    return "<td>" + tf(t.Y, s, "Y") + "</td><td>" + tf(t.Q, s, "Q") + "</td><td>" + tf(t.M, s, "M") + "</td><td>" + tf(t.W, s, "W") + "</td><td>" + tf(t.D, s, "D") + "</td>";
  }
  function openChart(sym, tfl) {
    const iv = ({ D: "D", W: "W", M: "M", Q: "3M", Y: "12M" })[tfl] || "D";
    const src = "https://www.tradingview.com/widgetembed/?frameElementId=tvchart&symbol=" + encodeURIComponent(sym) +
      "&interval=" + iv + "&theme=dark&style=1&hidesidetoolbar=1&saveimage=0&timezone=America%2FNew_York";
    modal(sym + " · " + tfl,
      '<iframe src="' + src + '" style="width:100%;height:520px;border:0;border-radius:8px;background:#131722" allowfullscreen></iframe>' +
      '<div class="note"><a href="https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(sym) + '" target="_blank" rel="noopener">פתח ב-TradingView ↗</a></div>');
  }
  function wireCharts(scope) {
    (scope || document).querySelectorAll("[data-chart]").forEach(b => {
      b.onclick = e => { e.stopPropagation(); openChart(b.dataset.chart, b.dataset.tf); };
    });
  }

  // ========== MARKET ==========
  function pctSpan(v) { v = v == null ? 0 : v; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '" style="font-size:13px">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function mkLead(items, cls, isSector) {
    if (!items || !items.length) return '<div class="muted" style="padding:8px 12px;font-size:13px">ממתין לנתוני מסחר…</div>';
    return items.map(x => {
      const label = isSector ? x.name : (x.s + ' <span class="tname">' + (x.sec || "") + "</span>");
      const chg = isSector ? x.chg : x.c;
      return '<div class="lead-row ' + cls + '"><span>' + label + "</span>" + pctSpan(chg) + "</div>";
    }).join("");
  }
  function breadthBar() {
    const b = LIVE && LIVE.breadth;
    if (!b || !b.total) return "";
    const ap = (b.above / b.total * 100);
    return '<div class="panel breadth-panel clickable" id="breadthBar"><h3>רוחב שוק · Breadth <span class="muted" style="font-size:12px">' + b.total + ' מניות · לחץ לפירוט לפי סקטור →</span></h3>' +
      '<div class="bigbreadth"><span class="bseg up" style="width:' + ap.toFixed(1) + '%"></span><span class="bseg down" style="width:' + (100 - ap).toFixed(1) + '%"></span></div>' +
      '<div class="bkey" style="margin-top:10px;font-size:13px"><span class="pos">🟢 ' + b.above + " מעל פתיחה</span><span class=\"neg\">🔴 " + b.below + ' מתחת</span><span class="muted">' + ap.toFixed(0) + "% ירוקים</span></div></div>";
  }
  function liveBanner() {
    if (LIVE && LIVE.updated) {
      const d = new Date(LIVE.updated);
      const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      return '<div class="demo-flag" style="background:rgba(22,184,119,.12);color:#7ee2b8;border-color:rgba(22,184,119,.3)">🟢 נתונים חיים · עודכן ' + hh + "</div>";
    }
    return DEMO;
  }
  function renderMarket() {
    const idxSrc = (LIVE && LIVE.indices && LIVE.indices.length) ? LIVE.indices : INDICES;
    const idxRows = idxSrc.map(r =>
      '<tr><td class="sym"><span class="tsym">' + r.sym + '</span> <span class="tname">' + r.name + "</span></td>" + tfCells(r) + "</tr>").join("");
    const dist = DIST.map(d => '<div class="tile"><div class="k"><span class="dot ' + d.dot + '"></span>' + d.k + '</div><div class="v">' + d.n + "</div></div>").join("");
    const breadth = BREADTH_IDX.map(b => '<div class="tile"><div class="k">' + b.sym + " · " + b.desc + '</div><div class="v muted">—</div></div>').join("");
    const rank = (arr, cls) => arr.map((s, i) => '<div class="lead-row ' + cls + '"><span>' + s + '</span><span class="rank">#' + (i + 1) + "</span></div>").join("");
    const vixVal = (LIVE && LIVE.vix)
      ? '<div class="v">' + LIVE.vix.level.toFixed(2) + '</div><div class="sub ' + (LIVE.vix.chg >= 0 ? "neg" : "pos") + '">' + (LIVE.vix.chg >= 0 ? "+" : "") + LIVE.vix.chg.toFixed(2) + "%</div>"
      : '<div class="v muted">—</div>';
    return (
      '<div class="page-head"><h1>סקירת שוק</h1><div class="sub">נתוני שוק בזמן אמת עבור סוחרי The Strat</div></div>' + liveBanner() +
      '<div class="cols2">' +
        '<div class="panel"><h3>מדדים ראשיים</h3><table class="idx-table"><thead><tr><th style="text-align:start">סימבול</th>' + tfHeadCols() + "</tr></thead><tbody>" + idxRows + "</tbody></table>" + colorLegend() + "</div>" +
        '<div class="panel"><h3>VIX <span class="muted" style="font-size:12px">תנודתיות</span></h3><div class="tile"><div class="k">מדד הפחד</div>' + vixVal + '</div><div class="muted" style="font-size:12px;margin-top:10px">VIX גבוה = פחד · נמוך = רוגע</div></div>' +
      "</div>" +
      breadthBar() +
      '<div class="panel"><h3>התפלגות נרות S&P 500 (יומי)</h3><div class="tiles">' + dist + "</div></div>" +
      '<div class="cols2"><div class="panel"><h3>🟢 סקטורים מובילים</h3>' + (LIVE ? mkLead(LIVE.sectorLeaders, "up", true) : rank(["חומרי גלם", "תקשורת", "אנרגיה"], "up")) + "</div>" +
      '<div class="panel"><h3>🔴 סקטורים בפיגור</h3>' + (LIVE ? mkLead(LIVE.sectorLaggards, "down", true) : rank(["מוצרי צריכה", "בריאות", "שירותים"], "down")) + "</div></div>" +
      '<div class="cols2"><div class="panel"><h3>🟢 מניות מובילות</h3>' + (LIVE ? mkLead((LIVE.leaders || []).slice(0, 5), "up", false) : rank(["SMCI", "PLTR", "MARA"], "up")) + "</div>" +
      '<div class="panel"><h3>🔴 מניות בפיגור</h3>' + (LIVE ? mkLead((LIVE.laggards || []).slice(0, 5), "down", false) : rank(["SNAP", "LCID", "NIO"], "down")) + "</div></div>"
    );
  }
  function wireMarket() {
    const bb = $("#breadthBar"); if (bb) bb.onclick = () => setPage("sp500");
  }

  // ========== S&P 500 BREADTH ==========
  function renderSp500() {
    const secs = (LIVE && LIVE.sectors) ? LIVE.sectors : null;
    if (!secs || !secs.length) {
      return '<div class="page-head"><h1>S&P 500 · רוחב שוק</h1><div class="sub">מניות לפי סקטור · מעל/מתחת למחיר הפתיחה</div></div>' +
        '<div class="panel"><div class="stub"><div class="big">🗺️</div><h2>ממתין לנתוני מסחר</h2><p>ה-breadth מחושב בשעות המסחר (מעל/מתחת לפתיחת היום). חזור כשהשוק פתוח.</p></div></div>';
    }
    const b = LIVE.breadth;
    const cards = secs.map(s => {
      const ap = s.above / (s.total || 1) * 100;
      const bar = '<div class="bigbreadth sm"><span class="bseg up" style="width:' + ap.toFixed(1) + '%"></span><span class="bseg down" style="width:' + (100 - ap).toFixed(1) + '%"></span></div>';
      const chips = s.stocks.map(x =>
        '<span class="stkchip ' + (x.ao ? "up" : "down") + ' clickable" data-chart="' + x.s + '" data-tf="D" title="' + x.c + '%">' + x.s + "</span>").join("");
      return '<div class="panel sec-breadth"><h3>' + s.name +
        ' <span class="muted" style="font-size:12px">' + s.above + "/" + s.total + " מעל פתיחה · " + ap.toFixed(0) + "% ירוקים · " + pctSpanBare(s.chg) + "</span></h3>" +
        bar + '<div class="stkchips">' + chips + "</div></div>";
    }).join("");
    return '<div class="page-head"><h1>S&P 500 · רוחב שוק לפי סקטור</h1><div class="sub">🟢 ' + b.above + " מעל פתיחה · 🔴 " + b.below + " מתחת · לחץ על מניה לגרף</div></div>" +
      liveBanner() + '<div class="sector-grid">' + cards + "</div>";
  }
  function pctSpanBare(v) { v = v == null ? 0 : v; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function colorLegend() {
    return '<div class="muted" style="font-size:11px;margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">' +
      '<span>הצבע = כיוון הנר · הטקסט = סוג Strat:</span>' +
      '<span>' + tf(cell("2U", "up")) + ' סגירה מעל הפתיחה</span>' +
      '<span>' + tf(cell("2U", "down")) + ' מתחת (קונפליקט)</span>' +
      '<span>' + tf(cell("1", "doji")) + " דוג'י</span></div>";
  }

  // ========== SCANNER ==========
  const scanState = { tfs: ["D"], patterns: [], dir: "all", sector: "all", sym: "", ftfc: false };
  function scanSource() {
    if (SCAN && SCAN.rows && SCAN.rows.length) {
      return SCAN.rows.map(r => ({ sym: r.s, sector: r.sec, price: r.p, chg: r.c,
        Y: r.Y, Q: r.Q, M: r.M, W: r.W, D: r.D, ftfc: r.ftfc, tech: r.tech }));
    }
    return TICKERS;
  }
  function scanInsights(rows, universe) {
    const n = rows.length;
    if (!n) return [];
    const facts = [];
    const pctOf = k => Math.round(k / n * 100);
    // sector concentration
    const sec = {}; rows.forEach(r => { sec[r.sector] = (sec[r.sector] || 0) + 1; });
    const topSec = Object.keys(sec).map(k => [k, sec[k]]).sort((a, b) => b[1] - a[1])[0];
    if (topSec && topSec[0]) facts.push({ i: "🗂️", t: pctOf(topSec[1]) + "% מהתוצאות בסקטור <b>" + topSec[0] + "</b> (" + topSec[1] + " מניות)" });
    // FTFC rate
    const ftfc = rows.filter(r => r.ftfc).length;
    if (ftfc) facts.push({ i: "🎯", t: pctOf(ftfc) + "% בהמשכיות-טיימפריימים מלאה (<b>FTFC</b>) — יישור חזק בין הזמנים" });
    // daily direction bias
    const green = rows.filter(r => (r.D || {}).c === "up").length, red = rows.filter(r => (r.D || {}).c === "down").length;
    if (green || red) {
      const dom = green >= red ? green : red;
      facts.push({ i: green >= red ? "🟢" : "🔴", t: pctOf(dom) + "% מהנרות היומיים " + (green > red ? "ירוקים (הטיה שורית)" : red > green ? "אדומים (הטיה דובית)" : "מאוזנים") });
    }
    // most common daily pattern
    const pat = {}; rows.forEach(r => { const t = (r.D || {}).t; if (t) pat[t] = (pat[t] || 0) + 1; });
    const topPat = Object.keys(pat).map(k => [k, pat[k]]).sort((a, b) => b[1] - a[1])[0];
    if (topPat) facts.push({ i: "📊", t: "התבנית היומית הנפוצה: <b>" + topPat[0] + "</b> ב-" + pctOf(topPat[1]) + "% מהתוצאות" });
    // conflict candles (2U red / 2D green)
    const conflict = rows.filter(r => { const d = r.D || {}; return (d.t === "2U" && d.c === "down") || (d.t === "2D" && d.c === "up"); }).length;
    if (conflict) facts.push({ i: "⚔️", t: pctOf(conflict) + "% נרות ב<b>קונפליקט</b> (2U אדום / 2D ירוק) — סימן להיפוך אפשרי" });
    // multi-TF confluence
    if (scanState.tfs.length > 1) facts.push({ i: "⚡", t: "קונפלואנס: התבנית מתקיימת על <b>" + scanState.tfs.length + " טיימפריימים</b> בו-זמנית — סטאפ נדיר וחזק יותר" });
    // selectivity
    facts.push({ i: "🔎", t: "הסינון צימצם ל-<b>" + n + "</b> מתוך " + universe + " מניות (" + Math.round(n / universe * 100) + "% מהיקום)" });
    return facts;
  }
  function renderScanner() {
    const all = scanSource();
    const isLive = !!(SCAN && SCAN.rows && SCAN.rows.length);
    const hasTech = all.some(t => t.tech);
    const sectors = Array.from(new Set(all.map(t => t.sector))).sort();
    const patBtn = p => '<button class="chip' + (scanState.patterns.indexOf(p) >= 0 ? " on" : "") + '" data-pat="' + p + '">' + p + "</button>";
    const tfBtn = f => '<button class="chip' + (scanState.tfs.indexOf(f) >= 0 ? " on" : "") + '" data-tff="' + f + '">' + f + "</button>";
    const dirBtn = (v, l) => '<button class="chip' + (scanState.dir === v ? " on" : "") + '" data-dir="' + v + '">' + l + "</button>";
    const filters =
      '<div class="panel filters"><h3>פילטרים <span class="muted" style="font-size:12px">בחר כמה טיימפריימים = חיפוש קונפלואנס (התבנית מתקיימת על כולם)</span></h3><div class="frow">' +
        '<div class="fgrp"><label>טיימפריימים · רב-בחירה</label><div class="chips">' + ["D", "W", "M", "Q", "Y"].map(tfBtn).join("") + "</div></div>" +
        '<div class="fgrp"><label>תבנית</label><div class="chips">' + ["1", "2U", "2D", "3"].map(patBtn).join("") + "</div></div>" +
        '<div class="fgrp"><label>צבע נר</label><div class="chips">' + dirBtn("all", "הכל") + dirBtn("up", "🟢 ירוק") + dirBtn("down", "🔴 אדום") + "</div></div>" +
        '<div class="fgrp"><label>סקטור</label><select id="scanSector"><option value="all">הכל</option>' + sectors.map(s => '<option' + (scanState.sector === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select></div>" +
        '<div class="fgrp"><label>סימבול</label><input id="scanSym" placeholder="AAPL" value="' + scanState.sym + '"></div>' +
        '<div class="fgrp"><label>FTFC בלבד</label><button class="chip' + (scanState.ftfc ? " on" : "") + '" id="scanFtfc">' + (scanState.ftfc ? "כן ✓" : "הכל") + "</button></div>" +
        '<div class="fgrp" style="align-self:flex-end"><button class="btn ghost" id="scanReset">איפוס</button></div>' +
      "</div></div>";

    // ---- technical filters (collapsible) ----
    const opt = (v, cur, lbl) => '<option value="' + v + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + (lbl == null ? v : lbl) + "</option>";
    const onChip = (on, id, lbl) => '<button class="chip' + (on ? " on" : "") + '" id="' + id + '">' + lbl + "</button>";
    const cnt = techActiveCount();
    let techInner = "";
    if (techState.techOpen) {
      techInner = !hasTech
        ? '<div class="note" style="margin-top:6px">⏳ הנתונים הטכניים ייטענו בהרצת הסורק הבאה בשרת.</div>'
        : '<div class="frow">' +
            '<div class="fgrp"><label>מרחק מממוצע נע ' + onChip(techState.maOn, "tMaOn", techState.maOn ? "פעיל ✓" : "כבוי") + '</label>' +
              '<div class="chips" style="align-items:center">' +
                '<select id="tMaType">' + opt("SMA", techState.maType) + opt("EMA", techState.maType) + '</select>' +
                '<select id="tMaPer">' + MA_PERIODS.map(p => opt(p, techState.maPeriod)).join("") + '</select>' +
                '<select id="tMaRel">' + opt("near", techState.maRel, "קרוב עד ±") + opt("above", techState.maRel, "מעל") + opt("below", techState.maRel, "מתחת") + '</select>' +
                (techState.maRel === "near" ? '<input id="tMaPct" type="number" step="0.5" min="0" style="width:70px" value="' + techState.maPct + '"><span class="muted">%</span>' : "") +
              "</div></div>" +
            '<div class="fgrp"><label>RSI (14) ' + onChip(techState.rsiOn, "tRsiOn", techState.rsiOn ? "פעיל ✓" : "כבוי") + '</label>' +
              '<div class="chips" style="align-items:center"><span class="muted">בין</span><input id="tRsiMin" type="number" min="0" max="100" style="width:64px" value="' + techState.rsiMin + '">' +
              '<span class="muted">ל-</span><input id="tRsiMax" type="number" min="0" max="100" style="width:64px" value="' + techState.rsiMax + '"></div></div>' +
            '<div class="fgrp"><label>MFI (14) · כסף חכם ' + onChip(techState.mfiOn, "tMfiOn", techState.mfiOn ? "פעיל ✓" : "כבוי") + '</label>' +
              '<div class="chips" style="align-items:center"><span class="muted">בין</span><input id="tMfiMin" type="number" min="0" max="100" style="width:64px" value="' + techState.mfiMin + '">' +
              '<span class="muted">ל-</span><input id="tMfiMax" type="number" min="0" max="100" style="width:64px" value="' + techState.mfiMax + '"></div></div>' +
          "</div>" +
          '<div class="frow">' +
            '<div class="fgrp"><label>ווליום יחסי (RVOL) ' + onChip(techState.rvolOn, "tRvolOn", techState.rvolOn ? "פעיל ✓" : "כבוי") + '</label>' +
              '<div class="chips" style="align-items:center"><span class="muted">לפחות</span><input id="tRvolMin" type="number" step="0.1" min="0" style="width:74px" value="' + techState.rvolMin + '"><span class="muted">×</span></div></div>' +
            '<div class="fgrp"><label>ווליום מוחלט (מניות) ' + onChip(techState.volOn, "tVolOn", techState.volOn ? "פעיל ✓" : "כבוי") + '</label>' +
              '<div class="chips" style="align-items:center"><span class="muted">מעל</span><select id="tVolMin">' +
                opt("500000", techState.volMin, "500K") + opt("1000000", techState.volMin, "1M") + opt("2000000", techState.volMin, "2M") +
                opt("5000000", techState.volMin, "5M") + opt("10000000", techState.volMin, "10M") + opt("20000000", techState.volMin, "20M") +
              "</select></div></div>" +
            '<div class="fgrp"><label>קרבה לשיא/שפל 52ש׳</label>' +
              '<div class="chips" style="align-items:center"><select id="tExt52">' +
                opt("off", techState.ext52, "כבוי") + opt("high", techState.ext52, "קרוב לשיא") + opt("low", techState.ext52, "קרוב לשפל") +
              "</select>" + (techState.ext52 !== "off" ? '<span class="muted">±</span><input id="tExt52Pct" type="number" step="0.5" min="0" style="width:64px" value="' + techState.ext52Pct + '"><span class="muted">%</span>' : "") + "</div></div>" +
          "</div>";
    }
    const techBadge = cnt ? ' <span class="badge-ftfc">' + cnt + ' פעילים</span>' : ' <span class="muted" style="font-size:12px">SMA/EMA · RSI · RVOL · ווליום · 52ש׳</span>';
    const techPanel = '<div class="panel filters"><h3 id="techToggle" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;margin:0"><span>📈 פילטרים טכניים' + techBadge + '</span><span style="font-size:14px">' + (techState.techOpen ? "▲" : "▼") + "</span></h3>" + techInner + "</div>";

    const techOn = techActive();
    const maLabel = techState.maType + techState.maPeriod;
    const rows = filterRows(all);
    const CAP = 300;
    const shown = rows.slice(0, CAP);
    const dmapKey = techState.maType === "EMA" ? "dema" : "dsma";
    const body = shown.map(t => {
      const k = t.tech || {};
      const dma = (k[dmapKey] || {})[techState.maPeriod];
      const techCells = techOn
        ? '<td class="' + rsiCls(k.rsi) + '">' + (k.rsi == null ? "—" : k.rsi.toFixed(0)) + "</td>" +
          '<td class="' + mfiCls(k.mfi) + '">' + (k.mfi == null ? "—" : k.mfi.toFixed(0)) + "</td>" +
          "<td>" + (k.rvol == null ? "—" : k.rvol.toFixed(2) + "×") + "</td>" +
          "<td>" + fmtVol(k.vol) + "</td>" +
          "<td>" + dPct(dma) + "</td>" +
          "<td>" + dPct(k.dhi52) + "</td>"
        : "";
      return "<tr>" +
        "<td>" + star(t.sym) + "</td>" +
        '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + '</span> <span class="tname">' + t.sector + "</span></td>" +
        "<td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" +
        tfCells(t) +
        "<td>" + (t.ftfc ? '<span class="badge-ftfc">FTFC</span>' : "—") + "</td>" +
        techCells +
        '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td>' +
      "</tr>";
    }).join("");

    const filterActive = scanState.patterns.length || scanState.dir !== "all" || scanState.sector !== "all" || scanState.sym || scanState.ftfc || scanState.tfs.length > 1 || cnt;
    const facts = filterActive ? scanInsights(rows, all.length) : [];
    const insightsPanel =
      '<div class="panel scan-insights"><h3>🧠 תובנות על התוצאות</h3>' +
      (facts.length
        ? facts.map(f => '<div class="insight"><span class="ins-ico">' + f.i + '</span><span>' + f.t + "</span></div>").join("")
        : '<div class="ins-empty">סַנֵּן לפי תבנית, טיימפריים, סקטור או פילטר טכני — ואציג לך עובדות מעניינות על מה שיצא. 🔍</div>') +
      "</div>";

    const techHead = techOn ? "<th>RSI</th><th>MFI</th><th>RVOL</th><th>ווליום</th><th>Δ " + maLabel + "</th><th>Δ שיא52</th>" : "";
    const nCols = techOn ? 16 : 10;
    const resultsPanel =
      '<div class="panel scan-results"><h3><span>תוצאות <span class="muted" style="font-size:12px">' + rows.length + " מתוך " + all.length + (rows.length > CAP ? " · מוצגות " + CAP + " הראשונות" : "") + "</span></span>" + (rows.length ? '<button class="btn ghost" id="scanCopy" style="font-size:12px;font-weight:600">📋 העתק ' + rows.length + " טיקרים</button>" : "") + "</h3>" +
      '<div class="tablewrap"><table class="scan-table"><thead><tr><th></th><th style="text-align:start">סימבול</th><th>מחיר</th><th>%</th>' + tfHeadCols() + "<th>FTFC</th>" + techHead + "<th></th></tr></thead><tbody>" +
      (shown.length ? body : '<tr><td colspan="' + nCols + '" class="muted" style="text-align:center;padding:30px">אין תוצאות לפילטרים האלה</td></tr>') +
      "</tbody></table></div>" + colorLegend() + "</div>";

    return (
      '<div class="page-head"><h1>סורק עסקאות</h1><div class="sub">תבניות Strat + קונפלואנס רב-טיימפריים · עם פילטרים טכניים (SMA/RSI/ווליום) לשילוב</div></div>' + (isLive ? liveBanner() : DEMO) +
      filters + techPanel +
      '<div class="scan-layout">' + resultsPanel + insightsPanel + "</div>"
    );
  }
  function filterRows(all) {
    const tfs = scanState.tfs.length ? scanState.tfs : ["D"];
    const techOn = techActive();
    return all.filter(t => {
      if (scanState.sector !== "all" && t.sector !== scanState.sector) return false;
      if (scanState.sym && t.sym.indexOf(scanState.sym.toUpperCase()) < 0) return false;
      if (scanState.ftfc && !t.ftfc) return false;
      for (let i = 0; i < tfs.length; i++) {
        const c = t[tfs[i]] || t.D;
        if (scanState.patterns.length && scanState.patterns.indexOf(c.t) < 0) return false;
        if (scanState.dir !== "all" && c.c !== scanState.dir) return false;
      }
      if (techOn) {
        const k = t.tech;
        if (!k) return false;
        if (techState.maOn) {
          const dmap = techState.maType === "EMA" ? k.dema : k.dsma;
          const d = dmap ? dmap[techState.maPeriod] : null;
          if (d == null) return false;
          if (techState.maRel === "near" && Math.abs(d) > techState.maPct) return false;
          if (techState.maRel === "above" && d <= 0) return false;
          if (techState.maRel === "below" && d >= 0) return false;
        }
        if (techState.rsiOn && (k.rsi == null || k.rsi < techState.rsiMin || k.rsi > techState.rsiMax)) return false;
        if (techState.mfiOn && (k.mfi == null || k.mfi < techState.mfiMin || k.mfi > techState.mfiMax)) return false;
        if (techState.rvolOn && (k.rvol == null || k.rvol < techState.rvolMin)) return false;
        if (techState.volOn && (!k.vol || k.vol < techState.volMin)) return false;
        if (techState.ext52 === "high" && (k.dhi52 == null || Math.abs(k.dhi52) > techState.ext52Pct)) return false;
        if (techState.ext52 === "low" && (k.dlo52 == null || Math.abs(k.dlo52) > techState.ext52Pct)) return false;
      }
      return true;
    });
  }
  function wireScanner() {
    document.querySelectorAll("[data-tff]").forEach(b => b.onclick = () => { const f = b.dataset.tff, i = scanState.tfs.indexOf(f); if (i >= 0) scanState.tfs.splice(i, 1); else scanState.tfs.push(f); reRender(); });
    document.querySelectorAll("[data-pat]").forEach(b => b.onclick = () => { const p = b.dataset.pat, i = scanState.patterns.indexOf(p); if (i >= 0) scanState.patterns.splice(i, 1); else scanState.patterns.push(p); reRender(); });
    document.querySelectorAll("[data-dir]").forEach(b => b.onclick = () => { scanState.dir = b.dataset.dir; reRender(); });
    const sec = $("#scanSector"); if (sec) sec.onchange = () => { scanState.sector = sec.value; reRender(); };
    const sym = $("#scanSym"); if (sym) sym.onchange = () => { scanState.sym = sym.value; reRender(); };
    const ftfc = $("#scanFtfc"); if (ftfc) ftfc.onclick = () => { scanState.ftfc = !scanState.ftfc; reRender(); };
    const reset = $("#scanReset"); if (reset) reset.onclick = () => {
      scanState.tfs = ["D"]; scanState.patterns = []; scanState.dir = "all"; scanState.sector = "all"; scanState.sym = ""; scanState.ftfc = false;
      resetTech(); reRender();
    };
    // technical controls
    const bind = (id, ev, fn) => { const e = $("#" + id); if (e) e[ev] = fn; };
    bind("techToggle", "onclick", () => { techState.techOpen = !techState.techOpen; reRender(); });
    bind("tMaOn", "onclick", () => { techState.maOn = !techState.maOn; reRender(); });
    bind("tMaType", "onchange", e => { techState.maType = e.target.value; reRender(); });
    bind("tMaPer", "onchange", e => { techState.maPeriod = e.target.value; reRender(); });
    bind("tMaRel", "onchange", e => { techState.maRel = e.target.value; reRender(); });
    bind("tMaPct", "onchange", e => { techState.maPct = parseFloat(e.target.value) || 0; reRender(); });
    bind("tRsiOn", "onclick", () => { techState.rsiOn = !techState.rsiOn; reRender(); });
    bind("tRsiMin", "onchange", e => { techState.rsiMin = parseFloat(e.target.value) || 0; reRender(); });
    bind("tRsiMax", "onchange", e => { techState.rsiMax = parseFloat(e.target.value) || 100; reRender(); });
    bind("tMfiOn", "onclick", () => { techState.mfiOn = !techState.mfiOn; reRender(); });
    bind("tMfiMin", "onchange", e => { techState.mfiMin = parseFloat(e.target.value) || 0; reRender(); });
    bind("tMfiMax", "onchange", e => { techState.mfiMax = parseFloat(e.target.value) || 100; reRender(); });
    bind("tRvolOn", "onclick", () => { techState.rvolOn = !techState.rvolOn; reRender(); });
    bind("tRvolMin", "onchange", e => { techState.rvolMin = parseFloat(e.target.value) || 0; reRender(); });
    bind("tVolOn", "onclick", () => { techState.volOn = !techState.volOn; reRender(); });
    bind("tVolMin", "onchange", e => { techState.volMin = parseInt(e.target.value, 10) || 0; reRender(); });
    bind("tExt52", "onchange", e => { techState.ext52 = e.target.value; reRender(); });
    bind("tExt52Pct", "onchange", e => { techState.ext52Pct = parseFloat(e.target.value) || 0; reRender(); });
    const copy = $("#scanCopy");
    if (copy) copy.onclick = () => {
      const rows = filterRows(scanSource());
      const syms = rows.map(t => t.sym).join(", ");
      const orig = copy.textContent;
      copyToClipboard(syms, () => { copy.textContent = "✓ הועתקו " + rows.length; setTimeout(() => copy.textContent = orig, 1600); });
    };
  }

  // ========== technical filter state (used by the unified scanner above) ==========
  const techState = {
    techOpen: false,
    maOn: false, maType: "SMA", maPeriod: "50", maRel: "near", maPct: 2,
    rsiOn: false, rsiMin: 0, rsiMax: 30,
    mfiOn: false, mfiMin: 0, mfiMax: 20,
    rvolOn: false, rvolMin: 1.5,
    volOn: false, volMin: 1000000,
    ext52: "off", ext52Pct: 3,      // off | high | low
  };
  const MA_PERIODS = ["10", "20", "50", "100", "150", "200"];
  function techActive() { return techState.maOn || techState.rsiOn || techState.mfiOn || techState.rvolOn || techState.volOn || techState.ext52 !== "off"; }
  function techActiveCount() { let n = 0; if (techState.maOn) n++; if (techState.rsiOn) n++; if (techState.mfiOn) n++; if (techState.rvolOn) n++; if (techState.volOn) n++; if (techState.ext52 !== "off") n++; return n; }
  function resetTech() {
    techState.maOn = false; techState.maType = "SMA"; techState.maPeriod = "50"; techState.maRel = "near"; techState.maPct = 2;
    techState.rsiOn = false; techState.rsiMin = 0; techState.rsiMax = 30;
    techState.mfiOn = false; techState.mfiMin = 0; techState.mfiMax = 20;
    techState.rvolOn = false; techState.rvolMin = 1.5; techState.volOn = false; techState.volMin = 1000000;
    techState.ext52 = "off"; techState.ext52Pct = 3;
  }
  function fmtVol(n) {
    if (n == null) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return String(n);
  }
  function dPct(v) { return v == null ? "—" : '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function rsiCls(v) { return v == null ? "" : (v >= 70 ? "neg" : v <= 30 ? "pos" : ""); }
  function mfiCls(v) { return v == null ? "" : (v >= 80 ? "neg" : v <= 20 ? "pos" : ""); }

  // ========== SECTORS ==========
  function renderSectors() {
    const live = LIVE && LIVE.sectors;
    if (!live || !live.length) {
      const seg = (b) => {
        const tot = b.u2 + b.d2 + b.one + b.three || 1;
        const w = n => (n / tot * 100).toFixed(1) + "%";
        return '<div class="breadth"><span class="bseg up" style="width:' + w(b.u2) + '"></span><span class="bseg one" style="width:' + w(b.one) + '"></span><span class="bseg three" style="width:' + w(b.three) + '"></span><span class="bseg down" style="width:' + w(b.d2) + '"></span></div>';
      };
      const cards = SECTORS.map((s, i) =>
        '<div class="panel sector-card" data-sector="' + i + '"><h3>' + s.name + ' <span class="muted" style="font-size:12px">' + s.etf + "</span></h3>" +
        ["D", "W", "M"].map(r => '<div class="brow"><span class="btf">' + r + "</span>" + seg(s.breadth[r]) + "</div>").join("") + "</div>").join("");
      return '<div class="page-head"><h1>סקטורים</h1><div class="sub">breadth + FTFC · לחץ על סקטור לפירוט</div></div>' + DEMO + '<div class="sector-grid">' + cards + "</div>";
    }
    const ftfcBySec = {};
    if (SCAN && SCAN.rows) SCAN.rows.forEach(r => { if (r.ftfc) ftfcBySec[r.sec] = (ftfcBySec[r.sec] || 0) + 1; });
    const cards = live.map(s => {
      const ap = s.above / (s.total || 1) * 100;
      const ftfc = ftfcBySec[s.name] || 0;
      return '<div class="panel sector-card" data-sec="' + encodeURIComponent(s.name) + '"><h3>' + s.name + ' <span class="muted" style="font-size:12px">' + s.total + " מניות · " + pctSpanBare(s.chg) + "</span></h3>" +
        '<div class="bigbreadth sm"><span class="bseg up" style="width:' + ap.toFixed(1) + '%"></span><span class="bseg down" style="width:' + (100 - ap).toFixed(1) + '%"></span></div>' +
        '<div class="bkey" style="margin-top:10px;font-size:12px"><span class="pos">🟢 ' + s.above + " (" + ap.toFixed(0) + "%)</span><span class=\"neg\">🔴 " + s.below + '</span><span class="badge-ftfc" style="margin-inline-start:auto">FTFC ' + ftfc + "</span></div></div>";
    }).join("");
    return '<div class="page-head"><h1>סקטורים · Breadth + FTFC</h1><div class="sub">% מניות מעל הפתיחה + מספר מניות בהמשכיות-טיימפריימים מלאה · לחץ לפירוט</div></div>' + liveBanner() + '<div class="sector-grid">' + cards + "</div>";
  }
  function wireSectors() {
    document.querySelectorAll(".sector-card").forEach(c => {
      c.onclick = () => { if (c.dataset.sec) openSectorDrillLive(decodeURIComponent(c.dataset.sec)); else openSectorDrill(+c.dataset.sector); };
    });
  }
  function openSectorDrillLive(secName) {
    const members = (SCAN && SCAN.rows) ? SCAN.rows.filter(r => r.sec === secName) : [];
    if (!members.length) { modal(secName, '<div class="muted" style="padding:20px">נתוני הטיימפריימים עדיין נטענים או שהשוק סגור.</div>'); return; }
    const rows = members.map(r => {
      const t = { sym: r.s, Y: r.Y, Q: r.Q, M: r.M, W: r.W, D: r.D };
      return "<tr><td>" + star(r.s) + '</td><td class="sym"><span class="tsym clickable" data-chart="' + r.s + '" data-tf="D">' + r.s + "</span></td><td>" + money(r.p) + "</td><td>" + pct(r.c) + "</td>" + tfCells(t) + "<td>" + (r.ftfc ? '<span class="badge-ftfc">FTFC</span>' : "—") + "</td></tr>";
    }).join("");
    modal(secName + " · " + members.length + " מניות", '<div class="tablewrap"><table class="scan-table"><thead><tr><th></th><th style="text-align:start">סימבול</th><th>מחיר</th><th>%</th>' + tfHeadCols() + "<th>FTFC</th></tr></thead><tbody>" + rows + "</tbody></table></div>" + colorLegend());
  }
  function openSectorDrill(idx) {
    const s = SECTORS[idx];
    const members = TICKERS.slice(0, 8);
    const rows = members.map(t =>
      "<tr><td>" + star(t.sym) + '</td><td class="sym"><span class="tsym">' + t.sym + "</span></td><td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" + tfCells(t) + "</tr>").join("");
    modal(s.name + " · " + s.etf, '<div class="tablewrap"><table class="scan-table"><thead><tr><th></th><th style="text-align:start">סימבול</th><th>מחיר</th><th>%</th>' + tfHeadCols() + "</tr></thead><tbody>" + rows + "</tbody></table></div>" + colorLegend());
  }

  // ========== GAPPERS ==========
  function renderGappers() {
    const g = LIVE && LIVE.gappers;
    const head = '<div class="page-head"><h1>גאפרים</h1><div class="sub">מניות שפותחות בגאפ מעל 3% (מול סגירת אתמול)</div></div>';
    if (g && (g.up.length || g.down.length)) {
      const top5 = (arr, cls, title) => {
        const rows = arr.slice(0, 5).map(x =>
          "<tr><td>" + star(x.s) + '</td><td class="sym"><span class="tsym clickable" data-chart="' + x.s + '" data-tf="D">' + x.s + "</span></td><td>" + money(x.price) + "</td><td class='" + cls + "'>" + (x.gd >= 0 ? "+" : "") + money(x.gd) + "</td><td>" + pct(x.gp) + "</td></tr>").join("");
        return '<div class="panel"><h3>' + title + " · TOP 5 <span class='muted' style='font-size:12px'>מתוך " + arr.length + "</span></h3><div class='tablewrap'><table class='scan-table'><thead><tr><th></th><th style='text-align:start'>סימבול</th><th>מחיר</th><th>$Gap</th><th>%Gap</th></tr></thead><tbody>" + (rows || '<tr><td colspan="5" class="muted">—</td></tr>') + "</tbody></table></div></div>";
      };
      const copyBox = (arr, label) => {
        const syms = arr.map(x => x.s).join(", ");
        return '<div class="panel"><h3>' + label + ' <span class="muted" style="font-size:12px">' + arr.length + ' מניות</span> <button class="btn ghost" data-copy="' + label + '">📋 העתק הכל</button></h3><textarea class="copybox" readonly>' + syms + "</textarea></div>";
      };
      return head + liveBanner() +
        '<div class="cols2">' + top5(g.up, "pos", "🟢 גאפ למעלה") + top5(g.down, "neg", "🔴 גאפ למטה") + "</div>" +
        copyBox(g.up, "כל הגאפ-אפ >3%") + copyBox(g.down, "כל הגאפ-דאון >3%");
    }
    // demo fallback
    const tbl = (arr, cls, title) => {
      const rows = arr.map(x =>
        "<tr><td>" + star(x.sym) + '</td><td class="sym"><span class="tsym">' + x.sym + '</span> <span class="tname">' + x.name + "</span></td><td>" + money(x.price) + "</td><td class='" + cls + "'>" + (x.gd >= 0 ? "+" : "") + money(x.gd) + "</td><td>" + pct(x.gp) + "</td><td class='muted'>" + x.vol + "</td></tr>").join("");
      return '<div class="panel"><h3>' + title + "</h3><div class='tablewrap'><table class='scan-table'><thead><tr><th></th><th style='text-align:start'>סימבול</th><th>מחיר</th><th>$Gap</th><th>%Gap</th><th>נפח</th></tr></thead><tbody>" + rows + "</tbody></table></div></div>";
    };
    return head + DEMO + '<div class="cols2">' + tbl(GAPPERS.up, "pos", "🟢 גאפ למעלה") + tbl(GAPPERS.down, "neg", "🔴 גאפ למטה") + "</div>";
  }
  function wireGappers() {
    document.querySelectorAll("[data-copy]").forEach(b => {
      b.onclick = () => {
        const ta = b.closest(".panel").querySelector(".copybox");
        if (ta) { ta.select(); try { document.execCommand("copy"); } catch (e) {} b.textContent = "✓ הועתק"; setTimeout(() => b.textContent = "📋 העתק הכל", 1500); }
      };
    });
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
    bg.appendChild(m);
    let downOnBg = false;
    bg.addEventListener("mousedown", e => { downOnBg = (e.target === bg); });
    bg.onclick = e => { if (e.target === bg && downOnBg) closeModal(); };
    document.body.appendChild(bg);
    m.querySelector("#pgModalX").onclick = closeModal;
    wireStars(m);
    wireCharts(m);
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
    market: { render: renderMarket, wire: wireMarket },
    sp500: { render: renderSp500, wire: null },
    scanner: { render: renderScanner, wire: wireScanner },
    sectors: { render: renderSectors, wire: wireSectors },
    gappers: { render: renderGappers, wire: wireGappers },
    favorites: { render: renderFavorites, wire: wireFavorites },
    alerts: { render: renderAlerts, wire: wireAlerts },
  };
  const state = { page: "market" };

  function reRender() {
    const p = PAGES[state.page]; if (!p) return;
    $("#page").innerHTML = p.render();
    if (p.wire) p.wire();
    wireStars($("#page"));
    wireCharts($("#page"));
  }

  function setPage(name) {
    document.querySelectorAll(".side-nav a").forEach(a => a.classList.toggle("active", a.dataset.page === name));
    const jc = $("#journalContainer"), pg = $("#page");
    if (name === "journal") { pg.classList.add("hidden"); jc.classList.remove("hidden"); state.page = "journal"; }
    else { jc.classList.add("hidden"); pg.classList.remove("hidden"); state.page = PAGES[name] ? name : "market"; reRender(); }
    if (state.page === "scanner" || state.page === "sectors") loadScanner();
    try { localStorage.setItem("sn_last_page", state.page); } catch (e) {}
  }
  window.setPageExternal = setPage;

  async function loadLive() {
    try {
      const cfg = window.SN_CONFIG;
      if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
      const url = cfg.SUPABASE_URL + "/rest/v1/market_snapshot?id=eq.latest&select=data";
      const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY } });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j[0] && j[0].data) { LIVE = j[0].data; if (state.page === "market") reRender(); }
    } catch (e) { /* keep demo data */ }
  }

  let _scanLoaded = false;
  async function loadScanner() {
    if (_scanLoaded) return;
    _scanLoaded = true;
    try {
      const cfg = window.SN_CONFIG;
      if (!cfg || !cfg.SUPABASE_URL) return;
      const url = cfg.SUPABASE_URL + "/rest/v1/scanner_data?id=eq.latest&select=data";
      const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY } });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j[0] && j[0].data) { SCAN = j[0].data; if (state.page === "scanner" || state.page === "sectors") reRender(); }
    } catch (e) { /* keep demo */ }
  }

  function initNav() {
    document.querySelectorAll(".side-nav a").forEach(a => a.onclick = () => setPage(a.dataset.page));
    if (window.Prefs) window.Prefs.onChange(() => { if (state.page === "favorites" || state.page === "alerts") reRender(); });
    let last = "market";
    try { last = localStorage.getItem("sn_last_page") || "market"; } catch (e) {}
    setPage((PAGES[last] || last === "journal") ? last : "market");
    loadLive();
    setInterval(loadLive, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initNav);
  else initNav();
})();
