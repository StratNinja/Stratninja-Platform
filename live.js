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

  var PATREON_JOIN = "https://www.patreon.com/14520383/join";   // community join link (shown on the locked screen)

  var _status = null;           // last /api/live payload
  var _timer = null;            // status poll
  var _cd = null;               // countdown 1s timer
  var _playerSig = "";          // only rebuild the <iframe> when this changes (avoids reload/flicker)

  // ---- community "vault" gate state ----
  var _access = "unknown";      // "unknown" | "checking" | "ok" | "locked"  (for the CURRENT community live)
  var _commIframe = "";         // the signed iframe URL once minted (entitled users only)
  var _accessTried = false;     // guard so we only run the entitlement check once per community-live session
  var _ready = "unknown";       // "unknown"|"checking"|"guest"|"ok"|"nomember" — readiness for an UPCOMING community live (soon screen)
  var _readyTried = false;      // guard so the soon-screen readiness check runs once per community-soon session

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

  // ---- community vault: entitlement + signed-URL helpers ----
  function _isCommunity(s) { return !!(s && s.visibility === "community"); }
  // POST /api/live-token → { status, json }. 200 = signed URL; 403 = not entitled; others = error/guest.
  function _postLiveToken(tok) {
    return fetch("/api/live-token", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; }); })
      .catch(function () { return { status: 0, json: {} }; });
  }
  // POST /api/entitlement-sync → refresh the user's 'community' entitlement from Discord guild membership.
  function _syncEntitlement(tok) {
    return fetch("/api/entitlement-sync", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok } })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .catch(function () { return {}; });
  }
  // Resolve whether the current viewer may watch the community live, and mint the signed player URL.
  // Self-healing: a just-signed-in Discord user has no entitlement row yet → a 403 triggers ONE sync +
  // retry, which populates it. Sets _access + _commIframe and re-applies the player.
  function _ensureCommunity() {
    if (_accessTried) return;
    _accessTried = true; _access = "checking";
    _accessToken().then(function (tok) {
      // No session yet (guest, or the Supabase session simply hasn't loaded). Lock for now but allow a
      // RETRY on a later poll — otherwise an entitled user whose session arrives late stays wrongly locked.
      if (!tok) { _access = "locked"; _commIframe = ""; _accessTried = false; _applyCommunity(); return; }
      _postLiveToken(tok).then(function (r) {
        if (r.json && r.json.ok && r.json.iframe) { _access = "ok"; _commIframe = r.json.iframe; _applyCommunity(); return; }
        if (r.status === 403) {   // not entitled (stored) → try a Discord re-check once, then retry
          _syncEntitlement(tok).then(function () {
            _postLiveToken(tok).then(function (r2) {
              if (r2.json && r2.json.ok && r2.json.iframe) { _access = "ok"; _commIframe = r2.json.iframe; }
              else { _access = "locked"; _commIframe = ""; }
              _applyCommunity();
            });
          });
          return;
        }
        _access = "locked"; _commIframe = ""; _applyCommunity();   // error/unauthorized → treat as locked
      });
    });
  }
  // reset the gate when leaving a community live or when the live/visibility changes
  function _resetCommunity() { _access = "unknown"; _commIframe = ""; _accessTried = false; }
  // re-render only the player + chat region after an async access result
  function _applyCommunity() {
    if (!$("liveRoot")) return;
    var pl = $("livePlayer"); if (pl) pl.innerHTML = _playerHtml(_status, _vs(_status));
    _syncCommunityChat(_status, _vs(_status));
  }

  // ---- community readiness: the "you're connected & ready" indicator on the SOON/countdown screen ----
  // So a community member knows BEFORE the live starts whether they're logged in + verified. Uses the
  // light entitlement-sync (no stream minting — there's no broadcast yet).
  function _ensureReady() {
    if (_readyTried) return;
    _readyTried = true;
    if (!me()) { _ready = "guest"; return; }            // not logged in → prompt to connect Discord
    _ready = "checking";
    _accessToken().then(function (tok) {
      if (!tok) { _ready = "guest"; _readyTried = false; _applyReady(); return; }   // session not loaded yet → retry later
      _syncEntitlement(tok).then(function (j) { _ready = (j && j.entitled) ? "ok" : "nomember"; _applyReady(); });
    });
  }
  function _resetReady() { _ready = "unknown"; _readyTried = false; }
  function _applyReady() {
    if (!$("liveRoot")) return;
    var pl = $("livePlayer"); if (pl) { pl.innerHTML = _playerHtml(_status, _vs(_status)); _wirePlayer(); }
  }
  // the readiness banner shown under the countdown for an upcoming COMMUNITY live
  function _readyBannerHtml(s) {
    var when = s && s.scheduled_at ? new Date(s.scheduled_at) : null;
    var at = "";
    try { if (when) at = " שמתחיל ב-" + when.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }); } catch (e) {}
    if (_ready === "ok") return '<div class="live-ready ok">✅ אתה מחובר ומאומת — מוכן ללייב הקהילה' + at + "! 🎉</div>";
    if (_ready === "checking" || _ready === "unknown") return '<div class="live-ready wait">🔄 בודקים אם אתה מחובר ומוכן…</div>';
    var msg = (_ready === "nomember")
      ? "⚠️ אתה מחובר, אבל עדיין לא אימתנו חברות קהילה. חבר את ה-Discord שלך או הצטרף לקהילה כדי להיות מוכן ללייב" + at + "."
      : "⚠️ אתה לא מחובר עם חשבון Discord. התחבר עכשיו כדי להיות מוכן ללייב הקהילה" + at + ".";
    return '<div class="live-ready warn">' + msg +
      '<div class="live-row" style="justify-content:center;margin-top:10px">' +
        '<button class="btn primary" id="liveDiscord" style="background:#5865F2;color:#fff;font-weight:800;font-size:13px;padding:8px 14px">התחבר עם Discord</button>' +
        '<a class="btn" href="' + PATREON_JOIN + '" target="_blank" rel="noopener" style="background:#dc2626;color:#fff;font-weight:800;font-size:13px;padding:8px 14px;text-decoration:none">🎁 הצטרף לקהילה</a>' +
      "</div></div>";
  }

  function _injectCss() {
    if ($("liveCss")) return;
    var s = document.createElement("style");
    s.id = "liveCss";
    s.textContent = [
      ".live-wrap{max-width:1340px;margin:0 auto}",
      ".live-grid{display:grid;grid-template-columns:1fr;gap:16px;align-items:start}",
      "@media(min-width:900px){.live-grid{grid-template-columns:minmax(0,1fr) 350px;align-items:stretch}.live-side,#liveChatRoot{display:flex;flex-direction:column;min-height:0}#liveChatRoot{flex:1}}",   // video | chat; chat column stretches to video height, chat fills it via a full flex chain
      ".live-main{min-width:0}.live-side{min-width:0}",
      ".live-stage{position:relative;width:100%;aspect-ratio:16/9;background:#05070c;border:1px solid var(--line);border-radius:16px;overflow:hidden}",
      ".live-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0}",
      ".live-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,7,12,.45),rgba(5,7,12,.82));z-index:1}",   // darken the thumbnail so the countdown is readable
      ".live-off{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;height:100%;text-align:center;padding:24px}",
      ".live-off .lo-ico{font-size:46px;line-height:1}",
      ".live-off h3{margin:0;font-size:22px;text-shadow:0 1px 10px rgba(0,0,0,.6)}",
      ".live-off p{margin:0;color:var(--muted);max-width:46ch}",
      ".live-off .live-cd{text-shadow:0 2px 14px rgba(0,0,0,.7)}",
      ".live-ready{margin-top:14px;max-width:52ch;border-radius:12px;padding:12px 16px;font-size:14px;font-weight:700;line-height:1.55}",   // readiness banner on the community countdown screen
      ".live-ready.ok{background:rgba(34,197,94,.16);color:#86efac;border:1px solid rgba(34,197,94,.45)}",
      ".live-ready.warn{background:rgba(245,158,11,.16);color:#fcd34d;border:1px solid rgba(245,158,11,.45)}",
      ".live-ready.wait{background:var(--panel2);color:var(--muted);border:1px solid var(--line)}",
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
      ".la-thumb{display:flex;align-items:center;gap:10px;margin-top:4px}",
      ".la-thumb-prev{width:92px;height:52px;object-fit:cover;border-radius:7px;border:1px solid var(--line);flex:0 0 auto}",
      ".la-thumb input[type=file]{font-size:12px}",
      // floating admin window
      ".live-adminwin{position:fixed;top:72px;inset-inline-end:20px;width:min(390px,94vw);max-height:84vh;overflow:auto;z-index:10000;background:var(--panel);border:1px solid var(--accent);border-radius:14px;box-shadow:0 18px 54px rgba(0,0,0,.6)}",
      ".live-adminwin .live-admin{border:0;margin:0;padding:14px}",
      ".law-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;background:var(--panel2);border-bottom:1px solid var(--line);cursor:move;font-weight:800;font-size:14px}",
      ".law-x{background:transparent;border:0;color:var(--muted);font-size:18px;cursor:pointer;line-height:1}",
      ".law-x:hover{color:var(--ink)}",
      ".law-bans{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px}",
      ".law-ban-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;padding:6px 0;border-bottom:1px solid var(--line)}",
      ".law-ban-row button{font-size:12px;padding:3px 11px}",
      ".live-admin .la-stat{font-size:12px;color:var(--muted);margin-top:10px}",
      "@media(max-width:640px){.live-admin .la-grid{grid-template-columns:1fr}.live-meta h2{font-size:19px}}",
      ".lc-locked{border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--muted);font-size:13.5px;text-align:center;padding:22px 16px}",   // community: chat is members-only
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

  // optional uploaded thumbnail as the background of the soon/offline stage. The URL is validated to a
  // bare https URL (no quotes/parens/spaces) so it can't break out of the CSS url() — no injection.
  function _thumb(s) {
    var u = (s && /^https:\/\/[^\s'"()]+$/i.test(String(s.thumbnail_url || ""))) ? s.thumbnail_url : "";
    return u ? { bg: ' style="background-image:url(\'' + u + '\');background-size:cover;background-position:center"', scrim: '<div class="live-scrim"></div>' }
             : { bg: "", scrim: "" };
  }
  // the community "vault" stage for a LIVE community broadcast: a signed player for entitled viewers,
  // a "checking" state while we resolve access, or the Hebrew "private — join the community" screen.
  function _communityLiveHtml() {
    if (_access === "ok" && _commIframe) {
      return '<div class="live-stage"><iframe src="' + esc(_commIframe) + '" ' +
        'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen playsinline></iframe></div>';
    }
    if (_access === "checking" || _access === "unknown") {
      return '<div class="live-stage"><div class="live-off"><div class="lo-ico">🔄</div>' +
        '<h3>בודקים את ההרשאה שלך…</h3><p>רגע, מוודאים שאתה חבר קהילה.</p></div></div>';
    }
    // locked — not entitled (guest, or logged-in without a verified Discord membership)
    var loggedIn = !!me();
    var discordBtn = '<button class="btn primary" id="liveDiscord" style="background:#5865F2;color:#fff;font-weight:800;font-size:14px;padding:9px 16px">' +
      (loggedIn ? "התחבר עם Discord לאימות חברות" : "התחבר עם Discord") + "</button>";
    return '<div class="live-stage"><div class="live-off"><div class="lo-ico">🔒</div>' +
      "<h3>הלייב פרטי כרגע — להצטרפות הירשם לקהילה</h3>" +
      '<p>השידור הזה פתוח לחברי הקהילה בלבד. הצטרף לקהילה בפטריון, והתחבר עם Discord כדי שנאמת את החברות שלך.</p>' +
      '<div class="live-row" style="justify-content:center">' +
        '<a class="btn" href="' + PATREON_JOIN + '" target="_blank" rel="noopener" style="background:#dc2626;color:#fff;font-weight:800;font-size:14px;padding:9px 16px;text-decoration:none">🎁 הצטרף לקהילה (Patreon)</a>' +
        discordBtn +
      "</div></div></div>";
  }

  function _playerHtml(s, vs) {
    if (vs === "live" && _isCommunity(s)) return _communityLiveHtml();   // the vault — gated player
    if (vs === "live") {
      var pb = s && s.playback;
      if (pb && pb.uid && pb.customer) {
        // DVR (rewind during the live) needs the active broadcast's VIDEO id; fall back to the Live Input id
        // (no DVR) if it isn't resolved yet. MUTED autoplay is allowed cross-origin (unmuted → black); the
        // player's own controls give manual play/unmute; playsinline keeps it inline on mobile.
        var vid = (s && s.live_video_uid && /^[a-f0-9]{32}$/i.test(s.live_video_uid)) ? s.live_video_uid : null;
        var id = vid || pb.uid;
        var dvr = vid ? "&dvrEnabled=true" : "";
        var src = "https://customer-" + pb.customer + ".cloudflarestream.com/" + id + "/iframe?autoplay=true&muted=true&controls=true&playsinline=true" + dvr;
        return '<div class="live-stage"><iframe src="' + esc(src) + '" ' +
          'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen playsinline></iframe></div>';
      }
      return '<div class="live-stage"><div class="live-off"><div class="lo-ico">🔴</div><h3>השידור חי</h3>' +
        '<p>הנגן עדיין לא הוגדר (חסרים פרטי ה-Playback של Cloudflare). ראה הוראות ההגדרה.</p></div></div>';
    }
    if (vs === "soon") {
      var when = s && s.scheduled_at ? new Date(s.scheduled_at) : null;
      var ts = _thumb(s);
      return '<div class="live-stage"' + ts.bg + '>' + ts.scrim + '<div class="live-off"><div class="lo-ico">⏳</div>' +
        '<h3>השידור יתחיל בקרוב</h3>' +
        (when ? '<div class="live-cd" id="liveCountdown">—</div>' : '<p>תכף מתחילים — הישאר בעמוד.</p>') +
        (_isCommunity(s) ? _readyBannerHtml(s) : "") +
        "</div></div>";
    }
    if (vs === "unknown") {
      return '<div class="live-stage"><div class="live-off"><div class="lo-ico">🔄</div>' +
        '<h3>בודקים את מצב השידור…</h3><p>לא הצלחנו כרגע לקבל את סטטוס השידור מ-Cloudflare — מנסים שוב אוטומטית.</p></div></div>';
    }
    var to = _thumb(s);
    return '<div class="live-stage"' + to.bg + '>' + to.scrim + '<div class="live-off"><div class="lo-ico">⚫</div>' +
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
    // when the admin has announced a live giveaway, surface a prominent entry button right here on /live
    var gvw = "";
    try { if (window.LiveAlert && window.LiveAlert.active && window.LiveAlert.active()) gvw = '<button class="btn" id="liveGvw" style="background:#dc2626;color:#fff;font-weight:800;font-size:13px;padding:6px 12px">🎁 השתתף בהגרלה</button>'; } catch (e) {}
    var adm = isAdmin() ? '<button class="btn ghost" id="liveAdminBtn" style="font-size:13px;padding:6px 12px">🎛️ ניהול</button>' : "";
    return '<div class="live-meta">' +
      '<div class="live-row">' + badge + prev + gvw +
      '<button class="btn ghost" id="liveShare" style="font-size:13px;padding:6px 12px">🔗 שיתוף</button>' + adm + "</div>" +
      title + desc + plats + "</div>";
  }

  // the admin form fields (rendered inside the floating window, wrapped in .live-admin for styling)
  function _adminFields(s) {
    if (s && s.preview) return '<div class="la-stat">🧪 מצב בדיקה (Preview) — עריכה וכתיבה מושבתות (קריאה-בלבד).</div>';
    var sch = s && s.scheduled_at ? new Date(s.scheduled_at) : null;
    var schVal = "";
    if (sch && !isNaN(sch)) { var off = sch.getTime() - sch.getTimezoneOffset() * 60000; schVal = new Date(off).toISOString().slice(0, 16); }
    var mode = (s && s.mode) || "auto";
    var vis = (s && s.visibility === "community") ? "community" : "public";
    function opt(v, l) { return '<option value="' + v + '"' + (mode === v ? " selected" : "") + ">" + l + "</option>"; }
    function vopt(v, l) { return '<option value="' + v + '"' + (vis === v ? " selected" : "") + ">" + l + "</option>"; }
    return '<label>כותרת</label><input id="laTitle" maxlength="200" value="' + esc(s && s.title) + '">' +
      '<label>תיאור</label><textarea id="laDesc" maxlength="1000">' + esc(s && s.description) + "</textarea>" +
      '<div class="la-grid">' +
      '<div><label>מצב תצוגה</label><select id="laMode">' + opt("auto", "אוטומטי (לפי השידור)") + opt("soon", "השידור יתחיל בקרוב") + opt("offline", "כבוי (OFFLINE מאולץ)") + "</select></div>" +
      '<div><label>זמן התחלה מתוזמן (לא חובה)</label><input type="datetime-local" id="laSched" value="' + schVal + '"></div>' +
      "</div>" +
      '<label>👁️ נראות השידור</label><select id="laVis">' + vopt("public", "🌐 ציבורי — פתוח לכולם") + vopt("community", "🔒 קהילה בלבד — רק חברי הקהילה (כספת)") + "</select>" +
      '<div class="la-stat">🔒 "קהילה" = שידור מה-Input הסגור; רק חברי הדיסקורד (משלמים) רואים דרך קישור חתום. ⚠️ ודא ש-OBS משדר ל-Stream Key ה<b>סגור</b> לפני מעבר ל"קהילה".</div>' +
      '<label>תמונת רקע למסך "בקרוב" / "אין שידור" (Thumbnail)</label>' +
      '<div class="la-thumb">' + (s && s.thumbnail_url ? '<img src="' + esc(s.thumbnail_url) + '" class="la-thumb-prev" alt=""><button class="btn ghost" id="laThumbRemove" style="font-size:12px;padding:5px 10px">🗑️ הסר תמונה</button>' : "") +
        '<input type="file" id="laThumb" accept="image/*"></div>' +
      '<div class="live-row"><button class="btn primary" id="laSave" style="font-size:13px;padding:7px 14px">💾 שמור</button>' +
      '<button class="btn ghost" id="laClearSched" style="font-size:13px;padding:7px 12px">נקה תזמון</button></div>' +
      '<div class="live-row" style="margin-top:4px"><button class="btn" id="laPush" style="background:#dc2626;color:#fff;font-weight:800;font-size:13px;padding:7px 14px">📢 שלח התראה לנייד — "אני בלייב"</button>' +
      '<button class="btn ghost" id="laPushTest" style="font-size:13px;padding:7px 12px">🧪 בדיקה — רק אליי</button></div>' +
      '<div class="la-stat">📢 = לכל מנויי ההתראות (פעם אחת; חסימה חוזרת 10 דק׳). 🧪 = נשלח רק לטלפון שלך לבדיקה, בלי להעיר אף אחד.</div>' +
      '<div class="live-row" style="margin-top:4px"><button class="btn ghost" id="laClearChat" style="font-size:13px;padding:7px 12px;color:#ff9b9b;border-color:#3a2030">🧹 נקה את כל הצ\'אט</button></div>' +
      '<div class="la-stat">מנקה את כל הודעות הצ\'אט (להכנה ללייב הבא). מסתיר לכולם — הפיך, המידע נשמר.</div>' +
      '<div class="la-stat" id="laStat">מצב שידור אמיתי מ-Cloudflare: <b>' + (s && s.is_live ? "🔴 חי" : "⚫ לא פעיל") + "</b>" +
      " · אי אפשר לאלץ 'LIVE' ידנית — הוא נקבע לפי החיבור בפועל של OBS.</div>";
  }

  // ---- floating admin window (opened from the 🎛️ button on /live; accessible only via the live channel) ----
  function _modCall(payload) {
    return _accessToken().then(function (tok) {
      if (!tok) return { error: "no_token" };
      return fetch("/api/live-mod", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); }).catch(function () { return { error: "net" }; });
    });
  }
  function closeAdmin() { var w = $("liveAdminWin"); if (w) w.remove(); }
  function openAdmin() {
    if (!isAdmin()) return;
    if (_status) { _renderAdminWin(); }
    else { _get().then(function (r) { if (r) _status = r; _renderAdminWin(); }); }
  }
  function _renderAdminWin() {
    closeAdmin();
    var s = _status;
    var win = document.createElement("div");
    win.id = "liveAdminWin"; win.className = "live-adminwin"; win.dir = "rtl";
    win.innerHTML =
      '<div class="law-head" id="lawHead"><span>🎛️ ניהול שידור</span><button class="law-x" id="lawClose" title="סגור">✕</button></div>' +
      '<div class="law-body live-admin">' + _adminFields(s) +
        '<div class="law-bans" id="lawBans"><div class="muted" style="font-size:12px">טוען חסומים…</div></div>' +
      "</div>";
    document.body.appendChild(win);
    _wireAdmin();
    var close = $("lawClose"); if (close) close.onclick = closeAdmin;
    _dragWin(win, $("lawHead"));
    if (!(s && s.preview)) _loadBans();
  }
  function _dragWin(win, handle) {
    if (!handle) return;
    handle.onmousedown = function (e) {
      if (e.target && e.target.id === "lawClose") return;
      var r = win.getBoundingClientRect();
      win.style.insetInlineEnd = "auto"; win.style.left = r.left + "px"; win.style.top = r.top + "px";
      var sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top;
      e.preventDefault();
      document.onmousemove = function (ev) {
        win.style.left = Math.max(0, sl + ev.clientX - sx) + "px";
        win.style.top = Math.max(0, st + ev.clientY - sy) + "px";
      };
      document.onmouseup = function () { document.onmousemove = null; document.onmouseup = null; };
    };
  }
  function _loadBans() {
    var box = $("lawBans"); if (!box) return;
    _modCall({ action: "list_bans" }).then(function (r) {
      if (!box.parentNode) return;
      if (!r || !r.ok) { box.innerHTML = '<div class="muted" style="font-size:12px">לא ניתן לטעון חסומים</div>'; return; }
      var bans = r.bans || [];
      var head = '<div style="font-weight:800;font-size:13px;margin-bottom:6px">🚫 חסומים' + (bans.length ? " (" + bans.length + ")" : "") + "</div>";
      if (!bans.length) { box.innerHTML = head + '<div class="muted" style="font-size:12px">אין חסומים</div>'; return; }
      box.innerHTML = head + bans.map(function (b) {
        return '<div class="law-ban-row"><span>' + esc(b.name || b.user_id) + '</span><button class="btn ghost" data-unban="' + esc(b.user_id) + '">שחרר</button></div>';
      }).join("");
      var btns = box.querySelectorAll("[data-unban]");
      for (var i = 0; i < btns.length; i++) btns[i].onclick = function () { _unban(this.getAttribute("data-unban")); };
    });
  }
  function _unban(userId) {
    _modCall({ action: "unban", user_id: userId }).then(function (r) {
      if (r && r.ok) { toast("החסימה שוחררה ✓"); _loadBans(); } else { toast("השחרור נכשל"); }
    });
  }

  function _body(s) {
    var vs = _vs(s);
    // two-column on desktop (video+meta on one side, chat on the other); stacks on mobile.
    return '<div class="live-grid">' +
        '<div class="live-main">' +
          '<div id="livePlayer">' + _playerHtml(s, vs) + "</div>" +
          '<div id="liveMeta">' + _metaHtml(s, vs) + "</div>" +
        "</div>" +
        '<div class="live-side"><div id="liveChatRoot"></div></div>' +   // live chat + waiting/viewer count
      "</div>";
    // admin controls are no longer inline — they open in a floating window via the 🎛️ button (see openAdmin).
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

  // wire controls that live INSIDE the player stage (the locked community screen's Discord button)
  function _wirePlayer() {
    var db = $("liveDiscord");
    if (db) db.onclick = function () { try { SNAuth.signInWithDiscord(); } catch (e) {} };
  }
  // chat + presence gating: public live → normal chat; community live → chat only for entitled members,
  // otherwise a "members only" note. (The video itself is server-gated; this mirrors it in the chat UI.)
  function _syncCommunityChat(s, vs) {
    var root = $("liveChatRoot"); if (!root) return;
    if (_isCommunity(s) && vs === "live" && _access !== "ok") {
      if (window.LiveChat && window.LiveChat.unmount) window.LiveChat.unmount();
      root.innerHTML = '<div class="lc-locked">🔒 הצ׳אט פתוח לחברי הקהילה בלבד</div>';
      return;
    }
    if (window.LiveChat && window.LiveChat.mount) window.LiveChat.mount();     // (re)mount if needed — idempotent
    if (window.LiveChat && window.LiveChat.setPhase) window.LiveChat.setPhase(vs);
  }

  function _wireMeta() {
    var sh = $("liveShare");
    if (sh) sh.onclick = function () {
      var url = liveUrl();
      if (navigator.share) { navigator.share({ title: "StratNinja — שידור חי", url: url }).catch(function () {}); return; }
      try { navigator.clipboard.writeText(url); toast("הקישור הועתק ✓"); } catch (e) { toast(url); }
    };
    var gv = $("liveGvw");   // 🎁 enter the announced giveaway (entry auto-prompts login if a guest)
    if (gv) gv.onclick = function () { try { if (window.setPageExternal) window.setPageExternal("giveaway"); else location.href = "/giveaway"; } catch (e) { location.href = "/giveaway"; } };
    var ab = $("liveAdminBtn"); if (ab) ab.onclick = openAdmin;   // 🎛️ open the floating admin window
  }
  function _wireAdmin() {
    var save = $("laSave"); if (!save) return;
    save.onclick = function () {
      var sched = ($("laSched") && $("laSched").value) || "";
      var body = {
        title: ($("laTitle") && $("laTitle").value) || "",
        description: ($("laDesc") && $("laDesc").value) || "",
        mode: ($("laMode") && $("laMode").value) || "auto",
        visibility: ($("laVis") && $("laVis").value) || "public",
        scheduled_at: sched ? new Date(sched).toISOString() : null,
      };
      save.disabled = true; save.textContent = "שומר…";
      _post(body).then(function (r) {
        save.disabled = false; save.textContent = "💾 שמור";
        if (r && r.ok) { _status = r; toast("נשמר ✓"); _apply(true); } else { toast("שמירה נכשלה" + (r && r.error ? " · " + r.error : "")); }
      });
    };
    var clr = $("laClearSched"); if (clr) clr.onclick = function () { if ($("laSched")) $("laSched").value = ""; };
    var th = $("laThumb"); if (th) th.onchange = function () { var f = th.files && th.files[0]; if (f) _uploadThumb(f); };
    var thRm = $("laThumbRemove");
    if (thRm) thRm.onclick = function () {
      if (!confirm("להסיר את התמונה? מסך 'בקרוב/אין שידור' יחזור לברירת המחדל.")) return;
      thRm.disabled = true; thRm.textContent = "מסיר…";
      _accessToken().then(function (tok) {
        if (!tok) { thRm.disabled = false; thRm.textContent = "🗑️ הסר תמונה"; toast("יש להתחבר מחדש"); return; }
        fetch("/api/live-thumb", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ remove: true }) })
          .then(function (r) { return r.json(); })
          .then(function (r) {
            if (r && r.ok) {
              _status = Object.assign({}, _status, { thumbnail_url: null });
              toast("התמונה הוסרה ✓"); _apply(true);
              var tw = document.querySelector(".law-body .la-thumb");
              if (tw) { var img = tw.querySelector(".la-thumb-prev"); if (img) img.remove(); }
              thRm.remove();
            } else { thRm.disabled = false; thRm.textContent = "🗑️ הסר תמונה"; toast("ההסרה נכשלה"); }
          }).catch(function () { thRm.disabled = false; thRm.textContent = "🗑️ הסר תמונה"; toast("ההסרה נכשלה"); });
      });
    };
    var clc = $("laClearChat");
    if (clc) clc.onclick = function () {
      if (!confirm("לנקות את כל הצ'אט? כל ההודעות ייעלמו מהמסך ומהצ'אט (להכנה ללייב הבא). המידע נשמר וניתן לשחזור.")) return;
      clc.disabled = true; clc.textContent = "מנקה…";
      _modCall({ action: "clear" }).then(function (r) {
        clc.disabled = false; clc.textContent = "🧹 נקה את כל הצ'אט";
        toast(r && r.ok ? "הצ'אט נוקה ✓" : ("הניקוי נכשל" + (r && r.error ? " · " + r.error : "")));
      });
    };
    function _livePush(btn, test) {
      var lbl = btn.textContent; btn.disabled = true; btn.textContent = "שולח…";
      _accessToken().then(function (tok) {
        if (!tok) { btn.disabled = false; btn.textContent = lbl; toast("יש להתחבר מחדש"); return; }
        fetch("/api/live-push", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ kind: "live", test: !!test }) })
          .then(function (r) { return r.json(); })
          .then(function (r) {
            btn.disabled = false; btn.textContent = lbl;
            if (r && r.ok) toast(test ? "התראת בדיקה בדרך אליך בלבד ✓ (עד דקה)" : "ההתראה בדרך לכל המנויים ✓ (עד דקה)");
            else if (r && r.cooldown) toast("כבר נשלחה לאחרונה — נסה שוב בעוד ~" + (r.wait || "") + " דק׳");
            else toast("שליחה נכשלה" + (r && r.error ? " · " + r.error : ""));
          }).catch(function () { btn.disabled = false; btn.textContent = lbl; toast("שליחה נכשלה"); });
      });
    }
    var pushBtn = $("laPush");
    if (pushBtn) pushBtn.onclick = function () {
      if (!confirm('לשלוח התראת פוש לכל המנויים: "🔴 StratNinja בלייב עכשיו"? נשלח פעם אחת.')) return;
      _livePush(pushBtn, false);
    };
    var pushTest = $("laPushTest");
    if (pushTest) pushTest.onclick = function () { _livePush(pushTest, true); };
  }

  // upload a thumbnail via the SERVER (service role) — reliable even though the storage RLS blocks a
  // direct client upload. The server stores the image + saves its URL on the live_status row.
  function _uploadThumb(file) {
    if (file.size > 3 * 1024 * 1024) { toast("התמונה גדולה מדי (מקס׳ 3MB)"); return; }
    toast("מעלה תמונה…");
    var reader = new FileReader();
    reader.onerror = function () { toast("קריאת הקובץ נכשלה"); };
    reader.onload = function () {
      _accessToken().then(function (tok) {
        if (!tok) { toast("יש להתחבר מחדש"); return; }
        fetch("/api/live-thumb", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ data_url: reader.result }) })
          .then(function (r) { return r.json(); })
          .then(function (r) {
            if (r && r.ok && r.thumbnail_url) {
              _status = Object.assign({}, _status, { thumbnail_url: r.thumbnail_url });
              toast("התמונה הועלתה ✓"); _apply(true);
              var tw = document.querySelector(".law-body .la-thumb");   // refresh the preview in the window
              if (tw) { var img = tw.querySelector(".la-thumb-prev"); if (!img) { img = document.createElement("img"); img.className = "la-thumb-prev"; tw.insertBefore(img, tw.firstChild); } img.src = r.thumbnail_url; }
            } else { toast("העלאה נכשלה" + (r && r.error ? " · " + r.error : "")); }
          }).catch(function () { toast("העלאה נכשלה"); });
      });
    };
    reader.readAsDataURL(file);
  }

  // apply _status to the DOM without reloading the player unless the player state changed
  function _apply(force) {
    if (!$("liveRoot")) return;
    var s = _status, vs = _vs(s);
    // COMMUNITY vault: resolve access once the live is on; reset the gate when it's no longer a community live.
    if (_isCommunity(s) && vs === "live") _ensureCommunity();
    else if (_accessTried) _resetCommunity();
    // COMMUNITY readiness: on the SOON/countdown screen, resolve whether the viewer is already a verified member.
    if (_isCommunity(s) && vs === "soon") _ensureReady();
    else if (_readyTried) _resetReady();
    var sig = vs + "|" + (s && s.playback && s.playback.uid || "") + "|" + (s && s.live_video_uid || "") +
      "|" + (_isCommunity(s) ? "c" : "p") + "|" + _access + "|" + _ready;   // also rebuild when visibility / vault-access / readiness changes
    if (force || sig !== _playerSig) {
      _playerSig = sig;
      var pl = $("livePlayer"); if (pl) { pl.innerHTML = _playerHtml(s, vs); _wirePlayer(); }
    }
    var mt = $("liveMeta"); if (mt) { mt.innerHTML = _metaHtml(s, vs); _wireMeta(); }
    _syncCommunityChat(s, vs);   // mount/gate chat + presence ("ממתינים"/"צופים"); locks chat for non-members
    _tickCd();
    // keep the floating admin window's live-status line fresh (only while it's open & not being edited)
    if (isAdmin() && $("laStat") && document.activeElement && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
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
    if (window.LiveChat && window.LiveChat.mount) window.LiveChat.mount();   // live chat + waiting/viewer count
  }

  // Called by the SPA when leaving the /live page: stop the player so there is NO background
  // video/audio, and stop the status poll. Removing the <iframe> immediately halts media (even
  // when the SPA only HIDES #page — e.g. navigating to the journal — rather than re-rendering it).
  function teardown() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    if (_cd) { clearInterval(_cd); _cd = null; }
    _playerSig = ""; _resetCommunity();                    // force a fresh player + re-check the vault when the user returns
    var pl = $("livePlayer"); if (pl) pl.innerHTML = "";   // remove the Cloudflare iframe → stops video + audio
    if (window.LiveChat && window.LiveChat.unmount) window.LiveChat.unmount();   // stop chat/presence polling + heartbeat
    closeAdmin();   // close the floating admin window when leaving /live
  }

  return { render: render, wire: wire, teardown: teardown, openAdmin: openAdmin };
})();
