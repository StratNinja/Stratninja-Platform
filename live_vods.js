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
      ".vod-ov{position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;padding:16px}",
      ".vod-player{position:relative;width:min(1000px,96vw)}",
      ".vod-stage{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden}",
      ".vod-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0}",
      ".vod-close{position:absolute;top:-42px;inset-inline-end:0;background:var(--panel2);border:1px solid var(--line);color:var(--ink);width:38px;height:38px;border-radius:50%;font-size:17px;cursor:pointer}",
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
        return '<div class="vod-card" data-iframe="' + esc(v.iframe) + '">' +
          '<div class="vod-thumb"' + (bg ? ' style="background-image:url(\'' + bg + '\')"' : "") + '>' +
            '<span class="vod-play">▶</span><span class="vod-dur">' + fmtDur(v.duration) + "</span></div>" +
          '<div class="vod-meta"><div class="vod-date">' + esc(fmtDate(v.created)) + "</div>" +
            (v.name ? '<div class="vod-name">' + esc(v.name) + "</div>" : "") + "</div>" +
          "</div>";
      }).join("");
      var cards = grid.querySelectorAll(".vod-card");
      for (var i = 0; i < cards.length; i++) cards[i].onclick = function () { _play(this.getAttribute("data-iframe")); };
    }).catch(function () {
      var grid = $("vodGrid"); if (grid) grid.innerHTML = '<div class="vod-empty">לא ניתן לטעון כרגע — נסו שוב.</div>';
    });
  }

  function _play(iframe) {
    if (!iframe) return;
    _closePlay();
    var ov = document.createElement("div"); ov.className = "vod-ov"; ov.id = "vodOv";
    ov.innerHTML = '<div class="vod-player"><button class="vod-close" id="vodClose" title="סגור">✕</button>' +
      '<div class="vod-stage"><iframe src="' + esc(iframe) + '?autoplay=true" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div></div>';
    document.body.appendChild(ov);
    ov.onclick = function (e) { if (e.target === ov || (e.target && e.target.id === "vodClose")) _closePlay(); };
  }
  function _closePlay() { var o = $("vodOv"); if (o) o.remove(); }   // removing the iframe stops playback + audio
  function teardown() { _closePlay(); }

  var api = { render: render, wire: wire, teardown: teardown };
  if (typeof window !== "undefined") window.LiveVods = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
