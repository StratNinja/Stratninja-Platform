/* StratNinja — VOD library (window.LiveVods): past live recordings from Cloudflare.
 * A grid of recordings (thumbnail + date + duration); click to play in a modal. Registered as PAGES.vods.
 * Reads the public, cached /api/live-vods. Playback is the normal Cloudflare player by Video ID.
 */
(function () {
  "use strict";

  var _playTimer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return (h > 0 ? h + ":" + p(m) : m + "") + ":" + p(s);
  }
  function fmtDate(iso) {
    try { var d = new Date(iso); if (isNaN(d)) return ""; function p(n) { return (n < 10 ? "0" : "") + n; }
      return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " · " + p(d.getHours()) + ":" + p(d.getMinutes()); } catch (e) { return ""; }
  }
  // safe https url for a CSS background (no quotes/parens/spaces → no injection)
  function safeBg(u) { return /^https:\/\/[^\s'"()]+$/i.test(String(u || "")) ? u : ""; }

  function me() { try { return window.SNAuth && SNAuth.user && SNAuth.user(); } catch (e) { return null; } }
  function isAdmin() { try { return ((me() || {}).email || "").toLowerCase() === "koriatmanagement@gmail.com"; } catch (e) { return false; } }
  function _token() {
    try {
      var c = window.SNAuth && SNAuth.getClient && SNAuth.getClient();
      if (!c) return Promise.resolve(null);
      return c.auth.getSession().then(function (r) { return (r.data && r.data.session && r.data.session.access_token) || null; }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function _css() {
    if ($("vodCss")) return;
    var s = document.createElement("style");
    s.id = "vodCss";
    s.textContent = [
      ".vod-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;max-width:1100px}",
      ".vod-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color .15s,transform .15s}",
      ".vod-card:hover{border-color:var(--accent);transform:translateY(-2px)}",
      ".vod-thumb{position:relative;aspect-ratio:16/9;background:#05070c center/cover no-repeat;display:flex;align-items:center;justify-content:center}",
      ".vod-thumb .vod-play{font-size:34px;color:#fff;opacity:.9;text-shadow:0 2px 12px rgba(0,0,0,.6)}",
      ".vod-thumb .vod-dur{position:absolute;inset-inline-end:7px;bottom:7px;background:rgba(0,0,0,.78);color:#fff;font-size:12px;font-weight:700;padding:2px 7px;border-radius:6px}",
      ".vod-meta{padding:10px 12px}",
      ".vod-date{font-size:13px;color:var(--ink);font-weight:700}",
      ".vod-name{font-size:13.5px;color:var(--accent);font-weight:700;margin-top:4px;line-height:1.35}",
      // at-a-glance teaser under each card (first sentence of the auto summary), 2-line clamp
      ".vod-tldr{font-size:12px;color:var(--muted);margin-top:7px;line-height:1.5;opacity:.92;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
      // "preparing summary" indicator — a gentle pulse so the viewer sees a summary is on the way
      ".vod-tldr.vod-tldr-prep{font-style:italic;color:var(--muted);animation:vodPrep 1.6s ease-in-out infinite}",
      "@keyframes vodPrep{0%,100%{opacity:.45}50%{opacity:.9}}",
      ".vod-empty{color:var(--muted);font-size:14.5px;padding:30px 0;text-align:center}",
      ".vod-ov{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.9);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:48px 16px 24px}",
      ".vod-player{position:relative;width:min(1200px,96vw);margin:auto 0}",
      ".vod-body{display:flex;flex-direction:column-reverse;gap:14px;align-items:stretch}",   // mobile: video on top, summary below
      "@media(min-width:900px){.vod-body{flex-direction:row}}",                                 // wide (RTL row): summary on the RIGHT, video on the LEFT
      ".vod-stage{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden;flex:1 1 auto;min-width:0}",
      ".vod-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0}",
      ".vod-close{position:absolute;top:-42px;inset-inline-end:0;background:var(--panel2);border:1px solid var(--line);color:var(--ink);width:38px;height:38px;border-radius:50%;font-size:17px;cursor:pointer}",
      // auto summary + key-moment chapters panel (under the player)
      ".vod-sum{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;max-height:42vh;overflow:auto}",
      "@media(min-width:900px){.vod-sum{flex:0 0 340px;max-height:none}}",   // side column that matches the video height, scrolls internally
      ".vod-sum h4{margin:14px 0 6px;font-size:14px;color:var(--ink)}",
      ".vod-sum h4:first-child{margin-top:0}",
      ".vod-sum .vs-text{font-size:14px;line-height:1.65;color:var(--muted)}",
      ".vs-chaps{display:flex;flex-direction:column;gap:3px}",
      ".vs-chap{display:flex;gap:10px;align-items:baseline;text-align:start;background:transparent;border:0;border-radius:8px;padding:6px 8px;cursor:pointer;color:var(--ink);font:inherit;width:100%}",
      ".vs-chap:hover{background:var(--panel2)}",
      ".vs-chap .vs-t{flex:none;font-weight:800;font-size:12.5px;color:var(--accent);direction:ltr;min-width:48px}",
      ".vs-chap .vs-title{font-size:13.5px}",
      ".vod-ttl{display:flex;align-items:center;gap:8px;margin-bottom:10px;color:var(--ink);font-weight:800;font-size:15px;min-height:24px}",
      ".vod-ttl .vt-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".vt-edit{flex:none;background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:3px 9px;font-size:13px;cursor:pointer;font-weight:700}",
      ".vt-edit:hover{border-color:var(--accent)}",
      // tabs: community lives / course
      ".vod-tabs{display:flex;gap:8px;margin:0 0 16px;flex-wrap:wrap}",
      ".vod-tab{background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:10px;padding:8px 16px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}",
      ".vod-tab:hover{border-color:var(--accent);color:var(--ink)}",
      ".vod-tab.active{background:var(--accent);border-color:var(--accent);color:#06281c}",
      // course curriculum
      ".course-head{max-width:860px;margin:0 0 14px;color:var(--muted);font-size:14px;line-height:1.6}",
      ".course-locked{max-width:860px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:0 0 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}",
      ".course-locked .cl-txt{flex:1 1 220px;color:var(--ink);font-size:14.5px;line-height:1.6}",
      ".course-cta{background:var(--accent);color:#06281c;border:0;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;text-decoration:none;display:inline-block}",
      ".course-sec{max-width:860px;margin:0 0 18px}",
      ".course-sec h3{font-size:15px;color:var(--ink);margin:0 0 8px;font-weight:800}",
      ".course-lesson{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 14px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}",
      ".course-lesson:hover{border-color:var(--accent)}",
      ".course-lesson .cl-ico{flex:none;width:30px;height:30px;border-radius:8px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:14px}",
      ".course-lesson .cl-main{flex:1 1 auto;min-width:0}",
      ".course-lesson .cl-title{font-size:14px;color:var(--ink);font-weight:700}",
      ".course-lesson .cl-sum{font-size:12px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".course-lesson .cl-dur{flex:none;font-size:12.5px;color:var(--muted);font-weight:700;direction:ltr}",
      ".course-lesson.locked{opacity:.72}",
      ".course-admin{max-width:860px;margin:2px 0 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".course-add{background:var(--panel2);border:1px dashed var(--line);color:var(--ink);border-radius:10px;padding:9px 14px;font-size:13.5px;font-weight:700;cursor:pointer;font-family:inherit}",
      ".course-add:hover{border-color:var(--accent)}",
      ".course-prog{flex:1 1 220px;min-width:180px;display:flex;flex-direction:column;gap:4px;justify-content:center}",
      ".course-prog .cp-bar{height:8px;background:var(--panel2);border:1px solid var(--line);border-radius:999px;overflow:hidden}",
      ".course-prog .cp-bar span{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}",
      ".course-prog .cp-txt{font-size:12px;color:var(--muted)}",
      ".course-empty{color:var(--muted);font-size:14.5px;padding:24px 0}",
    ].join("");
    document.head.appendChild(s);
  }

  function render() {
    _css();
    return '<div class="page-head"><h1>📼 שידורים קודמים</h1><div class="sub">צפו שוב בשידורים החיים הקודמים של StratNinja — בכל זמן.</div></div>' +
      '<div class="vod-tabs">' +
        '<button type="button" class="vod-tab active" data-tab="lives">📼 לייבי קהילה</button>' +
        '<button type="button" class="vod-tab" data-tab="course">🎓 קורס The Strat</button>' +
      '</div>' +
      '<div id="vodGrid" class="vod-grid"><div class="vod-empty">טוען הקלטות…</div></div>' +
      '<div id="courseWrap" style="display:none"><div class="course-empty">טוען קורס…</div></div>';
  }

  function wire() {
    _css();
    _wireTabs();
    _loadLives();
  }

  // tab switching: show the lives grid or the course pane (course loads lazily on first open)
  var _courseLoaded = false;
  function _wireTabs() {
    var tabs = document.querySelectorAll(".vod-tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].onclick = function () {
        var which = this.getAttribute("data-tab");
        for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle("active", tabs[k] === this);
        var grid = $("vodGrid"), course = $("courseWrap");
        if (grid) grid.style.display = (which === "lives") ? "" : "none";
        if (course) course.style.display = (which === "course") ? "" : "none";
        if (which === "course" && !_courseLoaded) { _courseLoaded = true; _loadCourse(); }
      };
    }
  }

  function _loadLives() {
    // cache:"no-cache" → always revalidate with the server (cheap ETag 304), so a renamed recording
    // shows on the next load without a hard refresh. The Vercel edge cache still serves the response.
    fetch("/api/live-vods", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var grid = $("vodGrid"); if (!grid) return;
      if (!j || !j.ok || !j.vods || !j.vods.length) {
        grid.innerHTML = '<div class="vod-empty">אין עדיין שידורים מוקלטים. אחרי הלייב הבא הם יופיעו כאן 🎬</div>';
        return;
      }
      grid.innerHTML = j.vods.map(function (v) {
        var bg = safeBg(v.thumbnail);
        return '<div class="vod-card" data-iframe="' + esc(v.iframe) + '" data-uid="' + esc(v.uid) + '" data-name="' + esc(v.name || "") + '">' +
          '<div class="vod-thumb"' + (bg ? ' style="background-image:url(\'' + bg + '\')"' : "") + '>' +
            '<span class="vod-play">▶</span><span class="vod-dur">' + fmtDur(v.duration) + "</span></div>" +
          '<div class="vod-meta"><div class="vod-date">' + esc(fmtDate(v.created)) + "</div>" +
            (v.name ? '<div class="vod-name">' + esc(v.name) + "</div>" : "") +
            '<div class="vod-tldr" data-tldr="' + esc(v.uid) + '"></div>' +
          "</div></div>";
      }).join("");
      var cards = grid.querySelectorAll(".vod-card");
      for (var i = 0; i < cards.length; i++) cards[i].onclick = function () { _play(this.getAttribute("data-iframe"), this.getAttribute("data-uid"), this.getAttribute("data-name")); };
      _loadTeasers();   // fill the at-a-glance blurbs under each card (one request for all)
    }).catch(function () {
      var grid = $("vodGrid"); if (grid) grid.innerHTML = '<div class="vod-empty">לא ניתן לטעון כרגע — נסו שוב.</div>';
    });
  }

  function _play(iframe, uid, name) {
    if (!iframe) return;
    _closePlay();
    var ov = document.createElement("div"); ov.className = "vod-ov"; ov.id = "vodOv";
    ov.innerHTML = '<div class="vod-player"><button class="vod-close" id="vodClose" title="סגור">✕</button>' +
      '<div class="vod-ttl" id="vodTtl"></div>' +
      '<div class="vod-body">' +
        '<div class="vod-sum" id="vodSum" style="display:none"></div>' +
        '<div class="vod-stage"><iframe id="vodFrame" src="' + esc(iframe) + '?autoplay=true" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>' +
      '</div></div>';
    document.body.appendChild(ov);
    ov.onclick = function (e) { if (e.target === ov || (e.target && e.target.id === "vodClose")) _closePlay(); };
    _renderTitle(uid, name || "");
    if (uid && /^[a-f0-9]{32}$/i.test(uid)) _loadSummary(uid, iframe);
  }

  // modal title row: the recording name + (admin only) an edit button that renames it on Cloudflare
  function _renderTitle(uid, name) {
    var el = $("vodTtl"); if (!el) return;
    var html = '<span class="vt-name">' + esc(name || "הקלטה") + "</span>";
    if (isAdmin() && uid) html += '<button type="button" class="vt-edit" id="vtEdit">✏️ שנה שם</button>';
    el.innerHTML = html;
    var btn = $("vtEdit");
    if (btn) btn.onclick = function () { _rename(uid, name || ""); };
  }

  function _rename(uid, current) {
    var nn = window.prompt("שם חדש להקלטה:", current || "");
    if (nn == null) return;   // cancelled
    nn = String(nn).trim().slice(0, 120);
    _token().then(function (tok) {
      if (!tok) { alert("צריך להיות מחובר כאדמין."); return; }
      fetch("/api/vod-rename", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ uid: uid, name: nn }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.ok) {
            _renderTitle(uid, nn);
            _updateCardName(uid, nn);   // reflect it in the grid NOW (the API is edge-cached ~1-3 min, so a reload would lag)
          }
          else {
            var det = (j && j.error ? " · " + j.error : "");
            if (j && j.http) det += " · HTTP " + j.http;
            if (j && j.cf && j.cf.length) det += "\n" + j.cf.join("\n");
            alert("שינוי השם נכשל" + det);
          }
        }).catch(function () { alert("שינוי השם נכשל."); });
    });
  }

  // fill the short at-a-glance teaser under every card, in ONE request (public + edge-cached)
  function _loadTeasers() {
    fetch("/api/vod-summaries").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var items = (j && j.ok && j.items) ? j.items : {};
      var slots = document.querySelectorAll(".vod-tldr[data-tldr]");
      for (var i = 0; i < slots.length; i++) {
        var t = items[slots[i].getAttribute("data-tldr")];
        if (t) { slots[i].textContent = t; slots[i].classList.remove("vod-tldr-prep"); }
        else { slots[i].textContent = "⏳ מכין סיכום אוטומטי…"; slots[i].classList.add("vod-tldr-prep"); }   // not done yet → show it's in progress
      }
    }).catch(function () {});
  }

  // after a successful rename, update the grid card immediately (data-name drives the modal title on
  // re-open; the .vod-name line is the visible label). Avoids the ~1-3 min edge-cache lag on reload.
  function _updateCardName(uid, name) {
    var card = document.querySelector('.vod-card[data-uid="' + uid + '"]'); if (!card) return;
    card.setAttribute("data-name", name || "");
    var meta = card.querySelector(".vod-meta"); if (!meta) return;
    var line = meta.querySelector(".vod-name");
    if (name) {
      if (!line) { line = document.createElement("div"); line.className = "vod-name"; meta.appendChild(line); }
      line.textContent = name;
    } else if (line) { line.parentNode.removeChild(line); }
  }

  // fetch + render the auto summary + clickable key-moment chapters for this recording
  function _loadSummary(uid, baseIframe) {
    fetch("/api/vod-summary?uid=" + encodeURIComponent(uid)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var box = $("vodSum"); if (!box) return;
      if (!j || !j.ok || (!j.summary && (!j.chapters || !j.chapters.length))) return;   // nothing yet -> stay hidden
      var html = "";
      if (j.summary) html += '<h4>📝 סיכום</h4><div class="vs-text">' + esc(j.summary) + "</div>";
      if (j.chapters && j.chapters.length) {
        html += '<h4>⏱️ רגעי מפתח</h4><div class="vs-chaps">';
        for (var i = 0; i < j.chapters.length; i++) {
          var c = j.chapters[i] || {}; var t = Math.max(0, parseInt(c.t, 10) || 0);
          html += '<button type="button" class="vs-chap" data-t="' + t + '"><span class="vs-t">' + fmtDur(t) + '</span><span class="vs-title">' + esc(c.title || "") + "</span></button>";
        }
        html += "</div>";
      }
      box.innerHTML = html; box.style.display = "";
      var chaps = box.querySelectorAll(".vs-chap");
      for (var k = 0; k < chaps.length; k++) chaps[k].onclick = function () { _seek(baseIframe, parseInt(this.getAttribute("data-t"), 10) || 0); };
    }).catch(function () {});
  }

  // jump the player to a key moment (reload the Cloudflare iframe at startTime)
  function _seek(baseIframe, t) {
    var fr = $("vodFrame"); if (!fr || !baseIframe) return;
    fr.src = baseIframe + "?autoplay=true&startTime=" + (t || 0);
    try { fr.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }
  // ===== COURSE (gated "The Strat" course) =====
  var COURSE_PATREON_URL = "https://www.patreon.com/14520383/join";   // purchase the course (Patreon $50+ tier)

  // load the curriculum + the viewer's course entitlement, then render the pane
  function _loadCourse() {
    var wrap = $("courseWrap"); if (!wrap) return;
    fetch("/api/course-lessons").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var lessons = (j && j.ok && Array.isArray(j.lessons)) ? j.lessons : [];
      _courseEntitled().then(function (state) { _renderCourse(wrap, lessons, state); });
    }).catch(function () { wrap.innerHTML = '<div class="course-empty">לא ניתן לטעון את הקורס כרגע — נסו שוב.</div>'; });
  }

  // { loggedIn, ok } — ok = this user holds an active course entitlement (server-verified)
  function _courseEntitled() {
    return _token().then(function (tok) {
      if (!tok) return { loggedIn: false, ok: false };
      return fetch("/api/entitlement-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { return { loggedIn: true, ok: !!(j && j.course) }; })
        .catch(function () { return { loggedIn: true, ok: false }; });
    });
  }

  function _renderCourse(wrap, lessons, state) {
    var admin = isAdmin();
    var html = '<div class="course-head">🎓 <b>קורס The Strat</b> — סדרת שיעורים מובנית. ' +
      (state.ok ? "יש לך גישה מלאה — לחץ על שיעור כדי לצפות." : (state.loggedIn ? "הגישה פתוחה לבעלי מנוי הקורס." : "התחבר כדי לצפות בשיעורים שרכשת.")) + "</div>";
    if (admin) html += '<div class="course-admin">' +
      '<button type="button" class="course-add" id="courseUpBtn">📤 העלה מהמחשב</button>' +
      '<button type="button" class="course-add" id="courseAdd">➕ הוסף לפי מזהה</button>' +
      '<button type="button" class="course-add" id="courseCleanBtn" title="מחק העלאות שנכשלו שתקועות ב-Cloudflare ותופסות מקום">🧹 נקה העלאות תקועות</button>' +
      '<input type="file" id="courseFile" accept="video/*" style="display:none">' +
      '<div class="course-prog" id="courseProg" style="display:none"><div class="cp-bar"><span id="cpFill"></span></div><div class="cp-txt" id="cpTxt"></div></div>' +
      '</div>';
    if (!state.ok) {
      var cta = state.loggedIn
        ? '<a class="course-cta" href="' + COURSE_PATREON_URL + '" target="_blank" rel="noopener">🔓 לרכישת הקורס</a>'
        : '<a class="course-cta" href="/">🔑 התחבר</a>';
      html += '<div class="course-locked"><div class="cl-txt">🔒 ' +
        (state.loggedIn ? "הגישה לקורס פתוחה למנויי הקורס (Patreon, מסלול $50 ומעלה). אם כבר רכשת — ודא שחיברת Discord וקיבלת את רול הקורס." : "התחבר עם החשבון שלך כדי לצפות בקורס שרכשת.") +
        "</div>" + cta + "</div>";
    }
    if (!lessons.length) {
      html += '<div class="course-empty">' + (admin ? "אין עדיין שיעורים — הוסף את הראשון עם הכפתור למעלה. ⬆️" : "השיעורים יתווספו בקרוב 🎬") + "</div>";
      wrap.innerHTML = html; _wireCourseActions(wrap, state); return;
    }
    var curMod = null;
    for (var i = 0; i < lessons.length; i++) {
      var L = lessons[i];
      if (L.module !== curMod) {
        if (curMod !== null) html += "</div>";
        curMod = L.module;
        html += '<div class="course-sec">' + (curMod ? "<h3>" + esc(curMod) + "</h3>" : "");
      }
      var ico = state.ok ? "▶" : "🔒";
      html += '<div class="course-lesson' + (state.ok ? "" : " locked") + '" data-uid="' + esc(L.uid) + '" data-title="' + esc(L.title) + '">' +
        '<span class="cl-ico">' + ico + "</span>" +
        '<div class="cl-main"><div class="cl-title">' + esc(L.title) + "</div>" + (L.summary ? '<div class="cl-sum">' + esc(L.summary) + "</div>" : "") + "</div>" +
        (L.duration ? '<span class="cl-dur">' + fmtDur(L.duration) + "</span>" : "") +
        (admin ? '<button type="button" class="vt-edit cl-ren" data-ren="' + esc(L.uid) + '" data-rtitle="' + esc(L.title) + '" data-rmod="' + esc(L.module || "") + '" data-rsort="' + (parseInt(L.sort, 10) || 0) + '" title="ערוך שם">✏️</button>' +
          '<button type="button" class="vt-edit cl-del" data-del="' + esc(L.uid) + '" title="מחק">🗑️</button>' : "") +
        "</div>";
    }
    if (curMod !== null) html += "</div>";
    wrap.innerHTML = html;
    _wireCourseActions(wrap, state);
  }

  function _wireCourseActions(wrap, state) {
    var add = $("courseAdd"); if (add) add.onclick = _courseAddPrompt;
    var clean = $("courseCleanBtn"); if (clean) clean.onclick = _courseCleanup;
    var up = $("courseUpBtn"), file = $("courseFile");
    if (up && file) { up.onclick = function () { file.value = ""; file.click(); }; file.onchange = function () { if (file.files && file.files[0]) _courseUpload(file.files[0]); }; }
    var dels = wrap.querySelectorAll(".cl-del");
    for (var d = 0; d < dels.length; d++) dels[d].onclick = function (e) { e.stopPropagation(); _courseDelete(this.getAttribute("data-del")); };
    var rens = wrap.querySelectorAll(".cl-ren");
    for (var rn = 0; rn < rens.length; rn++) rens[rn].onclick = function (e) { e.stopPropagation(); _courseRename(this.getAttribute("data-ren"), this.getAttribute("data-rtitle"), this.getAttribute("data-rmod"), this.getAttribute("data-rsort")); };
    var rows = wrap.querySelectorAll(".course-lesson");
    for (var i = 0; i < rows.length; i++) rows[i].onclick = function () {
      var uid = this.getAttribute("data-uid"), title = this.getAttribute("data-title");
      if (state.ok) _playCourse(uid, title); else _promptUnlock(state);
    };
  }

  function _promptUnlock(state) {
    if (!state.loggedIn) { alert("התחבר עם החשבון שלך כדי לצפות בקורס."); return; }
    alert("הגישה לקורס פתוחה למנויי הקורס. אם כבר רכשת — ודא שחיברת Discord וקיבלת את רול הקורס.");
  }

  // mint a signed URL for the lesson (server checks entitlement) and play it in the modal
  function _playCourse(uid, title) {
    _token().then(function (tok) {
      if (!tok) { alert("התחבר כדי לצפות בקורס."); return; }
      fetch("/api/course-token", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ uid: uid }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.ok && j.iframe) {
            _play(j.iframe, null, title || "שיעור");
            // course videos share the vod_summaries table — load the auto summary + chapters by the REAL
            // lesson uid (the iframe URL is a one-time signed token, so the uid can't be derived from it)
            if (/^[a-f0-9]{32}$/i.test(uid)) _loadSummary(uid, j.iframe);
          }
          else if (j && j.error === "not_entitled") { alert("אין לך גישה לקורס עדיין."); }
          else { alert("לא ניתן לנגן את השיעור כרגע" + (j && j.error ? " · " + j.error : "") + "."); }
        }).catch(function () { alert("שגיאה בניגון השיעור."); });
    });
  }

  // admin: add/update a lesson (prompts for the Cloudflare video uid + title + module + order)
  function _courseAddPrompt() {
    var uid = window.prompt("מזהה הווידאו ב-Cloudflare (32 תווים hex):", ""); if (uid == null) return;
    uid = String(uid).trim();
    if (!/^[a-f0-9]{32}$/i.test(uid)) { alert("מזהה לא תקין — צריך 32 תווים hex."); return; }
    var title = window.prompt("כותרת השיעור:", ""); if (title == null) return; title = String(title).trim();
    if (!title) { alert("צריך כותרת."); return; }
    var module = window.prompt("מודול/פרק (אפשר להשאיר ריק):", "") || "";
    var sort = window.prompt("סדר (מספר — קטן יופיע ראשון):", "0");
    _token().then(function (tok) {
      if (!tok) { alert("צריך להיות מחובר כאדמין."); return; }
      fetch("/api/course-admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ action: "save", uid: uid, title: title, module: module, sort: parseInt(sort, 10) || 0 }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (j && j.ok) {
            if (j.warn === "video_not_gated") alert("נשמר ✓ — אבל שים לב: הסרטון ב-Cloudflare לא מסומן כ-'Require signed URLs'. סמן אותו כדי שיהיה מגודר.");
            else if (j.warn === "cf_lookup_failed") alert("נשמר ✓ (לא הצלחתי לאמת מול Cloudflare — ודא שהמזהה נכון).");
            _loadCourse();
          } else { alert("שמירה נכשלה" + (j && j.error ? " · " + j.error : "") + (j && j.detail ? "\n" + j.detail : "")); }
        }).catch(function () { alert("שמירה נכשלה."); });
    });
  }

  // admin: UPLOAD a video straight from the computer → Cloudflare Stream (gated), RESUMABLE (tus) so it
  // handles multi-GB files, with live progress, then save the lesson.
  function _progShow(txt, pct) { var p = $("courseProg"), f = $("cpFill"), t = $("cpTxt"); if (p) p.style.display = ""; if (f) f.style.width = (pct || 0) + "%"; if (t) t.textContent = txt || ""; }
  function _progHide() { var p = $("courseProg"); if (p) p.style.display = "none"; }
  function _courseUpload(file) {
    if (!file) return;
    var title = window.prompt("כותרת השיעור:", (file.name || "").replace(/\.[^.]+$/, "")); if (title == null) return;
    title = String(title).trim(); if (!title) { alert("צריך כותרת."); return; }
    var module = window.prompt("מודול/פרק (אפשר להשאיר ריק):", "") || "";
    _token().then(function (tok) {
      if (!tok) { alert("צריך להיות מחובר כאדמין."); return; }
      _progShow("מכין העלאה…", 0);
      // 1) create a resumable (tus) upload on Cloudflare (server-side, with the CF token) → get the upload URL
      fetch("/api/course-upload", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ name: title, uploadLength: file.size }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (!(j && j.ok && j.location && j.uid)) { _progHide(); alert("לא ניתן להתחיל העלאה" + (j && j.error ? " · " + j.error : "") + (j && j.detail ? "\n" + j.detail : "")); return; }
          var t0 = Date.now();
          // 2) upload the file to Cloudflare in chunks (handles multi-GB), with progress + ETA
          _tusUpload(file, j.location,
            function (done, total) {
              var pct = Math.round(done / total * 100);
              var mb = (done / 1048576).toFixed(0) + "/" + (total / 1048576).toFixed(0) + "MB";
              var sp = done / Math.max(1, (Date.now() - t0) / 1000) / 1048576;      // MB/s
              var eta = sp > 0.01 ? Math.ceil((total - done) / 1048576 / sp / 60) : 0;   // minutes
              _progShow("מעלה… " + pct + "% · " + mb + (eta ? " · ~" + eta + " דק' נותרו" : ""), pct);
            },
            function () {
              _progShow("הועלה ✓ — שומר ומעבד…", 100);
              fetch("/api/course-admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ action: "save", uid: j.uid, title: title, module: module }) })
                .then(function (r) { return r.json().catch(function () { return {}; }); })
                .then(function (s) {
                  _progHide();
                  if (s && s.ok) { alert("הועלה ✓ — השיעור נוסף! (Cloudflare מעבד את הווידאו — כמה דקות עד שיתנגן.)"); _loadCourse(); }
                  else { alert("הקובץ הועלה אבל שמירת השיעור נכשלה. הוסף ידנית עם המזהה: " + j.uid); }
                }).catch(function () { _progHide(); alert("הקובץ הועלה; שמירת השיעור נכשלה. מזהה: " + j.uid); });
            },
            function (err) { _progHide(); alert("ההעלאה נכשלה (" + err + "). נסה שוב."); }
          );
        }).catch(function () { _progHide(); alert("שגיאה בבקשת ההעלאה."); });
    });
  }

  // minimal tus resumable uploader (chunked PATCH, no external lib). Cloudflare Stream speaks the tus core protocol.
  function _tusUpload(file, location, onProg, onDone, onErr) {
    var CHUNK = 52428800;   // 50MB — a multiple of 256KB, as tus/CF require for non-final chunks
    var offset = 0, retries = 0;
    var host = (function () { try { return new URL(location).host; } catch (e) { return String(location).slice(0, 48); } })();
    function head() {
      var x = new XMLHttpRequest();
      x.open("HEAD", location, true);
      x.setRequestHeader("Tus-Resumable", "1.0.0");
      x.onload = function () { var o = parseInt(x.getResponseHeader("Upload-Offset"), 10); if (!isNaN(o)) offset = o; patch(); };
      x.onerror = function () { patch(); };   // HEAD unsupported → just start from the current offset
      x.send();
    }
    function patch() {
      if (offset >= file.size) { onDone(); return; }
      var end = Math.min(offset + CHUNK, file.size), base = offset;
      var x = new XMLHttpRequest();
      x.open("PATCH", location, true);
      x.setRequestHeader("Tus-Resumable", "1.0.0");
      x.setRequestHeader("Upload-Offset", String(offset));
      x.setRequestHeader("Content-Type", "application/offset+octet-stream");
      x.upload.onprogress = function (e) { if (e.lengthComputable) onProg(base + e.loaded, file.size); };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) {
          var o = parseInt(x.getResponseHeader("Upload-Offset"), 10);
          offset = isNaN(o) ? end : o; retries = 0; onProg(offset, file.size); patch();
        } else if (retries < 3) { retries++; setTimeout(head, 1500 * retries); }   // transient → re-sync offset via HEAD and retry
        else { try { console.error("[course-upload] PATCH failed", x.status, x.responseText); } catch (e) {} onErr("HTTP " + x.status + (x.responseText ? " · " + String(x.responseText).slice(0, 140) : "") + " · host=" + host); }
      };
      x.onerror = function () {
        if (retries < 3) { retries++; setTimeout(head, 1500 * retries); }
        else { try { console.error("[course-upload] PATCH network/CORS error, host=", host); } catch (e) {} onErr("חסום (CORS/רשת) · host=" + host + " · status=" + x.status); }
      };
      x.send(file.slice(offset, end));
    }
    patch();   // start directly — a fresh upload has offset 0; HEAD is only used to re-sync on a retry
  }

  // admin: rename a lesson (and optionally change its module). Reuses the course-admin "save" upsert on
  // the same uid; also refreshes the CF duration as a bonus.
  function _courseRename(uid, title, module, sort) {
    var nt = window.prompt("שם חדש לשיעור:", title || ""); if (nt == null) return;
    nt = String(nt).trim(); if (!nt) { alert("צריך שם."); return; }
    var nm = window.prompt("מודול/פרק (אפשר להשאיר ריק):", module || ""); if (nm == null) nm = module || "";
    _token().then(function (tok) {
      if (!tok) { alert("צריך להיות מחובר כאדמין."); return; }
      fetch("/api/course-admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ action: "save", uid: uid, title: nt, module: nm, sort: parseInt(sort, 10) || 0 }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) { if (j && j.ok) { _loadCourse(); } else { alert("עריכה נכשלה" + (j && j.error ? " · " + j.error : "")); } })
        .catch(function () { alert("עריכה נכשלה."); });
    });
  }

  function _courseDelete(uid) {
    if (!uid || !window.confirm("להסיר את השיעור מהרשימה? (הסרטון עצמו ב-Cloudflare לא יימחק)")) return;
    _token().then(function (tok) {
      if (!tok) { alert("צריך להיות מחובר כאדמין."); return; }
      fetch("/api/course-admin", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ action: "delete", uid: uid }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) { if (j && j.ok) { _loadCourse(); } else { alert("ההסרה נכשלה."); } }).catch(function () { alert("ההסרה נכשלה."); });
    });
  }

  // admin: reclaim orphaned "pendingupload" videos (failed uploads) that eat the Stream quota.
  function _courseCleanup() {
    _token().then(function (tok) {
      if (!tok) { alert("צריך להיות מחובר כאדמין."); return; }
      fetch("/api/course-cleanup", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ action: "list" }) })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          if (!(j && j.ok)) { alert("לא ניתן לבדוק העלאות תקועות" + (j && j.error ? " · " + j.error : "")); return; }
          if (!j.count) { alert("אין העלאות תקועות — אין מה לנקות ✓"); return; }
          var mins = 0; for (var i = 0; i < j.pending.length; i++) mins += Math.round((j.pending[i].maxDurationSeconds || 0) / 60);
          if (!window.confirm("נמצאו " + j.count + " העלאות שנכשלו/תקועות (תופסות ~" + mins + " דק' מהמכסה).\nלמחוק אותן מ-Cloudflare?\n\n⚠️ אם יש כרגע העלאה שרצה — סיים אותה קודם, אחרת היא תימחק גם.")) return;
          fetch("/api/course-cleanup", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ action: "purge" }) })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (s) {
              if (s && s.ok) alert("נמחקו " + s.count + " העלאות תקועות ✓" + (s.failed && s.failed.length ? " (" + s.failed.length + " נכשלו)" : ""));
              else alert("הניקוי נכשל" + (s && s.error ? " · " + s.error : ""));
            }).catch(function () { alert("הניקוי נכשל."); });
        }).catch(function () { alert("שגיאה בבדיקת העלאות תקועות."); });
    });
  }

  function _closePlay() { var o = $("vodOv"); if (o) o.remove(); }   // removing the iframe stops playback + audio
  function teardown() { _closePlay(); }

  var api = { render: render, wire: wire, teardown: teardown };
  if (typeof window !== "undefined") window.LiveVods = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
