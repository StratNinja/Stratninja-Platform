/* StratNinja — PUBLIC LIVE page module (window.Live).
 * Embeds the Cloudflare Stream player, shows a REAL live/offline status (driven by
 * the Cloudflare webhook + a server-side reconcile — never a manual flag), a
 * "starting soon" state, title/description, a share button, and an admin panel
 * (title/description/mode/schedule). Registered into the SPA via PAGES.live.
 *
 * Status comes from GET /api/live (public, cached + reconciled). Admin edits go to
 * POST /api/live with the user's Supabase token (verified server-side). No secrets
 * or stream keys ever touch the browser — only the PUBLIC playback URL is used.
 */
window.Live = (function () {
  "use strict";

  var ADMIN_EMAIL = "koriatmanagement@gmail.com";
  var POLL_MS = 15000;          // refresh the status every 15s while on the page

  var _status = null;           // last /api/live payload
  var _timer = null;            // status poll
  var _cd = null;               // countdown 1s timer
  var _playerSig = "";          // only rebuild the <iframe> when this changes (avoids reload/flicker)

  function me() { try { return window.SNAuth && SNAuth.user && SNAuth.user(); } catch (e) { return null; } }
  function isAdmin() { try { return ((me() || {}).email || "").toLowerCase() === ADMIN_EMAIL; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function toast(m) { try { if (window.snToast) return window.snToast(m); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function liveUrl() { try { return location.origin + "/live"; } catch (e) { return "/live"; } }

  function _accessToken() {
    try {
      var c = window.SNAuth && SNAuth.getClient && SNAuth.getClient();
      if (!c) return Promise.resolve(null);
      return c.auth.getSession().then(function (r) { return (r.data && r.data.session && r.data.session.access_token) || null; }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function _get() { return fetch("/api/live", { headers: { "Cache-Control": "no-cache" } }).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function _post(body) {
    return _accessToken().then(function (tok) {
      if (!tok) return { error: "no_token" };
      return fetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); }).catch(function () { return { error: "net" }; });
    });
  }

  function _injectCss() {
    if ($("liveCss")) return;
    var s = document.createElement("style");
    s.id = "liveCss";
    s.textContent = [
      ".live-wrap{max-width:1000px;margin:0 auto}",
      ".live-stage{position:relative;width:100%;aspect-ratio:16/9;background:#05070c;border:1px solid var(--line);border-radius:16px;overflow:hidden}",
      ".live-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0}",
      ".live-off{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100%;text-align:center;padding:24px}",
      ".live-off .lo-ico{font-size:46px;line-height:1}",
      ".live-off h3{margin:0;font-size:22px}",
      ".live-off p{margin:0;color:var(--muted);max-width:46ch}",
      ".live-badge{display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:13px;padding:5px 12px;border-radius:999px}",
      ".live-badge.on{background:#dc2626;color:#fff;box-shadow:0 0 0 0 rgba(220,38,38,.55);animation:livePulse 1.8s infinite}",
      ".live-badge.off{background:var(--panel2);color:var(--muted);border:1px solid var(--line)}",
      ".live-badge.soon{background:#f59e0b;color:#1a1200}",
      ".live-badge .dot{width:8px;height:8px;border-radius:50%;background:currentColor}",
      "@keyframes livePulse{0%{box-shadow:0 0 0 0 rgba(220,38,38,.55)}70%{box-shadow:0 0 0 9px rgba(220,38,38,0)}100%{box-shadow:0 0 0 0 rgba(220,38,38,0)}}",
      ".live-meta{margin-top:14px}",
      ".live-meta h2{margin:0 0 6px;font-size:21px}",
      ".live-meta .lm-desc{color:var(--muted);font-size:14.5px;line-height:1.55;white-space:pre-wrap}",
      ".live-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}",
      ".live-cd{font-variant-numeric:tabular-nums;font-weight:800;font-size:18px}",
      ".live-plat a{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;text-decoration:none;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:4px 11px}",
      ".live-plat a:hover{border-color:var(--accent)}",
      ".live-admin{margin-top:18px;border:1px dashed var(--line);border-radius:14px;padding:14px}",
      ".live-admin h4{margin:0 0 10px;font-size:14px;color:var(--muted)}",
      ".live-admin label{display:block;font-size:12.5px;color:var(--muted);margin:8px 0 3px}",
      ".live-admin input,.live-admin textarea,.live-admin select{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:9px;color:var(--ink);padding:7px 10px;font-family:inherit;font-size:14px}",
      ".live-admin textarea{min-height:60px;resize:vertical}",
      ".live-admin .la-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".live-admin .la-stat{font-size:12px;color:var(--muted);margin-top:10px}",
      "@media(max-width:640px){.live-admin .la-grid{grid-template-columns:1fr}.live-meta h2{font-size:19px}}",
    ].join("");
    document.head.appendChild(s);
  }

  // which visual state to show
  function _vs(s) {
    if (!s || !s.ok) return "offline";
    if (s.unknown) return "unknown";                 // couldn't reach Cloudflare → "checking", not a false OFFLINE
    if (s.mode === "offline") return "offline";
    if (s.mode === "soon") return "soon";
    if (s.is_live) return "live";
    if (s.scheduled_at && new Date(s.scheduled_at).getTime() > Date.now()) return "soon";
    return "offline";
  }

  function _playerHtml(s, vs) {
    if (vs === "live") {
      var pb = s && s.playback;
      if (pb && pb.iframe) {
        // MUTED autoplay is allowed in cross-origin iframes (unmuted is blocked → black). The CF player's
        // own controls give the manual play / unmute fallback if autoplay is prevented; playsinline keeps
        // it inline on mobile. (The parent can't control a cross-origin iframe's audio — only its controls can.)
        // dvrEnabled=true turns on Cloudflare's built-in DVR: viewers START at the live edge, can scrub back
        // to the start of the broadcast, and the LIVE indicator (grey when behind, red at the edge) jumps back
        // to live on click. All-or-nothing in the built-in player (no 30-min gate). Still loads by Live Input ID.
        return '<div class="live-stage"><iframe src="' + esc(pb.iframe) + '?autoplay=true&muted=true&controls=true&playsinline=true&dvrEnabled=true" ' +
          'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen playsinline></iframe></div>';
      }
      return '<div class="live-stage"><div class="live-off"><div class="lo-ico">🔴</div><h3>השידור חי</h3>' +
        '<p>הנגן עדיין לא הוגדר (חסרים פרטי ה-Playback של Cloudflare). ראה הוראות ההגדרה.</p></div></div>';
    }
    if (vs === "soon") {
      var when = s && s.scheduled_at ? new Date(s.scheduled_at) : null;
      return '<div class="live-stage"><div class="live-off"><div class="lo-ico">⏳</div>' +
        '<h3>השידור יתחיל בקרוב</h3>' +
        (when ? '<div class="live-cd" id="liveCountdown">—</div>' : '<p>תכף מתחילים — הישאר בעמוד.</p>') +
        "</div></div>";
    }
    if (vs === "unknown") {
      return '<div class="live-stage"><div class="live-off"><div class="lo-ico">🔄</div>' +
        '<h3>בודקים את מצב השידור…</h3><p>לא הצלחנו כרגע לקבל את סטטוס השידור מ-Cloudflare — מנסים שוב אוטומטית.</p></div></div>';
    }
    return '<div class="live-stage"><div class="live-off"><div class="lo-ico">⚫</div>' +
      '<h3>אין שידור כרגע</h3><p>כרגע לא משדרים בלייב. חזור בזמן השידור הבא — או הצטרף לקהילה כדי לקבל עדכון.</p></div></div>';
  }

  function _metaHtml(s, vs) {
    var badge = vs === "live"
      ? '<span class="live-badge on"><span class="dot"></span>LIVE</span>'
      : vs === "soon"
        ? '<span class="live-badge soon"><span class="dot"></span>בקרוב</span>'
        : vs === "unknown"
          ? '<span class="live-badge off"><span class="dot"></span>בודק…</span>'
          : '<span class="live-badge off"><span class="dot"></span>OFFLINE</span>';
    var title = (s && s.title) ? '<h2>' + esc(s.title) + "</h2>" : "";
    var desc = (s && s.description) ? '<div class="lm-desc">' + esc(s.description) + "</div>" : "";
    var plats = "";
    if (s && s.platforms && s.platforms.length) {
      plats = '<div class="live-plat live-row">צפה גם ב: ' + s.platforms.map(function (p) {
        return '<a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.name || p.url) + " ↗</a>";
      }).join("") + "</div>";
    }
    var prev = (s && s.preview) ? '<span class="live-badge" style="background:#6a5cf0;color:#fff">🧪 PREVIEW</span>' : "";
    return '<div class="live-meta">' +
      '<div class="live-row">' + badge + prev +
      '<button class="btn ghost" id="liveShare" style="font-size:13px;padding:6px 12px">🔗 שיתוף</button></div>' +
      title + desc + plats + "</div>";
  }

  function _adminHtml(s) {
    if (!isAdmin()) return "";
    if (s && s.preview) return '<div class="live-admin"><h4>🛠️ ניהול שידור</h4><div class="la-stat">🧪 מצב בדיקה (Preview) — עריכה וכתיבה מושבתות (קריאה-בלבד).</div></div>';
    var sch = s && s.scheduled_at ? new Date(s.scheduled_at) : null;
    var schVal = "";
    if (sch && !isNaN(sch)) { var off = sch.getTime() - sch.getTimezoneOffset() * 60000; schVal = new Date(off).toISOString().slice(0, 16); }
    var mode = (s && s.mode) || "auto";
    function opt(v, l) { return '<option value="' + v + '"' + (mode === v ? " selected" : "") + ">" + l + "</option>"; }
    return '<div class="live-admin"><h4>🛠️ ניהול שידור (מנהל)</h4>' +
      '<label>כותרת</label><input id="laTitle" maxlength="200" value="' + esc(s && s.title) + '">' +
      '<label>תיאור</label><textarea id="laDesc" maxlength="1000">' + esc(s && s.description) + "</textarea>" +
      '<div class="la-grid">' +
      '<div><label>מצב תצוגה</label><select id="laMode">' + opt("auto", "אוטומטי (לפי השידור)") + opt("soon", "השידור יתחיל בקרוב") + opt("offline", "כבוי (OFFLINE מאולץ)") + "</select></div>" +
      '<div><label>זמן התחלה מתוזמן (לא חובה)</label><input type="datetime-local" id="laSched" value="' + schVal + '"></div>' +
      "</div>" +
      '<div class="live-row"><button class="btn primary" id="laSave" style="font-size:13px;padding:7px 14px">💾 שמור</button>' +
      '<button class="btn ghost" id="laClearSched" style="font-size:13px;padding:7px 12px">נקה תזמון</button></div>' +
      '<div class="la-stat" id="laStat">מצב שידור אמיתי מ-Cloudflare: <b>' + (s && s.is_live ? "🔴 חי" : "⚫ לא פעיל") + "</b>" +
      " · אי אפשר לאלץ 'LIVE' ידנית — הוא נקבע לפי החיבור בפועל של OBS.</div>" +
      "</div>";
  }

  function _body(s) {
    var vs = _vs(s);
    return '<div id="livePlayer">' + _playerHtml(s, vs) + "</div>" +
      '<div id="liveMeta">' + _metaHtml(s, vs) + "</div>" +
      _adminHtml(s);
  }

  function render() {
    _injectCss();
    var head = '<div class="page-head"><h1>🔴 שידור חי</h1><div class="sub">צפה בשידור החי של StratNinja — ניתוח שוק וסריקות בזמן אמת.</div></div>';
    return head + '<div class="live-wrap" id="liveRoot">' + _body(_status) + "</div>";
  }

  function _fmtCd(ms) {
    if (ms <= 0) return "מתחילים…";
    var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return (h > 0 ? h + ":" : "") + p(m) + ":" + p(sec);
  }
  function _tickCd() {
    var el = $("liveCountdown"); if (!el) return;
    if (!_status || !_status.scheduled_at) { el.textContent = ""; return; }
    el.textContent = _fmtCd(new Date(_status.scheduled_at).getTime() - Date.now());
  }

  function _wireMeta() {
    var sh = $("liveShare");
    if (sh) sh.onclick = function () {
      var url = liveUrl();
      if (navigator.share) { navigator.share({ title: "StratNinja — שידור חי", url: url }).catch(function () {}); return; }
      try { navigator.clipboard.writeText(url); toast("הקישור הועתק ✓"); } catch (e) { toast(url); }
    };
  }
  function _wireAdmin() {
    var save = $("laSave"); if (!save) return;
    save.onclick = function () {
      var sched = ($("laSched") && $("laSched").value) || "";
      var body = {
        title: ($("laTitle") && $("laTitle").value) || "",
        description: ($("laDesc") && $("laDesc").value) || "",
        mode: ($("laMode") && $("laMode").value) || "auto",
        scheduled_at: sched ? new Date(sched).toISOString() : null,
      };
      save.disabled = true; save.textContent = "שומר…";
      _post(body).then(function (r) {
        save.disabled = false; save.textContent = "💾 שמור";
        if (r && r.ok) { _status = r; toast("נשמר ✓"); _apply(true); } else { toast("שמירה נכשלה" + (r && r.error ? " · " + r.error : "")); }
      });
    };
    var clr = $("laClearSched"); if (clr) clr.onclick = function () { if ($("laSched")) $("laSched").value = ""; };
  }

  // apply _status to the DOM without reloading the player unless the player state changed
  function _apply(force) {
    if (!$("liveRoot")) return;
    var s = _status, vs = _vs(s);
    var sig = vs + "|" + (s && s.playback && s.playback.uid || "");
    if (force || sig !== _playerSig) {
      _playerSig = sig;
      var pl = $("livePlayer"); if (pl) pl.innerHTML = _playerHtml(s, vs);
    }
    var mt = $("liveMeta"); if (mt) { mt.innerHTML = _metaHtml(s, vs); _wireMeta(); }
    _tickCd();
    // admin panel: build once (don't clobber inputs while typing); refresh only the status line
    if (isAdmin() && !document.querySelector(".live-admin")) {
      $("liveRoot").insertAdjacentHTML("beforeend", _adminHtml(s)); _wireAdmin();
    } else if (isAdmin() && $("laStat") && document.activeElement && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      $("laStat").innerHTML = "מצב שידור אמיתי מ-Cloudflare: <b>" + (s && s.is_live ? "🔴 חי" : "⚫ לא פעיל") + "</b> · אי אפשר לאלץ 'LIVE' ידנית.";
    }
  }

  function _refresh() {
    _get().then(function (r) { if (r) { _status = r; _apply(false); } });
  }

  function wire() {
    _injectCss();
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_cd) { clearInterval(_cd); _cd = null; }
    _wireMeta(); _wireAdmin();
    _refresh();
    _timer = setInterval(function () {
      if (!$("liveRoot")) { clearInterval(_timer); _timer = null; if (_cd) { clearInterval(_cd); _cd = null; } return; }  // left the page
      _refresh();
    }, POLL_MS);
    _cd = setInterval(_tickCd, 1000);
  }

  // Called by the SPA when leaving the /live page: stop the player so there is NO background
  // video/audio, and stop the status poll. Removing the <iframe> immediately halts media (even
  // when the SPA only HIDES #page — e.g. navigating to the journal — rather than re-rendering it).
  function teardown() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_cd) { clearInterval(_cd); _cd = null; }
    _playerSig = "";                                       // force a fresh player when the user returns
    var pl = $("livePlayer"); if (pl) pl.innerHTML = "";   // remove the Cloudflare iframe → stops video + audio
  }

  return { render: render, wire: wire, teardown: teardown };
})();
