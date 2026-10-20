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
      ".vod-name{font-size:12.5px;color:var(--muted);margin-top:2px}",
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
    ].join("");
    document.head.appendChild(s);
  }

  function render() {
    _css();
    return '<div class="page-head"><h1>📼 שידורים קודמים</h1><div class="sub">צפו שוב בשידורים החיים הקודמים של StratNinja — בכל זמן.</div></div>' +
      '<div id="vodGrid" class="vod-grid"><div class="vod-empty">טוען הקלטות…</div></div>';
  }

  function wire() {
    _css();
    fetch("/api/live-vods").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
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
            (v.name ? '<div class="vod-name">' + esc(v.name) + "</div>" : "") + "</div>" +
          "</div>";
      }).join("");
      var cards = grid.querySelectorAll(".vod-card");
      for (var i = 0; i < cards.length; i++) cards[i].onclick = function () { _play(this.getAttribute("data-iframe"), this.getAttribute("data-uid"), this.getAttribute("data-name")); };
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
          if (j && j.ok) { _renderTitle(uid, nn); }   // the grid refreshes to the new name within the cache TTL
          else {
            var det = (j && j.error ? " · " + j.error : "");
            if (j && j.http) det += " · HTTP " + j.http;
            if (j && j.cf && j.cf.length) det += "\n" + j.cf.join("\n");
            alert("שינוי השם נכשל" + det);
          }
        }).catch(function () { alert("שינוי השם נכשל."); });
    });
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
  function _closePlay() { var o = $("vodOv"); if (o) o.remove(); }   // removing the iframe stops playback + audio
  function teardown() { _closePlay(); }

  var api = { render: render, wire: wire, teardown: teardown };
  if (typeof window !== "undefined") window.LiveVods = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
