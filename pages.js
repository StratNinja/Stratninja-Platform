/* StratNinja Platform — scanner pages + sidebar navigation.
 * Pages currently render with DEMO data; live data will be wired via a Polygon
 * proxy (Supabase Edge Function) or Adi's existing Python backend.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);

  // ---- tiny helpers ----
  const TF = { "2U": "u2", "2D": "d2", "1": "one", "3": "three" };
  function tf(v) { return '<span class="tf ' + (TF[v] || "one") + '">' + v + "</span>"; }
  const DEMO = '<div class="demo-flag">🧪 נתוני דמו — יחובר למפתח Polygon החי בשלב הבא</div>';

  // ---- DEMO datasets (structure mirrors the real feed) ----
  const INDICES = [
    { sym: "SPY", name: "S&P 500", Y: "2U", Q: "1", M: "1", W: "2U", D: "3" },
    { sym: "QQQ", name: "NASDAQ 100", Y: "2U", Q: "1", M: "1", W: "1", D: "2D" },
    { sym: "IWM", name: "Russell 2000", Y: "2U", Q: "2U", M: "2U", W: "2U", D: "2D" },
    { sym: "DIA", name: "Dow Jones", Y: "2U", Q: "2U", M: "2U", W: "2U", D: "2U" },
  ];
  const BREADTH_IDX = [
    { sym: "S5FD", desc: "מעל SMA50", val: "—" },
    { sym: "S5OF", desc: "מעל SMA100", val: "—" },
    { sym: "S5FI", desc: "מעל SMA150", val: "—" },
    { sym: "S5OH", desc: "מעל SMA200", val: "—" },
    { sym: "S5TW", desc: "מעל SMA20", val: "—" },
    { sym: "S5TH", desc: "שיאים/שפל", val: "—" },
  ];
  const DIST = [
    { k: "3 (חיצוני)", n: 41, dot: "p" },
    { k: "2D (יורד)", n: 116, dot: "r" },
    { k: "1 (פנימי)", n: 34, dot: "gray" },
    { k: "2U (עולה)", n: 309, dot: "g" },
  ];
  const SECT_LEAD = ["חומרי גלם · XLB", "תקשורת · XLC", "אנרגיה · XLE"];
  const SECT_LAG = ["מוצרי צריכה · XLY", "בריאות · XLV", "שירותים · XLU"];
  const STOCK_LEAD = ["SMCI", "PLTR", "MARA"];
  const STOCK_LAG = ["SNAP", "LCID", "NIO"];

  // ---- pages ----
  function renderMarket() {
    let idxRows = INDICES.map(r =>
      '<tr><td class="sym"><span class="tsym">' + r.sym + '</span> <span class="tname">' + r.name + "</span></td>" +
      "<td>" + tf(r.Y) + "</td><td>" + tf(r.Q) + "</td><td>" + tf(r.M) + "</td><td>" + tf(r.W) + "</td><td>" + tf(r.D) + "</td></tr>"
    ).join("");

    let dist = DIST.map(d =>
      '<div class="tile"><div class="k"><span class="dot ' + d.dot + '"></span>' + d.k + '</div><div class="v">' + d.n + "</div></div>"
    ).join("");

    let breadth = BREADTH_IDX.map(b =>
      '<div class="tile"><div class="k">' + b.sym + " · " + b.desc + '</div><div class="v muted">' + b.val + "</div></div>"
    ).join("");

    const leadList = (arr, cls) => arr.map((s, i) =>
      '<div class="lead-row ' + cls + '"><span>' + s + '</span><span class="rank">#' + (i + 1) + "</span></div>").join("");

    return (
      '<div class="page-head"><h1>סקירת שוק</h1><div class="sub">נתוני שוק בזמן אמת עבור סוחרי The Strat</div></div>' +
      DEMO +
      '<div class="cols2">' +
        '<div class="panel"><h3>מדדים ראשיים</h3>' +
          '<table class="idx-table"><thead><tr><th style="text-align:start">סימבול</th><th>Y</th><th>Q</th><th>M</th><th>W</th><th>D</th></tr></thead>' +
          "<tbody>" + idxRows + "</tbody></table></div>" +
        '<div class="panel"><h3>VIX <span class="muted" style="font-size:12px">תנודתיות</span></h3>' +
          '<div class="tile"><div class="k">מדד הפחד</div><div class="v muted">—</div></div>' +
          '<div class="muted" style="font-size:12px;margin-top:10px">VIX גבוה = פחד בשוק · נמוך = רוגע</div></div>' +
      "</div>" +
      '<div class="panel"><h3>התפלגות נרות S&P 500 (יומי)</h3><div class="tiles">' + dist + "</div></div>" +
      '<div class="panel"><h3>מדדי רוחב שוק (מאקרו · חישוב ידני)</h3><div class="tiles">' + breadth + "</div></div>" +
      '<div class="cols2">' +
        '<div class="panel"><h3>🟢 סקטורים מובילים</h3>' + leadList(SECT_LEAD, "up") + "</div>" +
        '<div class="panel"><h3>🔴 סקטורים בפיגור</h3>' + leadList(SECT_LAG, "down") + "</div>" +
      "</div>" +
      '<div class="cols2">' +
        '<div class="panel"><h3>🟢 מניות מובילות</h3>' + leadList(STOCK_LEAD, "up") + "</div>" +
        '<div class="panel"><h3>🔴 מניות בפיגור</h3>' + leadList(STOCK_LAG, "down") + "</div>" +
      "</div>"
    );
  }

  function stub(title, sub, bullets) {
    return (
      '<div class="page-head"><h1>' + title + '</h1><div class="sub">' + sub + "</div></div>" +
      '<div class="panel"><div class="stub"><div class="big">🚧</div><h2>בבנייה</h2>' +
      "<p>הדף הזה יכלול:</p><ul>" + bullets.map(b => "<li>" + b + "</li>").join("") + "</ul></div></div>"
    );
  }

  const PAGES = {
    market: renderMarket,
    scanner: () => stub("סורק עסקאות", "חיפוש תבניות Strat לפי טיימפריים, סוג נר ותבנית", [
      "פילטרים: טיימפריים (D/W/M/Q/Y), תבנית (1/2U/2D/3), CC, IF, צורת נר, כיוון",
      "טבלת תוצאות: CC, IF, P3, Shape, ATR, RVOL, C1/C2",
      "🧩 סינון לפי סורקי הקהילה (לחברים)",
      "לחיצה על מניה → גרף TradingView",
    ]),
    sectors: () => stub("סקטורים", "11 סקטורי SPDR — סוגי נרות + טיימפריימים + FTFC", [
      "breadth bars לכל סקטור (1/2U/2D/3) לפי D/W/M",
      "מי בהמשכיות טיימפריימים מלאה (FTFC)",
      "לחיצה על סקטור → המניות שבו + הטיימפריימים שלהן",
    ]),
    gappers: () => stub("גאפרים", "גאפים בפרימרקט/אפטרמרקט", [
      "גאפ למעלה / למטה עם $Gap ו-%Gap",
      "כיוון (UP/DOWN), TFC, נפח",
    ]),
    favorites: () => stub("מועדפים", "רשימת המעקב האישית שלך", [
      "התחבר עם גוגל ובחר מניות למועדפים",
      "צפייה בכל המועדפים עם נתוני Strat עדכניים",
      "נשמר בענן — נגיש מכל מכשיר",
    ]),
    alerts: () => stub("התראות", "התראות על מניות למייל או לדיסקורד", [
      "הגדרת התראה לפי מניה/תבנית/טיימפריים",
      "שליחה למייל או לערוץ דיסקורד ייעודי",
      "🔗 מתחבר לבוט הדיסקורד הקיים שלך",
    ]),
  };

  function setPage(name) {
    document.querySelectorAll(".side-nav a").forEach(a => a.classList.toggle("active", a.dataset.page === name));
    const jc = $("#journalContainer"), pg = $("#page");
    if (name === "journal") {
      pg.classList.add("hidden");
      jc.classList.remove("hidden");
    } else {
      jc.classList.add("hidden");
      pg.classList.remove("hidden");
      pg.innerHTML = (PAGES[name] || PAGES.market)();
    }
    try { localStorage.setItem("sn_last_page", name); } catch (e) {}
  }

  function initNav() {
    document.querySelectorAll(".side-nav a").forEach(a => {
      a.onclick = () => setPage(a.dataset.page);
    });
    let last = "market";
    try { last = localStorage.getItem("sn_last_page") || "market"; } catch (e) {}
    const valid = !!PAGES[last] || last === "journal";
    setPage(valid ? last : "market");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initNav);
  else initNav();
})();
