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
  const SHAPE_HE = { doji: "דוג'י", hammer: "פטיש 🔨", shooter: "כוכב נופל ⭐", marubozu: "מרובוזו", spinning: "סביבון", normal: "נר רגיל", flat: "—" };
  const SHAPE_OPTS = [["all", "הכל"], ["hammer", "🔨 פטיש (Hammer)"], ["shooter", "⭐ כוכב נופל (Shooter)"], ["doji", "דוג'י (Doji)"], ["marubozu", "מרובוזו (Marubozu)"], ["spinning", "סביבון (Spinning)"]];
  const BR_HE = { up: "היפוך 2D 🔼 (reclaim מלמטה)", down: "היפוך 2U 🔽 (rejection מלמעלה)" };
  const BROAD_OPTS = [["off", "הכל"], ["any", "⚡ כל היפוך"], ["up", "🔼 היפוך 2D (שורי)"], ["down", "🔽 היפוך 2U (דובי)"],
    ["2-1-2", "לקראת 2-1-2"], ["3-1-2", "לקראת 3-1-2"], ["1-3-2", "לקראת 1-3-2"], ["1-2-2", "לקראת 1-2-2"], ["3-2-2", "לקראת 3-2-2"]];
  const _isCombo = v => /^\d-\d-\d$/.test(v || "");
  // sector → SPDR sector ETF (the ETF that holds the stock)
  const SECTOR_ETF = { "Technology": "XLK", "Financials": "XLF", "Health Care": "XLV", "Energy": "XLE", "Consumer Disc.": "XLY", "Communication": "XLC", "Industrials": "XLI", "Consumer Staples": "XLP", "Materials": "XLB", "Real Estate": "XLRE", "Utilities": "XLU" };
  function etfFor(sec) { return SECTOR_ETF[sec] || ""; }
  const SECTOR_HE = { "Technology": "טכנולוגיה", "Financials": "פיננסים", "Health Care": "בריאות", "Energy": "אנרגיה", "Consumer Disc.": "צריכה מחזורית", "Communication": "תקשורת", "Industrials": "תעשייה", "Consumer Staples": "צריכה בסיסית", "Materials": "חומרי גלם", "Real Estate": 'נדל"ן', "Utilities": "תשתיות", "Crypto": "קריפטו", "אחר": "אחר" };
  function secHe(name) { return SECTOR_HE[name] || name; }
  function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;"); }
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  // sub-sector (industry) → closest tradeable ETF, matched by keyword (ordered specific→general).
  // Validated against all 171 live industries; unmapped ones are genuine ETF/macro categories.
  const INDUSTRY_ETF_KW = [
    ["SMH", ["semiconductor", "מוליכים למחצה", "שבבי", "וחומרה ל-ai", "חומרה ל-ai"]],
    ["XBI", ["biotechnology", "ביוטכנולוגיה", "עריכה גנטית"]],
    ["IHI", ["medical devices", "מכשור רפואי"]],
    ["IHF", ["שירותי בריאות", "ביטוח רפואי", "healthcare plans"]],
    ["IGV", ["תוכנה", "software", "saas", "וענן", "תוכנת ai", "פלטפורמות"]],
    ["CIBR", ["סייבר", "cyber", "אבטחת רשת", "אבטחת מידע"]],
    ["QTUM", ["קוונט", "quantum"]],
    ["BOTZ", ["בינה מלאכותית", "robotics"]],
    ["FINX", ["פינטק", "fintech"]],
    ["VNQ", ["נדל", "reit", "real estate"]],
    ["XOP", ["e&p"]],
    ["OIH", ["equipment & services"]],
    ["AMLP", ["midstream"]],
    ["ICLN", ["אנרגיה נקייה", "אנרגיה מתחדשת", "renewable", "clean energy"]],
    ["KRE", ["banks - regional", "בנקים אזוריים"]],
    ["KBE", ["banks - diversified", "banks", "בנקים"]],
    ["KIE", ["ביטוח", "insurance"]],
    ["IAI", ["בורסות", "ברוקרים", "broker", "exchange"]],
    ["BLOK", ["בלוקצ", "blockchain", "קריפטו", "crypto", "כורי"]],
    ["GDX", ["gold", "זהב", "מתכות יקרות", "כריית מתכות"]],
    ["URA", ["אורניום", "uranium", "גרעין", "nuclear"]],
    ["LIT", ["ליתיום", "lithium", "מתכות נדירות"]],
    ["XME", ["מתכות וכרייה", "כרייה", "מתכות תעשייתיות", "industrial metals", "other industrial metals", "mining"]],
    ["JETS", ["חברות תעופה", "תעופה", "airline"]],
    ["DRIV", ["רכב", "auto parts", "auto "]],
    ["ITA", ["חלל", "ביטחון", "aerospace", "defense"]],
    ["IYT", ["תחבורה", "לוגיסטיקה", "transport", "logistic", "freight", "railroad", "trucking", "airline"]],
    ["IBUY", ["מסחר אלקטרוני", "e-commerce", "online retail"]],
    ["PEJ", ["תיירות", "פנאי", "leisure", "gambling", "hotel", "travel"]],
    ["XRT", ["קמעונאות", "apparel retail", "retail"]],
    ["FDN", ["internet content", "internet"]],
    ["XLC", ["מדיה", "תקשורת", "telecom", "entertainment", "communication"]],
    ["ITB", ["בנייה", "homebuild", "building products", "building materials"]],
    ["XLP", ["מזון", "משקאות", "packaged foods", "צריכה בסיסי", "מוצרי בית", "טיפוח", "staples", "beverage"]],
    ["XLB", ["כימיקלים", "chemicals", "packaging", "containers"]],
    ["GRID", ["חשמול"]],
    ["XLU", ["utilities", "electric"]],
    ["MOO", ["חקלאות", "agricult"]],
    ["ARKK", ["צמיחה גבוהה", "מומנטום"]],
    ["FXI", ["סין", "china"]],
    ["SRVR", ["מרכזי נתונים", "data center"]],
    ["XLE", ["אנרגיה", "oil & gas", "נפט"]],
    ["XLV", ["בריאות", "health", "diagnostics", "pharma"]],
    ["XLI", ["תעופה", "תעשייה", "industrial", "business services", "machinery"]],
    ["XLK", ["טכנולוגיה", "technology", "electronic components", "information technology"]],
    ["XLF", ["פיננסים", "financ", "asset management", "credit", "מנהלי נכסים"]],
  ];
  function indEtf(ind) {
    if (!ind) return "";
    const s = String(ind).toLowerCase();
    for (let i = 0; i < INDUSTRY_ETF_KW.length; i++) {
      const kws = INDUSTRY_ETF_KW[i][1];
      for (let j = 0; j < kws.length; j++) { if (s.indexOf(kws[j].toLowerCase()) >= 0) return INDUSTRY_ETF_KW[i][0]; }
    }
    return "";
  }
  function etfChip(t) { return t ? '<span class="tsym clickable etf-chip" data-chart="' + t + '" title="תעודת סל · לחץ לגרף">' + t + "</span>" : ""; }
  // broad SPDR sector ETFs — must NOT appear as a sub-sector tag (that would just duplicate the sector's own ETF)
  const SECTOR_ETF_VALS = Object.keys(SECTOR_ETF).map(function (k) { return SECTOR_ETF[k]; });
  function subEtfFor(ind) { const e = indEtf(ind); return (e && SECTOR_ETF_VALS.indexOf(e) < 0) ? e : ""; }
  function cell(t, c) { return { t: t, c: c }; }
  function tf(x, sym, tfl) {
    const c = x && x.c ? x.c : "doji";
    const t = x && x.t ? x.t : "1";
    const sh = x && x.sh ? x.sh : "";
    const parts = [];
    if (sh && SHAPE_HE[sh]) parts.push(SHAPE_HE[sh]);
    if (x && x.br && BR_HE[x.br]) parts.push(BR_HE[x.br]);
    const title = parts.length ? ' title="' + parts.join(" · ") + '"' : "";
    const brMark = x && x.br ? ' style="text-decoration:underline dotted"' : "";
    const clk = sym ? ' clickable" data-chart="' + sym + '" data-tf="' + tfl + '"' : '"';
    return '<span class="tf ' + c + clk + title + brMark + ">" + t + "</span>";
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
  // FTFC badge — GREEN when the continuity is bullish (daily up), RED ("bear") when bearish (daily down)
  function ftfcBadge(row) {
    if (!row || !row.ftfc) return "—";
    return '<span class="badge-ftfc' + ((row.D || {}).c === "down" ? " bear" : "") + '">FTFC</span>';
  }
  function openChart(sym, tfl) {
    const iv = ({ D: "D", W: "W", M: "M", Q: "3M", Y: "12M" })[tfl] || "D";
    const src = "https://www.tradingview.com/widgetembed/?frameElementId=tvchart&symbol=" + encodeURIComponent(sym) +
      "&interval=" + iv + "&theme=dark&style=1&hidesidetoolbar=0&saveimage=1&timezone=America%2FNew_York";
    modal(sym + " · " + tfl,
      '<iframe src="' + src + '" style="width:100%;height:520px;border:0;border-radius:8px;background:#131722" allowfullscreen></iframe>' +
      '<div class="note"><a href="https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(sym) + '" target="_blank" rel="noopener">פתח ב-TradingView ↗</a></div>', "onechart");
  }
  function openMultiChart(sym) {
    const tfs = [["2h", "120"], ["D", "D"], ["W", "W"], ["M", "M"], ["Q", "3M"], ["Y", "12M"]];
    // strat-type strip from the loaded scanner row (if available)
    let strip = "";
    if (SCAN && SCAN.rows) {
      const r = SCAN.rows.find(x => x.s === sym);
      if (r) strip = '<div class="mtf-strip">' + ["D", "W", "M", "Q", "Y"].map(k => '<span class="mtf-tf">' + k + " " + tf(r[k]) + "</span>").join("") + "</div>";
    }
    const cells = tfs.map(([lbl, iv]) => {
      const src = "https://www.tradingview.com/widgetembed/?frameElementId=tv_" + lbl + "&symbol=" + encodeURIComponent(sym) +
        "&interval=" + iv + "&theme=dark&style=1&hidesidetoolbar=0&saveimage=1&timezone=America%2FNew_York";
      return '<div class="mtf-cell"><div class="mtf-lbl">' + lbl + '</div><iframe src="' + src + '" loading="lazy" style="width:100%;height:220px;border:0;border-radius:8px;background:#131722" allowfullscreen></iframe></div>';
    }).join("");
    modal(sym + ' · כל הטיימפריימים',
      strip + '<div class="mtf-grid">' + cells + "</div>" +
      '<div class="note" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">' +
        '<button class="btn ghost" id="mtfShot" style="font-size:13px;font-weight:600">📸 צילום מעוצב (כרטיס Strat)</button>' +
        '<button class="btn ghost" id="mtfFull" style="font-size:13px;font-weight:600">🖼️ צילום מסך כולל (עם הגרפים)</button>' +
        '<a href="https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(sym) + '" target="_blank" rel="noopener">פתח ב-TradingView ↗</a></div>', "mtf");
    { const ms = document.getElementById("mtfShot"); if (ms) ms.onclick = () => captureMtfCard(sym); }
    { const mf = document.getElementById("mtfFull"); if (mf) mf.onclick = () => captureFullShot(); }
  }
  // ---- scanner chart-grid view (TradingView-style, filtered symbols at the selected TF) ----
  const CG_IV = { D: "D", W: "W", M: "M", Q: "3M", Y: "12M" };
  const CG_TF_HE = { D: "יומי", W: "שבועי", M: "חודשי", Q: "רבעוני", Y: "שנתי" };
  function openScannerGrid() { openChartGrid(sortRows(filterRows(scanSource())), {}); }
  // generic chart-grid: takes a list of rows ({sym, price, chg, name/ind/sector}) and shows them as a TV grid
  function openChartGrid(rows, opts) {
    opts = opts || {};
    // if several TFs are selected → default to the LOWEST (shortest) one; order low→high = D,W,M,Q,Y
    const order = ["D", "W", "M", "Q", "Y"];
    const derived = opts.tf || (order.find(x => scanState.tfs.indexOf(x) >= 0) || "D");
    // lookback ranges (how far back to view) — each picks a sensible candle interval
    const CG_RANGE = [
      { k: "1D", he: "תוך יומי", iv: "15", rng: "1D" },
      { k: "5D", he: "5 ימים", iv: "60", rng: "5D" },
      { k: "1M", he: "חודש", iv: "D", rng: "1M" },
      { k: "3M", he: "רבעון", iv: "D", rng: "3M" },
      { k: "6M", he: "חצי שנה", iv: "D", rng: "6M" },
      { k: "12M", he: "שנה", iv: "D", rng: "12M" },
      { k: "60M", he: "5 שנים", iv: "W", rng: "60M" },
    ];
    // default lookback per TF. D → a full YEAR so candles render DAILY (a short 6M range makes
    // TradingView auto-switch to intraday 2h candles, which Adi doesn't want).
    const RANGE_DEF = { D: "12M", W: "12M", M: "60M", Q: "60M", Y: "60M" };
    const GCAP = 60; // lazy-loaded, but cap DOM to keep it snappy
    let cgSort = "ninja";   // charts order (like sorting the scanner table) — re-orderable below
    function cgSorted() {
      const arr = rows.slice();
      if (cgSort === "chg") arr.sort((a, b) => (b.chg || 0) - (a.chg || 0));
      else if (cgSort === "chgAsc") arr.sort((a, b) => (a.chg || 0) - (b.chg || 0));
      else if (cgSort === "sym") arr.sort((a, b) => (a.sym || "").localeCompare(b.sym || ""));
      else arr.sort((a, b) => (b.ninja || 0) - (a.ninja || 0));   // default: best Ninja Score first
      return arr.slice(0, GCAP);
    }
    let shown = cgSorted();
    if (!shown.length) { modal("📊 תצוגת גרפים", '<div class="note" style="padding:24px;text-align:center">אין מניות להצגה.</div>', "chartgrid"); return; }
    let curRange = RANGE_DEF[derived] || "12M";
    function cgSrc(sym, rk) {
      const R = CG_RANGE.find(x => x.k === rk) || CG_RANGE[4];
      return "https://www.tradingview.com/widgetembed/?frameElementId=cg_" + encodeURIComponent(sym) + "&symbol=" + encodeURIComponent(sym) +
        "&interval=" + R.iv + "&range=" + R.rng + "&theme=dark&style=1&hidesidetoolbar=1&hidetoptoolbar=1&saveimage=0&timezone=America%2FNew_York";
    }
    function cellsHtml(rk) {
      // charts are NOT rendered upfront — each is a placeholder that loads its iframe only
      // when it scrolls into view (see observeGrid), so the first row appears in ~2s instead of ~20s.
      return shown.map(t => {
        return '<div class="cg-cell">' +
          '<div class="cg-head">' + star(t.sym) +
            '<span class="cg-sym tsym clickable" data-chart="' + t.sym + '" title="כל הטיימפריימים">' + t.sym + "</span>" +
            '<span class="cg-name">' + (t.name || t.ind || t.sector || "") + "</span>" +
            '<span class="cg-price">' + money(t.price) + " " + pct(t.chg) + "</span>" +
            '<a class="cg-tv" href="https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(t.sym) + '" target="_blank" rel="noopener" title="פתח ב-TradingView">↗</a>' +
          "</div>" +
          '<div class="cg-frame cg-ph" data-src="' + cgSrc(t.sym, rk) + '"><span class="cg-spin"></span></div>' +
        "</div>";
      }).join("");
    }
    const more = rows.length > GCAP ? ' · מוצגות ' + GCAP + " מתוך " + rows.length : "";
    const rBtns = CG_RANGE.map(x => '<button class="chip cg-tfb' + (x.k === curRange ? " on" : "") + '" data-cgrange="' + x.k + '">' + x.he + "</button>").join("");
    const tfSel = '<div class="cg-tfsel"><span class="muted" style="font-size:12px">טווח:</span>' + rBtns +
      '<span class="muted" style="font-size:12px">· ' + shown.length + " מניות" + more + "</span></div>";
    const dens = '<div class="cg-dens"><span class="muted" style="font-size:12px">צפיפות:</span>' +
      '<button class="chip" data-cg="2">2</button><button class="chip on" data-cg="3">3</button><button class="chip" data-cg="4">4</button></div>';
    const sortSel = '<div class="cg-sort"><span class="muted" style="font-size:12px">מיון:</span><select id="cgSortSel" style="font-size:12px">' +
      '<option value="ninja">Ninja Score</option><option value="chg">% עולה→יורד</option><option value="chgAsc">% יורד→עולה</option><option value="sym">סימבול</option></select></div>';
    const shotBtn = '<button class="btn ghost" id="cgShot" style="font-size:12px;font-weight:600" title="צילום מסך של תצוגת הגרפים">🖼️ צילום מסך</button>';
    modal("📊 תצוגת גרפים" + (opts.title ? " · " + opts.title : ""), '<div class="cg-bar">' + tfSel + sortSel + dens + shotBtn + "</div>" + '<div class="cg-grid cg-3" id="cgGrid">' + cellsHtml(curRange) + "</div>", "chartgrid");
    const grid = $("#cgGrid");
    const scroller = document.querySelector(".modal.chartgrid");

    // ---- lazy chart loading: each chart loads the moment its cell scrolls into view ----
    // Visible charts load IN PARALLEL (no artificial stagger) — the first iframe downloads the
    // TradingView library, the rest reuse it from cache, so the whole visible screen fills quickly.
    let io = null;
    function realizePh(ph) {
      if (!ph || ph.dataset.done) return;
      ph.dataset.done = "1";
      const f = document.createElement("iframe");
      f.className = "cg-frame"; f.src = ph.dataset.src; f.setAttribute("allowfullscreen", "");
      f.setAttribute("loading", "lazy");
      ph.replaceWith(f);
    }
    function observeGrid() {
      if (io) io.disconnect();
      if (!("IntersectionObserver" in window)) { // very old browser fallback: just load all
        grid.querySelectorAll(".cg-ph").forEach(realizePh); return;
      }
      io = new IntersectionObserver(entries => {
        entries.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); realizePh(e.target); } });
      }, { root: scroller || null, rootMargin: "250px 0px", threshold: 0.01 });
      grid.querySelectorAll(".cg-ph").forEach(ph => io.observe(ph));
    }
    observeGrid();

    // density toggle
    document.querySelectorAll("[data-cg]").forEach(b => b.onclick = () => {
      if (grid) grid.className = "cg-grid cg-" + b.dataset.cg;
      document.querySelectorAll("[data-cg]").forEach(x => x.classList.toggle("on", x === b));
    });
    // manual range (lookback) selector — rebuilds the charts in place (re-observes for lazy loading)
    document.querySelectorAll("[data-cgrange]").forEach(b => b.onclick = () => {
      curRange = b.dataset.cgrange;
      if (grid) { grid.innerHTML = cellsHtml(curRange); wireStars(grid); wireCharts(grid); observeGrid(); }
      document.querySelectorAll("[data-cgrange]").forEach(x => x.classList.toggle("on", x === b));
    });
    // sort selector — re-orders the charts (like sorting the scanner table)
    { const ss = $("#cgSortSel"); if (ss) ss.onchange = () => { cgSort = ss.value; shown = cgSorted(); if (grid) { grid.innerHTML = cellsHtml(curRange); wireStars(grid); wireCharts(grid); observeGrid(); } }; }
    // full screenshot of the chart grid (captures the live TradingView charts)
    { const sh = $("#cgShot"); if (sh) sh.onclick = () => captureFullShot(); }
  }
  function wireCharts(scope) {
    (scope || document).querySelectorAll("[data-chart]").forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        if (b.classList.contains("tsym")) openMultiChart(b.dataset.chart);
        else openChart(b.dataset.chart, b.dataset.tf);
      };
    });
    wireSparkHover(scope);
  }

  // ---- hover sparkline preview (desktop): mini candlestick + Strat map on ticker hover ----
  let _hoverTO = null, _hoverEl = null;
  const _canHover = (() => { try { return window.matchMedia("(hover: hover)").matches; } catch (e) { return true; } })();
  function _rowBySym(sym) { return (SCAN && SCAN.rows) ? (SCAN.rows.find(x => x.s === sym) || null) : null; }
  function sparkCandles(spk, w, h) {
    if (!spk || !spk.length) return "";
    const pad = 3, n = spk.length;
    let lo = Infinity, hi = -Infinity;
    spk.forEach(b => { lo = Math.min(lo, b[2]); hi = Math.max(hi, b[1]); });
    if (!(hi > lo)) hi = lo + 1;
    const cw = (w - pad * 2) / n;
    const y = v => pad + (h - pad * 2) * (1 - (v - lo) / (hi - lo));
    let s = "";
    spk.forEach((b, i) => {
      const o = b[0], hh = b[1], ll = b[2], c = b[3];
      const cx = pad + cw * i + cw / 2;
      const col = c >= o ? "var(--green)" : "var(--red)";
      const bodyTop = y(Math.max(o, c)), bodyBot = y(Math.min(o, c));
      const bw = Math.max(1.6, cw * 0.62);
      s += '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(hh).toFixed(1) + '" y2="' + y(ll).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/>';
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + bodyTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, bodyBot - bodyTop).toFixed(1) + '" fill="' + col + '"/>';
    });
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + s + "</svg>";
  }
  function showHoverCard(sym, x, y) {
    const r = _rowBySym(sym); if (!r) return;
    const spk = (r.tech && r.tech.spk) || null;
    const chg = r.c || 0, cCls = chg > 0 ? "pos" : chg < 0 ? "neg" : "muted";
    const card = document.createElement("div");
    card.className = "spark-card";
    card.innerHTML =
      '<div class="sc-head"><b>' + r.s + '</b> <span class="muted">' + (r.sec || "") + "</span>" +
        '<span class="sc-px">' + money(r.p || 0) + ' <span class="' + cCls + '">' + (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%</span></span></div>" +
      (spk ? '<div class="sc-spark">' + sparkCandles(spk, 184, 54) + "</div>" : '<div class="muted" style="font-size:11px;padding:14px 0;text-align:center">אין נתוני גרף</div>') +
      '<div class="sc-cells">' + ["Y", "Q", "M", "W", "D"].map(k => r[k] ? ('<span class="sc-tf">' + k + "</span>" + tf(r[k], r.s, k)) : "").join("") + "</div>" +
      (r.ninja != null ? '<div class="sc-foot">🥷 Ninja Score <b>' + Math.round(r.ninja) + "</b> · 📅 14 ימים אחרונים</div>" : "");
    document.body.appendChild(card);
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let px = x + 16, py = y + 16;
    if (px + cw > window.innerWidth - 8) px = x - cw - 16;
    if (py + ch > window.innerHeight - 8) py = y - ch - 16;
    card.style.left = Math.max(8, px) + "px"; card.style.top = Math.max(8, py) + "px";
    _hoverEl = card;
  }
  function hideHoverCard() { if (_hoverEl) { _hoverEl.remove(); _hoverEl = null; } if (_hoverTO) { clearTimeout(_hoverTO); _hoverTO = null; } }
  function wireSparkHover(scope) {
    if (!_canHover) return;
    (scope || document).querySelectorAll(".tsym[data-chart]").forEach(el => {
      el.addEventListener("mouseenter", e => {
        hideHoverCard();
        const sym = el.dataset.chart, x = e.clientX, y = e.clientY;
        _hoverTO = setTimeout(() => showHoverCard(sym, x, y), 320);
      });
      el.addEventListener("mouseleave", hideHoverCard);
    });
  }

  // ========== MARKET ==========
  function pctSpan(v) { v = v == null ? 0 : v; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '" style="font-size:13px">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function mkLead(items, cls, isSector) {
    if (!items || !items.length) return '<div class="muted" style="padding:8px 12px;font-size:13px">ממתין לנתוני מסחר…</div>';
    return items.map(x => {
      const label = isSector ? (secHe(x.name) + (etfFor(x.name) ? " " + etfChip(etfFor(x.name)) : "")) : x.s;
      const chg = isSector ? x.chg : x.c;
      return '<div class="lead-row ' + cls + '"><span>' + label + "</span>" + pctSpan(chg) + "</div>";
    }).join("");
  }
  function breadthBar() {
    const b = mktU().breadth;
    if (!b || !b.total) return "";
    const ap = (b.above / b.total * 100);
    const uniLbl = marketUniverse === "sp500" ? "S&P 500" : "StratNinja";
    return '<div class="panel breadth-panel clickable" id="breadthBar"><h3>רוחב שוק · Breadth <span class="muted" style="font-size:12px">' + uniLbl + " · " + b.total + ' מניות · לחץ לפירוט לפי סקטור →</span></h3>' +
      '<div class="bigbreadth"><span class="bseg up" style="width:' + ap.toFixed(1) + '%"></span><span class="bseg down" style="width:' + (100 - ap).toFixed(1) + '%"></span></div>' +
      '<div class="bkey" style="margin-top:10px;font-size:13px"><span class="pos">🟢 ' + b.above + " מעל פתיחה</span><span class=\"neg\">🔴 " + b.below + ' מתחת</span><span class="muted">' + ap.toFixed(0) + "% ירוקים</span></div></div>";
  }
  function liveBanner() {
    if (LIVE && LIVE.updated) {
      const hh = d => String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      const scanTxt = (SCAN && SCAN.updated) ? ' · <span title="מחירי המניות בסורק מתעדכנים כל 15 דקות">מחירי מניות ' + hh(new Date(SCAN.updated)) + "</span>" : "";
      return '<div class="demo-flag" style="background:rgba(22,184,119,.12);color:#7ee2b8;border-color:rgba(22,184,119,.3)" title="מדדים/שוק מתעדכנים כל 3 דקות · סורק המניות כל 15 דקות (בשעות המסחר)">🟢 נתונים חיים · שוק עודכן ' + hh(new Date(LIVE.updated)) + scanTxt + "</div>";
    }
    return DEMO;
  }
  // ---- Candle Map (client-side breadth by candle type, from scanner data) ----
  const CMAP_ROWS = [
    ["3G", "3 GREEN — נר 3 חיצוני ירוק (Outside · התרחבות שורית)", "cm-3g"],
    ["F2D", "Failed 2D — שבר את הנמוך ונסגר ירוק (reclaim · היפוך שורי)", "cm-f2d"],
    ["2U", "2 UP — נר 2 מעלה (המשך שורי)", "cm-2u"],
    ["1", "INSIDE — נר פנימי (התכווצות / דשדוש)", "cm-1"],
    ["2D", "2 DOWN — נר 2 מטה (המשך דובי)", "cm-2d"],
    ["F2U", "Failed 2U — שבר את הגבוה ונסגר אדום (rejection · היפוך דובי)", "cm-f2u"],
    ["3R", "3 RED — נר 3 חיצוני אדום (Outside · התרחבות דובית)", "cm-3r"],
  ];
  const CMAP_DESC = {}; CMAP_ROWS.forEach(r => CMAP_DESC[r[0]] = r[1]);
  const TF_HE = { D: "יומי", W: "שבועי", M: "חודשי", Q: "רבעוני", Y: "שנתי" };
  function candleBucket(c) {
    if (!c) return "1";
    const t = c.t, col = c.c;
    if (t === "3") return col === "up" ? "3G" : "3R";
    if (t === "2U") return col === "down" ? "F2U" : "2U";
    if (t === "2D") return col === "up" ? "F2D" : "2D";
    return "1";
  }
  const _CM_BUCKET_HE = { "3G": "3 ירוק (התרחבות שורית)", "F2D": "היפוך 2D (reclaim)", "2U": "2U (המשך שורי)", "1": "Inside", "2D": "2D (המשך דובי)", "F2U": "היפוך 2U (rejection)", "3R": "3 אדום (התרחבות דובית)" };
  const _CM_TF_HE = { D: "היומי", W: "השבועי", M: "החודשי", Q: "הרבעוני", Y: "השנתי" };
  let _cmFacts = [], _cmTimer = null;
  // global universe toggle for the market-overview page: "sp500" (default) | "all" (StratNinja world)
  let marketUniverse = "sp500", _mktFlip = false;
  function mktU() {
    const u = LIVE && LIVE.universes;
    return (u && u[marketUniverse]) ? u[marketUniverse] : (LIVE || {});
  }
  function cmapRows() {
    const all = (SCAN && SCAN.rows) || [];
    if (marketUniverse === "sp500") { const sp = all.filter(r => r.sp); if (sp.length) return sp; }
    return all;
  }
  function candleMapFacts() {
    const rows = cmapRows();
    if (!rows.length) return [];
    const facts = [], pc = (a, b) => Math.round(a / b * 100);
    ["Y", "M", "W"].forEach(tf => {
      const byB = {};
      rows.forEach(r => { const b = candleBucket(r[tf]); (byB[b] = byB[b] || []).push(r); });
      Object.keys(byB).forEach(bk => {
        const arr = byB[bk];
        if (arr.length < 8) return;
        const sec = {}; arr.forEach(r => { if (r.sec) sec[r.sec] = (sec[r.sec] || 0) + 1; });
        const top = Object.keys(sec).map(k => [k, sec[k]]).sort((a, b) => b[1] - a[1])[0];
        if (top && top[1] / arr.length >= 0.28)
          facts.push("מבין <b>" + arr.length + "</b> המניות עם נר <b>" + _CM_BUCKET_HE[bk] + "</b> בטיימפריים " + _CM_TF_HE[tf] + " — <b>" + pc(top[1], arr.length) + "%</b> מסקטור <b>" + top[0] + "</b>.");
        const ind = {}; arr.forEach(r => { if (r.ind) ind[r.ind] = (ind[r.ind] || 0) + 1; });
        const ti = Object.keys(ind).map(k => [k, ind[k]]).sort((a, b) => b[1] - a[1])[0];
        if (ti && ti[1] >= 5 && ti[1] / arr.length >= 0.2)
          facts.push("<b>" + pc(ti[1], arr.length) + "%</b> מהמניות עם נר <b>" + _CM_BUCKET_HE[bk] + "</b> " + _CM_TF_HE[tf] + " הן בתת-סקטור <b>" + ti[0] + "</b>.");
      });
    });
    const dayG = rows.filter(r => (r.D || {}).c === "up").length;
    facts.push("היום <b>" + pc(dayG, rows.length) + "%</b> מהמניות בנר יומי ירוק — " + (dayG / rows.length >= 0.55 ? "הטיה שורית רחבה 🟢" : dayG / rows.length <= 0.45 ? "הטיה דובית 🔴" : "שוק מאוזן ⚖️") + ".");
    const secTot = {}, secG = {};
    rows.forEach(r => { if (r.sec) { secTot[r.sec] = (secTot[r.sec] || 0) + 1; if ((r.D || {}).c === "up") secG[r.sec] = (secG[r.sec] || 0) + 1; } });
    const secRank = Object.keys(secTot).filter(s => secTot[s] >= 6).map(s => [s, (secG[s] || 0) / secTot[s]]).sort((a, b) => b[1] - a[1]);
    if (secRank.length) {
      facts.push("הסקטור הכי שורי היום: <b>" + secRank[0][0] + "</b> (<b>" + Math.round(secRank[0][1] * 100) + "%</b> מהמניות בירוק).");
      const last = secRank[secRank.length - 1];
      facts.push("הסקטור הכי דובי היום: <b>" + last[0] + "</b> (רק <b>" + Math.round(last[1] * 100) + "%</b> בירוק).");
    }
    const ftfc = rows.filter(r => r.ftfc).length;
    if (ftfc) facts.push("<b>" + ftfc + "</b> מניות בהמשכיות-טיימפריימים מלאה (FTFC) — יישור חזק בין הזמנים.");
    ["W", "M"].forEach(tf => {
      const ins = rows.filter(r => (r[tf] || {}).t === "1").length;
      if (ins / rows.length >= 0.2) facts.push("<b>" + pc(ins, rows.length) + "%</b> מהמניות בנר <b>Inside</b> בטיימפריים " + _CM_TF_HE[tf] + " — התכווצות לפני תנועה.");
    });
    return facts;
  }
  function candleMapPanel() {
    const cols = ["D", "W", "M", "Q", "Y"];
    if (!(SCAN && SCAN.rows && SCAN.rows.length)) {
      return '<div class="panel"><h3>🗺️ Candle Map · התפלגות נרות</h3><div class="muted" style="padding:14px">טוען נתוני סורק…</div></div>';
    }
    const cmRows = cmapRows();
    const counts = {}; CMAP_ROWS.forEach(r => counts[r[0]] = { D: 0, W: 0, M: 0, Q: 0, Y: 0 });
    cmRows.forEach(row => cols.forEach(tf => { const b = candleBucket(row[tf]); if (counts[b]) counts[b][tf]++; }));
    const head = '<tr><th style="text-align:start">TYPE</th>' + cols.map(t => "<th>" + t + "</th>").join("") + "</tr>";
    const body = CMAP_ROWS.map(([key, desc, cls]) =>
      '<tr><td class="cm-type" title="' + desc + '">' + key + "</td>" +
      cols.map(tf => '<td><span class="cm-pill ' + cls + ' cm-click" data-cmb="' + key + '" data-cmtf="' + tf + '" title="' + desc + ' · לחץ לרשימת המניות">' + counts[key][tf] + "</span></td>").join("") + "</tr>").join("");
    _cmFacts = candleMapFacts();
    const firstFact = _cmFacts.length ? _cmFacts[Math.floor(Math.random() * _cmFacts.length)] : "";
    const insightBox = _cmFacts.length
      ? '<div class="cm-insight"><span class="cm-bulb">💡</span><span id="cmInsightText">' + firstFact + "</span></div>"
      : "";
    return '<div class="panel"><h3 class="cmap-head"><span>🗺️ Candle Map · התפלגות נרות לפי טיימפריים <span class="muted" style="font-size:12px">' + cmRows.length + ' מניות · לחץ על מספר לרשימה</span></span></h3>' +
      '<div class="tablewrap"><table class="cmap-table">' + head + body + "</table></div>" + insightBox + "</div>";
  }
  let cmDrill = { bucket: null, tfk: null, col: null, dir: -1 };
  function cmSortVal(r, col, tfk) {
    if (col === "sym") return r.s;
    if (col === "sec") return r.sec || "";
    if (col === "price") return r.p || 0;
    // candle color: green(up)=2, doji=1, red(down)=0 → descending puts green on top, then red
    if (col === "cndl") { const c = (r[tfk] || {}).c; return c === "up" ? 2 : (c === "down" ? 0 : 1); }
    return null;
  }
  function openCandleMapDrill(bucket, tfk) { cmDrill = { bucket, tfk, col: null, dir: -1 }; renderCmDrill(); }
  function renderCmDrill() {
    if (!(SCAN && SCAN.rows)) return;
    const bucket = cmDrill.bucket, tfk = cmDrill.tfk;
    let members = cmapRows().filter(r => candleBucket(r[tfk]) === bucket);
    const title = (CMAP_DESC[bucket] || bucket).split(" — ")[0];
    if (!members.length) { modal(bucket, '<div class="muted" style="padding:20px">אין מניות</div>'); return; }
    if (cmDrill.col) {
      members = members.slice().sort((a, b) => {
        const va = cmSortVal(a, cmDrill.col, tfk), vb = cmSortVal(b, cmDrill.col, tfk);
        if (typeof va === "string") return cmDrill.dir * va.localeCompare(vb);
        return cmDrill.dir * (va - vb);
      });
    } else {
      members = members.slice().sort((a, b) => a.s.localeCompare(b.s));
    }
    const th = (label, col, start) => {
      const arrow = cmDrill.col === col ? (cmDrill.dir < 0 ? " ▼" : " ▲") : "";
      return '<th class="sortable" data-cmsort="' + col + '" style="cursor:pointer;user-select:none' + (start ? ";text-align:start" : "") + '">' + label + arrow + "</th>";
    };
    const rows = members.map(r =>
      "<tr><td>" + star(r.s) + '</td><td class="sym"><span class="tsym clickable" data-chart="' + r.s + '" data-tf="D">' + r.s +
      '</span></td><td class="tname" style="text-align:start">' + (r.sec || "") + "</td><td>" + money(r.p || 0) + "</td><td>" + tf(r[tfk], r.s, tfk) + "</td></tr>").join("");
    const syms = members.map(r => r.s).join(", ");
    modal("🗺️ " + title + " · " + (TF_HE[tfk] || tfk) + " · " + members.length + " מניות",
      '<div class="drill-bar"><button class="btn ghost" id="cmapGrid" style="font-size:12px;font-weight:600">📊 תצוגת גרפים</button>' +
      '<button class="btn ghost" id="cmapCopy" style="font-size:12px;font-weight:600">📋 העתק ' + members.length + " טיקרים</button></div>" +
      '<div class="note" style="margin-bottom:8px">' + (CMAP_DESC[bucket] || "") + ' · לחץ על כל כותרת למיון (נר = 🟢 ירוק / 🔴 אדום)</div>' +
      '<div class="tablewrap"><table class="scan-table"><thead><tr><th></th>' + th("סימבול", "sym", true) + th("סקטור", "sec", true) + th("מחיר", "price") + th("נר " + tfk, "cndl") + "</tr></thead><tbody>" + rows + "</tbody></table></div>");
    const cp = $("#cmapCopy");
    if (cp) cp.onclick = () => { copyToClipboard(syms, () => { cp.textContent = "✓ הועתקו " + members.length; }); };
    const gb = $("#cmapGrid");
    if (gb) gb.onclick = () => openChartGrid(members.map(r => ({ sym: r.s, sector: r.sec, ind: r.ind, price: r.p || 0, chg: r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0) })), { title: title });
    document.querySelectorAll("[data-cmsort]").forEach(h => h.onclick = () => {
      const c = h.dataset.cmsort;
      if (cmDrill.col === c) cmDrill.dir *= -1; else { cmDrill.col = c; cmDrill.dir = c === "sym" ? 1 : -1; }
      renderCmDrill();
    });
  }
  // compact "what's happening now" pulse — market mode + session + index strip
  function marketPulse() {
    const ms = todayMarketState(), sess = (typeof newsSession === "function") ? newsSession() : "";
    if (!ms) return '<div class="panel mkt-pulse"><span class="mp-mode">📡 מה עולה עכשיו</span><span class="muted">התחבר לנתונים חיים</span></div>';
    const idx = ms.idx.map(i => '<span class="mp-idx"><b>' + i.sym + "</b> " + pctSpanBare(i.chg) + "</span>").join("");
    const vix = ms.vix ? '<span class="mp-idx"><b>VIX</b> ' + ms.vix.level.toFixed(1) + "</span>" : "";
    // breadth gauge — a mini bar, pushed to the far (left) end, opposite the mode label
    let breadth = "";
    if (ms.br && ms.br.total) {
      const ap = (ms.br.above / ms.br.total * 100);
      breadth = '<div class="mp-breadth clickable" id="pulseBreadth" title="רוחב שוק — לחץ לפירוט לפי סקטור">' +
        '<span class="mp-brlbl">רוחב שוק</span>' +
        '<span class="mp-brbar"><span class="mp-brup" style="width:' + ap.toFixed(1) + '%"></span></span>' +
        '<span class="mp-brnum"><span class="pos">' + ms.br.above + '</span>/<span class="neg">' + ms.br.below + "</span></span></div>";
    }
    return '<div class="panel mkt-pulse ' + ms.cls + '"><div class="mp-left"><span class="mp-mode">' + ms.emoji + " " + ms.mode + '</span><span class="mp-sess">' + sess + "</span></div>" +
      '<div class="mp-strip">' + idx + vix + "</div>" + breadth + "</div>";
  }
  // minutes since midnight in Israel time (works regardless of the viewer's own TZ)
  function _ilMinutes() {
    try {
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
      const hh = +p.find(x => x.type === "hour").value, mm = +p.find(x => x.type === "minute").value;
      return hh * 60 + mm;
    } catch (e) { return new Date().getHours() * 60 + new Date().getMinutes(); }
  }
  // Time-aware movers panel (Israel time). US↔IL is a constant 7h offset, so:
  //   16:30–23:00 → RTH gappers · 11:00–16:30 → pre-market (US pre-market 04:00–09:30 ET) ·
  //   23:00–11:00 (wraps past midnight) → after-market. The long after-market window keeps the
  //   last session's post-market movers on screen through the overnight dead zone (nothing new
  //   trades 03:00–11:00 IL), instead of showing an empty "pre-market" list.
  function gappersMini() {
    const mins = _ilMinutes();
    // movers panel ALWAYS uses the widest universe (full StratNinja, ~1415 stocks) so big
    // movers never get hidden by the S&P-500 filter — e.g. non-S&P names like IONS crashing.
    const U = (LIVE && LIVE.universes && LIVE.universes.all) || {};
    let head, data, upLbl, dnLbl, seeAll = "", note = "";
    if (mins >= 16 * 60 + 30 && mins < 23 * 60) {    // 16:30–23:00 IL → gappers (RTH)
      head = "⚡ גאפרים · פתיחת יום";
      data = U.gappers || (LIVE && LIVE.gappers) || { up: [], down: [] };
      upLbl = "🟢 TOP גאפ אפ"; dnLbl = "🔴 TOP גאפ דאון";
      seeAll = '<button class="btn ghost" id="gapAll" style="font-size:12px;font-weight:600">ראה הכל →</button>';
    } else if (mins >= 11 * 60 && mins < 16 * 60 + 30) {   // 11:00–16:30 IL → pre-market (US pre live)
      head = "🌅 PRE-MARKET MOVERS · תנועות לפני הפתיחה";
      data = U.premovers || (LIVE && LIVE.premovers) || { up: [], down: [] };
      upLbl = "🟢 עולות לפני פתיחת המסחר"; dnLbl = "🔴 יורדות לפני פתיחת המסחר";
      note = "מתעדכן ככל שנסחר יותר בפרה-מרקט";
    } else {                                         // 23:00–11:00 IL → after-market (post + overnight)
      head = "🌙 AFTER-MARKET MOVERS · תנועות אחרי הסגירה";
      data = U.aftermovers || (LIVE && LIVE.aftermovers) || { up: [], down: [] };
      upLbl = "🟢 עולות אחרי סגירת המסחר"; dnLbl = "🔴 יורדות אחרי סגירת המסחר";
      note = "תנועה ביחס למחיר הסגירה של היום";
    }
    const row = arr => arr.length ? arr.slice(0, 5).map(x =>
      '<div class="gm-row"><span class="tsym clickable" data-chart="' + x.s + '" data-tf="D">' + x.s + "</span>" + pct(x.gp) + "</div>").join("")
      : '<div class="muted" style="font-size:12px;padding:5px 2px">אין כרגע</div>';
    const sub = note ? '<div class="muted" style="font-size:11px;margin:-2px 0 6px">' + note + "</div>" : "";
    return '<div class="panel gappers-mini"><h3 class="gm-head"><span>' + head + "</span>" + seeAll + "</h3>" + sub +
      '<div class="gm-grid"><div><div class="td-h pos">' + upLbl + "</div>" + row(data.up) + '</div><div><div class="td-h neg">' + dnLbl + "</div>" + row(data.down) + "</div></div></div>";
  }
  function renderMarket() {
    const idxSrc = (LIVE && LIVE.indices && LIVE.indices.length) ? LIVE.indices : INDICES;
    const idxRows = idxSrc.map(r =>
      '<tr><td class="sym"><span class="tsym clickable" data-chart="' + r.sym + '" data-tf="D">' + r.sym + '</span> <span class="tname">' + r.name + "</span></td>" +
      '<td class="idx-chg">' + (r.chg != null ? pctSpanBare(r.chg) : '<span class="muted">—</span>') + extSpan(r) + "</td>" + tfCells(r) + "</tr>").join("");
    const dist = DIST.map(d => '<div class="tile"><div class="k"><span class="dot ' + d.dot + '"></span>' + d.k + '</div><div class="v">' + d.n + "</div></div>").join("");
    const breadth = BREADTH_IDX.map(b => '<div class="tile"><div class="k">' + b.sym + " · " + b.desc + '</div><div class="v muted">—</div></div>').join("");
    const rank = (arr, cls) => arr.map((s, i) => '<div class="lead-row ' + cls + '"><span>' + s + '</span><span class="rank">#' + (i + 1) + "</span></div>").join("");
    const vixVal = (LIVE && LIVE.vix)
      ? '<div class="v">' + LIVE.vix.level.toFixed(2) + '</div><div class="sub ' + (LIVE.vix.chg >= 0 ? "neg" : "pos") + '">' + (LIVE.vix.chg >= 0 ? "+" : "") + LIVE.vix.chg.toFixed(2) + "%</div>"
      : '<div class="v muted">—</div>';
    const idxPanel = '<div class="panel idx-panel"><h3>מדדים ראשיים</h3><div class="tablewrap"><table class="idx-table"><thead><tr><th style="text-align:start">סימבול</th><th>% יומי</th>' + tfHeadCols() + "</tr></thead><tbody>" + idxRows + "</tbody></table></div></div>";
    const vixCard = '<div class="panel vix-card"><div class="vix-lbl">VIX · מדד הפחד</div>' + vixVal + "</div>";
    const uniSwitch = '<div class="uni-switch" title="החלף בין עולם המניות של StratNinja ל-S&P 500">' +
      '<span class="uni-lbl">עולם המניות:</span>' +
      '<button class="uni-btn' + (marketUniverse === "sp500" ? " on" : "") + '" data-uni="sp500">S&P 500</button>' +
      '<button class="uni-btn' + (marketUniverse === "all" ? " on" : "") + '" data-uni="all">StratNinja</button>' +
      "</div>";
    return (
      '<div class="page-head compact"><h1>סקירת שוק <span class="mkt-live">' + (LIVE && LIVE.updated ? "🟢 חי" : "🧪 דמו") + '</span></h1><div class="sub">תמונת השוק במבט אחד: לאן נעים המדדים, מצב הפחד (VIX), רוחב השוק ואילו סקטורים חזקים או חלשים היום.</div></div>' +
      uniSwitch +
      '<div class="mkt-dash mkt-dash-tight' + (_mktFlip ? " uni-flip" : "") + '">' +
        marketPulse() +
        '<div class="mkt-dash-top">' +
          '<div class="mkt-dash-left">' +
            '<div class="mkt-idx-row">' + idxPanel + vixCard + "</div>" +
          "</div>" +
          '<div class="mkt-dash-right">' + candleMapPanel() + "</div>" +
        "</div>" +
        '<div class="mkt-sec-title">מובילים ומפגרים היום</div>' +
        '<div class="mkt-dash-bottom">' +
          '<div class="panel"><h3>🟢 סקטורים מובילים</h3>' + (LIVE ? mkLead((mktU().sectorLeaders || []).slice(0, 5), "up", true) : rank(["חומרי גלם", "תקשורת", "אנרגיה"], "up")) + "</div>" +
          '<div class="panel"><h3>🔴 סקטורים בפיגור</h3>' + (LIVE ? mkLead((mktU().sectorLaggards || []).slice(0, 5), "down", true) : rank(["מוצרי צריכה", "בריאות", "שירותים"], "down")) + "</div>" +
          '<div class="panel"><h3>🟢 מניות מובילות</h3>' + (LIVE ? mkLead((mktU().leaders || []).slice(0, 5), "up", false) : rank(["SMCI", "PLTR", "MARA"], "up")) + "</div>" +
          '<div class="panel"><h3>🔴 מניות בפיגור</h3>' + (LIVE ? mkLead((mktU().laggards || []).slice(0, 5), "down", false) : rank(["SNAP", "LCID", "NIO"], "down")) + "</div>" +
        "</div>" +
        gappersMini() +
      "</div>"
    );
  }
  function wireMarket() {
    const bb = $("#breadthBar"); if (bb) bb.onclick = () => setPage("sp500");
    { const pb = $("#pulseBreadth"); if (pb) pb.onclick = () => setPage("sp500"); }
    { const ga = $("#gapAll"); if (ga) ga.onclick = () => setPage("gappers"); }
    document.querySelectorAll("[data-cmb]").forEach(el => el.onclick = () => openCandleMapDrill(el.dataset.cmb, el.dataset.cmtf));
    document.querySelectorAll("[data-uni]").forEach(el => el.onclick = () => {
      if (marketUniverse === el.dataset.uni) return;
      marketUniverse = el.dataset.uni; _mktFlip = true; reRender();
    });
    _mktFlip = false;   // one-shot: the flip animation only plays on the switch render
    // rotating "did you know" Candle Map insight
    if (_cmTimer) { clearInterval(_cmTimer); _cmTimer = null; }
    if (_cmFacts && _cmFacts.length > 1) {
      let idx = _cmFacts.indexOf((document.getElementById("cmInsightText") || {}).innerHTML);
      _cmTimer = setInterval(() => {
        const el = document.getElementById("cmInsightText");
        if (!el) { clearInterval(_cmTimer); _cmTimer = null; return; }
        idx = (idx + 1) % _cmFacts.length;
        el.style.opacity = "0";
        setTimeout(() => { el.innerHTML = _cmFacts[idx]; el.style.opacity = "1"; }, 250);
      }, 10000);
    }
  }

  // ========== S&P 500 BREADTH ==========
  // color a tile by daily % move: neutral → green (up) / red (down); darker = stronger move
  function chgColor(c) {
    const m = Math.max(-3, Math.min(3, c == null ? 0 : c)) / 3; // -1..1
    const N = [40, 46, 58], G = [20, 168, 110], R = [222, 55, 55];
    const tgt = m >= 0 ? G : R, t = Math.abs(m);
    return "rgb(" + Math.round(N[0] + (tgt[0] - N[0]) * t) + "," + Math.round(N[1] + (tgt[1] - N[1]) * t) + "," + Math.round(N[2] + (tgt[2] - N[2]) * t) + ")";
  }
  // squarified treemap (Bruls et al.) — lays out items by .value inside rect [X,Y,W,H]; returns [{item,x,y,w,h}]
  function _worst(areas, side) {
    let sum = 0, mn = Infinity, mx = 0;
    for (const a of areas) { sum += a; if (a < mn) mn = a; if (a > mx) mx = a; }
    if (sum <= 0) return Infinity;
    const s2 = side * side, sum2 = sum * sum;
    return Math.max(s2 * mx / sum2, sum2 / (s2 * mn));
  }
  function squarify(items, X, Y, W, H) {
    const data = items.filter(d => d.value > 0).slice().sort((a, b) => b.value - a.value);
    const out = [];
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total <= 0 || W <= 0 || H <= 0) return out;
    const scale = (W * H) / total;
    const areas = data.map(d => d.value * scale);
    let x = X, y = Y, w = W, h = H, i = 0;
    while (i < areas.length) {
      const side = Math.min(w, h);
      let row = [areas[i]], j = i + 1;
      while (j < areas.length && _worst(row.concat(areas[j]), side) <= _worst(row, side)) { row.push(areas[j]); j++; }
      const rowSum = row.reduce((a, b) => a + b, 0), thick = rowSum / side;
      if (w >= h) { let py = y; for (let k = i; k < j; k++) { const len = areas[k] / thick; out.push({ item: data[k], x: x, y: py, w: thick, h: len }); py += len; } x += thick; w -= thick; }
      else { let px = x; for (let k = i; k < j; k++) { const len = areas[k] / thick; out.push({ item: data[k], x: px, y: y, w: len, h: thick }); px += len; } y += thick; h -= thick; }
      i = j;
    }
    return out;
  }
  // rotating "did you know?" facts for the market map — sector + sub-sector breadth insights
  let _spFacts = [], _spTimer = null;
  function sp500Facts() {
    const secs = (LIVE && LIVE.sectors) ? LIVE.sectors : null;
    if (!secs || !secs.length) return [];
    const b = LIVE.breadth, facts = [];
    const pc = (a, t) => t ? Math.round(a / t * 100) : 0;
    if (b && b.total) facts.push("🟢 <b>" + b.above + "</b> מתוך " + b.total + " מניות מעל מחיר הפתיחה (<b>" + pc(b.above, b.total) + "%</b> מהשוק).");
    const big = secs.filter(s => s.total >= 10).slice().sort((x, y) => pc(y.above, y.total) - pc(x.above, x.total));
    if (big[0]) facts.push("הסקטור הכי <b>חזק</b> היום: <b>" + secHe(big[0].name) + "</b> — " + pc(big[0].above, big[0].total) + "% מעל הפתיחה (" + big[0].above + "/" + big[0].total + ").");
    if (big.length > 1) { const w = big[big.length - 1]; facts.push("הסקטור הכי <b>חלש</b> היום: <b>" + secHe(w.name) + "</b> — רק " + pc(w.above, w.total) + "% מעל הפתיחה."); }
    const totAbove = secs.reduce((a, s) => a + s.above, 0);
    const topGreen = secs.slice().sort((x, y) => y.above - x.above)[0];
    if (topGreen && totAbove) facts.push("<b>" + Math.round(topGreen.above / totAbove * 100) + "%</b> מכלל המניות שמעל הפתיחה הן מסקטור <b>" + secHe(topGreen.name) + "</b> (" + topGreen.above + " מניות).");
    // sub-sector (industry) breadth
    const byInd = {};
    secs.forEach(s => (s.stocks || []).forEach(x => { const k = (x.ind || "").trim(); if (!k) return; const o = byInd[k] || (byInd[k] = { a: 0, t: 0, sec: s.name }); o.t++; if (x.ao) o.a++; }));
    const inds = Object.keys(byInd).map(k => ({ ind: k, a: byInd[k].a, t: byInd[k].t, sec: byInd[k].sec })).filter(o => o.t >= 6);
    if (inds.length) {
      const strong = inds.slice().sort((x, y) => (y.a / y.t) - (x.a / x.t))[0];
      facts.push("<b>" + strong.a + "</b> מניות מתת-סקטור <b>" + strong.ind + "</b> (" + secHe(strong.sec) + ") מעל מחיר הפתיחה — <b>" + pc(strong.a, strong.t) + "%</b> מהתת-סקטור.");
      const weak = inds.slice().sort((x, y) => (x.a / x.t) - (y.a / y.t))[0];
      if (weak && weak.ind !== strong.ind) facts.push("תת-סקטור <b>" + weak.ind + "</b> חלש היום — רק " + pc(weak.a, weak.t) + "% מעל הפתיחה.");
    }
    // mega-cap breadth
    const all = []; secs.forEach(s => (s.stocks || []).forEach(x => { if (x.mc) all.push(x); }));
    const mega = all.sort((x, y) => y.mc - x.mc).slice(0, 12);
    if (mega.length >= 6) facts.push("מבין <b>12 החברות הגדולות</b> בשוק, <b>" + mega.filter(x => x.ao).length + "</b> מעל מחיר הפתיחה.");
    return facts;
  }
  function renderSp500() {
    const secs = (LIVE && LIVE.sectors) ? LIVE.sectors : null;
    if (!secs || !secs.length) {
      return '<div class="page-head"><h1>S&P 500 · מפת שוק</h1><div class="sub">מפת חום של המדד: כל ריבוע = מניה, הגודל = שווי השוק, הצבע = התנועה היום. מבט מהיר על מי מוביל ומי נופל.</div></div>' +
        '<div class="panel"><div class="stub"><div class="big">🗺️</div><h2>ממתין לנתוני מסחר</h2><p>המפה מחושבת בשעות המסחר (מעל/מתחת לפתיחת היום). חזור כשהשוק פתוח.</p></div></div>';
    }
    const b = LIVE.breadth;
    _spFacts = sp500Facts();
    const firstFact = _spFacts.length ? _spFacts[Math.floor(Math.random() * _spFacts.length)] : "";
    const insightBox = _spFacts.length ? '<div class="cm-insight"><span class="cm-bulb">💡</span><span id="spInsightText">' + firstFact + "</span></div>" : "";
    const mvChip = x => {
      const cs = (x.c >= 0 ? "+" : "") + (x.c == null ? 0 : x.c).toFixed(1) + "%";
      return '<span class="mv-chip clickable" data-chart="' + x.s + '" data-tf="D" title="' + x.s + " " + cs + '" style="background:' + chgColor(x.c) + '">' + x.s + " <b>" + cs + "</b></span>";
    };
    const spCard = s => {
      const ap = s.above / (s.total || 1) * 100;
      const st = s.stocks.slice().sort((x, y) => (y.c == null ? 0 : y.c) - (x.c == null ? 0 : x.c));
      const gain = st.slice(0, 4), lose = st.slice(-4).reverse();
      return '<div class="panel sector-card sp-card" data-spdrill="' + encodeURIComponent(s.name) + '">' +
        "<h3>" + secHe(s.name) + " " + etfChip(etfFor(s.name)) + ' <span class="muted" style="font-size:12px">' + s.above + "/" + s.total + " · " + ap.toFixed(0) + "% · " + pctSpanBare(s.chg) + "</span></h3>" +
        '<div class="bigbreadth sm"><span class="bseg up" style="width:' + ap.toFixed(1) + '%"></span><span class="bseg down" style="width:' + (100 - ap).toFixed(1) + '%"></span></div>' +
        '<div class="mv-row"><span class="mv-lbl">🟢 מובילים</span>' + gain.map(mvChip).join("") + "</div>" +
        '<div class="mv-row"><span class="mv-lbl">🔴 חלשים</span>' + lose.map(mvChip).join("") + "</div>" +
        '<div class="mv-more">' + s.total + " מניות · לחץ להצגת כולן ←</div></div>";
    };
    // split sectors into 3 columns by breadth (% above open): BULL (right) · neutral · BEAR (left)
    const withAp = secs.map(s => ({ s, ap: s.above / (s.total || 1) * 100 }));
    const spBull = withAp.filter(o => o.ap >= 55).sort((a, c) => c.ap - a.ap);
    const spMid = withAp.filter(o => o.ap >= 45 && o.ap < 55).sort((a, c) => c.ap - a.ap);
    const spBear = withAp.filter(o => o.ap < 45).sort((a, c) => a.ap - c.ap);
    const spColHtml = (title, cls, arr) => '<div class="ss-col ' + cls + '"><div class="ss-col-h">' + title + ' <span class="muted">' + arr.length + "</span></div>" +
      (arr.length ? arr.map(o => spCard(o.s)).join("") : '<div class="muted" style="padding:12px;font-size:12px;text-align:center">אין כרגע</div>') + "</div>";
    return '<div class="page-head"><h1>S&P 500 · רוחב שוק לפי סקטור</h1><div class="sub">🟢 ' + b.above + " מעל פתיחה · 🔴 " + b.below + ' מתחת · מחולק ל-3 לפי רוחב: <b>BULL</b> (55%+ מעל פתיחה) · <b>בין לבין</b> · <b>BEAR</b> (מתחת 45%). לחץ על סקטור לכל המניות.</div></div>' +
      insightBox + liveBanner() + '<div class="subsec-3col sp-3col">' + spColHtml("🟢 BULL", "ss-bull", spBull) + spColHtml("⚪ בין לבין", "ss-mid", spMid) + spColHtml("🔴 BEAR", "ss-bear", spBear) + "</div>";
  }
  let spDrillSort = { col: "c", dir: -1 };
  function spDrillVal(x, col) {
    if (col === "sym") return x.s;
    if (col === "ao") return x.ao ? 1 : 0;
    if (col === "c") return x.c == null ? -999 : x.c;
    if (col === "mc") return x.mc || 0;
    return 0;
  }
  function renderSp500Drill(secName) {
    const s = ((LIVE && LIVE.sectors) || []).find(x => x.name === secName);
    if (!s) return;
    const col = spDrillSort.col, dir = spDrillSort.dir;
    const st = s.stocks.slice().sort((a, b) => {
      const va = spDrillVal(a, col), vb = spDrillVal(b, col);
      if (typeof va === "string") return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
    const th = (label, c, start) => { const arrow = spDrillSort.col === c ? (spDrillSort.dir < 0 ? " ▼" : " ▲") : ""; return '<th class="sortable" data-spsort="' + c + '" style="cursor:pointer;user-select:none' + (start ? ";text-align:start" : "") + '">' + label + arrow + "</th>"; };
    const rows = st.map(x => {
      const cs = (x.c >= 0 ? "+" : "") + (x.c == null ? 0 : x.c).toFixed(2) + "%";
      return "<tr><td class='sym'><span class='tsym clickable' data-chart='" + x.s + "' data-tf='D'>" + x.s + "</span>" + (x.ind ? ' <span class="tname">' + x.ind + "</span>" : "") + "</td><td>" + (x.ao ? "🟢" : "🔴") + "</td><td class='" + (x.c > 0 ? "pos" : x.c < 0 ? "neg" : "") + "'>" + cs + "</td><td>" + fmtCap(x.mc) + "</td></tr>";
    }).join("");
    const ap = s.above / (s.total || 1) * 100;
    const syms = st.map(x => x.s).join(", ");
    modal(secHe(s.name) + " · " + s.above + "/" + s.total + " מעל פתיחה (" + ap.toFixed(0) + "%)",
      '<div class="drill-bar"><button class="btn ghost" id="spGrid" style="font-size:12px;font-weight:600">📊 תצוגת גרפים</button>' +
      '<button class="btn ghost" id="spCopy" style="font-size:12px;font-weight:600">📋 העתק ' + st.length + " טיקרים</button><span class=\"muted\" style=\"font-size:12px\">לחץ על כותרת למיון</span></div>" +
      "<div class='tablewrap'><table class='scan-table'><thead><tr>" + th("סימבול", "sym", true) + th("מעל פתיחה", "ao") + th("תנועה", "c") + th("שווי", "mc") + "</tr></thead><tbody>" + rows + "</tbody></table></div>");
    document.querySelectorAll("[data-spsort]").forEach(h => h.onclick = () => {
      const c = h.dataset.spsort;
      if (spDrillSort.col === c) spDrillSort.dir *= -1; else { spDrillSort.col = c; spDrillSort.dir = c === "sym" ? 1 : -1; }
      renderSp500Drill(secName);
    });
    const cp = $("#spCopy");
    if (cp) cp.onclick = () => copyToClipboard(syms, () => { cp.textContent = "✓ הועתקו " + st.length; setTimeout(() => cp.textContent = "📋 העתק " + st.length + " טיקרים", 1600); });
    const gb = $("#spGrid");
    if (gb) gb.onclick = () => openChartGrid(st.map(x => {
      const r = (SCAN && SCAN.rows) ? SCAN.rows.find(rr => rr.s === x.s) : null;
      return { sym: x.s, sector: secName, ind: x.ind, price: r ? (r.p || 0) : 0, chg: x.c };
    }), { title: secHe(s.name) });
  }
  function wireSp500() {
    wireCharts(document);
    document.querySelectorAll("[data-spdrill]").forEach(c => c.onclick = () => renderSp500Drill(decodeURIComponent(c.dataset.spdrill)));
    if (_spTimer) { clearInterval(_spTimer); _spTimer = null; }
    if (_spFacts && _spFacts.length > 1) {
      let idx = _spFacts.indexOf((document.getElementById("spInsightText") || {}).innerHTML);
      _spTimer = setInterval(() => {
        const el = document.getElementById("spInsightText");
        if (!el) { clearInterval(_spTimer); _spTimer = null; return; }
        idx = (idx + 1) % _spFacts.length;
        el.style.opacity = "0";
        setTimeout(() => { el.innerHTML = _spFacts[idx]; el.style.opacity = "1"; }, 250);
      }, 10000);
    }
  }
  function pctSpanBare(v) { v = v == null ? 0 : v; return '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function extSpan(r) {
    if (r == null || r.ext == null || r.extChg == null) return "";
    const lbl = r.extType === "pre" ? "Pre" : "After";
    const s = (r.extChg >= 0 ? "+" : "") + r.extChg.toFixed(2) + "%";
    return ' <span class="ext-hours" title="מסחר מוקדם/מאוחר (' + (r.extType === "pre" ? "לפני פתיחה" : "אחרי סגירה") + ') — לא הסגירה הרשמית">(' + lbl + " " + money(r.ext) + " · " + s + ")</span>";
  }
  function colorLegend() {
    return '<div class="muted" style="font-size:11px;margin-top:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">' +
      '<span><b>צבע</b> = כיוון הנר: 🟢 סגירה מעל הפתיחה · 🔴 סגירה מתחת</span>' +
      '<span><b>ספרה</b> = סוג נר לפי Strat —</span>' +
      '<span>' + tf(cell("1", "doji")) + ' נר פנימי (Inside · לא פרץ את השיא/שפל של הנר הקודם)</span>' +
      '<span>' + tf(cell("2U", "up")) + ' שיא חדש בלבד</span>' +
      '<span>' + tf(cell("2D", "down")) + ' שפל חדש בלבד</span>' +
      '<span>' + tf(cell("3", "up")) + ' נר חיצוני (Outside · פרץ גם שיא וגם שפל)</span>' +
    "</div>";
  }

  // ========== SCANNER ==========
  // expanded Strat timeframes the user can add via ➕ (computed on the server, TheStrat-agnostic)
  const EXTRA_TFS = ["2D", "3D", "5D", "2W", "3W", "6W", "2M", "4M", "6M"];
  const scanState = { tfs: ["D"], tfsExtra: [], patterns: [], dir: "all", shape: "all", broad: "off", inforce: false, sector: "all", subsec: "all", universe: "all", sym: "", ftfc: false, priceMin: "", priceMax: "", cap: "all", mtfOpen: false, indOpen: false, mtf: newMtf() };
  let _selPreset = "";   // id of the saved-scan currently chosen in the dropdown (survives reRender so delete/duplicate work)
  // optional result columns the user can add/remove. key undefined = never touched (a filter may auto-add it);
  // true/false = explicit user choice (so removal always sticks, even for filter columns).
  const colState = {};
  // multi-timeframe per-TF conditions: {D:{t,c}, W:{t,c}, ...}  (t = bar type "1/2U/2D/3", c = color "up/down", "" = any)
  const MTF_TFS = ["D", "W", "M", "Q", "Y"];
  const MTF_TF_HE = { D: "יומי", W: "שבועי", M: "חודשי", Q: "רבעוני", Y: "שנתי" };
  function newMtf() { const o = {}; ["D", "W", "M", "Q", "Y"].forEach(function (k) { o[k] = { t: "", c: "" }; }); return o; }
  function mtfActiveCount() { let n = 0; MTF_TFS.forEach(function (k) { if (scanState.mtf[k].t || scanState.mtf[k].c) n++; }); return n; }
  // ---- scanner panel visibility (declutter): hide whole filter areas per trader ----
  const SCAN_PANELS = [{ k: "filters", t: "Strat" }, { k: "mtf", t: "MTF" }, { k: "tech", t: "טכני" }, { k: "ind", t: "אינדיקטורים" }];
  function panelVis() {
    const def = { filters: true, mtf: true, tech: true, ind: true };
    const saved = (window.Prefs && window.Prefs.scanPanels) ? window.Prefs.scanPanels() : null;
    return saved ? Object.assign(def, saved) : def;
  }
  function togglePanel(k) {
    const v = panelVis(); v[k] = !v[k];
    if (window.Prefs && window.Prefs.setScanPanels) window.Prefs.setScanPanels(v);
    reRender();
  }
  // ---- scan presets ("must-have scans"): snapshot + restore the full filter config ----
  function scanConfigSnapshot() {
    const s = scanState;
    return {
      s: { tfs: s.tfs.slice(), tfsExtra: s.tfsExtra.slice(), patterns: s.patterns.slice(), dir: s.dir, shape: s.shape, broad: s.broad, inforce: s.inforce,
        sector: s.sector, subsec: s.subsec, sym: s.sym, ftfc: s.ftfc, priceMin: s.priceMin, priceMax: s.priceMax,
        cap: s.cap, mtf: JSON.parse(JSON.stringify(s.mtf)) },
      t: Object.assign({}, techState),
    };
  }
  function applyScanConfig(cfg) {
    if (!cfg) return;
    const s = cfg.s || {}, t = cfg.t || {};
    ["dir", "shape", "broad", "inforce", "sector", "subsec", "sym", "ftfc", "priceMin", "priceMax", "cap"].forEach(k => { if (s[k] !== undefined) scanState[k] = s[k]; });
    if (s.tfs) scanState.tfs = s.tfs.slice();
    scanState.tfsExtra = s.tfsExtra ? s.tfsExtra.slice() : [];
    if (s.patterns) scanState.patterns = s.patterns.slice();
    scanState.mtf = s.mtf ? JSON.parse(JSON.stringify(s.mtf)) : newMtf();
    Object.keys(techState).forEach(k => { if (k === "techOpen") return; if (t[k] !== undefined) techState[k] = t[k]; });
  }

  // ---- preset × favorites ALERTS (client-side; reuses the real filter, no server duplication) ----
  function evalPreset(preset) {
    if (!preset || !preset.cfg) return [];
    const snapS = JSON.parse(JSON.stringify(scanState)), snapT = JSON.parse(JSON.stringify(techState));
    let syms = [];
    try { applyScanConfig(preset.cfg); syms = filterRows(scanSource()).map(t => t.sym); } catch (e) { syms = []; }
    Object.keys(snapS).forEach(k => { scanState[k] = snapS[k]; });
    Object.keys(snapT).forEach(k => { techState[k] = snapT[k]; });
    return syms;
  }
  function requestNotifyPerm() { try { if (window.Notification && Notification.permission === "default") Notification.requestPermission(); } catch (e) {} }
  function snToast(msg) {
    const t = document.createElement("div"); t.className = "sn-toast"; t.innerHTML = "🔔 " + msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 4500);
  }
  // ── market open/close chime + banner (16:30 open / 23:00 close, Israel time) ──
  let _audioCtx = null;
  function _primeAudio() {                   // called on first user gesture so the bell can play later
    try { _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (_audioCtx.state === "suspended") _audioCtx.resume(); } catch (e) {}
  }
  function _bellSound(kind) {                 // soft synthesized bell melody (not loud/startling)
    try {
      _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === "suspended") _audioCtx.resume();
      const ctx = _audioCtx, now = ctx.currentTime;
      // open = ASCENDING opening bell · close = DESCENDING closing bell (clearly distinct)
      const notes = kind === "open" ? [523.25, 659.25, 783.99, 1046.5]
                                    : [1046.5, 783.99, 659.25, 523.25];
      const step = 0.34;
      const ring = (f, t0, peak, dur) => {     // fundamental + soft octave = bell-like timbre
        [[1, peak], [2, peak * 0.32]].forEach(([h, pk]) => {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "sine"; o.frequency.value = f * h;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(pk, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
          o.connect(g); g.connect(ctx.destination);
          o.start(t0); o.stop(t0 + dur + 0.1);
        });
      };
      notes.forEach((f, i) => ring(f, now + i * step, 0.16, 1.4));
      // final sustained chime rounds it off (a bit longer, ~3.3s total)
      ring(kind === "open" ? 1046.5 : 523.25, now + notes.length * step, 0.15, 2.0);
    } catch (e) {}
  }
  function _marketBellBanner(kind) {
    const open = kind === "open";
    const el = document.createElement("div");
    el.className = "mkt-bell " + (open ? "open" : "close");
    el.innerHTML = '<span class="mb-ico">🔔</span><div class="mb-txt"><b>' +
      (open ? "המסחר נפתח! 🟢" : "המסחר נסגר 🔴") + "</b><span>" +
      (open ? "וול סטריט פתוחה — בהצלחה!" : "נתראה מחר · אפטר-מרקט פעיל") + "</span></div>";
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    const kill = () => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); };
    el.onclick = kill; setTimeout(kill, 9000);
  }
  function _ilParts() {                       // {dow, date} in Israel time, viewer-TZ independent
    try {
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const g = t => (p.find(x => x.type === t) || {}).value;
      return { dow: g("weekday"), date: g("year") + "-" + g("month") + "-" + g("day") };
    } catch (e) { const d = new Date(); return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()], date: d.toISOString().slice(0, 10) }; }
  }
  function _marketBell(kind, dateStr) {        // fire once per day per event (localStorage-deduped)
    const key = "sn_bell_" + dateStr + "_" + kind;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch (e) {}
    _bellSound(kind); _marketBellBanner(kind);
  }
  function _marketBellTick() {
    const ip = _ilParts();
    if (["Sat", "Sun"].indexOf(ip.dow) >= 0) return;         // US market weekdays only
    const mins = _ilMinutes();
    // 15-minute catch window (deduped once/day) so a backgrounded/throttled tab or a slightly
    // late page-open still rings — instead of a strict 3-minute window that's easy to miss.
    if (mins >= 16 * 60 + 30 && mins < 16 * 60 + 45) _marketBell("open", ip.date);
    else if (mins >= 23 * 60 && mins < 23 * 60 + 15) _marketBell("close", ip.date);
  }
  function fireNotification(e) {
    const body = e.sym + ' נכנסה לסריקה "' + e.preset + '"';
    try {
      if (window.Notification && Notification.permission === "granted") {
        // prefer the service worker (shows on the phone even when the app is backgrounded)
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification("🔔 התראת StratNinja",
            { body: body, icon: "favicon.svg", badge: "favicon.svg", tag: e.pid + e.sym, dir: "rtl", data: { url: "/" } })).catch(() => {});
        } else {
          const n = new Notification("🔔 התראת StratNinja", { body: body, icon: "favicon.svg", tag: e.pid + e.sym });
          n.onclick = () => { try { window.focus(); } catch (x) {} openAlertsFeed(); n.close(); };
        }
      }
    } catch (x) {}
  }
  // prominent on-screen alert — can't be missed
  function showAlertBanner(fresh) {
    const box = document.createElement("div");
    box.className = "alert-pop";
    box.innerHTML = '<div class="ap-head"><span>🔔 התראה חדשה!</span><button class="ap-x" aria-label="סגור">✕</button></div>' +
      '<div class="ap-body">' + fresh.map(e =>
        '<div class="ap-row"><span class="ap-sym">' + escAttr(e.sym) + "</span>נכנסה לסריקה <b>" + escAttr(e.preset) + "</b>" +
        ' <a class="ap-link" href="https://www.tradingview.com/chart/?symbol=' + escAttr(e.sym) + '" target="_blank" rel="noopener">📈 גרף</a></div>').join("") +
      "</div>";
    document.body.appendChild(box);
    requestAnimationFrame(() => box.classList.add("show"));
    const close = () => { box.classList.remove("show"); setTimeout(() => box.remove(), 300); };
    const x = box.querySelector(".ap-x"); if (x) x.onclick = close;
    setTimeout(close, 15000);
  }
  // alert-style preference: "both" (default) | "visual" (silent) | "sound"
  function _alertStyle() { try { return localStorage.getItem("sn_alert_style") || "both"; } catch (e) { return "both"; } }
  function _setAlertStyle(v) { try { localStorage.setItem("sn_alert_style", v); } catch (e) {} }
  // bright rising 3-note chime for a stock alert (distinct from the market open/close bell)
  function _alertChime() {
    try {
      _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === "suspended") _audioCtx.resume();
      const ctx = _audioCtx, now = ctx.currentTime;
      [880, 1108.73, 1318.51].forEach((f, i) => {           // A5 · C#6 · E6
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const t0 = now + i * 0.13;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.5);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0); o.stop(t0 + 0.55);
      });
    } catch (e) {}
  }
  function _fireAlert(fresh) {                               // visual + sound per the user's style
    const style = _alertStyle();
    fresh.forEach(fireNotification);                        // system notification (also wakes a backgrounded tab)
    if (style !== "sound") showAlertBanner(fresh);          // on-screen banner (both / visual)
    if (style !== "visual") _alertChime();                  // chime (both / sound)
  }
  function checkPresetAlerts() {
    if (!window.Prefs || !(SCAN && SCAN.rows && SCAN.rows.length)) return;
    const presets = (Prefs.scanPresets() || []).filter(p => p.alert);
    const favs = Prefs.favorites();
    if (!presets.length || !favs.length) return;
    const today = new Date().toISOString().slice(0, 10), fresh = [];
    presets.forEach(p => {
      const matched = evalPreset(p);
      matched.filter(s => favs.indexOf(s) >= 0).forEach(sym => {
        if (Prefs.feedHas(p.id, sym, today)) return;
        const entry = { pid: p.id, preset: p.name, sym: sym, ts: Date.now(), date: today, read: false };
        Prefs.feedAdd(entry); fresh.push(entry);
      });
    });
    if (fresh.length) { _fireAlert(fresh); updateAlertBell(); }
  }
  window._snTestAlert = () => _fireAlert([{ sym: "TSLA", preset: "בדיקה", pid: "x" }]);
  function updateAlertBell() {
    const n = window.Prefs ? Prefs.feedUnread() : 0;
    [document.getElementById("alBadge"), document.getElementById("alBadgeSide")].forEach(b => {
      if (b) { b.textContent = n ? n : ""; b.style.display = n ? "inline-flex" : "none"; }
    });
  }
  function openAlertsFeed() {
    if (!window.Prefs) return;
    Prefs.feedMarkRead(); updateAlertBell();
    const presets = Prefs.scanPresets() || [], feed = Prefs.alertFeed();
    const permTxt = (window.Notification && Notification.permission === "granted")
      ? '<span class="pos">✓ התראות דפדפן פעילות</span>'
      : '<button class="btn ghost" id="alNotifyPerm" style="font-size:12px">הפעל התראות דפדפן</button>';
    const plist = presets.length ? presets.map(p =>
      '<div class="al-prow"><span>' + escAttr(p.name) + '</span><label class="ios-switch"><input type="checkbox" data-alp="' + escAttr(p.id) + '"' + (p.alert ? " checked" : "") + '><span class="ios-slider"></span></label></div>').join("")
      : '<div class="muted">אין עדיין סריקות שמורות. שמור פריסט בסורק העסקאות כדי להפעיל עליו התראה.</div>';
    const flist = feed.length ? feed.slice(0, 50).map(e =>
      '<div class="al-frow"><span class="tsym clickable" data-chart="' + escAttr(e.sym) + '" data-tf="D">' + e.sym + '</span><span class="muted">נכנסה ל־"' + escAttr(e.preset) + '"</span><span class="muted al-time">' + new Date(e.ts).toLocaleString("he-IL") + "</span></div>").join("")
      : '<div class="muted">עוד לא נורו התראות. כשמניה מהמועדפים תיכנס לסריקה מסומנת — היא תופיע כאן.</div>';
    const pushOn = !!(window.Prefs && Prefs.pushSubs().length);
    const pushBtn = pushOn ? '<span class="pos" style="font-weight:600">✓ התראות פלאפון פעילות</span>'
      : '<button class="btn primary" id="alPushSub" style="font-size:12px">📱 הפעל התראות לפלאפון</button>';
    const body =
      '<div class="note" style="margin-bottom:8px">🔔 קבל התראה כשמניה <b>מהמועדפים</b> שלך נכנסת לסריקה שמורה. ' + permTxt + "</div>" +
      '<div class="note" style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' + pushBtn +
        '<span style="font-size:11px;color:var(--muted)">📱 בפלאפון: הוסף קודם למסך הבית (שיתוף → הוסף למסך הבית), ואז תקבל התראות גם כשהאפליקציה סגורה לגמרי.</span></div>' +
      '<div class="note" style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<span style="font-size:12px;font-weight:600">🔔 צלצול פתיחה/סגירת מסחר:</span>' +
        '<button class="btn ghost" id="alBellOpen" style="font-size:12px">בדוק פתיחה 🟢</button>' +
        '<button class="btn ghost" id="alBellClose" style="font-size:12px">בדוק סגירה 🔴</button>' +
        '<span style="font-size:11px;color:var(--muted)">מנוגן אוטומטית ב-16:30 ו-23:00 (שעון ישראל)</span></div>' +
      '<div class="note" style="margin-bottom:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<span style="font-size:12px;font-weight:600">📣 התראת מניה:</span>' +
        '<button class="btn ghost al-style' + (_alertStyle() === "both" ? " on" : "") + '" data-style="both" style="font-size:12px">🔔👁️ צליל + ויזואלי</button>' +
        '<button class="btn ghost al-style' + (_alertStyle() === "visual" ? " on" : "") + '" data-style="visual" style="font-size:12px">👁️ ויזואלי (שקט)</button>' +
        '<button class="btn ghost al-style' + (_alertStyle() === "sound" ? " on" : "") + '" data-style="sound" style="font-size:12px">🔔 צליל בלבד</button>' +
        '<button class="btn ghost" id="alTestAlert" style="font-size:12px;font-weight:600">🧪 בדוק התראה</button></div>' +
      '<h3 style="margin:12px 0 6px;font-size:14px">הסריקות שלי · הפעל/כבה התראה</h3><div class="al-plist">' + plist + "</div>" +
      '<h3 style="margin:16px 0 6px;font-size:14px">התראות אחרונות ' + (feed.length ? '<button class="btn ghost" id="alClear" style="font-size:12px;font-weight:600">🗑 נקה</button>' : "") + '</h3><div class="al-flist">' + flist + "</div>";
    modal("🔔 מרכז ההתראות", body);
    document.querySelectorAll("[data-alp]").forEach(b => b.onchange = () => { Prefs.togglePresetAlert(b.dataset.alp); requestNotifyPerm(); });
    { const pm = $("#alNotifyPerm"); if (pm) pm.onclick = () => { requestNotifyPerm(); setTimeout(openAlertsFeed, 400); }; }
    { const ps = $("#alPushSub"); if (ps) ps.onclick = () => subscribeToPush(); }
    { const bo = $("#alBellOpen"); if (bo) bo.onclick = () => { _primeAudio(); _bellSound("open"); _marketBellBanner("open"); }; }
    { const bc = $("#alBellClose"); if (bc) bc.onclick = () => { _primeAudio(); _bellSound("close"); _marketBellBanner("close"); }; }
    document.querySelectorAll(".al-style").forEach(b => b.onclick = () => { _setAlertStyle(b.dataset.style); _primeAudio(); openAlertsFeed(); });
    { const ta = $("#alTestAlert"); if (ta) ta.onclick = () => { _primeAudio(); _fireAlert([{ sym: "TSLA", preset: "בדיקה", pid: "test" }]); }; }
    { const cl = $("#alClear"); if (cl) cl.onclick = () => { Prefs.feedClear(); openAlertsFeed(); }; }
    wireCharts(document.getElementById("pgModal") || document);
  }
  window._snOpenAlerts = openAlertsFeed;
  window._snCheckAlerts = checkPresetAlerts;
  // ---- community requests form (saved to Supabase; the server relays new ones to a private
  //      Discord channel — the webhook stays server-side, never in this client code) ----
  function openRequestForm() {
    const body =
      '<div class="note" style="margin-bottom:12px">💬 יש לך רעיון, בקשה לפיצ׳ר או משהו שתרצה לראות באתר? ספר לנו — זה מגיע ישירות לצוות StratNinja. קוראים הכל 🥷</div>' +
      '<div class="fgrp"><label>השם שלך <span class="muted">(רשות)</span></label><input id="reqName" type="text" maxlength="60" placeholder="איך קוראים לך?"></div>' +
      '<div class="fgrp"><label>ליצירת קשר <span class="muted">(רשות)</span></label><input id="reqContact" type="text" maxlength="80" placeholder="דיסקורד / אימייל / טלגרם"></div>' +
      '<div class="fgrp"><label>הבקשה שלך</label><textarea id="reqMsg" rows="5" maxlength="1000" placeholder="מה תרצה שנוסיף או נשפר?" style="width:100%;box-sizing:border-box;resize:vertical;padding:9px 11px;border-radius:8px;background:var(--panel2);border:1px solid var(--line);color:var(--ink);font-family:inherit;font-size:14px"></textarea></div>' +
      '<input id="reqHp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0">' +
      '<button class="btn primary" id="reqSend" style="margin-top:4px">📤 שלח בקשה</button>' +
      '<div id="reqStatus" class="note" style="margin-top:10px;display:none"></div>';
    modal("💬 בקשות מהקהל", body);
    const btn = document.getElementById("reqSend");
    btn.onclick = async () => {
      if ((document.getElementById("reqHp").value || "").trim()) { closeModal(); return; }   // honeypot → bot, silently drop
      const msg = (document.getElementById("reqMsg").value || "").trim();
      if (msg.length < 3) { snToast("כתוב בבקשה את הבקשה ✍️"); return; }
      try { const last = +localStorage.getItem("sn_req_last") || 0; if (Date.now() - last < 120000) { snToast("שלחת בקשה זה עתה — נסה שוב בעוד רגע 🙏"); return; } } catch (e) {}
      const cfg = window.SN_CONFIG || {};
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) { snToast("שירות הבקשות לא זמין כרגע"); return; }
      const name = (document.getElementById("reqName").value || "").trim().slice(0, 60);
      const contact = (document.getElementById("reqContact").value || "").trim().slice(0, 80);
      btn.disabled = true; btn.textContent = "שולח…";
      const st = document.getElementById("reqStatus");
      try {
        const res = await fetch(cfg.SUPABASE_URL + "/rest/v1/community_requests", {
          method: "POST",
          headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ name: name || null, contact: contact || null, message: msg }),
        });
        if (res.ok) {
          try { localStorage.setItem("sn_req_last", String(Date.now())); } catch (e) {}
          st.style.display = "block"; st.style.color = "var(--green)"; st.innerHTML = "✅ נשלח! תודה רבה — נעבור על זה. 🥷";
          document.getElementById("reqMsg").value = ""; btn.style.display = "none";
        } else { throw new Error("http " + res.status); }
      } catch (e) {
        st.style.display = "block"; st.style.color = "var(--red)"; st.innerHTML = "❌ שליחה נכשלה — נסה שוב מאוחר יותר.";
        btn.disabled = false; btn.textContent = "📤 שלח בקשה";
      }
    };
  }
  window._snOpenRequest = openRequestForm;

  // ========== COMMUNITY TICKERS (viewer-suggested scanner stocks) ==========
  const SN_ADMIN_EMAIL = "koriatmanagement@gmail.com";
  function _snIsAdmin() {
    try { return ((window.SNAuth && SNAuth.user() || {}).email || "").toLowerCase() === SN_ADMIN_EMAIL; }
    catch (e) { return false; }
  }
  // viewer-facing: suggest a ticker for the scanner (requires Google login — browsing stays free)
  function openSuggestTicker() {
    const cloud = !!(window.SNAuth && SNAuth.isCloud && SNAuth.isCloud());
    const loggedIn = !!(window.SNAuth && SNAuth.user && SNAuth.user());
    if (cloud && !loggedIn) {
      modal("⭐ הצע מניה לסורק",
        '<div class="note" style="margin-bottom:14px">⭐ כדי להציע מניה לסורק צריך <b>להתחבר עם Google</b> — כך נדע מי הציע ונוכל לעדכן אותך.<br>הגלישה באתר חופשית לגמרי; רק הצעת מניה דורשת התחברות. 🥷</div>' +
        '<button class="btn primary" id="sugLogin" style="width:100%;box-sizing:border-box">🔓 התחבר עם Google</button>');
      const lb = document.getElementById("sugLogin");
      if (lb) lb.onclick = () => { try { SNAuth.signInWithGoogle(); } catch (e) {} };
      return;
    }
    const body =
      '<div class="note" style="margin-bottom:12px">⭐ יש מניה אמריקאית שתרצה שתופיע בסורק? הצע אותה!<br>השרת בודק אוטומטית שהיא אמיתית ונזילה, ואז היא עוברת אישור קצר — ואז נכנסת ל<b>רשימת הקהילה</b> בסורק. 🥷</div>' +
      '<div class="fgrp"><label>סימבול המניה</label><input id="sugTk" type="text" maxlength="8" placeholder="AAPL" autocomplete="off" style="text-transform:uppercase;letter-spacing:1px;font-weight:700"></div>' +
      '<input id="sugHp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0">' +
      '<button class="btn primary" id="sugSend" style="margin-top:4px">📤 הצע מניה</button>' +
      '<div id="sugStatus" class="note" style="margin-top:10px;display:none"></div>';
    modal("⭐ הצע מניה לסורק", body);
    const inp = document.getElementById("sugTk"); if (inp) inp.focus();
    const btn = document.getElementById("sugSend");
    btn.onclick = async () => {
      if ((document.getElementById("sugHp").value || "").trim()) { closeModal(); return; }
      const tk = (document.getElementById("sugTk").value || "").trim().toUpperCase();
      const st = document.getElementById("sugStatus");
      const show = (color, html) => { st.style.display = "block"; st.style.color = color; st.innerHTML = html; };
      if (!/^[A-Z][A-Z.\-]{0,7}$/.test(tk)) { show("var(--red)", "❌ הזן סימבול תקין (אותיות לועזיות, למשל AAPL)"); return; }
      try { const last = +localStorage.getItem("sn_sug_last") || 0; if (Date.now() - last < 60000) { show("var(--red)", "הצעת מניה זה עתה — נסה שוב בעוד רגע 🙏"); return; } } catch (e) {}
      const cfg = window.SN_CONFIG || {};
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) { show("var(--red)", "השירות לא זמין כרגע"); return; }
      const email = ((window.SNAuth && SNAuth.user() || {}).email) || null;
      btn.disabled = true; btn.textContent = "שולח…";
      try {
        const res = await fetch(cfg.SUPABASE_URL + "/rest/v1/community_tickers", {
          method: "POST",
          headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ ticker: tk, requested_by: email }),
        });
        if (res.ok) {
          try { localStorage.setItem("sn_sug_last", String(Date.now())); } catch (e) {}
          show("var(--green)", "✅ <b>$" + tk + "</b> נשלחה! נבדוק אותה ונוסיף לרשימת הקהילה אם היא מתאימה. תודה 🥷");
          document.getElementById("sugTk").value = ""; btn.style.display = "none";
        } else if (res.status === 409) {
          show("var(--muted)", "ℹ️ <b>$" + tk + "</b> כבר הוצעה — היא בתהליך.");
          btn.disabled = false; btn.textContent = "📤 הצע מניה";
        } else { throw new Error("http " + res.status); }
      } catch (e) {
        show("var(--red)", "❌ שליחה נכשלה — נסה שוב מאוחר יותר.");
        btn.disabled = false; btn.textContent = "📤 הצע מניה";
      }
    };
  }
  window._snSuggestTicker = openSuggestTicker;

  // admin-only: approve / reject / remove suggested tickers
  async function openCommunityAdmin() {
    if (!_snIsAdmin()) { snToast("גישה למנהל בלבד"); return; }
    const client = window.SNAuth && SNAuth.getClient && SNAuth.getClient();
    if (!client) { snToast("התחבר עם Google כדי לנהל"); return; }
    modal("⭐ מניות קהילה · ניהול", '<div id="caBody" class="note">טוען…</div>');
    renderCommunityAdmin(client);
  }
  async function renderCommunityAdmin(client) {
    const box = document.getElementById("caBody");
    if (!box) return;
    let rows = [];
    try {
      const { data, error } = await client.from("community_tickers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      rows = data || [];
    } catch (e) { box.innerHTML = '<span style="color:var(--red)">שגיאה בטעינה: ' + (e.message || e) + "</span>"; return; }
    const awaiting = rows.filter(r => r.status === "pending" && r.validated);
    const checking = rows.filter(r => r.status === "pending" && !r.validated);
    const approved = rows.filter(r => r.status === "approved");
    const rejected = rows.filter(r => r.status === "rejected");
    const chip = (r, acts) => '<div class="ca-row"><span class="ca-tk">$' + (r.ticker || "").toUpperCase() + "</span>" +
      '<span class="ca-sec muted">' + (r.sector || "—") + "</span>" +
      '<span class="ca-by muted" title="' + escAttr(r.requested_by || "אנונימי") + '">👤 ' + escHtml(r.requested_by || "אנונימי") + "</span>" +
      (r.reason ? '<span class="ca-reason muted" title="' + escAttr(r.reason) + '">· ' + escHtml(r.reason).slice(0, 40) + "</span>" : "") +
      '<span class="ca-acts">' + acts.map(a => '<button class="btn ghost ca-btn" data-ca="' + a.act + '" data-id="' + r.id + '">' + a.lbl + "</button>").join("") + "</span></div>";
    let html = "";
    html += '<div class="ca-sec-h">🟢 ממתין לאישור שלך (' + awaiting.length + ")</div>";
    html += awaiting.length ? awaiting.map(r => chip(r, [{ act: "approve", lbl: "✅ אשר" }, { act: "reject", lbl: "❌ דחה" }])).join("") : '<div class="muted" style="padding:4px 0">אין ממתינות ✨</div>';
    if (checking.length) { html += '<div class="ca-sec-h">⏳ בבדיקת השרת (' + checking.length + ")</div>"; html += checking.map(r => chip(r, [{ act: "del", lbl: "🗑️" }])).join(""); }
    html += '<div class="ca-sec-h">⭐ מאושרות · בסורק (' + approved.length + ")</div>";
    html += approved.length ? approved.map(r => chip(r, [{ act: "del", lbl: "🗑️ הסר" }])).join("") : '<div class="muted" style="padding:4px 0">עדיין אין</div>';
    if (rejected.length) { html += '<div class="ca-sec-h">❌ נדחו (' + rejected.length + ")</div>"; html += rejected.map(r => chip(r, [{ act: "approve", lbl: "↩️ שחזר" }, { act: "del", lbl: "🗑️" }])).join(""); }
    box.innerHTML = html;
    box.querySelectorAll("[data-ca]").forEach(b => b.onclick = async () => {
      const id = b.dataset.id, act = b.dataset.ca;
      b.disabled = true; b.textContent = "…";
      try {
        if (act === "del") await client.from("community_tickers").delete().eq("id", id);
        else if (act === "approve") await client.from("community_tickers").update({ status: "approved", validated: true, reason: null }).eq("id", id);
        else if (act === "reject") await client.from("community_tickers").update({ status: "rejected", reason: "נדחה ידנית" }).eq("id", id);
        renderCommunityAdmin(client);
      } catch (e) { snToast("שגיאה: " + (e.message || e)); b.disabled = false; renderCommunityAdmin(client); }
    });
  }
  window._snCommunityAdmin = openCommunityAdmin;

  // ---- Web Push subscription (phone alerts even when the app is closed) ----
  function urlB64ToUint8(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s), arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  async function subscribeToPush() {
    try {
      const cfg = window.SN_CONFIG;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !cfg || !cfg.VAPID_PUBLIC) {
        snToast("הדפדפן הזה לא תומך בהתראות Push"); return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { snToast("צריך לאשר התראות בדפדפן"); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.VAPID_PUBLIC) });
      if (window.Prefs && sub) Prefs.addPushSub(sub.toJSON());
      snToast("✓ התראות לפלאפון הופעלו!");
      if (document.getElementById("pgModal")) openAlertsFeed();
    } catch (e) { snToast("שגיאה בהפעלת התראות פלאפון"); }
  }
  window._snSubPush = subscribeToPush;

  // ---- screenshot & share ----
  const _shNum = v => (v >= 0 ? "+" : "") + (v == null ? 0 : v).toFixed(2) + "%";
  function _shPick(score, sym, chg) {
    return '<div class="sc-pick"><div class="sc-pk-score">' + score + '</div><div class="sc-pk-sym">' + sym +
      '</div><div class="sc-pk-chg ' + ((chg || 0) >= 0 ? "pos" : "neg") + '">' + _shNum(chg) + "</div></div>";
  }
  function _shIdx(label, val, cls) { return '<span class="sc-idx' + (cls ? " " + cls : "") + '"><b>' + label + "</b> " + val + "</span>"; }
  // page-aware summary content for the share card
  function shareSummaryFor(page) {
    const ms = todayMarketState();
    const src = (typeof scanSource === "function" ? scanSource() : []);
    if (page === "scanner") {
      let rows = []; try { rows = filterRows(src); } catch (e) { rows = src; }
      const top = rows.filter(t => t.ninja != null).sort((a, b) => b.ninja - a.ninja).slice(0, 4);
      return { headline: "🔍 סורק עסקאות · " + rows.length + " תוצאות", cls: "zero", strip: "", picksLabel: "Top Ninja Score",
        picks: top.map(t => _shPick(t.ninja, t.sym, t.chg)).join("") };
    }
    if (page === "today") {
      // rich card that reflects the page's value: money flow + long AND short candidates
      const flow = (typeof todaySectors === "function" ? todaySectors(src) : []).sort((a, b) => b.chg - a.chg);
      const flowIn = flow.slice(0, 3), flowOut = flow.slice(-3).reverse();
      const longs = src.filter(t => t.ninja != null && (t.D || {}).c === "up").sort((a, b) => b.ninja - a.ninja).slice(0, 3);
      const shorts = src.filter(t => t.ninja != null && (t.D || {}).c === "down").sort((a, b) => b.ninja - a.ninja).slice(0, 3);
      const flowStrip = flowIn.map(s => _shIdx(secHe(s.name), _shNum(s.chg), "pos")).join("") + flowOut.map(s => _shIdx(secHe(s.name), _shNum(s.chg), "neg")).join("");
      const col = (lbl, cls, arr) => '<div class="sc-col"><div class="sc-picks-lbl ' + cls + '">' + lbl + "</div><div class=\"sc-picks\">" +
        (arr.length ? arr.map(t => _shPick(t.ninja, t.sym, t.chg)).join("") : '<div class="sc-empty">אין מועמדים ברורים</div>') + "</div></div>";
      const bodyHtml =
        (flowStrip ? '<div class="sc-sec-lbl">🗂️ לאן הכסף זורם</div><div class="sc-strip">' + flowStrip + "</div>" : "") +
        '<div class="sc-two">' + col("🟢 מועמדים ללונג", "pos", longs) + col("🔴 מועמדים לשורט", "neg", shorts) + "</div>";
      return { headline: ms ? ms.emoji + " " + ms.mode : "🎯 מה לבדוק עכשיו", cls: ms ? ms.cls : "zero", bodyHtml: bodyHtml };
    }
    if (page === "sectors") {
      // count full-continuity (FTFC) stocks per sector & sub-sector, split by direction (🟢 up / 🔴 down)
      const secC = {}, indC = {};
      src.forEach(t => {
        if (!t.ftfc) return;
        const dir = (t.D || {}).c;
        if (dir !== "up" && dir !== "down") return;
        const up = dir === "up";
        if (t.sector) { const o = secC[t.sector] = secC[t.sector] || { g: 0, r: 0 }; o[up ? "g" : "r"]++; }
        if (t.ind) { const o = indC[t.ind] = indC[t.ind] || { g: 0, r: 0 }; o[up ? "g" : "r"]++; }
      });
      const top2 = (obj, key, heFn) => Object.keys(obj).filter(k => obj[k][key] > 0).sort((a, b) => obj[b][key] - obj[a][key]).slice(0, 2).map(k => ({ name: heFn ? heFn(k) : k, n: obj[k][key] }));
      const line = (arr, cls) => arr.length ? arr.map(x => _shIdx(x.name, "FTFC " + x.n, cls)).join("") : '<span class="sc-idx muted">—</span>';
      const bodyHtml =
        '<div class="sc-sec-lbl pos">🟢 הכי הרבה FTFC ירוק (המשכיות עולה)</div><div class="sc-strip">' +
          line(top2(secC, "g", secHe), "pos") + line(top2(indC, "g"), "pos") + "</div>" +
        '<div class="sc-sec-lbl neg" style="margin-top:12px">🔴 הכי הרבה FTFC אדום (המשכיות יורדת)</div><div class="sc-strip">' +
          line(top2(secC, "r", secHe), "neg") + line(top2(indC, "r"), "neg") + "</div>";
      return { headline: "🗂️ סקטורים · המשכיות טיימפריימים (FTFC)", cls: "zero", bodyHtml: bodyHtml };
    }
    if (page === "sp500") {
      const b = mktU().breadth || {}; const pct = b.total ? Math.round(b.above / b.total * 100) : 0;
      // the top-rising stock inside today's leading sector
      let leadStrip = "";
      const leadSec = (LIVE && LIVE.sectorLeaders || [])[0];
      if (leadSec) {
        const secObj = (LIVE && LIVE.sectors || []).find(s => s.name === leadSec.name);
        const topSt = secObj && secObj.stocks && secObj.stocks.length ? secObj.stocks.slice().sort((a, b) => (b.c || 0) - (a.c || 0))[0] : null;
        if (topSt) leadStrip = _shIdx("🚀 " + topSt.s + " · " + secHe(leadSec.name), _shNum(topSt.c), "pos");
      }
      return { headline: "🗺️ רוחב שוק S&P 500 · " + pct + "% ירוקים", cls: pct >= 55 ? "pos" : pct <= 45 ? "neg" : "zero",
        strip: _shIdx("מעל פתיחה", b.above || 0, "pos") + _shIdx("מתחת", b.below || 0, "neg") + leadStrip, picksLabel: "", picks: "" };
    }
    if (page === "gappers") {
      const g = (LIVE && LIVE.gappers) || { up: [], down: [] };
      const strip = (g.up || []).slice(0, 4).map(x => _shIdx(x.s, _shNum(x.gp), "pos")).join("") + (g.down || []).slice(0, 4).map(x => _shIdx(x.s, _shNum(x.gp), "neg")).join("");
      return { headline: "⚡ גאפרים היום", cls: "zero", strip: strip || '<span class="sc-idx">אין גאפרים כרגע</span>', picksLabel: "", picks: "" };
    }
    if (page === "favorites") {
      const favs = window.Prefs ? Prefs.favorites() : [];
      const rows = src.filter(t => favs.indexOf(t.sym) >= 0);
      const gainers = rows.filter(t => (t.chg || 0) > 0).sort((a, b) => b.chg - a.chg).slice(0, 5);   // TOP 5 up
      const losers = rows.filter(t => (t.chg || 0) < 0).sort((a, b) => a.chg - b.chg).slice(0, 5);     // TOP 5 down
      const strip = gainers.map(t => _shIdx(t.sym, _shNum(t.chg), "pos")).join("") + losers.map(t => _shIdx(t.sym, _shNum(t.chg), "neg")).join("");
      return { headline: "⭐ המועדפים שלי · " + favs.length, cls: "zero", strip: strip || '<span class="sc-idx">אין מועדפים</span>', picksLabel: "", picks: "" };
    }
    if (page === "journal") {
      const j = (window.Journal && window.Journal.summary) ? window.Journal.summary() : null;
      if (!j || !j.count) return { headline: "📅 יומן מסחר", cls: "zero", strip: '<span class="sc-idx">אין עדיין עסקאות סגורות ביומן</span>', picksLabel: "", picks: "" };
      const pf = j.profitFactor === Infinity ? "∞" : (j.profitFactor || 0).toFixed(2);
      const netTxt = (j.net >= 0 ? "+$" : "-$") + Math.abs(Math.round(j.net)).toLocaleString("en-US");
      const strip = _shIdx("רווח/הפסד נטו", netTxt, j.net >= 0 ? "pos" : "neg") +
        _shIdx("Win Rate", j.winRate + "%", j.winRate >= 50 ? "pos" : "neg") +
        _shIdx("Profit Factor", pf, (j.profitFactor || 0) >= 1 ? "pos" : "neg") +
        _shIdx("עסקאות", j.count, "") + (j.open ? _shIdx("פתוחות", j.open, "") : "");
      return { headline: "📅 יומן מסחר · הביצועים שלי", cls: j.net >= 0 ? "pos" : "neg", strip: strip, picksLabel: "", picks: "" };
    }
    // default = market: show the strongest FULL-TIMEFRAME-CONTINUITY plays — top-2 bullish
    // (FTFC green) + top-2 bearish (FTFC red) by Ninja Score.
    const idx = ms ? ms.idx.map(i => _shIdx(i.sym, _shNum(i.chg))).join("") + (ms.vix ? _shIdx("VIX", ms.vix.level.toFixed(1)) : "") : "";
    const ftfcUp = src.filter(t => t.ftfc && (t.D || {}).c === "up").sort((a, b) => b.ninja - a.ninja).slice(0, 2);
    const ftfcDn = src.filter(t => t.ftfc && (t.D || {}).c === "down").sort((a, b) => b.ninja - a.ninja).slice(0, 2);
    const picks = ftfcUp.concat(ftfcDn).map(t => _shPick(t.ninja, t.sym, t.chg)).join("");
    return { headline: ms ? ms.emoji + " " + ms.mode : "📡 סקירת שוק", cls: ms ? ms.cls : "zero", strip: idx,
      picksLabel: "FTFC · 2🟢 המשכיות עולה / 2🔴 יורדת", picks: picks };
  }
  // html2canvas ignores object-fit:cover and stretches a non-square photo → distorted.
  // Pre-crop hero.jpg to a centered SQUARE via a canvas so the captured photo is never warped.
  let _heroSquare = null;
  function _prepHeroSquare(cb) {
    if (_heroSquare) { cb(_heroSquare); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const S = 200, c = document.createElement("canvas"); c.width = S; c.height = S;
        const ctx = c.getContext("2d");
        const scale = Math.max(S / img.width, S / img.height);   // cover
        const w = img.width * scale, h = img.height * scale;
        // focus point: 0=left .. 0.5=center .. 1=right. FOCUS_X<0.5 reveals more of the
        // LEFT of the photo → the subject appears shifted RIGHT in the circle.
        const FOCUS_X = 0.3, FOCUS_Y = 0.5;
        ctx.drawImage(img, -(w - S) * FOCUS_X, -(h - S) * FOCUS_Y, w, h);
        _heroSquare = c.toDataURL("image/png");
      } catch (e) { _heroSquare = null; }
      cb(_heroSquare);
    };
    img.onerror = () => cb(null);
    img.src = "hero.jpg";
  }
  function buildShareCardEl() {
    const s = shareSummaryFor(state.page);
    const el = document.createElement("div");
    el.className = "share-card";
    el.style.cssText = "position:fixed;left:-9999px;top:0;width:1000px;z-index:-1;";
    const photo = _heroSquare
      ? '<img class="sc-photo" src="' + _heroSquare + '">'
      : '<img class="sc-photo" src="hero.jpg" crossorigin="anonymous" onerror="this.style.display=\'none\'">';
    el.innerHTML =
      '<div class="sc-top"><img class="sc-logo" src="favicon.svg" crossorigin="anonymous">' +
        '<div><div class="sc-title">StratNinja <span>Scanner</span></div><div class="sc-sub">סריקת שוק בזמן אמת · The Strat</div></div>' +
        photo + "</div>" +
      '<div class="sc-body">' +
        '<div class="sc-mode ' + s.cls + '">' + s.headline + "</div>" +
        (s.bodyHtml ? s.bodyHtml :
          ((s.strip ? '<div class="sc-strip">' + s.strip + "</div>" : "") +
           (s.picks ? '<div class="sc-picks-lbl">' + s.picksLabel + '</div><div class="sc-picks">' + s.picks + "</div>" : ""))) +
      "</div>" +
      '<div class="sc-foot"><span>Adi Koriat · @KoriatTrade</span><span>stratninja.win · ' + new Date().toLocaleDateString("he-IL") + "</span></div>";
    document.body.appendChild(el);
    return el;
  }
  function captureShare() {
    if (typeof html2canvas !== "function") { snToast("כלי הצילום עדיין נטען — נסה שוב בעוד רגע"); return; }
    const body = '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<button class="btn primary" id="capSummary" style="font-size:14px;padding:13px;text-align:start">🖼️ כרטיס סיכום מעוצב<div style="font-size:11px;font-weight:400;opacity:.85;margin-top:3px">תמונה ממותגת עם סיכום מה שאתה רואה בערוץ הנוכחי</div></button>' +
      '<button class="btn ghost" id="capFull" style="font-size:14px;padding:13px;text-align:start">📸 צילום מסך מלא<div style="font-size:11px;font-weight:400;opacity:.7;margin-top:3px">צילום של כל המסך כמו שהוא כרגע</div></button>' +
      "</div>";
    modal("📷 צילום ושיתוף", body);
    { const a = document.getElementById("capSummary"); if (a) a.onclick = () => { closeModal(); captureSummaryCard(); }; }
    { const b = document.getElementById("capFull"); if (b) b.onclick = () => { closeModal(); captureFullScreen(); }; }
  }
  function captureSummaryCard() {
    snToast("מכין כרטיס סיכום…");
    _prepHeroSquare(() => {
      const el = buildShareCardEl();
      setTimeout(() => {
        html2canvas(el, { backgroundColor: "#0f1420", scale: 2, useCORS: true, logging: false })
          .then(cv => { el.remove(); showShareModal(cv); })
          .catch(() => { el.remove(); snToast("שגיאה בצילום — נסה שוב"); });
      }, 300);
    });
  }
  function captureFullScreen() {
    const target = state.page === "journal" ? document.getElementById("journalContainer") : document.getElementById("page");
    if (!target) { snToast("אין מה לצלם"); return; }
    snToast("מצלם את המסך…");
    html2canvas(target, { backgroundColor: "#0f1420", scale: 2, useCORS: true, logging: false }).then(cv => {
      const w = cv.width, fh = 128;
      const out = document.createElement("canvas");
      out.width = w; out.height = cv.height + fh;
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#0f1420"; ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(cv, 0, 0);
      ctx.fillStyle = "#131a2b"; ctx.fillRect(0, cv.height, w, fh);
      ctx.fillStyle = "#7c6cf0"; ctx.fillRect(0, cv.height, 6, fh);
      ctx.textBaseline = "middle"; ctx.textAlign = "right"; ctx.direction = "rtl";
      ctx.fillStyle = "#ffffff"; ctx.font = "800 36px Rubik, Arial";
      ctx.fillText("StratNinja Scanner", w - 40, cv.height + fh / 2 - 20);
      ctx.fillStyle = "#9aa3b2"; ctx.font = "500 26px Rubik, Arial";
      ctx.fillText("Adi Koriat · stratninja.win · " + new Date().toLocaleString("he-IL"), w - 40, cv.height + fh / 2 + 24);
      showShareModal(out);
    }).catch(() => snToast("שגיאה בצילום — נסה שוב"));
  }
  // ---- designed multi-timeframe Strat card (from scanner data — TradingView iframes can't
  //      be screenshotted cross-origin, so we render a branded card of the Strat bar-types) ----
  function buildMtfCardEl(sym, r) {
    const chg = (r.c != null) ? r.c : (r.tech && r.tech.chg != null ? r.tech.chg : null);
    const chgCol = (chg == null) ? "#8a93a6" : (chg >= 0 ? "#22c55e" : "#ef4444");
    const chgTxt = (chg == null) ? "" : (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
    const price = (r.p != null) ? r.p : (r.tech && r.tech.px != null ? r.tech.px : null);
    const TFS = [["Y", "שנתי"], ["Q", "רבעוני"], ["M", "חודשי"], ["W", "שבועי"], ["D", "יומי"]];
    const bar = (k, he) => {
      const cell = r[k], t = (cell && cell.t) || "1", dir = cell && cell.c;
      const col = dir === "up" ? "#22c55e" : dir === "down" ? "#ef4444" : "#586074";
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;background:#131c2e;border:1px solid #26324a;border-radius:14px;padding:15px 4px">' +
        '<span style="font-size:13px;color:#93a0b8;font-weight:700">' + he + "</span>" +
        '<span style="display:flex;align-items:center;justify-content:center;min-width:52px;height:38px;border-radius:10px;font-weight:800;font-size:17px;color:#fff;background:' + col + '">' + t + "</span>" +
        '<span style="font-size:13px;color:' + col + '">' + arrow + "</span></div>";
    };
    const badges = [];
    if (r.ftfc) { const ftfcBear = (r.D || {}).c === "down"; badges.push('<span style="padding:6px 12px;border-radius:9px;font-weight:800;font-size:13px;color:#0a0f1c;background:' + (ftfcBear ? "#ef4444" : "#22c55e") + '">FTFC ' + (ftfcBear ? "↓" : "✓") + "</span>"); }
    if (r.ninja != null) badges.push('<span style="padding:6px 12px;border-radius:9px;font-weight:800;font-size:13px;color:#fff;background:#2b3550">Ninja Score ' + r.ninja + "</span>");
    if (r.sec) badges.push('<span style="padding:6px 12px;border-radius:9px;font-weight:700;font-size:13px;color:#cbd5e6;background:#1b2438">' + r.sec + "</span>");
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;left:-9999px;top:0;width:660px;padding:30px;background:linear-gradient(150deg,#101a2c,#0a0f1c);border:1px solid #223;border-radius:22px;font-family:Rubik,Arial,sans-serif;direction:rtl;color:#eef2f8;box-sizing:border-box";
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
        '<img src="favicon.svg" style="width:38px;height:38px" crossorigin="anonymous">' +
        '<div><div style="font-weight:800;font-size:20px">StratNinja</div><div style="font-size:12px;color:#8a93a6">כל הטיימפריימים · The Strat</div></div>' +
      "</div>" +
      '<div style="display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:6px">' +
        '<span style="font-size:40px;font-weight:800;letter-spacing:.5px">' + sym + "</span>" +
        (price != null ? '<span style="font-size:24px;font-weight:700;color:#cbd5e6">$' + price.toFixed(2) + "</span>" : "") +
        (chgTxt ? '<span style="font-size:22px;font-weight:800;color:' + chgCol + '">' + chgTxt + "</span>" : "") +
      "</div>" +
      (badges.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 18px">' + badges.join("") + "</div>" : '<div style="height:14px"></div>') +
      '<div style="display:flex;gap:10px">' + TFS.map(x => bar(x[0], x[1])).join("") + "</div>" +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:22px;padding-top:16px;border-top:1px solid #223046;font-size:13px;color:#8a93a6">' +
        "<span>Adi Koriat · @KoriatTrade</span><span>stratninja.win · " + new Date().toLocaleDateString("he-IL") + "</span></div>";
    return el;
  }
  function captureMtfCard(sym) {
    if (typeof html2canvas !== "function") { snToast("כלי הצילום עדיין נטען — נסה שוב בעוד רגע"); return; }
    const r = (SCAN && SCAN.rows) ? SCAN.rows.find(x => x.s === sym) : null;
    if (!r) { snToast("אין נתוני Strat למניה הזו — פתח אותה דרך סורק העסקאות כדי לצלם כרטיס"); return; }
    snToast("מכין כרטיס מעוצב…");
    const el = buildMtfCardEl(sym, r);
    document.body.appendChild(el);
    setTimeout(() => {
      html2canvas(el, { backgroundColor: "#0a0f1c", scale: 2, useCORS: true, logging: false })
        .then(cv => { el.remove(); showShareModal(cv); })
        .catch(() => { el.remove(); snToast("שגיאה בצילום — נסה שוב"); });
    }, 200);
  }
  // full screenshot INCLUDING the live TradingView charts — html2canvas can't read cross-origin
  // iframes, so we use the Screen Capture API (captures rendered pixels, needs a one-time "share
  // this tab" confirmation). Chrome/Edge auto-scope to the current tab via preferCurrentTab.
  async function captureFullShot() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      snToast("הדפדפן לא תומך בצילום מסך מלא — השתמש בכרטיס המעוצב, או בצילום המובנה של כל גרף 📸"); return;
    }
    snToast("בחר \"הכרטיסייה הנוכחית\" בחלון שנפתח…");
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, preferCurrentTab: true, audio: false });
    } catch (e) { snToast("הצילום בוטל"); return; }
    try {
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      await video.play();
      await new Promise(r => setTimeout(r, 400));            // let a full frame paint
      const cv = document.createElement("canvas");
      cv.width = video.videoWidth || 1920; cv.height = video.videoHeight || 1080;
      cv.getContext("2d").drawImage(video, 0, 0, cv.width, cv.height);
      stream.getTracks().forEach(t => t.stop());
      if (!cv.width || !cv.height) { snToast("לא התקבלה תמונה — נסה שוב"); return; }
      showShareModal(cv);
    } catch (e) { try { stream.getTracks().forEach(t => t.stop()); } catch (x) {} snToast("שגיאה בצילום — נסה שוב"); }
  }
  // copy a PNG blob to the clipboard (secure-context + supported browsers only)
  function _copyImageBlob(blob, okMsg) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
          .then(() => { snToast(okMsg || "✓ התמונה הועתקה ללוח — אפשר להדביק (Ctrl+V)"); return true; })
          .catch(() => { snToast("לא ניתן להעתיק ללוח כאן — השתמש ב-📥 הורד"); return false; });
      }
    } catch (e) {}
    snToast("העתקה ללוח לא נתמכת בדפדפן הזה — השתמש ב-📥 הורד");
    return Promise.resolve(false);
  }
  // page-aware share caption + $cashtags (for the X tweet / WhatsApp text)
  function shareTweetText() {
    const page = state.page;
    const src = (typeof scanSource === "function" ? scanSource() : []);
    const cash = arr => arr.filter(Boolean).map(s => "$" + s).slice(0, 8).join(" ");
    let cap = "סרקתי את השוק ב-StratNinja 📊", tags = [];
    if (page === "sectors") {
      cap = "🗂️ הסקטורים ותתי-הסקטורים המעניינים היום · StratNinja";
      const secC = {}, indC = {};
      src.forEach(t => { if (!t.ftfc) return; const dir = (t.D || {}).c; if (dir !== "up" && dir !== "down") return; const up = dir === "up"; if (t.sector) { const o = secC[t.sector] = secC[t.sector] || { g: 0, r: 0 }; o[up ? "g" : "r"]++; } if (t.ind) { const o = indC[t.ind] = indC[t.ind] || { g: 0, r: 0 }; o[up ? "g" : "r"]++; } });
      const topSec = Object.keys(secC).sort((a, b) => secC[b].g - secC[a].g).slice(0, 2).map(s => etfFor(s));
      const topInd = Object.keys(indC).sort((a, b) => indC[b].g - indC[a].g).slice(0, 3).map(i => subEtfFor(i));
      tags = topSec.concat(topInd);
    } else if (page === "scanner") {
      cap = "🔍 הסטאפים החזקים היום ב-StratNinja";
      let rows = []; try { rows = filterRows(src); } catch (e) { rows = src; }
      tags = rows.filter(t => t.ninja != null).sort((a, b) => b.ninja - a.ninja).slice(0, 5).map(t => t.sym);
    } else if (page === "today") {
      cap = "🎯 מה לבדוק היום · StratNinja";
      tags = src.filter(t => t.ninja != null && (t.D || {}).c === "up").sort((a, b) => b.ninja - a.ninja).slice(0, 4).map(t => t.sym);
    } else if (page === "gappers") {
      cap = "⚡ הגאפרים של היום · StratNinja";
      const g = (LIVE && LIVE.gappers) || { up: [], down: [] };
      tags = (g.up || []).slice(0, 3).map(x => x.s).concat((g.down || []).slice(0, 2).map(x => x.s));
    } else if (page === "favorites") {
      cap = "⭐ רשימת המעקב שלי · StratNinja";
      tags = (window.Prefs ? Prefs.favorites() : []).slice(0, 6);
    } else {
      cap = "📊 סקירת השוק היום ב-StratNinja";
      tags = src.filter(t => t.ftfc).sort((a, b) => (b.ninja || 0) - (a.ninja || 0)).slice(0, 5).map(t => t.sym);
    }
    const tagStr = cash(tags);
    return cap + (tagStr ? "\n\n" + tagStr : "") + "\n\nstratninja.win";
  }
  function showShareModal(canvas) {
    canvas.toBlob(blob => {
      if (!blob) { snToast("שגיאה ביצירת התמונה"); return; }
      const url = URL.createObjectURL(blob);
      const file = new File([blob], "stratninja.png", { type: "image/png" });
      const tweetTxt = shareTweetText();
      const tweet = "https://twitter.com/intent/tweet?text=" + encodeURIComponent(tweetTxt);
      const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      const capPreview = tweetTxt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
      const body =
        '<img src="' + url + '" style="max-width:100%;border-radius:10px;border:1px solid var(--line);display:block">' +
        '<div style="margin-top:10px;font-size:11px;color:var(--muted)">📝 הכיתוב שילווה את השיתוף (מותאם לדף):</div>' +
        '<div style="margin-top:5px;white-space:pre-wrap;font-size:12px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 11px">' + capPreview + "</div>" +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
          '<button class="btn primary" id="shareNative" style="font-size:13px">📤 שתף · אינסטגרם / סטורי / וואטסאפ</button>' +
          '<button class="btn ghost" id="copyClip" style="font-size:13px">📋 העתק תמונה</button>' +
          '<button class="btn ghost" id="copyCap" style="font-size:13px">📝 העתק כיתוב</button>' +
          '<a class="btn ghost" href="' + url + '" download="stratninja.png" style="font-size:13px">📥 הורד</a>' +
          '<a class="btn ghost" href="' + tweet + '" target="_blank" rel="noopener" style="font-size:13px">𝕏 שתף ב-X</a>' +
        "</div>" +
        '<div class="note" style="margin-top:10px;font-size:11px;line-height:1.6">' +
          '📱 <b>בפלאפון:</b> "שתף" פותח את גיליון השיתוף — משם ישר ל<b>אינסטגרם, סטורי, וואטסאפ</b> (עם הכיתוב והטיקרים).<br>' +
          '🖥️ <b>במחשב:</b> אינסטגרם ויוטיוב לא מאפשרים פרסום מהדפדפן — לחץ <b>📥 הורד</b> + <b>📝 העתק כיתוב</b> והעלה ידנית.<br>' +
          '𝕏 <b>ל-X:</b> "שתף ב-X" פותח ציוץ עם הכיתוב — הדבק את התמונה (Ctrl+V).' +
        "</div>";
      modal("📷 צילום ושיתוף", body);
      // auto-copy right away (still within the click's activation window)
      _copyImageBlob(blob);
      { const cc = document.getElementById("copyClip"); if (cc) cc.onclick = () => _copyImageBlob(blob); }
      { const cp = document.getElementById("copyCap"); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(tweetTxt); snToast("✓ הכיתוב הועתק — הדבק באינסטגרם/יוטיוב"); } catch (e) { snToast("לא ניתן להעתיק כאן"); } }; }
      const sn = document.getElementById("shareNative");
      if (sn) sn.onclick = () => {
        if (canShareFiles) {
          try { navigator.share({ files: [file], title: "StratNinja", text: tweetTxt }); }
          catch (e) {}
        } else {
          // desktop: no OS share sheet → download + guide (IG/YouTube need manual upload via the app)
          const a = document.createElement("a"); a.href = url; a.download = "stratninja.png"; a.click();
          snToast("במחשב אין שיתוף ישיר — התמונה הורדה, העלה אותה לאינסטגרם/יוטיוב דרך האפליקציה 📱");
        }
      };
    }, "image/png");
  }
  window._snCapture = captureShare;
  const CAP_OPTS = [["all", "הכל"], ["mega", "Mega (>$200B)"], ["large", "Large ($10B–200B)"], ["mid", "Mid ($2B–10B)"], ["small", "Small ($300M–2B)"], ["micro", "Micro (<$300M)"]];
  const CAP_RANGES = { mega: [2e11, Infinity], large: [1e10, 2e11], mid: [2e9, 1e10], small: [3e8, 2e9], micro: [0, 3e8] };
  function fmtCap(n) {
    if (n == null) return "—";
    if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
    return "$" + n;
  }
  // ---- table sorting ----
  const scanSort = { col: "ninja", dir: -1 };   // default: best Ninja Score first. dir: -1 desc, 1 asc
  function dirRank(cell) { const c = cell && cell.c; return c === "up" ? 1 : c === "down" ? -1 : 0; }
  // rank a Strat timeframe cell by bar TYPE (2U > 3 > 2D > 1), color as tiebreak — so sorting a TF
  // column groups by pattern: 2U (new high) at the top, 1 (inside) at the bottom. null = no data → last.
  function tfRank(cell) {
    if (!cell || !cell.t) return null;
    const base = ({ "2U": 4, "3": 3, "2D": 2, "1": 1 })[cell.t];
    if (base == null) return null;
    const dir = cell.c === "up" ? 1 : cell.c === "down" ? -1 : 0;
    return base * 3 + dir;
  }
  function sortVal(t, col) {
    if (col === "sym") return t.sym;
    if (col === "sec") return t.sector;
    if (col === "etf") return etfFor(t.sector);
    if (col === "price") return t.price;
    if (col === "mc") return t.mc;
    if (col === "chg") return t.chg;
    if (col === "ftfc") return t.ftfc ? 1 : 0;
    if (col === "ninja") return t.ninja;
    if (col === "ind") return t.ind || "";
    if (["Y", "Q", "M", "W", "D"].indexOf(col) >= 0) return tfRank(t[col]);
    const k = t.tech || {};
    if (col === "rsi") return k.rsi;
    if (col === "mfi") return k.mfi;
    if (col === "rvol") return k.rvol;
    if (col === "vol") return k.vol;
    if (col === "dhi52") return k.dhi52;
    if (col === "atrp") return k.atrp;
    if (col === "gap") return k.gap;
    if (col === "dma") { const dmap = techState.maType === "EMA" ? k.dema : k.dsma; return dmap ? dmap[techState.maPeriod] : null; }
    if (col === "comp") return _compSpread(k);
    if (col === "bbsq") return k.bbsq;
    if (col === "swd") return techState.swSide === "low" ? k.swlo_d : k.swhi_d;
    return null;
  }
  function sortRows(rows) {
    if (!scanSort.col) return rows;
    const col = scanSort.col, dir = scanSort.dir;
    return rows.slice().sort((a, b) => {
      let va = sortVal(a, col), vb = sortVal(b, col);
      const na = va == null || va === "" || (typeof va === "number" && isNaN(va));
      const nb = vb == null || vb === "" || (typeof vb === "number" && isNaN(vb));
      if (na && nb) return 0; if (na) return 1; if (nb) return -1;   // blanks always last
      if (typeof va === "string") return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });
  }
  function onSortClick(col) {
    if (scanSort.col === col) scanSort.dir *= -1;
    else { scanSort.col = col; scanSort.dir = col === "sym" ? 1 : -1; }  // numbers high→low first
    reRender();
  }
  function sortableTh(label, col, extra) {
    const active = scanSort.col === col;
    const arrow = active ? (scanSort.dir < 0 ? " ▼" : " ▲") : "";
    return '<th class="sortable" data-sortcol="' + col + '" style="cursor:pointer;user-select:none"' + (extra || "") + ">" + label + arrow + "</th>";
  }
  function resetScan() {
    scanState.tfs = ["D"]; scanState.tfsExtra = []; scanState.patterns = []; scanState.dir = "all"; scanState.shape = "all"; scanState.broad = "off"; scanState.inforce = false;
    scanState.sector = "all"; scanState.subsec = "all"; scanState.universe = "all"; scanState.sym = ""; scanState.ftfc = false; scanState.priceMin = ""; scanState.priceMax = ""; scanState.cap = "all";
    scanState.mtf = newMtf(); scanState.indOpen = false;
    resetTech(); techState.techOpen = false;
  }
  // ➕ custom-timeframe picker (adds a server-computed extra Strat TF to the scanner)
  function closeTfMenu() { const p = document.getElementById("tfAddPop"); if (p) p.remove(); document.removeEventListener("click", _tfMenuOutside); }
  function _tfMenuOutside(e) { const p = document.getElementById("tfAddPop"); if (p && !p.contains(e.target) && e.target.id !== "tfAdd") closeTfMenu(); }
  function openTfAddMenu(btn) {
    closeTfMenu();
    const avail = EXTRA_TFS.filter(t => scanState.tfsExtra.indexOf(t) < 0);
    if (!avail.length) return;
    const pop = document.createElement("div"); pop.className = "tf-addpop"; pop.id = "tfAddPop";
    pop.innerHTML = '<div class="tf-addpop-lbl">➕ טיימפריים סטראט מותאם</div><div class="tf-addpop-grid">' +
      avail.map(t => '<button class="chip" data-addtf="' + t + '">' + t + "</button>").join("") + "</div>" +
      '<div class="tf-addpop-note">TheStrat אגנוסטי לזמן — הוסף כל מסגרת וסנן לפיה כמו D/W/M/Q/Y.</div>';
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + window.scrollY + 6) + "px";
    pop.style.insetInlineStart = (r.left + window.scrollX) + "px";
    pop.querySelectorAll("[data-addtf]").forEach(b => b.onclick = () => {
      const t = b.dataset.addtf;
      if (scanState.tfsExtra.indexOf(t) < 0) scanState.tfsExtra.push(t);
      if (scanState.tfs.indexOf(t) < 0) scanState.tfs.push(t);
      closeTfMenu(); reRender();
    });
    setTimeout(() => document.addEventListener("click", _tfMenuOutside), 0);
  }
  function scanSource() {
    if (SCAN && SCAN.rows && SCAN.rows.length) {
      return SCAN.rows.map(r => {
        const o = { sym: r.s, sector: r.sec, ind: r.ind, price: r.p || (r.tech ? r.tech.px : 0),
          chg: r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0), mc: r.mc, ninja: r.ninja,
          Y: r.Y, Q: r.Q, M: r.M, W: r.W, D: r.D, ftfc: r.ftfc, tech: r.tech, sp: r.sp, comm: r.comm };
        EXTRA_TFS.forEach(tf => { if (r[tf]) o[tf] = r[tf]; });   // custom Strat timeframes
        return o;
      });
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
    // sub-sector (industry) concentration
    const ind = {}; rows.forEach(r => { if (r.ind) ind[r.ind] = (ind[r.ind] || 0) + 1; });
    const topInd = Object.keys(ind).map(k => [k, ind[k]]).sort((a, b) => b[1] - a[1])[0];
    if (topInd && topInd[1] >= 2) facts.push({ i: "🏭", t: pctOf(topInd[1]) + "% בתת-סקטור <b>" + topInd[0] + "</b> (" + topInd[1] + " מניות)" });
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
  // MA-relation modes that use the ± percentage input
  function _maPctShown() { return ["near", "far", "farAbove", "farBelow", "touchAbove", "touchBelow"].indexOf(techState.maRel) >= 0; }
  // plain-language explanation of exactly what the "מיקום מול ממוצע" filter does right now
  function maRelHint() {
    const ma = techState.maType + techState.maPeriod, p = techState.maPct;
    switch (techState.maRel) {
      case "above": return "מציג רק מניות שהמחיר שלהן <b>מעל</b> " + ma + " (מגמה חיובית / מעל התמיכה).";
      case "below": return "מציג רק מניות שהמחיר שלהן <b>מתחת</b> ל-" + ma + " (חולשה / מתחת להתנגדות).";
      case "near":  return "מציג מניות שהמחיר <b>עד " + p + "%</b> מ-" + ma + " — נוגעות/נבחנות מול הממוצע (אזור כניסה).";
      case "far":   return "מציג מניות שהמחיר <b>יותר מ-" + p + "%</b> מ-" + ma + " — מתוחות / רחוקות מהממוצע (שני הכיוונים).";
      case "farAbove": return "מציג מניות שהמחיר <b>יותר מ-" + p + "% מעל</b> " + ma + " — מתוחות כלפי מעלה (מומנטום/מגמת <b>לונג</b>).";
      case "farBelow": return "מציג מניות שהמחיר <b>יותר מ-" + p + "% מתחת</b> ל-" + ma + " — מתוחות כלפי מטה (חולשה/מגמת <b>שורט</b>).";
      case "touchAbove": return "🎯 כמו ה-<b>SMA150 Sniper</b> בדיסקורד: המניה סגרה <b>מעל</b> " + ma + ", וה-<b>נמוך</b> ירד עד <b>" + p + "%</b> מהממוצע (צלפה בו מלמעלה).";
      case "touchBelow": return "🎯 כמו ה-Sniper בדיסקורד: המניה סגרה <b>מתחת</b> ל-" + ma + ", וה-<b>גבוה</b> נגע עד <b>" + p + "%</b> מהממוצע (מלמטה).";
      default: return "";
    }
  }
  function renderScanner() {
    const all = scanSource();
    const isLive = !!(SCAN && SCAN.rows && SCAN.rows.length);
    const hasTech = all.some(t => t.tech);
    const sectors = Array.from(new Set(all.map(t => t.sector))).sort();
    const subsectors = Array.from(new Set(all.filter(t => scanState.sector === "all" || t.sector === scanState.sector).map(t => t.ind).filter(Boolean))).sort();
    const patBtn = p => '<button class="chip' + (scanState.patterns.indexOf(p) >= 0 ? " on" : "") + '" data-pat="' + p + '">' + p + "</button>";
    const tfBtn = f => '<button class="chip' + (scanState.tfs.indexOf(f) >= 0 ? " on" : "") + '" data-tff="' + f + '">' + f + "</button>";
    const dirBtn = (v, l) => '<button class="chip' + (scanState.dir === v ? " on" : "") + '" data-dir="' + v + '">' + l + "</button>";
    const uniBtn = (v, l) => '<button class="chip' + (scanState.universe === v ? " on" : "") + '" data-scanuni="' + v + '">' + l + "</button>";
    const filters =
      '<div class="panel filters"><h3>פילטרים <span class="muted" style="font-size:12px">בחר כמה טיימפריימים = חיפוש קונפלואנס (התבנית מתקיימת על כולם)</span></h3><div class="frow">' +
        '<div class="fgrp"><label>טיימפריימים · רב-בחירה</label><div class="chips">' +
          ["D", "W", "M", "Q", "Y"].map(tfBtn).join("") +
          scanState.tfsExtra.map(f => '<button class="chip tf-extra' + (scanState.tfs.indexOf(f) >= 0 ? " on" : "") + '" data-tff="' + f + '">' + f + '<span class="tf-x" data-rmtf="' + f + '" title="הסר">✕</span></button>').join("") +
          '<button class="chip tf-addbtn" id="tfAdd" title="הוסף טיימפריים סטראט מותאם">➕</button>' +
        "</div></div>" +
        '<div class="fgrp"><label>תבנית</label><div class="chips">' + ["1", "2U", "2D", "3"].map(patBtn).join("") + "</div></div>" +
        '<div class="fgrp"><label>צבע נר</label><div class="chips">' + dirBtn("all", "הכל") + dirBtn("up", "🟢 ירוק") + dirBtn("down", "🔴 אדום") + "</div></div>" +
        '<div class="fgrp"><label>צורת נר</label><select id="scanShape">' + SHAPE_OPTS.map(o => '<option value="' + o[0] + '"' + (scanState.shape === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
        '<div class="fgrp"><label>תבניות (רצף Strat)</label><div class="chips" style="align-items:center"><select id="scanBroad">' + BROAD_OPTS.map(o => '<option value="' + o[0] + '"' + (scanState.broad === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>" +
          (_isCombo(scanState.broad) ? '<button class="chip' + (scanState.inforce ? " on" : "") + '" id="scanInforce" title="IN FORCE = התבנית כבר הושלמה (המהלך קרה). כבוי = לקראת המהלך (סטאפ)">IN FORCE</button>' : "") + "</div></div>" +
        '<div class="fgrp"><label>סקטור</label><select id="scanSector"><option value="all">הכל</option>' + sectors.map(s => '<option value="' + escAttr(s) + '"' + (scanState.sector === s ? " selected" : "") + ">" + s + (etfFor(s) ? " (" + etfFor(s) + ")" : "") + "</option>").join("") + "</select></div>" +
        '<div class="fgrp"><label>תת-סקטור</label><select id="scanSubsec"><option value="all">הכל</option>' + subsectors.map(s => '<option value="' + escAttr(s) + '"' + (scanState.subsec === s ? " selected" : "") + ">" + s + (subEtfFor(s) ? " (" + subEtfFor(s) + ")" : "") + "</option>").join("") + "</select></div>" +
        '<div class="fgrp"><label>סימבול</label><input id="scanSym" placeholder="AAPL" value="' + scanState.sym + '"></div>' +
        '<div class="fgrp"><label>מחיר ($)</label><div class="chips" style="align-items:center"><input id="scanPmin" type="number" min="0" step="1" placeholder="מ-" style="width:74px" value="' + scanState.priceMin + '"><span class="muted">–</span><input id="scanPmax" type="number" min="0" step="1" placeholder="עד" style="width:74px" value="' + scanState.priceMax + '"></div></div>' +
        '<div class="fgrp"><label>שווי שוק</label><select id="scanCap">' + CAP_OPTS.map(o => '<option value="' + o[0] + '"' + (scanState.cap === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
        '<div class="fgrp"><label>FTFC בלבד</label><button class="chip' + (scanState.ftfc ? " on" : "") + '" id="scanFtfc">' + (scanState.ftfc ? "כן ✓" : "הכל") + "</button></div>" +
        '<div class="fgrp"><label>יקום · רשימה</label><div class="chips" style="align-items:center">' + uniBtn("all", "הכל") + uniBtn("sp500", "S&P 500") + uniBtn("comm", "⭐ קהילה") + '<button class="chip" id="scanSuggest" title="הצע מניה חדשה לסורק — עוברת בדיקה ואישור">➕ הצע מניה</button></div></div>' +
      "</div></div>";

    // ---- technical filters (collapsible) ----
    const opt = (v, cur, lbl) => '<option value="' + v + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + (lbl == null ? v : lbl) + "</option>";
    const onChip = (on, id, lbl) => '<button class="chip' + (on ? " on" : "") + '" id="' + id + '">' + lbl + "</button>";
    const cnt = techActiveCount();
    let techInner = "";
    if (techState.techOpen) {
      techInner = !hasTech
        ? '<div class="note" style="margin-top:6px">⏳ הנתונים הטכניים ייטענו בהרצת הסורק הבאה בשרת.</div>'
        : '<div class="frow tech-row">' +
            '<div class="fgrp tf-ind-grp"><label>אינדיקטורים · מסגרת זמן <span class="muted" style="font-size:10px">(RSI·MFI·RVOL·ATR)</span></label><div class="chips" style="align-items:center"><select id="tTechTf">' +
              ["D", "W", "M", "Q", "Y"].map(t => opt(t, techState.techTf, t + " · " + (TF_HE_SHORT[t] || t))).join("") + "</select>" +
              (techState.techTf !== "D" ? '<span class="tf-ind-badge">' + (TF_HE_SHORT[techState.techTf] || techState.techTf) + "</span>" : "") + "</div></div>" +
            '<div class="fgrp"><label>מיקום מול ממוצע (MA)</label><div class="chips" style="align-items:center">' +
              '<select id="tMaType">' + opt("SMA", techState.maType) + opt("EMA", techState.maType) + '</select>' +
              '<select id="tMaPer">' + MA_PERIODS.map(p => opt(p, techState.maPeriod)).join("") + '</select>' +
              '<select id="tMaRel">' + opt("off", techState.maRel, "— בלי סינון") + opt("above", techState.maRel, "מעל הממוצע") + opt("below", techState.maRel, "מתחת לממוצע") + opt("near", techState.maRel, "עד ±% מהממוצע") + opt("far", techState.maRel, "יותר מ-±% מהממוצע (2 הכיוונים)") + opt("farAbove", techState.maRel, "יותר מ-% מעל הממוצע ↑ לונג") + opt("farBelow", techState.maRel, "יותר מ-% מתחת לממוצע ↓ שורט") + opt("touchAbove", techState.maRel, "🎯 נגיעה מלמעלה (צל תחתון)") + opt("touchBelow", techState.maRel, "🎯 נגיעה מלמטה (צל עליון)") + '</select>' +
              (_maPctShown() ? '<input id="tMaPct" type="number" step="0.5" min="0" style="width:58px" value="' + techState.maPct + '"><span class="muted">%</span>' : "") +
            "</div>" + (techState.maRel !== "off" ? '<div class="ma-hint">' + maRelHint() + "</div>" : "") + "</div>" +
            '<div class="fgrp"><label>RSI</label><div class="chips" style="align-items:center"><input id="tRsiMin" type="number" min="0" max="100" style="width:54px" value="' + techState.rsiMin + '"><span class="muted">–</span><input id="tRsiMax" type="number" min="0" max="100" style="width:54px" value="' + techState.rsiMax + '"></div></div>' +
            '<div class="fgrp"><label>MFI · כסף חכם</label><div class="chips" style="align-items:center"><input id="tMfiMin" type="number" min="0" max="100" style="width:54px" value="' + techState.mfiMin + '"><span class="muted">–</span><input id="tMfiMax" type="number" min="0" max="100" style="width:54px" value="' + techState.mfiMax + '"></div></div>' +
            '<div class="fgrp"><label>RVOL ≥</label><input id="tRvolMin" type="number" step="0.1" min="0" placeholder="—" style="width:62px" value="' + techState.rvolMin + '"></div>' +
            '<div class="fgrp"><label>ווליום ≥</label><select id="tVolMin">' +
              opt("0", techState.volMin, "— הכל") + opt("500000", techState.volMin, "500K") + opt("1000000", techState.volMin, "1M") + opt("2000000", techState.volMin, "2M") +
              opt("5000000", techState.volMin, "5M") + opt("10000000", techState.volMin, "10M") + opt("20000000", techState.volMin, "20M") + "</select></div>" +
            '<div class="fgrp"><label>ממוצע ≥ (נזילות)</label><div class="chips" style="align-items:center"><select id="tAvgVolMin">' +
              opt("0", techState.avgVolMin, "— הכל") + opt("300000", techState.avgVolMin, "300K") + opt("500000", techState.avgVolMin, "500K") + opt("1000000", techState.avgVolMin, "1M") +
              opt("2000000", techState.avgVolMin, "2M") + opt("5000000", techState.avgVolMin, "5M") + opt("10000000", techState.avgVolMin, "10M") +
              '</select><select id="tAvgVolPer">' + opt("30", techState.avgVolPeriod, "30י") + opt("90", techState.avgVolPeriod, "90י") + "</select></div></div>" +
            '<div class="fgrp"><label>52ש׳</label><div class="chips" style="align-items:center"><select id="tExt52">' +
              opt("off", techState.ext52, "— הכל") + opt("high", techState.ext52, "קרוב לשיא") + opt("low", techState.ext52, "קרוב לשפל") +
              "</select>" + (techState.ext52 !== "off" ? '<span class="muted">±</span><input id="tExt52Pct" type="number" step="0.5" min="0" style="width:54px" value="' + techState.ext52Pct + '"><span class="muted">%</span>' : "") + "</div></div>" +
            '<div class="fgrp"><label>ATR% ≥ <span class="muted" style="font-size:10px">(תנודתיות)</span></label><input id="tAtrpMin" type="number" step="0.5" min="0" placeholder="—" style="width:66px" value="' + techState.atrpMin + '"></div>' +
            '<div class="fgrp"><label>תנועה יומית %</label><div class="chips" style="align-items:center"><input id="tChgMin" type="number" step="0.5" placeholder="מ-" style="width:60px" value="' + techState.chgMin + '"><span class="muted">–</span><input id="tChgMax" type="number" step="0.5" placeholder="עד" style="width:60px" value="' + techState.chgMax + '"></div></div>' +
            '<div class="fgrp"><label>גאפ (פתיחה מול אתמול)</label><div class="chips" style="align-items:center"><select id="tGapDir">' +
              opt("off", techState.gapDir, "— הכל") + opt("up", techState.gapDir, "גאפ אפ ↑") + opt("down", techState.gapDir, "גאפ דאון ↓") +
              "</select>" + (_gapActive() ? '<span class="muted">≥</span><input id="tGapPct" type="number" step="0.5" min="0" style="width:56px" value="' + techState.gapPct + '"><span class="muted">%</span>' : "") + "</div></div>" +
          "</div>";
    }
    const techBadge = cnt ? ' <span class="badge-ftfc">' + cnt + ' פעילים</span>' : ' <span class="muted" style="font-size:12px">נטרלי · שנה ערך כדי לסנן</span>';
    const techPanel = '<div class="panel filters"><h3 id="techToggle" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;margin:0"><span>📈 פילטרים טכניים' + techBadge + '</span><span style="font-size:14px">' + (techState.techOpen ? "▲" : "▼") + "</span></h3>" + techInner + "</div>";

    // ---- multi-timeframe (MTF) analysis: a separate bar-type+color condition per timeframe ----
    const mtfCnt = mtfActiveCount();
    const mtfTypeSel = tf => '<select data-mtft="' + tf + '">' + ["", "1", "2U", "2D", "3"].map(v => '<option value="' + v + '"' + (scanState.mtf[tf].t === v ? " selected" : "") + ">" + (v === "" ? "— כל" : v) + "</option>").join("") + "</select>";
    const mtfColorSel = tf => '<select data-mtfc="' + tf + '">' + [["", "— כל"], ["up", "🟢 ירוק"], ["down", "🔴 אדום"]].map(o => '<option value="' + o[0] + '"' + (scanState.mtf[tf].c === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>";
    let mtfInner = "";
    if (scanState.mtfOpen) {
      mtfInner = '<div class="mtf-rows">' + MTF_TFS.map(tf =>
        '<div class="mtf-cond"><span class="mtf-tf-lbl">' + MTF_TF_HE[tf] + "</span>" + mtfTypeSel(tf) + mtfColorSel(tf) + "</div>").join("") + "</div>" +
        '<div class="note" style="margin-top:8px;font-size:11px">💡 בחר סוג נר וצבע לכל טיימפריים בנפרד — <b>כולם צריכים להתקיים יחד</b>. לדוגמה: חודשי = <b>2U</b>, יומי = <b>2D + 🟢</b> (2D בקונפליקט). קונפליקט = 2D ירוק / 2U אדום. תנאים אלה מצטרפים לשאר הפילטרים.</div>';
    }
    const mtfBadge = mtfCnt ? ' <span class="badge-ftfc">' + mtfCnt + ' פעילים</span>' : ' <span class="muted" style="font-size:12px">תנאי נפרד לכל טיימפריים</span>';
    const mtfPanel = '<div class="panel filters"><h3 id="mtfToggle" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;margin:0"><span>🔀 ניתוח מרובה-זמן (MTF)' + mtfBadge + '</span><span style="font-size:14px">' + (scanState.mtfOpen ? "▲" : "▼") + "</span></h3>" + mtfInner + "</div>";

    // ---- indicator scanners (compression / Bollinger / swing) — collapsible, stack AND on top of everything ----
    const indCnt = indActiveCount();
    let indInner = "";
    if (scanState.indOpen) {
      indInner = !hasTech
        ? '<div class="note" style="margin-top:6px">⏳ הנתונים הטכניים ייטענו בהרצת הסורק הבאה בשרת.</div>'
        : '<div class="frow tech-row">' +
            '<div class="fgrp"><label>📉 דחיסת ממוצעים ≤ % <span class="muted" style="font-size:10px">(SMA 20/50/100/200)</span></label><input id="tCompMax" type="number" step="0.5" min="0" placeholder="—" style="width:70px" value="' + techState.compMax + '"></div>' +
            '<div class="fgrp"><label>🎈 בולינגר דחיסה ≤ <span class="muted" style="font-size:10px">(אחוזון 0–100)</span></label><input id="tBbSqMax" type="number" step="5" min="0" max="100" placeholder="—" style="width:70px" value="' + techState.bbSqMax + '"></div>' +
            '<div class="fgrp"><label>〽️ סווינג</label><div class="chips" style="align-items:center"><select id="tSwSide">' +
              opt("off", techState.swSide, "— הכל") + opt("high", techState.swSide, "קרוב לשיא") + opt("low", techState.swSide, "קרוב לתחתית") +
              "</select>" + (_swActive() ? '<span class="muted">±</span><input id="tSwPct" type="number" step="0.5" min="0" style="width:54px" value="' + techState.swPct + '"><span class="muted">%</span>' : "") + "</div></div>" +
          "</div>" +
          '<div class="note" style="margin-top:8px;font-size:11px">💡 <b>דחיסת ממוצעים</b> = טווח ה-SMA כאחוז מהמחיר (נמוך=צפוף). <b>בולינגר דחיסה</b> = אחוזון רוחב הרצועות מול 6 חודשים (נמוך=לפני פריצה). <b>סווינג</b> = קרוב לרמת שיא/תחתית אחרונה. כל פילטר מוסיף עמודה וממוין בלחיצה על הכותרת — ומצטרף (AND) לכל שאר הסינונים.</div>';
    }
    const indBadge = indCnt ? ' <span class="badge-ftfc">' + indCnt + ' פעילים</span>' : ' <span class="muted" style="font-size:12px">דחיסה · בולינגר · סווינג</span>';
    const indPanel = '<div class="panel filters"><h3 id="indToggle" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;margin:0"><span>🎯 סורקי אינדיקטורים' + indBadge + '</span><span style="font-size:14px">' + (scanState.indOpen ? "▲" : "▼") + "</span></h3>" + indInner + "</div>";

    const techOn = techActive();
    const maLabel = techState.maType + techState.maPeriod;
    const rows = sortRows(filterRows(all));
    const CAP = 300;
    const shown = rows.slice(0, CAP);
    const dmapKey = techState.maType === "EMA" ? "dema" : "dsma";
    // optional result columns — shown if the user toggled them on OR the matching filter is active
    const optCols = [
      { key: "ind", th: "תת-סקטור", tip: "תת-הסקטור (התעשייה) של המניה + תעודת הסל שלה", cell: (k, dma, t) => '<td class="tname" style="text-align:start">' + (t && t.ind ? t.ind + (subEtfFor(t.ind) ? ' <span class="muted">· ' + subEtfFor(t.ind) + "</span>" : "") : '<span class="muted">—</span>') + "</td>", active: scanState.subsec !== "all" },
      { key: "rsi", th: "RSI" + _tfSuf(), tip: "RSI (0–100): מדד מומנטום. מעל 70 = קניית-יתר, מתחת 30 = מכירת-יתר" + _tfTip(), cell: k => { const v = _techVal(k, "rsi"); return '<td class="' + rsiCls(v) + '">' + (v == null ? "—" : v.toFixed(0)) + "</td>"; }, active: techState.rsiMin > 0 || techState.rsiMax < 100 },
      { key: "mfi", th: "MFI" + _tfSuf(), tip: "MFI (0–100): תזרים כסף — כמו RSI אך משוקלל בווליום ('כסף חכם'). מעל 80 קניית-יתר, מתחת 20 מכירת-יתר" + _tfTip(), cell: k => { const v = _techVal(k, "mfi"); return '<td class="' + mfiCls(v) + '">' + (v == null ? "—" : v.toFixed(0)) + "</td>"; }, active: techState.mfiMin > 0 || techState.mfiMax < 100 },
      { key: "rvol", th: "RVOL" + _tfSuf(), tip: "ווליום יחסי: נפח המסחר היום חלקי הממוצע. מעל 1× = פעילות ערה מהרגיל" + _tfTip(), cell: k => { const v = _techVal(k, "rvol"); return "<td>" + (v == null ? "—" : v.toFixed(2) + "×") + "</td>"; }, active: _rv() > 0 },
      { key: "vol", th: "ווליום", tip: "נפח: מספר המניות שנסחרו היום", cell: k => "<td>" + fmtVol(k.vol) + "</td>", active: techState.volMin > 0 },
      { key: "atrp", th: "ATR%" + _tfSuf(), tip: "ATR%: טווח התנועה הממוצע כאחוז מהמחיר — מדד תנודתיות" + _tfTip(), cell: k => { const v = _techVal(k, "atrp"); return "<td>" + (v == null ? "—" : v.toFixed(2) + "%") + "</td>"; }, active: _atrp() > 0 },
      { key: "gap", th: "גאפ", tip: "גאפ: פער הפתיחה של היום מול סגירת אתמול (%)", cell: k => "<td>" + dPct(k.gap) + "</td>", active: _gapActive() },
      { key: "dma", th: "Δ " + maLabel, tip: "מרחק המחיר (%) מהממוצע-הנע שבחרת בפילטר הטכני", cell: (k, dma) => "<td>" + dPct(dma) + "</td>", active: techState.maRel !== "off" },
      { key: "dhi52", th: "Δ שיא52", tip: "מרחק המחיר משיא 52 השבועות (0% = בשיא)", cell: k => "<td>" + dPct(k.dhi52) + "</td>", active: techState.ext52 !== "off" },
      { key: "comp", th: "דחיסת MA", tip: "דחיסת ממוצעים: כמה הממוצעים הנעים צפופים זה לזה — נמוך = קפיץ דחוס לפני פריצה", cell: k => { const sp = _compSpread(k); return '<td class="sma-spread">' + (sp == null ? "—" : sp.toFixed(2) + "%") + "</td>"; }, active: _compActive() },
      { key: "bbsq", th: "BB דחיסה", tip: "דחיסת בולינגר: אחוז הימים (~חצי שנה) עם רצועות צרות יותר — נמוך = דחוס/קפיץ", cell: k => "<td>" + (k.bbsq == null ? "—" : k.bbsq.toFixed(0)) + "</td>", active: _bbActive() },
      { key: "swd", th: "Δ סווינג", tip: "מרחק המחיר (%) מנקודת הסווינג האחרונה (שיא/תחתית מקומית)", cell: k => "<td>" + dPct(techState.swSide === "low" ? k.swlo_d : k.swhi_d) + "</td>", active: _swActive() },
    ];
    // a filter becoming active auto-adds its column (once); the user can still remove it via the chip
    optCols.forEach(c => { if (c.active && colState[c.key] == null) colState[c.key] = true; });
    const visCols = optCols.filter(c => colState[c.key]);
    const body = shown.map(t => {
      const k = t.tech || {};
      const dma = (k[dmapKey] || {})[techState.maPeriod];
      const techCells = visCols.map(c => c.cell(k, dma, t)).join("");
      return "<tr>" +
        "<td>" + star(t.sym) + "</td>" +
        '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + "</span></td>" +
        '<td class="tname" style="text-align:start">' + t.sector + "</td>" +
        "<td>" + (etfFor(t.sector) ? '<span class="tsym clickable etf-chip" data-chart="' + etfFor(t.sector) + '" data-tf="D">' + etfFor(t.sector) + "</span>" : '<span class="muted">—</span>') + "</td>" +
        "<td>" + money(t.price) + "</td><td>" + fmtCap(t.mc) + "</td><td>" + pct(t.chg) + "</td>" +
        tfCells(t) +
        "<td>" + ftfcBadge(t) + "</td>" +
        "<td>" + ninjaCell(t.ninja, t.sym) + "</td>" +
        techCells +
        '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td>' +
      "</tr>";
    }).join("");

    const filterActive = scanState.patterns.length || scanState.dir !== "all" || scanState.shape !== "all" || scanState.broad !== "off" || scanState.sector !== "all" || scanState.subsec !== "all" || scanState.sym || scanState.ftfc || scanState.priceMin !== "" || scanState.priceMax !== "" || scanState.cap !== "all" || scanState.tfs.length > 1 || cnt || mtfCnt || indCnt;
    const facts = filterActive ? scanInsights(rows, all.length) : [];
    const insightsPanel =
      '<div class="panel scan-insights"><h3>🧠 תובנות על התוצאות</h3>' +
      (facts.length
        ? facts.map(f => '<div class="insight"><span class="ins-ico">' + f.i + '</span><span>' + f.t + "</span></div>").join("")
        : '<div class="ins-empty">סַנֵּן לפי תבנית, טיימפריים, סקטור או פילטר טכני — ואציג לך עובדות מעניינות על מה שיצא. 🔍</div>') +
      "</div>";

    const head =
      "<th></th>" + sortableTh("סימבול", "sym", ' title="סימבול המניה · לחץ על השם בשורה לגרף"') + sortableTh("סקטור", "sec", ' title="הסקטור של המניה"') + sortableTh("ת\"ס", "etf", ' title="תעודת הסל (ETF) שמייצגת את הסקטור"') + sortableTh("מחיר", "price", ' title="המחיר הנוכחי"') + sortableTh("שווי", "mc", ' title="שווי שוק (מחיר × מספר מניות)"') + sortableTh("%", "chg", ' title="שינוי במחיר היום באחוזים"') +
      sortableTh("Y", "Y", ' title="נר Strat בטיימפריים השנתי"') + sortableTh("Q", "Q", ' title="נר Strat בטיימפריים הרבעוני"') + sortableTh("M", "M", ' title="נר Strat בטיימפריים החודשי"') + sortableTh("W", "W", ' title="נר Strat בטיימפריים השבועי"') + sortableTh("D", "D", ' title="נר Strat בטיימפריים היומי"') + sortableTh("FTFC", "ftfc", ' title="FTFC — המשכיות טיימפריימים מלאה: כל הטיימפריימים באותו כיוון (ירוק=עולה, אדום=יורד)"') +
      sortableTh("Ninja", "ninja", ' title="Ninja Score 0-100: איכות הסטאפ — יישור טיימפריימים, ווליום יחסי, תבנית, כסף חכם, קרבה לממוצע, נזילות וחוזק הסקטור"') +
      visCols.map(c => sortableTh(c.th, c.key, c.tip ? ' title="' + escAttr(c.tip) + '"' : "")).join("") +
      "<th></th>";
    const nCols = 15 + visCols.length;
    const colChips = '<div class="col-picker"><span class="muted" style="font-size:12px">➕ עמודות:</span>' +
      optCols.map(c => '<button class="chip col-chip' + (colState[c.key] ? " on" : "") + '" data-col="' + c.key + '" title="' + escAttr((c.tip ? c.tip : c.th) + (c.active ? " · פילטר פעיל" : "")) + '">' + c.th + (c.active ? " •" : "") + "</button>").join("") + "</div>";
    const resultsPanel =
      '<div class="panel scan-results"><h3><span>תוצאות <span class="muted" style="font-size:12px">' + rows.length + " מתוך " + all.length + (rows.length > CAP ? " · מוצגות " + CAP + " הראשונות" : "") + "</span></span>" + (rows.length ? '<span style="display:flex;gap:8px"><button class="btn ghost" id="scanGrid" style="font-size:12px;font-weight:600">📊 תצוגת גרפים</button><button class="btn ghost" id="scanCopy" style="font-size:12px;font-weight:600">📋 העתק ' + rows.length + " טיקרים</button></span>" : "") + "</h3>" + colChips +
      '<div class="tablewrap"><table class="scan-table"><thead><tr>' + head + "</tr></thead><tbody>" +
      (shown.length ? body : '<tr><td colspan="' + nCols + '" class="muted" style="text-align:center;padding:30px">אין תוצאות לפילטרים האלה</td></tr>') +
      "</tbody></table></div>" + colorLegend() + "</div>";

    const pv = panelVis();
    const panelChips = SCAN_PANELS.map(p => '<button class="chip col-chip' + (pv[p.k] ? " on" : "") + '" data-panel="' + p.k + '">' + (pv[p.k] ? "" : "＋ ") + p.t + "</button>").join("");
    const presets = (window.Prefs && window.Prefs.scanPresets) ? window.Prefs.scanPresets() : [];
    if (_selPreset && !presets.some(p => p.id === _selPreset)) _selPreset = "";  // stale id (deleted) → clear
    const presetOpts = '<option value="">— טען פריסט —</option>' + presets.map(p => '<option value="' + escAttr(p.id) + '"' + (p.id === _selPreset ? " selected" : "") + ">" + escAttr(p.name) + "</option>").join("");
    const topBar = '<div class="panel filters scan-topbar">' +
      '<div class="stb-grp"><span class="muted stb-lbl">🧩 פאנלים:</span>' + panelChips +
        '<button class="btn ghost stb-reset" id="scanReset" title="נקה את כל הפילטרים">↺ איפוס פילטרים</button>' + "</div>" +
      '<div class="stb-grp stb-presets"><span class="muted stb-lbl">⭐ סריקות שמורות:</span>' +
        '<select id="presetSel">' + presetOpts + "</select>" +
        '<button class="btn ghost" id="presetSave" title="שמור את הפילטרים הנוכחיים כסריקה חדשה">💾 שמור</button>' +
        (presets.length ? '<button class="btn ghost" id="presetDup" title="שכפל את הסריקה הנבחרת">⧉ שכפל</button>' : "") +
        (presets.length ? '<button class="btn ghost" id="presetDel" title="מחק את הסריקה הנבחרת">🗑 מחק</button>' : "") +
        '<button class="btn ghost" id="alertBell" title="מרכז התראות — התראה כשמניה מהמועדפים נכנסת לסריקה">🔔<span class="al-badge" id="alBadge"></span></button>' +
      "</div></div>";
    return (
      '<div class="page-head"><h1>סורק עסקאות</h1><div class="sub">כאן מוצאים מניות למסחר: סוננו לפי תבניות Strat, טיימפריימים ופילטרים טכניים — וכל מניה מקבלת <b>Ninja Score</b> שמדרג כמה שווה לבדוק אותה עכשיו.</div></div>' + (isLive ? liveBanner() : DEMO) +
      topBar +
      (pv.filters ? filters : "") + (pv.mtf ? mtfPanel : "") + (pv.tech ? techPanel : "") + (pv.ind ? indPanel : "") +
      '<div class="scan-layout">' + resultsPanel + insightsPanel + "</div>"
    );
  }
  function filterRows(all) {
    const tfs = scanState.tfs.length ? scanState.tfs : ["D"];
    const techOn = techActive();
    return all.filter(t => {
      if (scanState.universe === "sp500" && !t.sp) return false;
      if (scanState.universe === "comm" && !t.comm) return false;
      if (scanState.sector !== "all" && t.sector !== scanState.sector) return false;
      if (scanState.subsec !== "all" && t.ind !== scanState.subsec) return false;
      if (scanState.sym && t.sym.indexOf(scanState.sym.toUpperCase()) < 0) return false;
      if (scanState.ftfc && !t.ftfc) return false;
      if (scanState.priceMin !== "" || scanState.priceMax !== "") {
        const px = t.price || (t.tech ? t.tech.px : 0);
        if (scanState.priceMin !== "" && px < parseFloat(scanState.priceMin)) return false;
        if (scanState.priceMax !== "" && px > parseFloat(scanState.priceMax)) return false;
      }
      if (scanState.cap !== "all") {
        const mc = t.mc, rng = CAP_RANGES[scanState.cap];
        if (mc == null || (rng && (mc < rng[0] || mc >= rng[1]))) return false;
      }
      // daily % move (signed, from–to) — uses the always-present change field, not the tech block
      if (_chgActive()) {
        const cg = t.chg == null ? (t.tech ? t.tech.chg : null) : t.chg;
        if (cg == null) return false;
        if (techState.chgMin !== "" && cg < parseFloat(techState.chgMin)) return false;
        if (techState.chgMax !== "" && cg > parseFloat(techState.chgMax)) return false;
      }
      for (let i = 0; i < tfs.length; i++) {
        const c = t[tfs[i]] || t.D;
        if (scanState.patterns.length && scanState.patterns.indexOf(c.t) < 0) return false;
        if (scanState.dir !== "all" && c.c !== scanState.dir) return false;
        if (scanState.shape !== "all" && (c.sh || "") !== scanState.shape) return false;
        if (scanState.broad !== "off") {
          if (scanState.broad === "any" || scanState.broad === "up" || scanState.broad === "down") {
            const br = c.br || "";
            if (scanState.broad === "any" && !br) return false;
            if ((scanState.broad === "up" || scanState.broad === "down") && br !== scanState.broad) return false;
          } else {   // combo pattern (2-1-2 …)
            const p = scanState.broad.split("-"), sq = (c.seq3 || "").split("-");
            if (sq.length < 3) return false;
            if (scanState.inforce) {
              if ((c.seq3 || "") !== scanState.broad) return false;     // IN FORCE: full 3-bar pattern completed
            } else if (sq[1] !== p[0] || sq[2] !== p[1]) return false;  // setup: last 2 bars = first 2 digits (approaching)
          }
        }
      }
      // multi-timeframe (MTF): a separate per-TF condition (type + color), all must hold together (AND)
      for (let m = 0; m < MTF_TFS.length; m++) {
        const tf = MTF_TFS[m], cond = scanState.mtf[tf];
        if (!cond || (!cond.t && !cond.c)) continue;
        const cell = t[tf];
        if (!cell) return false;
        if (cond.t && cell.t !== cond.t) return false;
        if (cond.c && cell.c !== cond.c) return false;
      }
      if (techOn) {
        const k = t.tech;
        if (!k) return false;
        if (techState.maRel !== "off") {
          const isE = techState.maType === "EMA";
          const dmap = isE ? k.dema : k.dsma;
          const d = dmap ? dmap[techState.maPeriod] : null;   // close distance from MA (signed %)
          if (d == null) return false;
          if (techState.maRel === "near" && Math.abs(d) > techState.maPct) return false;
          if (techState.maRel === "far" && Math.abs(d) < techState.maPct) return false;
          if (techState.maRel === "farAbove" && d < techState.maPct) return false;   // stretched ABOVE (long)
          if (techState.maRel === "farBelow" && d > -techState.maPct) return false;  // stretched BELOW (short)
          if (techState.maRel === "above" && d <= 0) return false;
          if (techState.maRel === "below" && d >= 0) return false;
          // wick "touch" of the MA — mirrors the community SMA150 Sniper:
          //   touchAbove = closed ABOVE the MA and the LOW dipped within ±% of it
          //   touchBelow = closed BELOW the MA and the HIGH poked within ±% of it
          if (techState.maRel === "touchAbove" || techState.maRel === "touchBelow") {
            const loMap = isE ? k.dema_lo : k.dsma_lo, hiMap = isE ? k.dema_hi : k.dsma_hi;
            const dLo = loMap ? loMap[techState.maPeriod] : null, dHi = hiMap ? hiMap[techState.maPeriod] : null;
            if (techState.maRel === "touchAbove") { if (d <= 0 || dLo == null || Math.abs(dLo) > techState.maPct) return false; }
            else { if (d >= 0 || dHi == null || Math.abs(dHi) > techState.maPct) return false; }
          }
        }
        if (techState.rsiMin > 0 || techState.rsiMax < 100) { const rv = _techVal(k, "rsi"); if (rv == null || rv < techState.rsiMin || rv > techState.rsiMax) return false; }
        if (techState.mfiMin > 0 || techState.mfiMax < 100) { const mv = _techVal(k, "mfi"); if (mv == null || mv < techState.mfiMin || mv > techState.mfiMax) return false; }
        const rvmin = _rv();
        if (rvmin > 0) { const rvv = _techVal(k, "rvol"); if (rvv == null || rvv < rvmin) return false; }
        if (techState.volMin > 0 && (!k.vol || k.vol < techState.volMin)) return false;
        if (techState.avgVolMin > 0) {
          const av = techState.avgVolPeriod === "90" ? k.avol90 : k.avol30;
          if (av == null || av < techState.avgVolMin) return false;
        }
        if (techState.ext52 === "high" && (k.dhi52 == null || Math.abs(k.dhi52) > techState.ext52Pct)) return false;
        if (techState.ext52 === "low" && (k.dlo52 == null || Math.abs(k.dlo52) > techState.ext52Pct)) return false;
        if (_atrp() > 0) { const av2 = _techVal(k, "atrp"); if (av2 == null || av2 < _atrp()) return false; }
        if (techState.gapDir === "up" && (k.gap == null || k.gap < (parseFloat(techState.gapPct) || 0))) return false;
        if (techState.gapDir === "down" && (k.gap == null || k.gap > -(parseFloat(techState.gapPct) || 0))) return false;
      }
      // indicator scanners (compression / Bollinger / swing) — own collapsible panel, stack AND independently
      if (_compActive() || _bbActive() || _swActive()) {
        const k = t.tech;
        if (!k) return false;
        if (_compActive()) { const sp = _compSpread(k); if (sp == null || sp > parseFloat(techState.compMax)) return false; }
        if (_bbActive() && (k.bbsq == null || k.bbsq > parseFloat(techState.bbSqMax))) return false;
        if (techState.swSide === "high" && (k.swhi_d == null || Math.abs(k.swhi_d) > techState.swPct)) return false;
        if (techState.swSide === "low" && (k.swlo_d == null || Math.abs(k.swlo_d) > techState.swPct)) return false;
      }
      return true;
    });
  }
  function wireScanner() {
    document.querySelectorAll("[data-tff]").forEach(b => b.onclick = e => { if (e.target && e.target.dataset && e.target.dataset.rmtf) return; const f = b.dataset.tff, i = scanState.tfs.indexOf(f); if (i >= 0) scanState.tfs.splice(i, 1); else scanState.tfs.push(f); reRender(); });
    document.querySelectorAll("[data-rmtf]").forEach(x => x.onclick = e => { e.stopPropagation(); const f = x.dataset.rmtf; scanState.tfsExtra = scanState.tfsExtra.filter(t => t !== f); const i = scanState.tfs.indexOf(f); if (i >= 0) scanState.tfs.splice(i, 1); reRender(); });
    { const add = $("#tfAdd"); if (add) add.onclick = e => { e.stopPropagation(); openTfAddMenu(add); }; }
    // multi-timeframe (MTF) controls
    { const mt = $("#mtfToggle"); if (mt) mt.onclick = () => { scanState.mtfOpen = !scanState.mtfOpen; reRender(); }; }
    { const it = $("#indToggle"); if (it) it.onclick = () => { scanState.indOpen = !scanState.indOpen; reRender(); }; }
    // panel-visibility chips + saved-scan presets
    document.querySelectorAll("[data-panel]").forEach(b => b.onclick = () => togglePanel(b.dataset.panel));
    { const psel = $("#presetSel"); if (psel) psel.onchange = () => { _selPreset = psel.value; if (!_selPreset) { reRender(); return; } const p = (window.Prefs.scanPresets() || []).find(x => x.id === _selPreset); if (p) { applyScanConfig(p.cfg); scanSort.col = null; reRender(); } }; }
    { const psave = $("#presetSave"); if (psave) psave.onclick = () => { const name = (window.prompt("שם לסריקה השמורה:", "") || "").trim(); if (!name) return; const rec = window.Prefs.saveScanPreset(name, scanConfigSnapshot()); if (rec) _selPreset = rec.id; reRender(); }; }
    { const pdup = $("#presetDup"); if (pdup) pdup.onclick = () => { if (!_selPreset) { alert("בחר סריקה שמורה מהרשימה כדי לשכפל אותה."); return; } const rec = window.Prefs.duplicateScanPreset(_selPreset); if (rec) _selPreset = rec.id; reRender(); }; }
    { const pdel = $("#presetDel"); if (pdel) pdel.onclick = () => { if (!_selPreset) { alert("בחר סריקה שמורה מהרשימה כדי למחוק אותה."); return; } const p = (window.Prefs.scanPresets() || []).find(x => x.id === _selPreset); if (p && !confirm('למחוק את הסריקה "' + p.name + '"?')) return; window.Prefs.deleteScanPreset(_selPreset); _selPreset = ""; reRender(); }; }
    { const bell = $("#alertBell"); if (bell) bell.onclick = () => openAlertsFeed(); updateAlertBell(); }
    document.querySelectorAll("[data-mtft]").forEach(s => s.onchange = () => { scanState.mtf[s.dataset.mtft].t = s.value; reRender(); });
    document.querySelectorAll("[data-mtfc]").forEach(s => s.onchange = () => { scanState.mtf[s.dataset.mtfc].c = s.value; reRender(); });
    document.querySelectorAll("[data-pat]").forEach(b => b.onclick = () => { const p = b.dataset.pat, i = scanState.patterns.indexOf(p); if (i >= 0) scanState.patterns.splice(i, 1); else scanState.patterns.push(p); reRender(); });
    document.querySelectorAll("[data-dir]").forEach(b => b.onclick = () => { scanState.dir = b.dataset.dir; reRender(); });
    document.querySelectorAll("[data-scanuni]").forEach(b => b.onclick = () => { scanState.universe = b.dataset.scanuni; reRender(); });
    { const sg = $("#scanSuggest"); if (sg) sg.onclick = () => openSuggestTicker(); }
    const shp = $("#scanShape"); if (shp) shp.onchange = () => { scanState.shape = shp.value; reRender(); };
    const brd = $("#scanBroad"); if (brd) brd.onchange = () => { scanState.broad = brd.value; if (!_isCombo(scanState.broad)) scanState.inforce = false; reRender(); };
    { const inf = $("#scanInforce"); if (inf) inf.onclick = () => { scanState.inforce = !scanState.inforce; reRender(); }; }
    const sec = $("#scanSector"); if (sec) sec.onchange = () => { scanState.sector = sec.value; scanState.subsec = "all"; reRender(); };
    const subsec = $("#scanSubsec"); if (subsec) subsec.onchange = () => { scanState.subsec = subsec.value; reRender(); };
    // live filter as you type (not only on Enter) — restore focus + caret after the re-render
    const sym = $("#scanSym");
    if (sym) sym.oninput = () => {
      const pos = sym.selectionStart;
      scanState.sym = sym.value;
      reRender();
      const ns = $("#scanSym");
      if (ns) { ns.focus(); try { ns.setSelectionRange(pos, pos); } catch (e) {} }
    };
    document.querySelectorAll("[data-sortcol]").forEach(th => th.onclick = () => onSortClick(th.dataset.sortcol));
    const cap = $("#scanCap"); if (cap) cap.onchange = () => { scanState.cap = cap.value; reRender(); };
    const pmin = $("#scanPmin"); if (pmin) pmin.onchange = () => { scanState.priceMin = pmin.value; reRender(); };
    const pmax = $("#scanPmax"); if (pmax) pmax.onchange = () => { scanState.priceMax = pmax.value; reRender(); };
    const ftfc = $("#scanFtfc"); if (ftfc) ftfc.onclick = () => { scanState.ftfc = !scanState.ftfc; reRender(); };
    const reset = $("#scanReset"); if (reset) reset.onclick = () => { resetScan(); scanSort.col = "ninja"; scanSort.dir = -1; reRender(); };
    // technical controls
    const bind = (id, ev, fn) => { const e = $("#" + id); if (e) e[ev] = fn; };
    bind("techToggle", "onclick", () => { techState.techOpen = !techState.techOpen; reRender(); });
    bind("tTechTf", "onchange", e => { techState.techTf = e.target.value; reRender(); });
    bind("tMaType", "onchange", e => { techState.maType = e.target.value; reRender(); });
    bind("tMaPer", "onchange", e => { techState.maPeriod = e.target.value; reRender(); });
    bind("tMaRel", "onchange", e => { techState.maRel = e.target.value; reRender(); });
    bind("tMaPct", "onchange", e => { techState.maPct = parseFloat(e.target.value) || 0; reRender(); });
    bind("tRsiMin", "onchange", e => { techState.rsiMin = parseFloat(e.target.value) || 0; reRender(); });
    bind("tRsiMax", "onchange", e => { techState.rsiMax = e.target.value === "" ? 100 : (parseFloat(e.target.value) || 0); reRender(); });
    bind("tMfiMin", "onchange", e => { techState.mfiMin = parseFloat(e.target.value) || 0; reRender(); });
    bind("tMfiMax", "onchange", e => { techState.mfiMax = e.target.value === "" ? 100 : (parseFloat(e.target.value) || 0); reRender(); });
    bind("tRvolMin", "onchange", e => { techState.rvolMin = e.target.value; reRender(); });
    bind("tVolMin", "onchange", e => { techState.volMin = parseInt(e.target.value, 10) || 0; reRender(); });
    bind("tAvgVolMin", "onchange", e => { techState.avgVolMin = parseInt(e.target.value, 10) || 0; reRender(); });
    bind("tAvgVolPer", "onchange", e => { techState.avgVolPeriod = e.target.value; reRender(); });
    bind("tExt52", "onchange", e => { techState.ext52 = e.target.value; reRender(); });
    bind("tExt52Pct", "onchange", e => { techState.ext52Pct = parseFloat(e.target.value) || 0; reRender(); });
    bind("tAtrpMin", "onchange", e => { techState.atrpMin = e.target.value; reRender(); });
    bind("tChgMin", "onchange", e => { techState.chgMin = e.target.value; reRender(); });
    bind("tChgMax", "onchange", e => { techState.chgMax = e.target.value; reRender(); });
    bind("tGapDir", "onchange", e => { techState.gapDir = e.target.value; reRender(); });
    bind("tGapPct", "onchange", e => { techState.gapPct = parseFloat(e.target.value) || 0; reRender(); });
    bind("tCompMax", "onchange", e => { techState.compMax = e.target.value; reRender(); });
    bind("tBbSqMax", "onchange", e => { techState.bbSqMax = e.target.value; reRender(); });
    bind("tSwSide", "onchange", e => { techState.swSide = e.target.value; reRender(); });
    bind("tSwPct", "onchange", e => { techState.swPct = parseFloat(e.target.value) || 0; reRender(); });
    document.querySelectorAll("[data-col]").forEach(b => b.onclick = () => { colState[b.dataset.col] = !colState[b.dataset.col]; reRender(); });
    const grid = $("#scanGrid");
    if (grid) grid.onclick = () => openScannerGrid();
    const copy = $("#scanCopy");
    if (copy) copy.onclick = () => {
      const rows = filterRows(scanSource());
      const syms = rows.map(t => t.sym).join(", ");
      const orig = copy.textContent;
      copyToClipboard(syms, () => { copy.textContent = "✓ הועתקו " + rows.length; setTimeout(() => copy.textContent = orig, 1600); });
    };
  }

  // ========== technical filter state (used by the unified scanner above) ==========
  // Technical filters are NEUTRAL by default — no on/off toggles. A filter becomes
  // active automatically when its value differs from neutral (maRel≠off / RSI≠0-100 /
  // MFI≠0-100 / RVOL>0 / volume>0 / avg-vol>0 / 52w≠off).
  const techState = {
    techOpen: false,
    techTf: "D",                 // timeframe for RSI/MFI/RVOL/ATR indicators (D/W/M/Q/Y)
    maType: "SMA", maPeriod: "50", maRel: "off", maPct: 2,
    rsiMin: 0, rsiMax: 100,
    mfiMin: 0, mfiMax: 100,
    rvolMin: "",
    volMin: 0,
    avgVolPeriod: "30", avgVolMin: 0,
    ext52: "off", ext52Pct: 3,
    atrpMin: "",                 // ATR as % of price ≥
    chgMin: "", chgMax: "",      // daily % move, from–to (signed)
    gapDir: "off", gapPct: 3,    // gap: open vs prior close — up/down by ≥ %
    compMax: "",                 // SMA-compression: spread across COMP_MAS ≤ %
    bbSqMax: "",                 // Bollinger squeeze percentile ≤
    swSide: "off", swPct: 2,     // Swing proximity: within ±% of last swing high/low
  };
  const MA_PERIODS = ["5", "10", "20", "50", "100", "150", "200"];
  const COMP_MAS = ["20", "50", "100", "200"];
  // RSI/MFI/RVOL/ATR value on the SELECTED indicator timeframe (D uses the daily tech block;
  // W/M/Q/Y read the per-timeframe block the server attaches as tech.tf). null if unavailable there.
  function _techVal(k, field) {
    if (!k) return null;
    if (techState.techTf && techState.techTf !== "D") {
      const t = k.tf && k.tf[techState.techTf];
      return t && t[field] != null ? t[field] : null;
    }
    return k[field];
  }
  const TF_HE_SHORT = { D: "יומי", W: "שבועי", M: "חודשי", Q: "רבעוני", Y: "שנתי" };
  function _tfSuf() { return techState.techTf && techState.techTf !== "D" ? "·" + techState.techTf : ""; }
  function _tfTip() { return techState.techTf && techState.techTf !== "D" ? " (מסגרת זמן: " + (TF_HE_SHORT[techState.techTf] || techState.techTf) + ")" : ""; }
  function _compSpread(k) {
    if (!k || !k.dsma) return null;
    const vals = COMP_MAS.map(p => k.dsma[p]).filter(v => v != null);
    if (vals.length < 2) return null;
    return Math.max.apply(null, vals) - Math.min.apply(null, vals);
  }
  function _compActive() { return techState.compMax !== "" && !isNaN(parseFloat(techState.compMax)); }
  function _bbActive() { return techState.bbSqMax !== "" && !isNaN(parseFloat(techState.bbSqMax)); }
  function _swActive() { return techState.swSide === "high" || techState.swSide === "low"; }
  function indActiveCount() { return (_compActive() ? 1 : 0) + (_bbActive() ? 1 : 0) + (_swActive() ? 1 : 0); }
  function _rv() { const v = parseFloat(techState.rvolMin); return isNaN(v) ? 0 : v; }
  function _atrp() { const v = parseFloat(techState.atrpMin); return isNaN(v) ? 0 : v; }
  function _chgActive() { return techState.chgMin !== "" || techState.chgMax !== ""; }
  function _gapActive() { return techState.gapDir === "up" || techState.gapDir === "down"; }
  function techActive() {
    return techState.maRel !== "off" || techState.rsiMin > 0 || techState.rsiMax < 100 ||
      techState.mfiMin > 0 || techState.mfiMax < 100 || _rv() > 0 ||
      techState.volMin > 0 || techState.avgVolMin > 0 || techState.ext52 !== "off" ||
      _atrp() > 0 || _chgActive() || _gapActive();
  }
  function techActiveCount() {
    let n = 0;
    if (techState.maRel !== "off") n++;
    if (techState.rsiMin > 0 || techState.rsiMax < 100) n++;
    if (techState.mfiMin > 0 || techState.mfiMax < 100) n++;
    if (_rv() > 0) n++;
    if (techState.volMin > 0) n++;
    if (techState.avgVolMin > 0) n++;
    if (techState.ext52 !== "off") n++;
    if (_atrp() > 0) n++;
    if (_chgActive()) n++;
    if (_gapActive()) n++;
    return n;
  }
  function resetTech() {
    techState.maType = "SMA"; techState.maPeriod = "50"; techState.maRel = "off"; techState.maPct = 2;
    techState.rsiMin = 0; techState.rsiMax = 100; techState.mfiMin = 0; techState.mfiMax = 100;
    techState.rvolMin = ""; techState.volMin = 0; techState.avgVolPeriod = "30"; techState.avgVolMin = 0;
    techState.ext52 = "off"; techState.ext52Pct = 3;
    techState.atrpMin = ""; techState.chgMin = ""; techState.chgMax = ""; techState.gapDir = "off"; techState.gapPct = 3;
    techState.compMax = ""; techState.bbSqMax = ""; techState.swSide = "off"; techState.swPct = 2;
    techState.techTf = "D";
  }
  function fmtVol(n) {
    if (n == null) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
    return String(n);
  }
  function dPct(v) { return v == null ? "—" : '<span class="' + (v > 0 ? "pos" : v < 0 ? "neg" : "zero") + '">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function ninjaCls(v) { return v >= 80 ? "nj-hi" : v >= 65 ? "nj-mid" : v >= 50 ? "nj-lo" : "nj-min"; }
  function ninjaCell(v, sym) {
    if (v == null) return '<span class="muted">—</span>';
    const cls = "ninja-badge " + ninjaCls(v) + (sym ? " nj-click" : "");
    const attr = sym ? ' data-nj="' + escAttr(sym) + '" title="למה הניקוד הזה? לחץ"' : "";
    return '<span class="' + cls + '"' + attr + ">" + v + "</span>";
  }
  // client-side explanation of a Ninja Score, mirroring the server factors (from the row's tech data)
  function ninjaWhy(t) {
    const k = t.tech || {}, r = [];
    const d = (t.D || {}).c;
    if (d === "up" || d === "down") {
      const same = ["Y", "Q", "M", "W", "D"].filter(tf => (t[tf] || {}).c === d).length;
      if (t.ftfc) r.push({ i: "🎯", s: "FTFC — יישור טיימפריימים מלא (" + same + "/5)", pos: true });
      else if (same >= 3) r.push({ i: "🎯", s: "יישור טיימפריימים חלקי (" + same + "/5 באותו כיוון)", pos: true });
      else r.push({ i: "🎯", s: "יישור טיימפריימים חלש (" + same + "/5)", pos: false });
    }
    if (k.rvol != null) {
      if (k.rvol >= 2) r.push({ i: "🔊", s: "ווליום יחסי " + k.rvol.toFixed(1) + "× — גבוה", pos: true });
      else if (k.rvol >= 1) r.push({ i: "🔊", s: "ווליום יחסי " + k.rvol.toFixed(1) + "× — ממוצע", pos: false });
      else r.push({ i: "🔊", s: "ווליום יחסי " + k.rvol.toFixed(1) + "× — נמוך", pos: false });
    }
    const dt = (t.D || {}).t;
    const patTxt = { "3": "נר יומי 3 (התרחבות) — חזק", "2U": "נר יומי 2U (פריצה מעלה)", "2D": "נר יומי 2D (שבירה מטה)", "1": "נר יומי Inside (דשדוש)" }[dt];
    if (patTxt) r.push({ i: "📊", s: patTxt, pos: dt !== "1" });
    if (k.mfi != null) {
      if (k.mfi >= 50 && k.mfi <= 80) r.push({ i: "💰", s: "MFI " + k.mfi.toFixed(0) + " — תזרים כסף בריא", pos: true });
      else if (k.mfi > 90) r.push({ i: "💰", s: "MFI " + k.mfi.toFixed(0) + " — קניית יתר", pos: false });
      else if (k.mfi < 20) r.push({ i: "💰", s: "MFI " + k.mfi.toFixed(0) + " — מכירת יתר", pos: false });
    }
    const dsma = k.dsma || {};
    const nearArr = ["20", "50"].map(p => dsma[p] != null ? Math.abs(dsma[p]) : null).filter(x => x != null);
    if (nearArr.length) {
      const near = Math.min.apply(null, nearArr);
      if (near <= 2) r.push({ i: "📈", s: "צמוד לממוצע (±" + near.toFixed(1) + "% מ-SMA20/50)", pos: true });
      else if (near <= 5) r.push({ i: "📈", s: "קרוב לממוצע (±" + near.toFixed(1) + "%)", pos: true });
    }
    if (k.avol30 != null) {
      if (k.avol30 >= 1e6) r.push({ i: "💧", s: "נזילות גבוהה (" + fmtVol(k.avol30) + " ליום)", pos: true });
      else if (k.avol30 < 3e5) r.push({ i: "💧", s: "נזילות נמוכה (" + fmtVol(k.avol30) + ")", pos: false });
    }
    return r;
  }
  function openNinjaWhy(sym) {
    const t = scanSource().find(x => x.sym === sym);
    if (!t || t.ninja == null) return;
    const rs = ninjaWhy(t);
    const body = '<div class="nj-why-top"><span class="ninja-badge ' + ninjaCls(t.ninja) + '" style="font-size:18px;padding:5px 14px">' + t.ninja + "</span><span class=\"muted\">/ 100 · " + t.sym + " · " + secHe(t.sector) + "</span></div>" +
      '<div class="nj-why-list">' + (rs.length ? rs.map(x => '<div class="nj-why-row"><span class="nj-why-ico">' + x.i + '</span><span class="' + (x.pos ? "pos" : "muted") + '">' + x.s + "</span></div>").join("") : '<div class="muted">אין מספיק נתונים.</div>') + "</div>" +
      '<div class="note" style="margin-top:10px;font-size:11px">💡 <b>Ninja Score</b> = איכות סטאפ: יישור טיימפריימים · ווליום · תבנית · כסף חכם · קרבה לממוצע · נזילות · חוזק סקטור · יישור לשוק. כלי מיון — לא המלצת קנייה/מכירה. תמיד אמת בגרף.</div>';
    modal("Ninja Score · " + sym, body);
  }
  function wireNinja(scope) {
    (scope || document).querySelectorAll("[data-nj]").forEach(el => el.onclick = e => { e.stopPropagation(); openNinjaWhy(el.dataset.nj); });
  }
  function rsiCls(v) { return v == null ? "" : (v >= 70 ? "neg" : v <= 30 ? "pos" : ""); }
  function mfiCls(v) { return v == null ? "" : (v >= 80 ? "neg" : v <= 20 ? "pos" : ""); }

  // ========== SECTORS ==========
  function renderSectors() {
    const head = '<div class="page-head"><h1>סקטורים · Breadth + FTFC</h1><div class="sub">כאן רואים לאן הכסף זורם היום, לפי מניות <b>S&P 500</b>. הבר בכל כרטיס = הרכב ה-<b>FTFC</b> (המשכיות <b>D·W·M</b> — יומי·שבועי·חודשי): <span class="pos">🟢 המשכיות מעלה</span> · <span class="muted">⚪ ללא המשכיות</span> · <span class="neg">🔴 המשכיות מטה</span>. לחץ על סקטור לפירוט.</div></div>';
    if (!(SCAN && SCAN.rows && SCAN.rows.length)) {
      return head + '<div class="panel"><div class="stub"><div class="big">🗂️</div><h2>טוען נתוני סקטורים…</h2><p>הנתונים נטענים מהסורק. רגע ומתעדכן.</p></div></div>';
    }
    const bySec = {};
    SCAN.rows.forEach(r => { const s = r.sec || "אחר"; (bySec[s] = bySec[s] || []).push(r); });
    const liveMap = {}; if (LIVE && LIVE.sectors) LIVE.sectors.forEach(s => liveMap[s.name] = s);
    const names = Object.keys(bySec).sort((a, b) => bySec[b].length - bySec[a].length);
    // classify each main sector by its FTFC directional bias (of its FTFC stocks, more green or red?)
    const secInfo = names.map(name => {
      const members = bySec[name];
      const sb = members.filter(m => m.ftfc && (m.D || {}).c === "up").length;
      const sr = members.filter(m => m.ftfc && (m.D || {}).c === "down").length;
      const ft = sb + sr;
      const bucket = ft === 0 ? "mid" : (sb / ft > 0.6 ? "bull" : (sb / ft < 0.4 ? "bear" : "mid"));
      return { name, members, bucket };
    });
    function secCard(o, extra) {
      const name = o.name, members = o.members, tot = members.length;
      const fg = members.filter(m => m.ftfc && (m.D || {}).c === "up").length;
      const fr = members.filter(m => m.ftfc && (m.D || {}).c === "down").length;
      const lv = liveMap[name];
      const chgHtml = lv ? (" · " + pctSpanBare(lv.chg)) : "";
      const bcls = o.bucket === "bull" ? " b-bull" : o.bucket === "bear" ? " b-bear" : " b-mid";
      return '<div class="panel sector-card' + bcls + (extra ? " ss-extra" : "") + '" data-sec="' + encodeURIComponent(name) + '"><h3>' + name + " " + etfChip(etfFor(name)) + ' <span class="muted" style="font-size:11px">' + tot + " מניות" + chgHtml + "</span></h3>" +
        ftfc3Html(fg, fr, tot) + "</div>";
    }
    // ONE column per bucket, side by side (RTL: BULL right · neutral middle · BEAR left). Inside each
    // column: a grid of up to 4-per-row (auto-fits the column width), first 4 shown + "עוד N" toggle.
    const SS_HEAD = 4;
    const ssColumn = (title, cls, arr, cardFn) => {
      const cards = arr.length
        ? arr.map((o, i) => cardFn(o, i >= SS_HEAD)).join("")
        : '<div class="muted" style="padding:12px;grid-column:1/-1;text-align:center;font-size:12px">אין כרגע</div>';
      const hidden = Math.max(0, arr.length - SS_HEAD);
      return '<div class="ss-col ' + cls + '"><div class="ss-col-h">' + title + ' <span class="muted">' + arr.length + "</span></div>" +
        '<div class="ss-col-grid">' + cards + "</div>" +
        (hidden ? '<button class="btn ghost ss-more" data-sssection>עוד ' + hidden + " ↓</button>" : "") + "</div>";
    };
    const secBull = secInfo.filter(o => o.bucket === "bull");
    const secMid = secInfo.filter(o => o.bucket === "mid");
    const secBear = secInfo.filter(o => o.bucket === "bear");
    const secGrouped = '<div class="subsec-3col">' +
      ssColumn("🟢 BULL", "ss-bull", secBull, secCard) + ssColumn("⚪ נטרלי", "ss-mid", secMid, secCard) + ssColumn("🔴 BEAR", "ss-bear", secBear, secCard) + "</div>";
    const note = (LIVE && LIVE.sectors && LIVE.sectors.length)
      ? liveBanner()
      : '<div class="demo-flag" style="background:rgba(22,184,119,.1);color:#7ee2b8;border-color:rgba(22,184,119,.25)">🟢 חברי הסקטור אמיתיים · הירוק/אדום לפי הנר היומי (השוק סגור — אין "מעל פתיחה")</div>';

    // ---- sub-sectors (industries): split into BULL / neutral / BEAR by FTFC direction ----
    const byInd = {};
    SCAN.rows.forEach(r => { const k = (r.ind || "").trim(); if (k) (byInd[k] = byInd[k] || []).push(r); });
    const indNames = Object.keys(byInd).filter(k => byInd[k].length >= 4);
    const subInfo = indNames.map(name => {
      const mem = byInd[name], tot = mem.length;
      const green = mem.filter(m => (m.D || {}).c === "up").length;
      const bull = mem.filter(m => m.ftfc && (m.D || {}).c === "up").length;   // FTFC aligned UP
      const bear = mem.filter(m => m.ftfc && (m.D || {}).c === "down").length; // FTFC aligned DOWN
      const bullPct = tot ? bull / tot * 100 : 0, bearPct = tot ? bear / tot * 100 : 0;
      const bucket = bullPct > 50 ? "bull" : (bearPct >= 50 ? "bear" : "mid");
      return { name, tot, green, bull, bear, bullPct, bearPct, bucket, parentSec: mem[0].sec || "" };
    });
    // 3-way FTFC (continuity of D·W·M): 🟢 up · ⚪ no-continuity · 🔴 down
    function ftfc3Html(fg, fr, tot) {
      const gray = Math.max(0, tot - fg - fr);
      const gp = tot ? fg / tot * 100 : 0, rp = tot ? fr / tot * 100 : 0, yp = Math.max(0, 100 - gp - rp);
      return '<div class="ftfc3" title="FTFC = המשכיות D·W·M"><span class="f3 g" style="width:' + gp.toFixed(1) + '%"></span><span class="f3 y" style="width:' + yp.toFixed(1) + '%"></span><span class="f3 r" style="width:' + rp.toFixed(1) + '%"></span></div>' +
        '<div class="ftfc3-key"><span class="pos">🟢 ' + fg + '</span><span class="gy">⚪ ' + gray + '</span><span class="neg">🔴 ' + fr + "</span></div>";
    }
    function subCard(o, extra) {
      const bcls = o.bucket === "bull" ? " b-bull" : o.bucket === "bear" ? " b-bear" : " b-mid";
      return '<div class="panel subsec-card' + bcls + (extra ? " ss-extra" : "") + '" data-subsec="' + encodeURIComponent(o.name) + '" data-sec="' + encodeURIComponent(o.parentSec) + '">' +
        '<h3>' + o.name + " " + etfChip(subEtfFor(o.name)) + ' <span class="muted" style="font-size:11px">' + o.tot + "</span></h3>" +
        ftfc3Html(o.bull, o.bear, o.tot) + "</div>";
    }
    const ssBull = subInfo.filter(o => o.bucket === "bull").sort((a, b) => b.bullPct - a.bullPct);
    const ssMid = subInfo.filter(o => o.bucket === "mid").sort((a, b) => (b.bullPct - b.bearPct) - (a.bullPct - a.bearPct));
    const ssBear = subInfo.filter(o => o.bucket === "bear").sort((a, b) => b.bearPct - a.bearPct);
    const subSection = indNames.length
      ? '<div class="page-head" style="margin-top:28px"><h2 style="font-size:20px;margin:0 0 4px">🏭 תתי-סקטורים לפי FTFC</h2><div class="sub">מחולק ל-3 לפי כיוון הכסף: <b>🟢 BULL</b> (מימין) · <b>⚪ בין לבין</b> (אמצע) · <b>🔴 BEAR</b> (שמאל). הבר = הרכב <b>FTFC (D·W·M)</b>: <span class="pos">🟢 מעלה</span> · <span class="muted">⚪ ללא</span> · <span class="neg">🔴 מטה</span>. לחץ על כרטיס למניות.</div></div>' +
        '<div class="subsec-3col">' +
          ssColumn("🟢 BULL", "ss-bull", ssBull, subCard) + ssColumn("⚪ בין לבין", "ss-mid", ssMid, subCard) + ssColumn("🔴 BEAR", "ss-bear", ssBear, subCard) + "</div>"
      : "";

    return head + note + secGrouped + subSection;
  }
  function wireSectors() {
    document.querySelectorAll(".sector-card").forEach(c => {
      c.onclick = () => { if (c.dataset.sec) openSectorDrillLive(decodeURIComponent(c.dataset.sec)); };
    });
    // sub-sector card → open a drill with that sub-sector's stocks (like a sector drill)
    document.querySelectorAll(".subsec-card").forEach(c => {
      c.onclick = () => { if (c.dataset.subsec) openSubDrillLive(decodeURIComponent(c.dataset.subsec)); };
    });
    // "עוד N" — reveal/hide the collapsed cards inside each column
    document.querySelectorAll("[data-sssection]").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const col = b.closest(".ss-col"); if (!col) return;
      const open = col.classList.toggle("expanded");
      b.textContent = open ? "פחות ↑" : ("עוד " + col.querySelectorAll(".ss-extra").length + " ↓");
    });
    wireCharts(document); // ETF chips on sector + sub-sector cards
  }
  let secSort = { col: null, dir: -1 };
  function secSortVal(r, col) {
    if (col === "sym") return r.s;
    if (col === "price") return r.p || (r.tech ? r.tech.px : 0);
    if (col === "chg") return r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0);
    // FTFC-green (D up) on top, then FTFC-red (D down), then non-FTFC — so descending groups green→red→none
    if (col === "ftfc") return r.ftfc ? ((r.D || {}).c === "down" ? 1 : 2) : 0;
    if (["Y", "Q", "M", "W", "D"].indexOf(col) >= 0) return tfRank(r[col]);
    return null;
  }
  function openSectorDrillLive(secName) { secSort = { col: null, dir: -1 }; renderSecDrill(secName, null); }
  function openSubDrillLive(subName) { secSort = { col: null, dir: -1 }; renderSecDrill(null, subName); }
  function renderSecDrill(secName, indFilter) {
    const isSub = !!indFilter;
    const displayName = isSub ? indFilter : secName;
    const members = (SCAN && SCAN.rows) ? SCAN.rows.filter(r => isSub ? r.ind === indFilter : r.sec === secName) : [];
    if (!members.length) { modal(displayName, '<div class="muted" style="padding:20px">נתוני הטיימפריימים עדיין נטענים או שהשוק סגור.</div>'); return; }
    const rowHtml = r => {
      const t = { sym: r.s, Y: r.Y, Q: r.Q, M: r.M, W: r.W, D: r.D };
      const chg = r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0);
      return "<tr><td>" + star(r.s) + '</td><td class="sym"><span class="tsym clickable" data-chart="' + r.s + '" data-tf="D">' + r.s + "</span></td><td>" + money(r.p || (r.tech ? r.tech.px : 0)) + "</td><td>" + pct(chg) + "</td>" + tfCells(t) + "<td>" + ftfcBadge(r) + "</td></tr>";
    };
    const th = (label, col, start) => {
      const arrow = secSort.col === col ? (secSort.dir < 0 ? " ▼" : " ▲") : "";
      return '<th class="sortable" data-ssort="' + col + '" style="cursor:pointer;user-select:none' + (start ? ";text-align:start" : "") + '">' + label + arrow + "</th>";
    };
    const head = "<th></th>" + th("סימבול", "sym", true) + th("מחיר", "price") + th("%", "chg") + th("Y", "Y") + th("Q", "Q") + th("M", "M") + th("W", "W") + th("D", "D") + th("FTFC", "ftfc");
    const sortMembers = () => members.slice().sort((a, b) => {
      let va = secSortVal(a, secSort.col), vb = secSortVal(b, secSort.col);
      const na = va == null || va === "" || (typeof va === "number" && isNaN(va)), nb = vb == null || vb === "" || (typeof vb === "number" && isNaN(vb));
      if (na && nb) return 0; if (na) return 1; if (nb) return -1;
      if (typeof va === "string") return secSort.dir * va.localeCompare(vb);
      return secSort.dir * (va - vb);
    });
    let body, sub;
    if (isSub) {
      body = (secSort.col ? sortMembers() : members).map(rowHtml).join("");
      sub = "לחץ כותרת למיון";
    } else if (!secSort.col) {
      const byInd = {}; members.forEach(r => { const k = r.ind || "אחר"; (byInd[k] = byInd[k] || []).push(r); });
      const indNames = Object.keys(byInd).sort((a, b) => byInd[b].length - byInd[a].length);
      body = indNames.map(ind => '<tr class="sub-head"><td colspan="10">🏭 ' + ind + ' <span class="muted" style="font-weight:400">(' + byInd[ind].length + ")</span></td></tr>" + byInd[ind].map(rowHtml).join("")).join("");
      sub = indNames.length + " תתי-סקטורים · לחץ כותרת למיון";
    } else {
      body = sortMembers().map(rowHtml).join("");
      sub = "ממוין · לחץ שוב להפוך · לחץ סקטור מחדש לקיבוץ תתי-סקטורים";
    }
    const etf = isSub ? subEtfFor(indFilter) : etfFor(secName);
    const bar = '<div class="drill-bar"><button class="btn ghost" id="drillGrid" style="font-size:12px;font-weight:600">📊 תצוגת גרפים</button>' +
      '<button class="btn ghost" id="drillCopy" style="font-size:12px;font-weight:600">📋 העתק ' + members.length + " טיקרים</button>" +
      (etf ? '<span class="muted" style="font-size:12px">תעודת סל:</span>' + etfChip(etf) : "") + "</div>";
    modal(displayName + " · " + members.length + " מניות · " + sub,
      bar + '<div class="tablewrap"><table class="scan-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>" + colorLegend());
    const gbtn = $("#drillGrid");
    if (gbtn) gbtn.onclick = () => openChartGrid(members.map(r => ({ sym: r.s, sector: r.sec, ind: r.ind, price: r.p || (r.tech ? r.tech.px : 0), chg: r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0) })), { title: displayName });
    const cbtn = $("#drillCopy");
    if (cbtn) cbtn.onclick = () => copyToClipboard(members.map(r => r.s).join(", "), () => { cbtn.textContent = "✓ הועתקו " + members.length; setTimeout(() => cbtn.textContent = "📋 העתק " + members.length + " טיקרים", 1600); });
    document.querySelectorAll("[data-ssort]").forEach(h => h.onclick = () => {
      const c = h.dataset.ssort;
      if (secSort.col === c) secSort.dir *= -1; else { secSort.col = c; secSort.dir = c === "sym" ? 1 : -1; }
      renderSecDrill(secName, indFilter);
    });
  }

  // ========== GAPPERS ==========
  let gapSort = { col: "gp", dir: -1 };
  function gapVal(x, col) {
    if (col === "sym") return x.s;
    if (col === "price") return x.price || 0;
    if (col === "gd") return x.gd || 0;
    return x.gp || 0; // gp
  }
  function renderGappers() {
    const g = LIVE && LIVE.gappers;
    const head = '<div class="page-head"><h1>גאפרים</h1><div class="sub">כאן רואים מניות שפתחו בגאפ משמעותי (מעל/מתחת 3% מסגירת אתמול) — לזיהוי תנועה חריגה בתחילת היום. לחץ על כותרת למיון.</div></div>';
    if (g && (g.up.length || g.down.length)) {
      const gapTh = (label, col, start) => { const arrow = gapSort.col === col ? (gapSort.dir < 0 ? " ▼" : " ▲") : ""; return '<th class="sortable" data-gapsort="' + col + '" style="cursor:pointer;user-select:none' + (start ? ";text-align:start" : "") + '">' + label + arrow + "</th>"; };
      const gapTable = (arr, cls, title) => {
        const sorted = arr.slice().sort((a, b) => { const va = gapVal(a, gapSort.col), vb = gapVal(b, gapSort.col); if (typeof va === "string") return gapSort.dir * va.localeCompare(vb); return gapSort.dir * (va - vb); });
        const rows = sorted.map(x =>
          "<tr><td>" + star(x.s) + '</td><td class="sym"><span class="tsym clickable" data-chart="' + x.s + '" data-tf="D">' + x.s + "</span></td><td>" + money(x.price) + "</td><td class='" + cls + "'>" + (x.gd >= 0 ? "+" : "") + money(x.gd) + "</td><td>" + pct(x.gp) + "</td></tr>").join("");
        return '<div class="panel"><h3>' + title + ' <span class="muted" style="font-size:12px">' + arr.length + " מניות</span> <button class=\"btn ghost\" data-gapcopy=\"" + encodeURIComponent(arr.map(x => x.s).join(", ")) + "\" style=\"font-size:12px;font-weight:600\">📋 העתק " + arr.length + "</button></h3><div class='tablewrap'><table class='scan-table'><thead><tr><th></th>" + gapTh("סימבול", "sym", true) + gapTh("מחיר", "price") + gapTh("$Gap", "gd") + gapTh("%Gap", "gp") + "</tr></thead><tbody>" + (rows || '<tr><td colspan="5" class="muted">—</td></tr>') + "</tbody></table></div></div>";
      };
      return head + liveBanner() +
        '<div class="cols2">' + gapTable(g.up, "pos", "🟢 גאפ למעלה") + gapTable(g.down, "neg", "🔴 גאפ למטה") + "</div>";
    }
    // no gappers right now — honest empty state (market closed / nothing gapping >3%)
    const note = (LIVE && LIVE.updated)
      ? '<div class="demo-flag" style="background:rgba(22,184,119,.1);color:#7ee2b8;border-color:rgba(22,184,119,.25)">🟢 מחובר לנתונים חיים · אין כרגע מניות בגאפ מעל 3%</div>'
      : DEMO;
    return head + note +
      '<div class="panel"><div class="stub"><div class="big">⚡</div><h2>אין גאפרים כרגע</h2><p>גאפרים מחושבים <b>בזמן אמת בשעות המסחר</b> — מניות שפותחות מעל/מתחת ל-3% מסגירת אתמול. חזור כשהשוק פתוח והרשימה תתמלא אוטומטית.</p></div></div>';
  }
  function wireGappers() {
    document.querySelectorAll("[data-gapsort]").forEach(h => h.onclick = () => {
      const c = h.dataset.gapsort;
      if (gapSort.col === c) gapSort.dir *= -1; else { gapSort.col = c; gapSort.dir = c === "sym" ? 1 : -1; }
      reRender();
    });
    document.querySelectorAll("[data-gapcopy]").forEach(b => b.onclick = () => {
      const syms = decodeURIComponent(b.dataset.gapcopy), orig = b.textContent;
      copyToClipboard(syms, () => { b.textContent = "✓ הועתק"; setTimeout(() => b.textContent = orig, 1500); });
    });
    wireCharts($("#page"));
  }

  // ========== SMA COMPRESSION ==========
  const SMA_ALL = ["5", "10", "20", "50", "100", "150", "200"];
  const smaState = { periods: ["5", "10", "20", "50", "100", "200"], maxSpread: "" };
  function smaSpread(t, sel) {
    const k = t.tech && t.tech.dsma;
    if (!k) return null;
    const vals = sel.map(p => k[p]).filter(v => v != null);
    if (vals.length < 2) return null;
    return Math.max.apply(null, vals) - Math.min.apply(null, vals);
  }
  function smaRows() {
    const sel = smaState.periods.filter(Boolean);
    let rows = scanSource().map(t => ({ t: t, sp: smaSpread(t, sel) })).filter(x => x.sp != null);
    const maxSp = parseFloat(smaState.maxSpread);
    if (!isNaN(maxSp) && maxSp > 0) rows = rows.filter(x => x.sp <= maxSp);
    rows.sort((a, b) => a.sp - b.sp);
    return rows;
  }
  function renderSmaCompression() {
    const head0 = '<div class="page-head"><h1>📉 דחיסת ממוצעים · SMA Compression</h1><div class="sub">מניות שבהן הממוצעים הנבחרים <b>הכי צפופים</b> (התכווצות → לרוב לפני תנועה חדה) · + המרחק של כל ממוצע מהמחיר</div></div>';
    const isLive = !!(SCAN && SCAN.rows && SCAN.rows.length);
    const hasTech = scanSource().some(t => t.tech && t.tech.dsma);
    const sel = smaState.periods.filter(Boolean);
    const slot = i => { const cur = smaState.periods[i] || ""; return '<select data-smaslot="' + i + '"><option value="">— ריק</option>' + SMA_ALL.map(p => '<option value="' + p + '"' + (cur === p ? " selected" : "") + ">SMA" + p + "</option>").join("") + "</select>"; };
    const controls = '<div class="panel filters"><h3>הגדרות דחיסה <span class="muted" style="font-size:12px">בחר עד 6 ממוצעים (5–200) · אפשר להשאיר ריק</span></h3><div class="frow">' +
      '<div class="fgrp"><label>ממוצעים</label><div class="chips">' + [0, 1, 2, 3, 4, 5].map(slot).join("") + "</div></div>" +
      '<div class="fgrp"><label>דחיסה מקס׳ (%)</label><input id="smaMax" type="number" step="0.5" min="0" placeholder="הכל" style="width:80px" value="' + smaState.maxSpread + '"></div>' +
      '<div class="fgrp" style="align-self:flex-end"><button class="btn ghost" id="smaReset">איפוס</button></div>' +
      "</div></div>";
    if (!hasTech) return head0 + controls + '<div class="panel"><div class="note" style="margin:6px 0">⏳ נתוני הממוצעים ייטענו מהסורק. רגע ומתעדכן.</div></div>';
    if (sel.length < 2) return head0 + controls + '<div class="panel"><div class="stub"><div class="big">📉</div><h2>בחר לפחות 2 ממוצעים</h2><p>בחר את הממוצעים שביניהם לבדוק דחיסה (למשל 20 · 50 · 100 · 200).</p></div></div>';
    const rows = smaRows();
    const CAP = 300, shown = rows.slice(0, CAP);
    const body = shown.map(x => {
      const t = x.t, k = t.tech.dsma || {};
      return "<tr><td>" + star(t.sym) + "</td>" +
        '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + "</span></td>" +
        '<td class="tname" style="text-align:start">' + t.sector + "</td><td>" + money(t.price) + "</td>" +
        '<td class="sma-spread"><b>' + x.sp.toFixed(2) + "%</b></td>" +
        sel.map(p => "<td>" + dPct(k[p]) + "</td>").join("") +
        "<td>" + ftfcBadge(t) + "</td>" +
        '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td></tr>';
    }).join("");
    const head = "<th></th><th style='text-align:start'>סימבול</th><th style='text-align:start'>סקטור</th><th>מחיר</th><th title='טווח הממוצעים כאחוז מהמחיר — קטן = צפוף'>דחיסה ▲</th>" + sel.map(p => "<th>SMA" + p + "</th>").join("") + "<th>FTFC</th><th></th>";
    const nCols = 6 + sel.length;
    const results = '<div class="panel scan-results"><h3><span>תוצאות <span class="muted" style="font-size:12px">' + rows.length + " · מהצפוף לרחב</span></span>" + (rows.length ? '<button class="btn ghost" id="smaCopy" style="font-size:12px;font-weight:600">📋 העתק ' + Math.min(rows.length, CAP) + " טיקרים</button>" : "") + "</h3>" +
      '<div class="tablewrap"><table class="scan-table"><thead><tr>' + head + "</tr></thead><tbody>" + (shown.length ? body : '<tr><td colspan="' + nCols + '" class="muted" style="text-align:center;padding:30px">אין תוצאות</td></tr>') + "</tbody></table></div></div>";
    return head0 + (isLive ? liveBanner() : DEMO) + controls + results;
  }
  function wireSmaCompression() {
    document.querySelectorAll("[data-smaslot]").forEach(s => s.onchange = () => { smaState.periods[+s.dataset.smaslot] = s.value; reRender(); });
    const mx = $("#smaMax"); if (mx) mx.onchange = () => { smaState.maxSpread = mx.value; reRender(); };
    const rst = $("#smaReset"); if (rst) rst.onclick = () => { smaState.periods = ["5", "10", "20", "50", "100", "200"]; smaState.maxSpread = ""; reRender(); };
    wireCharts($("#page")); wireStars($("#page"));
    const cp = $("#smaCopy");
    if (cp) cp.onclick = () => { const syms = smaRows().slice(0, 300).map(x => x.t.sym).join(", "); copyToClipboard(syms, () => { const o = cp.textContent; cp.textContent = "✓ הועתקו"; setTimeout(() => cp.textContent = o, 1500); }); };
  }

  // ========== BOLLINGER BANDS ==========
  const bollingerState = { mode: "sq", maxSq: "" };
  const BB_MODES = [
    { k: "sq", t: "התכווצות (Squeeze)" },
    { k: "up", t: "פריצת רצועה עליונה" },
    { k: "low", t: "נגיעה ברצועה תחתונה" },
    { k: "all", t: "הכל" },
  ];
  function bbNum(v, suf) { return v == null ? "—" : v.toFixed(v >= 100 || v <= -10 ? 0 : 1) + (suf || ""); }
  function bbPct(v) {
    if (v == null) return "—";
    const cls = v >= 100 ? "pos" : v <= 0 ? "neg" : "zero";
    return '<span class="' + cls + '">' + v.toFixed(1) + "</span>";
  }
  function bbRows() {
    let rows = scanSource().filter(t => t.tech && t.tech.bbw != null);
    const m = bollingerState.mode;
    if (m === "up") { rows = rows.filter(t => t.tech.bbp != null && t.tech.bbp >= 100); rows.sort((a, b) => b.tech.bbp - a.tech.bbp); }
    else if (m === "low") { rows = rows.filter(t => t.tech.bbp != null && t.tech.bbp <= 0); rows.sort((a, b) => a.tech.bbp - b.tech.bbp); }
    else {
      rows = rows.filter(t => t.tech.bbsq != null);
      const mx = parseFloat(bollingerState.maxSq);
      if (!isNaN(mx) && mx > 0) rows = rows.filter(t => t.tech.bbsq <= mx);
      rows.sort((a, b) => a.tech.bbsq - b.tech.bbsq);
    }
    return rows;
  }
  function renderBollinger() {
    const head0 = '<div class="page-head"><h1>🎈 בולינגר · Bollinger Bands</h1><div class="sub">רצועות בולינגר (20, 2σ) · דחיסה (Squeeze) לפני פריצה · מיקום המחיר ברצועות (%B) · רוחב הרצועות</div></div>';
    const isLive = !!(SCAN && SCAN.rows && SCAN.rows.length);
    const hasTech = scanSource().some(t => t.tech && t.tech.bbw != null);
    const showSq = bollingerState.mode === "sq" || bollingerState.mode === "all";
    const controls = '<div class="panel filters"><h3>מצב סינון</h3><div class="frow"><div class="fgrp"><label>מצב</label><select id="bbMode">' +
      BB_MODES.map(o => '<option value="' + o.k + '"' + (bollingerState.mode === o.k ? " selected" : "") + ">" + o.t + "</option>").join("") + "</select></div>" +
      (showSq ? '<div class="fgrp"><label>דחיסה עד (%)</label><input id="bbMaxSq" type="number" step="5" min="0" max="100" placeholder="הכל" style="width:80px" value="' + bollingerState.maxSq + '"></div>' : "") + "</div>" +
      '<div class="note" style="margin-top:6px">🎈 <b>%B</b> = מיקום המחיר ברצועות: 0 = רצועה תחתונה, 100 = עליונה, מעל 100 = פרץ מעל. <b>רוחב</b> = מרחק הרצועות כאחוז מהמחיר. <b>דחיסה</b> = אחוז הימים ב-6 החודשים האחרונים שבהם הרצועות היו צרות יותר — נמוך = הרצועות הכי צמודות עכשיו (התכווצות לפני תנועה).</div></div>';
    if (!hasTech) return head0 + controls + '<div class="panel"><div class="note" style="margin:6px 0">⏳ נתוני בולינגר ייטענו מהסורק. רגע ומתעדכן.</div></div>';
    const rows = bbRows();
    const CAP = 300, shown = rows.slice(0, CAP);
    const body = shown.map(t => {
      const k = t.tech;
      return "<tr><td>" + star(t.sym) + "</td>" +
        '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + "</span></td>" +
        '<td class="tname" style="text-align:start">' + t.sector + "</td><td>" + money(t.price) + "</td>" +
        "<td>" + bbPct(k.bbp) + "</td>" +
        "<td>" + bbNum(k.bbw, "%") + "</td>" +
        '<td class="sma-spread"><b>' + bbNum(k.bbsq) + "</b></td>" +
        "<td>" + ftfcBadge(t) + "</td>" +
        '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td></tr>';
    }).join("");
    const sortHint = bollingerState.mode === "up" ? "%B ▼" : bollingerState.mode === "low" ? "%B ▲" : "דחיסה ▲";
    const head = "<th></th><th style='text-align:start'>סימבול</th><th style='text-align:start'>סקטור</th><th>מחיר</th><th title='מיקום ברצועות 0-100'>%B</th><th title='רוחב הרצועות כאחוז מהמחיר'>רוחב</th><th title='אחוז ימים עם רצועות צרות יותר — נמוך=דחוס'>דחיסה</th><th>FTFC</th><th></th>";
    const results = '<div class="panel scan-results"><h3><span>תוצאות <span class="muted" style="font-size:12px">' + rows.length + " · " + sortHint + "</span></span>" + (rows.length ? '<button class="btn ghost" id="bbCopy" style="font-size:12px;font-weight:600">📋 העתק ' + Math.min(rows.length, CAP) + " טיקרים</button>" : "") + "</h3>" +
      '<div class="tablewrap"><table class="scan-table"><thead><tr>' + head + "</tr></thead><tbody>" + (shown.length ? body : '<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">אין תוצאות במצב הזה</td></tr>') + "</tbody></table></div></div>";
    return head0 + (isLive ? liveBanner() : DEMO) + controls + results;
  }
  function wireBollinger() {
    const md = $("#bbMode"); if (md) md.onchange = () => { bollingerState.mode = md.value; reRender(); };
    const msq = $("#bbMaxSq"); if (msq) msq.onchange = () => { bollingerState.maxSq = msq.value; reRender(); };
    wireCharts($("#page")); wireStars($("#page"));
    const cp = $("#bbCopy");
    if (cp) cp.onclick = () => { const syms = bbRows().slice(0, 300).map(t => t.sym).join(", "); copyToClipboard(syms, () => { const o = cp.textContent; cp.textContent = "✓ הועתקו"; setTimeout(() => cp.textContent = o, 1500); }); };
  }

  // ========== SWING HIGHS & LOWS ==========
  const swingState = { mode: "nearHi", maxDist: "" };
  const SW_MODES = [
    { k: "nearHi", t: "קרוב לשיא סווינג" },
    { k: "brokeHi", t: "פרצו שיא סווינג" },
    { k: "nearLo", t: "קרוב לתחתית סווינג" },
    { k: "brokeLo", t: "שברו תחתית סווינג" },
  ];
  function swRows() {
    const m = swingState.mode;
    const mx = parseFloat(swingState.maxDist);
    const capNear = (v) => isNaN(mx) || mx <= 0 || Math.abs(v) <= mx;
    let rows = scanSource().filter(t => t.tech && (t.tech.swhi_d != null || t.tech.swlo_d != null));
    if (m === "nearHi") { rows = rows.filter(t => t.tech.swhi_d != null && capNear(t.tech.swhi_d)); rows.sort((a, b) => Math.abs(a.tech.swhi_d) - Math.abs(b.tech.swhi_d)); }
    else if (m === "brokeHi") { rows = rows.filter(t => t.tech.swhi_d != null && t.tech.swhi_d > 0); rows.sort((a, b) => a.tech.swhi_d - b.tech.swhi_d); }
    else if (m === "nearLo") { rows = rows.filter(t => t.tech.swlo_d != null && capNear(t.tech.swlo_d)); rows.sort((a, b) => Math.abs(a.tech.swlo_d) - Math.abs(b.tech.swlo_d)); }
    else { rows = rows.filter(t => t.tech.swlo_d != null && t.tech.swlo_d < 0); rows.sort((a, b) => b.tech.swlo_d - a.tech.swlo_d); }
    return rows;
  }
  function renderSwing() {
    const head0 = '<div class="page-head"><h1>〽️ סווינג · Swing Highs & Lows</h1><div class="sub">רמות השיא והתחתית האחרונות (pivot של 5 נרות מכל צד) + מרחק המחיר מכל רמה · תמיכה/התנגדות ופריצות</div></div>';
    const isLive = !!(SCAN && SCAN.rows && SCAN.rows.length);
    const hasTech = scanSource().some(t => t.tech && (t.tech.swhi_d != null || t.tech.swlo_d != null));
    const isNear = swingState.mode === "nearHi" || swingState.mode === "nearLo";
    const controls = '<div class="panel filters"><h3>מצב סינון</h3><div class="frow"><div class="fgrp"><label>מצב</label><select id="swMode">' +
      SW_MODES.map(o => '<option value="' + o.k + '"' + (swingState.mode === o.k ? " selected" : "") + ">" + o.t + "</option>").join("") + "</select></div>" +
      (isNear ? '<div class="fgrp"><label>מרחק מקס׳ (%)</label><input id="swMaxDist" type="number" step="0.5" min="0" placeholder="הכל" style="width:80px" value="' + swingState.maxDist + '"></div>' : "") + "</div>" +
      '<div class="note" style="margin-top:6px">〽️ <b>שיא סווינג</b> = הפיבוט הגבוה האחרון (נר שגבוה מ-5 נרות מכל צד) — התנגדות מעל. <b>תחתית סווינג</b> = הפיבוט הנמוך האחרון — תמיכה מתחת. המרחק הוא באחוזים: חיובי = המחיר מעל הרמה, שלילי = מתחת.</div></div>';
    if (!hasTech) return head0 + controls + '<div class="panel"><div class="note" style="margin:6px 0">⏳ נתוני הסווינג ייטענו מהסורק. רגע ומתעדכן.</div></div>';
    const rows = swRows();
    const CAP = 300, shown = rows.slice(0, CAP);
    const body = shown.map(t => {
      const k = t.tech;
      return "<tr><td>" + star(t.sym) + "</td>" +
        '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + "</span></td>" +
        '<td class="tname" style="text-align:start">' + t.sector + "</td><td>" + money(t.price) + "</td>" +
        "<td>" + (k.swhi != null ? money(k.swhi) : "—") + "</td><td>" + dPct(k.swhi_d) + "</td>" +
        "<td>" + (k.swlo != null ? money(k.swlo) : "—") + "</td><td>" + dPct(k.swlo_d) + "</td>" +
        "<td>" + ftfcBadge(t) + "</td>" +
        '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td></tr>';
    }).join("");
    const head = "<th></th><th style='text-align:start'>סימבול</th><th style='text-align:start'>סקטור</th><th>מחיר</th><th>שיא סווינג</th><th title='מרחק המחיר מהשיא'>מרחק לשיא</th><th>תחתית סווינג</th><th title='מרחק המחיר מהתחתית'>מרחק לתחתית</th><th>FTFC</th><th></th>";
    const results = '<div class="panel scan-results"><h3><span>תוצאות <span class="muted" style="font-size:12px">' + rows.length + "</span></span>" + (rows.length ? '<button class="btn ghost" id="swCopy" style="font-size:12px;font-weight:600">📋 העתק ' + Math.min(rows.length, CAP) + " טיקרים</button>" : "") + "</h3>" +
      '<div class="tablewrap"><table class="scan-table"><thead><tr>' + head + "</tr></thead><tbody>" + (shown.length ? body : '<tr><td colspan="10" class="muted" style="text-align:center;padding:30px">אין תוצאות במצב הזה</td></tr>') + "</tbody></table></div></div>";
    return head0 + (isLive ? liveBanner() : DEMO) + controls + results;
  }
  function wireSwing() {
    const md = $("#swMode"); if (md) md.onchange = () => { swingState.mode = md.value; reRender(); };
    const mdst = $("#swMaxDist"); if (mdst) mdst.onchange = () => { swingState.maxDist = mdst.value; reRender(); };
    wireCharts($("#page")); wireStars($("#page"));
    const cp = $("#swCopy");
    if (cp) cp.onclick = () => { const syms = swRows().slice(0, 300).map(t => t.sym).join(", "); copyToClipboard(syms, () => { const o = cp.textContent; cp.textContent = "✓ הועתקו"; setTimeout(() => cp.textContent = o, 1500); }); };
  }

  // ========== WHAT TO CHECK NOW (daily briefing) ==========
  function todayMarketState() {
    if (!LIVE || !LIVE.indices || !LIVE.indices.length) return null;
    const idx = LIVE.indices;
    const green = idx.filter(i => (i.chg || 0) > 0).length;
    const red = idx.filter(i => (i.chg || 0) < 0).length;
    const br = LIVE.breadth || {};
    const brGreen = (br.above != null && br.total) ? br.above / br.total : null;
    let mode, emoji, cls;
    if (green > red && (brGreen == null || brGreen >= 0.5)) { mode = "שוק חיובי · Risk-On"; emoji = "🟢"; cls = "pos"; }
    else if (red > green && (brGreen == null || brGreen < 0.5)) { mode = "שוק שלילי · Risk-Off"; emoji = "🔴"; cls = "neg"; }
    else { mode = "שוק מעורב · זהירות"; emoji = "🟡"; cls = "zero"; }
    return { mode, emoji, cls, idx, vix: LIVE.vix, br };
  }
  function todaySectors(rows) {
    const liveChg = {}; if (LIVE && LIVE.sectors) LIVE.sectors.forEach(s => liveChg[s.name] = s.chg);
    const m = {};
    rows.forEach(t => {
      const s = t.sector || "—";
      if (!m[s]) m[s] = { n: 0, green: 0, top: null, chgSum: 0, chgN: 0 };
      m[s].n++;
      if ((t.D || {}).c === "up") m[s].green++;
      if (t.chg != null) { m[s].chgSum += t.chg; m[s].chgN++; }
      if (t.mc && (!m[s].top || t.mc > m[s].top.mc)) m[s].top = { sym: t.sym, mc: t.mc, chg: t.chg };   // largest holding
    });
    // chg = the sector's official daily move (from LIVE.sectors) — the real "money flow";
    // falls back to the average move of its stocks when live data isn't loaded.
    return Object.keys(m).filter(s => m[s].n >= 3).map(s => ({
      name: s, n: m[s].n, greenPct: m[s].green / m[s].n * 100, top: m[s].top,
      chg: liveChg[s] != null ? liveChg[s] : (m[s].chgN ? m[s].chgSum / m[s].chgN : 0),
    }));
  }
  function todayStockRow(t) {
    return "<tr><td>" + ninjaCell(t.ninja, t.sym) + "</td>" +
      '<td>' + star(t.sym) + '</td>' +
      '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + "</span></td>" +
      '<td class="tname" style="text-align:start">' + secHe(t.sector) + "</td><td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" +
      "<td>" + ftfcBadge(t) + "</td>" +
      '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td></tr>';
  }
  function renderToday() {
    const head = '<div class="page-head"><h1>🎯 מה לבדוק עכשיו?</h1><div class="sub">התדריך היומי במבט אחד: מצב השוק, לאן הכסף זורם, ואיפה ה-Ninja Score הכי גבוה — ללונג ולשורט.</div></div>';
    const isLive = !!(SCAN && SCAN.rows && SCAN.rows.length);
    const rows = scanSource().filter(t => t.ninja != null);
    if (!rows.length) return head + '<div class="panel"><div class="note" style="margin:6px 0">⏳ הנתונים ייטענו מהסורק. רגע ומתעדכן.</div></div>';

    const ms = todayMarketState();
    let marketPanel;
    if (ms) {
      const strip = ms.idx.map(i => '<span class="td-idx"><b>' + i.sym + "</b> " + pct(i.chg) + "</span>").join("");
      const vixTxt = ms.vix ? '<span class="td-idx"><b>VIX</b> ' + ms.vix.level + "</span>" : "";
      let brBar = "";
      if (ms.br && ms.br.total) {
        const ap = (ms.br.above / ms.br.total * 100);
        brBar = '<div class="td-breadth"><span class="td-brlbl">רוחב שוק</span>' +
          '<span class="td-brbar"><span class="td-brup" style="width:' + ap.toFixed(1) + '%"></span></span>' +
          '<span class="td-brnum"><span class="pos">' + ms.br.above + '</span>/<span class="neg">' + ms.br.below + "</span></span></div>";
      }
      marketPanel = '<div class="panel td-market ' + ms.cls + '"><h3>מצב השוק</h3>' +
        '<div class="td-mode ' + ms.cls + '">' + ms.emoji + " " + ms.mode + "</div>" +
        '<div class="td-strip">' + strip + vixTxt + "</div>" + brBar + "</div>";
    } else {
      marketPanel = '<div class="panel td-market"><h3>מצב השוק</h3><div class="muted">התחבר לנתונים חיים כדי לראות מצב שוק בזמן אמת.</div></div>';
    }

    // "where the money flows" — every sector ranked by its daily move, as a diverging
    // bar (green = money IN → right, red = money OUT → left) with the leading holding.
    const flow = todaySectors(rows).sort((a, b) => b.chg - a.chg);
    const maxAbs = Math.max.apply(null, flow.map(s => Math.abs(s.chg)).concat([0.1]));
    const flowRow = s => {
      const pos = s.chg >= 0, w = Math.min(50, Math.abs(s.chg) / maxAbs * 50);
      const top = s.top ? '<span class="tdf-top" title="האחזקה הגדולה בסקטור"><span class="tsym clickable" data-chart="' + s.top.sym + '" data-tf="D">' + s.top.sym + "</span> " + pct(s.top.chg == null ? 0 : s.top.chg) + "</span>" : '<span class="tdf-top"></span>';
      return '<div class="tdf-row">' +
        '<span class="tdf-name">' + secHe(s.name) + (etfFor(s.name) ? " " + etfChip(etfFor(s.name)) : "") + "</span>" +
        '<span class="tdf-bar"><span class="tdf-center"></span><span class="tdf-fill ' + (pos ? "pos" : "neg") + '" style="width:' + w.toFixed(1) + '%"></span></span>' +
        '<span class="tdf-pct ' + (pos ? "pos" : "neg") + '">' + (pos ? "+" : "") + s.chg.toFixed(2) + "%</span>" + top +
      "</div>";
    };
    const sectorsPanel = '<div class="panel td-flow"><h3>🗂️ לאן הכסף זורם עכשיו <span class="muted" style="font-size:11px">כל הסקטורים לפי התנועה היום · 🟢 כסף נכנס · 🔴 כסף יוצא · + האחזקה הגדולה</span></h3>' +
      '<div class="tdf-list">' + (flow.length ? flow.map(flowRow).join("") : '<div class="muted" style="padding:10px">—</div>') + "</div></div>";

    const longs = rows.filter(t => (t.D || {}).c === "up").sort((a, b) => b.ninja - a.ninja).slice(0, 8);
    const shorts = rows.filter(t => (t.D || {}).c === "down").sort((a, b) => b.ninja - a.ninja).slice(0, 8);
    const tbl = (list, title) => {
      const syms = list.map(t => t.sym).join(", ");
      const btns = list.length
        ? '<span style="display:flex;gap:6px"><button class="btn ghost td-grid" data-syms="' + encodeURIComponent(syms) + '" style="font-size:12px;font-weight:600">📊 גרפים</button>' +
          '<button class="btn ghost td-copy" data-syms="' + encodeURIComponent(syms) + '" style="font-size:12px;font-weight:600">📋 העתק ' + list.length + "</button></span>"
        : "";
      return '<div class="panel"><h3 class="td-tbl-head"><span>' + title + ' <span class="muted" style="font-size:12px">Top ' + list.length + " לפי Ninja Score</span></span>" + btns + "</h3>" +
        (list.length ? '<div class="tablewrap"><table class="scan-table"><thead><tr><th>Score</th><th></th><th style="text-align:start">סימבול</th><th style="text-align:start">סקטור</th><th>מחיר</th><th>%</th><th>FTFC</th><th></th></tr></thead><tbody>' + list.map(todayStockRow).join("") + "</tbody></table></div>" : '<div class="muted" style="padding:14px">אין מועמדים ברורים כרגע.</div>') + "</div>";
    };

    return head + (isLive ? liveBanner() : DEMO) +
      '<div class="td-topgrid">' + marketPanel + sectorsPanel + "</div>" +
      '<div class="td-two">' + tbl(longs, "🟢 מועמדים ללונג") + tbl(shorts, "🔴 מועמדים לשורט") + "</div>" +
      '<div class="note" style="margin-top:6px;font-size:11px">💡 <b>Ninja Score</b> מדרג איכות סטאפ (יישור טיימפריימים, ווליום, תבנית, כסף חכם, קרבה לממוצע, נזילות, חוזק סקטור). זהו כלי מיון — לא המלצת קנייה/מכירה. תמיד אמת בגרף.</div>';
  }
  function wireToday() {
    wireCharts($("#page")); wireStars($("#page"));
    document.querySelectorAll(".td-copy").forEach(b => b.onclick = () => {
      const syms = decodeURIComponent(b.dataset.syms), o = b.textContent;
      copyToClipboard(syms, () => { b.textContent = "✓ הועתקו"; setTimeout(() => b.textContent = o, 1500); });
    });
    document.querySelectorAll(".td-grid").forEach(b => b.onclick = () => {
      const syms = decodeURIComponent(b.dataset.syms).split(", ").filter(Boolean);
      const gridRows = syms.map(sym => {
        const r = (SCAN && SCAN.rows) ? SCAN.rows.find(x => x.s === sym) : null;
        return r ? { sym: sym, sector: r.sec, ind: r.ind, price: r.p || (r.tech ? r.tech.px : 0), chg: r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0) } : { sym: sym };
      });
      if (gridRows.length) openChartGrid(gridRows, { title: "מה לבדוק עכשיו" });
    });
  }

  // ========== FAVORITES ==========
  function renderFavorites() {
    const favs = window.Prefs ? window.Prefs.favorites() : [];
    const list = favs.map(sym => {
      const r = (SCAN && SCAN.rows) ? SCAN.rows.find(x => x.s === sym) : null;    // prefer LIVE scan data (sector/sub-sector)
      if (r) return { sym: sym, name: "", sector: r.sec, ind: r.ind, price: r.p || (r.tech ? r.tech.px : 0), chg: r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0), Y: r.Y, Q: r.Q, M: r.M, W: r.W, D: r.D };
      return TICKERS.find(t => t.sym === sym) || { sym: sym, name: "", sector: "", ind: "", price: 0, chg: 0, Y: cell("1", "doji"), Q: cell("1", "doji"), M: cell("1", "doji"), W: cell("1", "doji"), D: cell("1", "doji") };
    });
    let body;
    if (!favs.length) {
      body = '<div class="panel"><div class="stub"><div class="big">⭐</div><h2>אין עדיין מועדפים</h2><p>לחץ על הכוכב ⭐ ליד מניות בסורק, בסקטורים או בגאפרים כדי להוסיף אותן לכאן.</p><button class="btn primary" id="goScanner">לסורק העסקאות</button></div></div>';
    } else {
      // which favorites currently match one or more of the saved scan presets (for the highlight + count badge)
      const presets = (window.Prefs && window.Prefs.scanPresets) ? window.Prefs.scanPresets() : [];
      const pmatch = {};
      const _addMatch = (sym, name) => { const a = pmatch[sym] = pmatch[sym] || []; if (a.indexOf(name) < 0) a.push(name); };
      // (a) live matches — re-run each saved preset against the current scan data
      if (SCAN && SCAN.rows && SCAN.rows.length && presets.length) {
        presets.forEach(p => { let m = []; try { m = evalPreset(p) || []; } catch (e) {} m.forEach(sym => _addMatch(sym, p.name)); });
      }
      // (b) today's fired alerts — covers stocks that matched but aren't in the current scan snapshot
      const _feed = (window.Prefs && window.Prefs.alertFeed) ? window.Prefs.alertFeed() : [];
      const _today = new Date().toISOString().slice(0, 10);
      _feed.forEach(e => { if (e && e.date === _today && favs.indexOf(e.sym) >= 0) _addMatch(e.sym, e.preset); });
      const rows = list.map(t => {
        const pm = pmatch[t.sym] || [];
        const badge = pm.length ? '<span class="fav-pcount" title="נמצאת ב-' + pm.length + ' סריקות: ' + escAttr(pm.join(", ")) + '">' + pm.length + "</span>" : "";
        return "<tr" + (pm.length ? ' class="fav-inpreset"' : "") + '><td><span class="fav-starcell">' + star(t.sym) + badge + "</span></td>" +
          '<td class="sym"><span class="tsym clickable" data-chart="' + t.sym + '" data-tf="D">' + t.sym + "</span></td>" +
          '<td class="tname" style="text-align:start">' + (t.sector ? secHe(t.sector) : "—") + "</td>" +
          '<td class="tname" style="text-align:start">' + (t.ind ? t.ind + (subEtfFor(t.ind) ? ' <span class="muted">· ' + subEtfFor(t.ind) + "</span>" : "") : "—") + "</td>" +
          "<td>" + money(t.price) + "</td><td>" + pct(t.chg) + "</td>" + tfCells(t) + '<td><a class="tvlink" href="https://www.tradingview.com/chart/?symbol=' + t.sym + '" target="_blank" rel="noopener">📈</a></td></tr>';
      }).join("");
      body = '<div class="panel"><h3 style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span>רשימת המעקב שלי <span class="muted" style="font-size:12px">' + favs.length + ' מניות</span></span><button class="btn ghost" id="favGrid" style="font-size:12px;font-weight:600">📊 תצוגת גרפים</button></h3><div class=\'tablewrap\'><table class=\'scan-table\'><thead><tr><th></th><th style=\'text-align:start\'>סימבול</th><th style=\'text-align:start\'>סקטור</th><th style=\'text-align:start\'>תת-סקטור</th><th>מחיר</th><th>%</th>' + tfHeadCols() + "<th></th></tr></thead><tbody>" + rows + "</tbody></table></div>" + colorLegend() + "</div>";
    }
    return '<div class="page-head"><h1>מועדפים</h1><div class="sub">רשימת המעקב האישית שלך · נשמרת בענן</div></div>' + body;
  }
  function wireFavorites() {
    const g = $("#goScanner"); if (g) g.onclick = () => setPage("scanner");
    const fg = $("#favGrid");
    if (fg) fg.onclick = () => {
      const favs = window.Prefs ? window.Prefs.favorites() : [];
      const favRows = favs.map(sym => {
        const r = (SCAN && SCAN.rows) ? SCAN.rows.find(x => x.s === sym) : null;
        return r ? { sym: sym, sector: r.sec, ind: r.ind, price: r.p || (r.tech ? r.tech.px : 0), chg: r.c || (r.tech && r.tech.chg != null ? r.tech.chg : 0) } : { sym: sym };
      });
      if (favRows.length) openChartGrid(favRows, { title: "רשימת המעקב" });
    };
    wireStars(); wireCharts();
  }

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
      "</div><div class='note' style='margin-top:8px'>🟢 ההתראות פעילות — נשלחות לערוץ הדיסקורד בכל סריקה (עד כל ~15 דק' בשעות המסחר). כל סטאפ נשלח פעם ביום כדי לא להציף. \"מייל\" מנותב בינתיים לדיסקורד.</div></div>";
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
  function modal(title, bodyHtml, extraCls) {
    closeModal();
    const bg = document.createElement("div"); bg.className = "modal-bg"; bg.id = "pgModal";
    const m = document.createElement("div"); m.className = "modal wide" + (extraCls ? " " + extraCls : "");
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
        if (_starJustDragged) return;          // a drag just handled these — don't double-toggle
        window.Prefs.toggleFav(b.dataset.star);
        b.classList.toggle("on");
        b.textContent = b.classList.contains("on") ? "★" : "☆";
        if (state.page === "favorites") reRender();
      };
    });
  }
  // ---- drag-to-select stars: press on a star and drag over more to mark/unmark them all ----
  let _starDrag = null, _starJustDragged = false;
  function _paintStar(btn, on) {
    if (!btn || !window.Prefs) return;
    const sym = btn.dataset.star;
    if (window.Prefs.isFav(sym) !== on) window.Prefs.toggleFav(sym);
    btn.classList.toggle("on", on);
    btn.textContent = on ? "★" : "☆";
  }
  function _setupStarDrag() {
    document.addEventListener("mousedown", e => {
      const btn = e.target && e.target.closest && e.target.closest("[data-star]");
      if (!btn || !window.Prefs) return;
      e.preventDefault();                                    // no text selection while dragging
      _starDrag = { start: btn, target: !window.Prefs.isFav(btn.dataset.star), dragged: false };
    });
    document.addEventListener("mouseover", e => {
      if (!_starDrag) return;
      const btn = e.target && e.target.closest && e.target.closest("[data-star]");
      if (!btn) return;
      if (btn === _starDrag.start && !_starDrag.dragged) return;       // still on the start star — not a drag yet
      if (!_starDrag.dragged) { _starDrag.dragged = true; _paintStar(_starDrag.start, _starDrag.target); }
      _paintStar(btn, _starDrag.target);
    });
    document.addEventListener("mouseup", () => {
      if (!_starDrag) return;
      const dragged = _starDrag.dragged;
      _starDrag = null;
      if (dragged) {
        _starJustDragged = true;                             // block the trailing click's toggle (only after a real drag)
        setTimeout(() => { _starJustDragged = false; }, 0);
        if (state.page === "favorites") setTimeout(() => reRender(), 0);  // refresh rows/badges AFTER the click
      }
    });
  }

  // ---------- router ----------
  const PAGES = {
    market: { render: renderMarket, wire: wireMarket },
    today: { render: renderToday, wire: wireToday },
    sp500: { render: renderSp500, wire: wireSp500 },
    scanner: { render: renderScanner, wire: wireScanner },
    sectors: { render: renderSectors, wire: wireSectors },
    gappers: { render: renderGappers, wire: wireGappers },
    favorites: { render: renderFavorites, wire: wireFavorites },
    // alerts: { render: renderAlerts, wire: wireAlerts },  // hidden per Adi 2026-07-05; re-enable on request
  };
  const state = { page: "market" };

  function reRender() {
    const p = PAGES[state.page]; if (!p) return;
    $("#page").innerHTML = p.render();
    if (p.wire) p.wire();
    wireStars($("#page"));
    wireCharts($("#page"));
    wireNinja($("#page"));
  }

  function setPage(name) {
    document.querySelectorAll(".side-nav a").forEach(a => a.classList.toggle("active", a.dataset.page === name));
    const jc = $("#journalContainer"), pg = $("#page");
    if (name === "journal") { pg.classList.add("hidden"); jc.classList.remove("hidden"); state.page = "journal"; if (window.Journal && window.Journal.onEnter) window.Journal.onEnter(); }
    else { jc.classList.add("hidden"); pg.classList.remove("hidden"); state.page = PAGES[name] ? name : "market"; reRender(); }
    if (state.page === "scanner" || state.page === "sectors" || state.page === "market" || state.page === "today") { loadScanner(); if (state.page === "today") loadLive(); }
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
      if (j && j[0] && j[0].data) { LIVE = j[0].data; _liveTs = Date.now(); updateTicker(); if (state.page === "market" || state.page === "today") reRender(); }
    } catch (e) { /* keep demo data */ }
  }

  let _scanLoaded = false;
  async function fetchScanner() {
    try {
      const cfg = window.SN_CONFIG;
      if (!cfg || !cfg.SUPABASE_URL) return;
      const url = cfg.SUPABASE_URL + "/rest/v1/scanner_data?id=eq.latest&select=data";
      const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY } });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j[0] && j[0].data) {
        SCAN = j[0].data;
        if (state.page === "scanner" || state.page === "sectors" || state.page === "market" || state.page === "today") reRender();
        checkPresetAlerts();   // fire preset × favorites alerts on fresh scan data
      }
    } catch (e) { /* keep demo */ }
  }
  async function loadScanner() {
    if (_scanLoaded) return;
    _scanLoaded = true;
    fetchScanner();
  }

  // ---- Hebrew news feed (opens from the sidebar; not a permanent floating box) ----
  let NEWS = null, _newsOpen = false;
  try { _newsOpen = localStorage.getItem("sn_news_open") === "1"; } catch (e) {}
  async function loadNews() {
    try {
      const cfg = window.SN_CONFIG; if (!cfg || !cfg.SUPABASE_URL) return;
      const r = await fetch(cfg.SUPABASE_URL + "/rest/v1/market_snapshot?id=eq.news&select=data",
        { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY } });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j[0] && j[0].data) { NEWS = j[0].data; if (_newsOpen) renderNewsFeed(); updateNewsNav(); }
    } catch (e) {}
  }
  function updateNewsNav() {
    const b = document.getElementById("sideNews"); if (!b) return;
    b.classList.toggle("active", _newsOpen);
  }
  function toggleNews() {
    _newsOpen = !_newsOpen;
    try { localStorage.setItem("sn_news_open", _newsOpen ? "1" : "0"); } catch (e) {}
    if (_newsOpen) { if (!NEWS) loadNews(); else renderNewsFeed(); }
    else { const box = document.getElementById("newsFeed"); if (box) box.classList.add("hidden"); }
    updateNewsNav();
  }
  function newsSession() {
    try {
      const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const m = et.getHours() * 60 + et.getMinutes(), wd = et.getDay();
      if (wd === 0 || wd === 6) return "🔴 השוק סגור (סופ״ש)";
      if (m >= 240 && m < 570) return "🟡 פרה-מרקט";
      if (m >= 570 && m < 960) return "🟢 שוק פתוח";
      if (m >= 960 && m < 1200) return "🟡 אפטר-מרקט";
      return "🔴 השוק סגור";
    } catch (e) { return ""; }
  }
  function timeAgoHe(iso) {
    if (!iso) return "";
    const d = new Date(iso.length <= 19 ? iso + "Z" : iso), s = (Date.now() - d.getTime()) / 1000;
    if (isNaN(s)) return "";
    if (s < 90) return "עכשיו";
    if (s < 3600) return "לפני " + Math.round(s / 60) + " ד׳";
    if (s < 86400) return "לפני " + Math.round(s / 3600) + " ש׳";
    return "לפני " + Math.round(s / 86400) + " י׳";
  }
  function renderNewsFeed() {
    const box = document.getElementById("newsFeed");
    if (!box || !NEWS) return;
    box.classList.remove("hidden");
    box.className = "news-feed";
    const list = (NEWS.cards || []).map(c =>
      '<a class="nf-item" href="' + escAttr(c.url || "#") + '" target="_blank" rel="noopener">' +
      '<div class="nf-he">' + (c.he || c.en || "") + "</div>" +
      '<div class="nf-meta">' + ((c.tk || []).slice(0, 3).map(t => '<span class="nf-tk">' + escAttr(t) + "</span>").join("")) +
      '<span class="nf-src">' + escAttr(c.pub || "") + "</span><span class=\"nf-time\">" + timeAgoHe(c.ts) + "</span></div></a>").join("");
    box.innerHTML =
      '<div class="nf-head"><span class="nf-title">🗞️ חדשות בזמן אמת</span>' +
      '<button class="nf-min" id="nfClose" title="סגור">✕</button></div>' +
      '<a class="nf-cta" href="https://www.patreon.com/14520383/join" target="_blank" rel="noopener">' +
        '<span class="nf-cta-ico">🎓</span>' +
        '<span class="nf-cta-txt"><b>רוצה להבין את הגרפים טוב יותר?</b><span>הצטרף לקורס ולקהילת StratNinja →</span></span>' +
      "</a>" +
      '<div class="nf-status">' + newsSession() + " · עודכן " + timeAgoHe(NEWS.updated) + "</div>" +
      '<div class="nf-list">' + (list || '<div class="muted" style="padding:12px">אין חדשות כרגע.</div>') + "</div>";
    const cl = document.getElementById("nfClose"); if (cl) cl.onclick = () => toggleNews();
  }

  // ---- persistent live ticker (SPY / QQQ / BTC) ----
  let _btc = null, _btcTs = 0, _liveTs = 0;
  async function fetchBtc() {
    if (_btc && Date.now() - _btcTs < 45000) return _btc;
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true");
      if (r.ok) { const j = await r.json(); if (j && j.bitcoin) { _btc = { price: j.bitcoin.usd, chg: j.bitcoin.usd_24h_change }; _btcTs = Date.now(); } }
    } catch (e) { /* keep last */ }
    return _btc;
  }
  function tickerItem(sym, name, price, chg, chartSym, noDollar) {
    const c = chg == null ? 0 : chg;
    // VIX: rising volatility is "bad" (red), falling is "good" (green) — invert the color
    const cls = noDollar ? (c > 0 ? "neg" : c < 0 ? "pos" : "zero") : (c > 0 ? "pos" : c < 0 ? "neg" : "zero");
    const cs = (c >= 0 ? "+" : "") + c.toFixed(2) + "%";
    const pxTxt = price == null ? "—" : (noDollar ? "" : "$") + Number(price).toLocaleString("en-US", { maximumFractionDigits: price >= 1000 ? 0 : 2 });
    return '<span class="lt-item tsym clickable" data-chart="' + (chartSym || sym) + '" data-tf="D" title="' + name + '"><b class="lt-sym">' + sym + "</b><span class=\"lt-px\">" + pxTxt + '</span><span class="' + cls + '">' + cs + "</span></span>";
  }
  async function updateTicker() {
    const el = document.getElementById("liveTicker");
    if (!el) return;
    const btc = await fetchBtc();                                  // await BEFORE reading LIVE
    const idx = (LIVE && LIVE.indices) ? LIVE.indices : [];        // read LIVE after await → no race
    const spy = idx.find(x => x.sym === "SPY"), qqq = idx.find(x => x.sym === "QQQ");
    const dia = idx.find(x => x.sym === "DIA"), iwm = idx.find(x => x.sym === "IWM");
    let html = "";
    if (spy) html += tickerItem("SPY", "S&P 500", spy.price, spy.chg);
    if (qqq) html += tickerItem("QQQ", "NASDAQ 100", qqq.price, qqq.chg);
    if (dia) html += tickerItem("DIA", "Dow Jones", dia.price, dia.chg);
    if (iwm) html += tickerItem("IWM", "Russell 2000", iwm.price, iwm.chg);
    if (LIVE && LIVE.vix) html += tickerItem("VIX", "Volatility", LIVE.vix.level, LIVE.vix.chg, "TVC:VIX", true);
    if (btc) html += tickerItem("BTC", "Bitcoin", btc.price, btc.chg, "BINANCE:BTCUSD");
    html += '<span class="lt-sync" id="ltSync"></span>';
    el.innerHTML = html || '<span class="muted" style="font-size:12px;padding-inline-start:4px">טוען מחירים…</span>';
    updateSync();
    wireCharts(el);
  }
  // freshness + next-scan countdown at the end of the ticker (updated every second).
  // Reflects the SERVER scan cadence — market snapshot every 3 min, ticker prices refreshed with it.
  function updateSync() {
    const s = document.getElementById("ltSync");
    if (!s) return;
    const now = Date.now();
    const upd = (LIVE && LIVE.updated) ? new Date(LIVE.updated) : null;
    if (!upd) { s.innerHTML = '<span class="lt-dot zero"></span><span class="muted">טוען נתונים…</span>'; return; }
    const hhmm = d => d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    const scanTime = (SCAN && SCAN.updated) ? new Date(SCAN.updated) : null;
    const tip = "מחירי מדדים/שוק מתעדכנים כל 3 דקות · סורק המניות כל 15 דקות (בשעות המסחר בלבד)."
      + " מדדים נכון ל-" + upd.toLocaleString("he-IL")
      + (scanTime ? " · מחירי מניות (סורק) נכון ל-" + scanTime.toLocaleString("he-IL") : "");
    const ageMin = (now - upd.getTime()) / 60000;
    if (ageMin > 8) {   // stale — market closed / no recent scan
      s.innerHTML = '<span class="lt-dot stale" title="' + tip + '"></span><span class="lt-fresh">🕐 נכון ל-' + hhmm(upd) + '</span><span class="muted lt-next">· השוק סגור</span>';
      return;
    }
    const CAD = 3 * 60 * 1000;   // matches the */3 market-snapshot cron
    const next = Math.ceil(now / CAD) * CAD - now;
    const nextTxt = Math.floor(next / 60000) + ":" + String(Math.floor(next / 1000) % 60).padStart(2, "0");
    s.innerHTML = '<span class="lt-dot pos" title="' + tip + '"></span><span class="lt-fresh">🕐 עודכן ' + hhmm(upd) + '</span><span class="muted lt-next">· סריקה הבאה ~' + nextTxt + '</span>';
  }
  window._snUpdateTicker = updateTicker;
  // ================= onboarding GUIDE (guided tour) =================
  const GUIDE_STEPS = [
    { page: null, ico: "👋", t: "ברוך הבא ל-StratNinja", d: "סיור קצר שיראה לך איפה כל דבר ואיך משתמשים באתר. אפשר לדלג בכל רגע — ותמיד לפתוח שוב מהכפתור 📖 שליד הלוגו." },
    { page: "market", ico: "📊", t: "סקירת שוק", d: "תמונת השוק במבט אחד: לאן נעים המדדים, ה-VIX (מדד הפחד), רוחב השוק, מפת הנרות של The Strat, הסקטורים החזקים/חלשים והגאפרים של היום." },
    { page: "sp500", ico: "🗺️", t: "S&P 500", d: "מפת חום של 500 החברות הגדולות — לראות בבירור לאן הכסף זורם היום, לפי סקטורים וגודל חברה." },
    { page: "sectors", ico: "🗂️", t: "סקטורים", d: "פירוק לכל סקטור ותת-סקטור: מי מוביל, מי בפיגור, ואילו מניות בולטות בכל אחד." },
    { page: "today", ico: "🎯", t: "מה לבדוק עכשיו", d: "קיצור דרך: האחזקה הבולטת בכל סקטור והתנועות החשובות — מכאן כדאי להתחיל את הבדיקה היומית." },
    { page: "scanner", ico: "🔍", t: "סורק העסקאות — הלב של המערכת", d: "מסננים מניות לפי תבניות Strat, טיימפריימים ופילטרים טכניים. כל מניה מקבלת <b>Ninja Score</b> (0–100) שמדרג את איכות הסטאפ. אפשר לשמור <b>סריקות מועדפות (PRESETS)</b> ולקבל 🔔 התראה כשמניה מהמועדפים נכנסת לסריקה." },
    { page: "favorites", ico: "⭐", t: "מועדפים", d: "סמן ★ על כל מניה כדי להוסיף אותה לרשימת המעקב האישית — נשמרת בענן ומסתנכרנת בין כל המכשירים שלך." },
    { page: "journal", ico: "📅", t: "יומן מסחר", d: "העלה דוח מהברוקר או הזן עסקאות ידנית — ותקבל דשבורד רווח/הפסד, לוח שנה וסטטיסטיקות אישיות, בסגנון Tradezella." },
    { page: null, ico: "🗞️", t: "חדשות, שיתוף והתראות לפלאפון", d: "בסרגל הצד: 🗞️ חדשות שוק מתורגמות לעברית, ו-📷 שיתוף מסך. בסורק אפשר להפעיל <b>התראות לפלאפון (Push)</b> שיקפיצו אותך גם כשהאתר סגור." },
    { page: null, ico: "🚀", t: "זהו — אתה מוכן!", d: "תמיד אפשר לפתוח את המדריך שוב מהכפתור 📖 שליד הלוגו. בהצלחה במסחר!" },
  ];
  let _guideIdx = 0;
  function guideRender() {
    const s = GUIDE_STEPS[_guideIdx], n = GUIDE_STEPS.length;
    const isLast = _guideIdx === n - 1, isFirst = _guideIdx === 0;
    const dots = GUIDE_STEPS.map((_, i) => '<span class="gd-dot' + (i === _guideIdx ? " on" : "") + '"></span>').join("");
    let el = document.getElementById("snGuide");
    if (!el) { el = document.createElement("div"); el.id = "snGuide"; el.className = "guide-wrap"; document.body.appendChild(el); }
    el.innerHTML =
      '<div class="guide-card">' +
        '<button class="guide-x" id="gdX" title="סגור">✕</button>' +
        '<div class="gd-ico">' + s.ico + "</div>" +
        '<div class="gd-step">שלב ' + (_guideIdx + 1) + " מתוך " + n + "</div>" +
        '<h3 class="gd-title">' + s.t + "</h3>" +
        '<p class="gd-text">' + s.d + "</p>" +
        '<div class="gd-dots">' + dots + "</div>" +
        '<div class="gd-nav">' +
          (isFirst ? '<span></span>' : '<button class="btn ghost" id="gdPrev">הקודם</button>') +
          '<button class="btn primary" id="gdNext">' + (isLast ? "סיום ✓" : "הבא →") + "</button>" +
        "</div>" +
      "</div>";
    el.querySelector("#gdX").onclick = guideClose;
    el.querySelector("#gdNext").onclick = () => { if (isLast) guideClose(); else guideGo(_guideIdx + 1); };
    const pv = el.querySelector("#gdPrev"); if (pv) pv.onclick = () => guideGo(_guideIdx - 1);
  }
  function guideGo(i) {
    _guideIdx = Math.max(0, Math.min(GUIDE_STEPS.length - 1, i));
    const p = GUIDE_STEPS[_guideIdx].page;
    if (p) setPage(p);
    guideRender();
  }
  function guideStart() { _guideIdx = 0; const p = GUIDE_STEPS[0].page; if (p) setPage(p); guideRender(); }
  function guideClose() { const el = document.getElementById("snGuide"); if (el) el.remove(); try { localStorage.setItem("sn_guide_seen", "1"); } catch (e) {} }
  window.SNGuide = {
    start: guideStart,
    autoStartIfNew: function () {
      let seen; try { seen = localStorage.getItem("sn_guide_seen"); } catch (e) {}
      if (seen) return;
      try { localStorage.setItem("sn_guide_seen", "1"); } catch (e) {}  // set immediately so it auto-runs only once
      setTimeout(() => { if (document.getElementById("page")) guideStart(); }, 500);
    },
  };

  // ================= 52-week-high celebration widget =================
  // A small floating card that celebrates one stock at a new 52-week high at a time,
  // rotating every 30s with a countdown bar showing when the next one appears.
  const ATH_SECS = 30;
  let _athList = [], _athIdx = 0, _athTimer = null, _athMin = false;
  try { _athMin = localStorage.getItem("sn_ath_min") === "1"; } catch (e) {}
  // clicking the widget → scanner, pre-filtered to stocks at a 52-week high, sorted high-first
  function goScanner52wHigh() {
    try {
      resetScan();
      techState.techOpen = true;
      techState.ext52 = "high"; techState.ext52Pct = 1;
      scanSort.col = "dhi52"; scanSort.dir = -1;   // closest to the 52-week high first
    } catch (e) {}
    setPage("scanner");
  }
  function _athStocks() {
    if (!(SCAN && SCAN.rows && SCAN.rows.length)) return [];
    return SCAN.rows.filter(r => {
      const k = r.tech; if (!k) return false;
      const chg = r.c != null ? r.c : (k.chg != null ? k.chg : null);
      const px = r.p || k.px || 0;
      // at (or within 0.3% of) the 52-week high, green today, tradable
      return k.dhi52 != null && k.dhi52 >= -0.3 && (chg == null || chg > 0) &&
        (k.avol30 == null || k.avol30 >= 300000) && px >= 3;
    }).map(r => ({ sym: r.s, sec: r.sec, ind: r.ind, price: r.p || (r.tech ? r.tech.px : 0),
      chg: r.c != null ? r.c : (r.tech ? r.tech.chg : 0) }))
      .sort((a, b) => (b.chg || 0) - (a.chg || 0));
  }
  function _athEl() {
    let e = document.getElementById("athCeleb");
    if (!e) { e = document.createElement("div"); e.id = "athCeleb"; document.body.appendChild(e); }
    return e;
  }
  function _athShow(i) {
    if (!_athList.length) { const e = document.getElementById("athCeleb"); if (e) e.remove(); return; }
    _athIdx = ((i % _athList.length) + _athList.length) % _athList.length;
    const s = _athList[_athIdx];
    const e = _athEl();
    if (_athMin) {
      // collapsed pill — always visible so it can be re-opened
      e.className = "ath-celeb ath-mini";
      e.onclick = null;
      e.innerHTML = '<button class="ath-mini-btn" id="athExpand" title="הצג שיאי 52 שבועות">🚀 שיא 52ש׳ · <b>' + s.sym + "</b> ▲</button>";
      { const ex = document.getElementById("athExpand"); if (ex) ex.onclick = () => { _athMin = false; try { localStorage.setItem("sn_ath_min", "0"); } catch (e2) {} _athShow(_athIdx); }; }
      clearTimeout(_athTimer);
      _athTimer = setTimeout(() => _athShow(_athIdx + 1), ATH_SECS * 1000);
      return;
    }
    e.className = "ath-celeb";
    e.innerHTML =
      '<button class="ath-x" id="athMin" title="מזער">▬</button>' +
      '<div class="ath-badge">🚀 שיא 52 שבועות!</div>' +
      '<div class="ath-main"><span class="ath-sym tsym clickable" data-chart="' + s.sym + '" data-tf="D">' + s.sym + "</span>" +
        '<span class="ath-price">' + money(s.price) + " " + pct(s.chg == null ? 0 : s.chg) + "</span></div>" +
      '<div class="ath-sub">' + (secHe(s.sec) || "") + (s.ind ? " · " + s.ind : "") + ' <span class="muted">· ' + (_athIdx + 1) + "/" + _athList.length + "</span></div>" +
      '<div class="ath-cta">כל השיאים בסורק ←</div>' +
      '<div class="ath-timer"><span class="ath-timerbar" id="athBar"></span></div>';
    wireCharts(e);
    // whole card → scanner filtered to 52-week highs; ticker keeps its own chart click
    e.onclick = () => goScanner52wHigh();
    { const sym = e.querySelector(".ath-sym"); if (sym) sym.addEventListener("click", ev => ev.stopPropagation()); }
    { const mn = document.getElementById("athMin"); if (mn) mn.onclick = ev => { ev.stopPropagation(); _athMin = true; try { localStorage.setItem("sn_ath_min", "1"); } catch (e2) {} _athShow(_athIdx); }; }
    const bar = document.getElementById("athBar");
    if (bar) { bar.style.transition = "none"; bar.style.width = "100%"; void bar.offsetWidth; bar.style.transition = "width " + ATH_SECS + "s linear"; bar.style.width = "0%"; }
    clearTimeout(_athTimer);
    _athTimer = setTimeout(() => _athShow(_athIdx + 1), ATH_SECS * 1000);
  }
  function refreshAthCeleb() {
    if (!document.body.classList.contains("in-app")) return;   // app pages only
    _athList = _athStocks();
    if (!_athList.length) { const e = document.getElementById("athCeleb"); if (e) e.remove(); clearTimeout(_athTimer); return; }
    if (!document.getElementById("athCeleb")) { _athIdx = 0; _athShow(0); }   // (re)start rotation if not already running
  }

  function initNav() {
    document.querySelectorAll(".side-nav a[data-page]").forEach(a => a.onclick = () => setPage(a.dataset.page));
    { const gb = document.getElementById("guideBtn"); if (gb) gb.onclick = () => guideStart(); }
    if (window.Prefs) window.Prefs.onChange(() => { if (state.page === "favorites" || state.page === "alerts") reRender(); });
    let last = "market";
    try { last = localStorage.getItem("sn_last_page") || "market"; } catch (e) {}
    setPage((PAGES[last] || last === "journal") ? last : "market");
    loadLive();
    setInterval(loadLive, 60000);
    loadScanner();                                   // ensure scan data (for alerts) even off the scanner page
    setInterval(() => { if (_scanLoaded) fetchScanner(); }, 300000);   // refresh scan + re-check alerts every 5 min
    updateTicker();
    setInterval(updateTicker, 60000);
    setInterval(updateSync, 1000);
    startCtaRotator();
    { const cam = document.getElementById("sideCam"); if (cam) cam.onclick = () => captureShare(); }
    { const nb = document.getElementById("sideNews"); if (nb) nb.onclick = () => toggleNews(); }
    { const sa = document.getElementById("sideAlerts"); if (sa) sa.onclick = () => openAlertsFeed(); }
    { const sr = document.getElementById("sideRequest"); if (sr) sr.onclick = () => openRequestForm(); }
    { const sg = document.getElementById("sideSuggest"); if (sg) sg.onclick = () => openSuggestTicker(); }
    { const ca = document.getElementById("sideCommAdmin"); if (ca) ca.onclick = () => openCommunityAdmin(); }
    // reveal the admin-only community panel link for Adi (and whenever auth state changes)
    const _revealAdmin = () => { const el = document.getElementById("sideCommAdmin"); if (el) el.style.display = _snIsAdmin() ? "" : "none"; };
    _revealAdmin();
    try { if (window.SNAuth && SNAuth.onChange) SNAuth.onChange(_revealAdmin); } catch (e) {}
    updateAlertBell();
    loadNews();
    setInterval(loadNews, 300000);   // refresh the news feed every 5 min
    // 52-week-high celebration: boot once scan data is present AND the app is visible,
    // then refresh each minute
    const _athBoot = setInterval(() => {
      if (SCAN && SCAN.rows && SCAN.rows.length && document.body.classList.contains("in-app")) { clearInterval(_athBoot); refreshAthCeleb(); }
    }, 1500);
    setInterval(refreshAthCeleb, 60000);
    // market open/close chime — prime audio on first interaction, then poll every 20s.
    // Also re-check when the tab regains focus (background tabs throttle timers, so a poll
    // may be skipped right at 16:30 — this catches it the moment you come back).
    document.addEventListener("pointerdown", _primeAudio, { once: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) _marketBellTick(); });
    _marketBellTick();
    setInterval(_marketBellTick, 20000);
    // ESC closes any open modal (chart-grid, all-timeframes, single chart, alerts, share…)
    document.addEventListener("keydown", e => { if (e.key === "Escape" && document.getElementById("pgModal")) closeModal(); });
    _setupStarDrag();   // drag over stars to mark/unmark many at once
  }
  // rotating motivational lines in the "join community" banner
  const CTA_MSGS = [
    '<span class="cta-trophy">🏆</span> הצטרף לקהילת הדיסקורד של StratNinja',
    "רוצה סוף־סוף להבין מה באמת קורה בגרפים? 📊",
    "לסחור לבד זה יקר — טעות אחת מכסה שנה של קהילה 🤝",
    "עוד מתלבט על העסקה? תשמע דעה שנייה לפני שתלחץ 💬",
    "סטאפים, ניתוחים ולייבים — כל יום, בזמן אמת",
    "נינג׳ות לא סוחרות לבד ⚔️ בוא תצטרף",
    "חדשות בוקר, סורקים וכלים אוטומטיים — הכל במקום אחד 🚀",
    "השוק לא מחכה לאף אחד — אתה עדיין בחוץ? ⏰",
    "המנויים כבר בפנים. אתה עדיין קורא באנרים 👀",
  ];
  function startCtaRotator() {
    const el = document.getElementById("ctaText");
    if (!el) return;
    let i = 0;
    setInterval(() => {
      const e = document.getElementById("ctaText");
      if (!e) return;
      i = (i + 1) % CTA_MSGS.length;
      e.style.transition = "opacity .35s"; e.style.opacity = "0";
      setTimeout(() => { e.innerHTML = CTA_MSGS[i]; e.style.opacity = "1"; }, 350);
    }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initNav);
  else initNav();
})();
