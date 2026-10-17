/* StratNinja — LIVE engagement (window.LiveChat): live CHAT + a waiting/viewer COUNT.
 *
 * Mounted by live.js into #liveChatRoot on the /live page. All security is enforced in the
 * database (RLS + a rate-limit trigger + length checks in live_engagement.sql): posting requires
 * a logged-in user and can only be done AS that user; the live count comes from a SECURITY DEFINER
 * function that returns just a number. The UI here is convenience only — never the gate.
 *
 *  • Read chat   : cached GET /api/live-chat (edge-cached ~2s) with a direct-Supabase fallback. Polled.
 *  • Post chat   : logged-in only, via the user's own Supabase session (RLS: user_id = auth.uid()).
 *  • Count       : rpc('live_active_count') — logged-in heartbeats seen in the last 30s.
 *  • Moderate    : admin (koriatmanagement) can hide a message (RLS admin-update policy).
 *
 * Runs as a classic browser <script> (sets window.LiveChat) and is also require-able in Node for
 * unit tests (sets module.exports) — the IIFE touches no DOM at load time, only inside mount/wire.
 */
(function () {
  "use strict";

  var ADMIN_EMAIL = "koriatmanagement@gmail.com";
  var LIVE_ID = "public";
  var MSG_POLL_MS = 2000;     // fetch new messages
  var BEAT_MS = 15000;        // heartbeat + refresh the count
  var MSG_MAX = 280;          // keep in sync with live_engagement.sql
  var NAME_MAX = 40;

  var _msgTimer = null, _beatTimer = null;
  var _lastId = 0;            // highest message id we've rendered (for dedup / incremental fetch)
  var _phase = "offline";     // from live.js _vs(): "live" → "צופים", else "ממתינים"
  var _seen = {};             // id → true (dedup)
  var _mounted = false;
  var _authHooked = false;    // register the SNAuth listener only once

  function $(id) { return document.getElementById(id); }
  function user() { try { return window.SNAuth && SNAuth.user && SNAuth.user(); } catch (e) { return null; } }
  function client() { try { return window.SNAuth && SNAuth.getClient && SNAuth.getClient(); } catch (e) { return null; } }
  function isAdmin() { try { return ((user() || {}).email || "").toLowerCase() === ADMIN_EMAIL; } catch (e) { return false; } }
  function toast(m) { try { if (window.snToast) window.snToast(m); } catch (e) {} }

  // ---- pure helpers (exported for unit tests) ----
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  // normalize a message the way the DB will accept it (trim, collapse blank, cap length, strip control chars)
  function cleanMsg(s) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    s = s.replace(/\s+/g, " ").trim();
    if (s.length > MSG_MAX) s = s.slice(0, MSG_MAX);
    return s;
  }
  function cleanName(s) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!s) s = "אורח";
    if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX);
    return s;
  }
  function displayName(u) {
    var md = (u && u.user_metadata) || {};
    return cleanName(md.full_name || md.name || (u && u.email) || "משתמש");
  }
  function fmtTime(iso) {
    try {
      var d = new Date(iso); if (isNaN(d)) return "";
      function p(n) { return (n < 10 ? "0" : "") + n; }
      return p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) { return ""; }
  }
  function countLabel(phase, n) {
    var noun = phase === "live" ? "צופים עכשיו" : "ממתינים ללייב";
    return "👥 " + (n || 0) + " " + noun;
  }

  // ---- CSS ----
  function _css() {
    if ($("liveChatCss")) return;
    var s = document.createElement("style");
    s.id = "liveChatCss";
    s.textContent = [
      ".lc-wrap{margin:0}",   // fills its column (video is beside it on desktop, above it on mobile)
      // desktop: the chat matches the video's height and stays FIXED (list scrolls; never shrinks when empty)
      "@media(min-width:900px){.lc-wrap{display:flex;flex-direction:column;height:100%}.lc-box{flex:1;display:flex;flex-direction:column;min-height:0}.lc-list{flex:1;max-height:none;min-height:0}}",
      ".lc-count{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:13px;padding:5px 12px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);color:var(--ink);margin-bottom:10px}",
      ".lc-count .lc-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.5);animation:lcPulse 2s infinite}",
      "@keyframes lcPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)}70%{box-shadow:0 0 0 7px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}",
      ".lc-box{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}",
      ".lc-head{padding:10px 14px;border-bottom:1px solid var(--line);font-weight:800;font-size:14px;display:flex;align-items:center;gap:8px}",
      ".lc-list{max-height:340px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:9px}",
      ".lc-msg{font-size:14px;line-height:1.45;word-break:break-word}",
      ".lc-msg .lc-name{font-weight:800;color:var(--accent)}",
      ".lc-msg .lc-t{font-size:11px;color:var(--muted);margin-inline-start:6px}",
      ".lc-msg .lc-hide,.lc-msg .lc-ban{font-size:11px;color:var(--muted);cursor:pointer;margin-inline-start:6px;opacity:.6}",
      ".lc-msg .lc-hide:hover,.lc-msg .lc-ban:hover{opacity:1;color:#ef4444}",
      ".lc-empty{color:var(--muted);font-size:13.5px;text-align:center;padding:18px 0}",
      ".lc-form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}",
      ".lc-form input{flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:9px;color:var(--ink);padding:9px 12px;font-family:inherit;font-size:14px}",
      ".lc-form button{background:var(--accent);color:#fff;border:0;border-radius:9px;padding:0 16px;font-weight:800;cursor:pointer}",
      ".lc-login{padding:12px 14px;border-top:1px solid var(--line);text-align:center;color:var(--muted);font-size:13.5px}",
      ".lc-login a{color:var(--accent);font-weight:800;cursor:pointer;text-decoration:none}",
    ].join("");
    document.head.appendChild(s);
  }

  // ---- render skeleton ----
  function _inputHtml() {   // the composer OR the login prompt, depending on whether a user is signed in
    return user()
      ? '<form class="lc-form" id="lcForm"><input id="lcInput" maxlength="' + MSG_MAX + '" placeholder="כתוב הודעה…" autocomplete="off"><button type="submit">שלח</button></form>'
      : '<div class="lc-login">כדי לכתוב בצ\'אט <a id="lcLogin">התחבר עם Google</a> · אפשר לקרוא גם בלי התחברות</div>';
  }
  function _shell() {
    return '<div class="lc-wrap">' +
      '<div class="lc-count" id="lcCount"><span class="lc-dot"></span>' + esc(countLabel(_phase, 0)) + "</div>" +
      '<div class="lc-box">' +
      '<div class="lc-head">💬 צ\'אט חי</div>' +
      '<div class="lc-list" id="lcList"><div class="lc-empty">עדיין אין הודעות — תהיו הראשונים 👋</div></div>' +
      '<div id="lcInputWrap">' + _inputHtml() + "</div>" +
      "</div></div>";
  }
  // keep the input in sync with the login state — the Supabase session often loads a moment AFTER mount,
  // so a logged-in user was seeing the "log in" prompt. Rebuilds ONLY the input, never the message list.
  function _syncInput() {
    var wrap = $("lcInputWrap"); if (!wrap) return;
    // ONLY upgrade guest-prompt → composer once a user is present. Never downgrade composer → login:
    // a transient null session (token refresh) must not yank the input box or a half-typed message.
    if (user() && !$("lcForm")) { wrap.innerHTML = _inputHtml(); _wireForm(); }
  }

  function _msgHtml(m) {
    var admin = "";
    if (isAdmin()) {
      admin = '<span class="lc-hide" data-hide="' + m.id + '" title="מחק הודעה">🗑️</span>' +
        (m.user_id ? '<span class="lc-ban" data-ban="' + esc(m.user_id) + '" data-banname="' + esc(m.name) + '" title="חסום משתמש (לא יוכל לכתוב יותר)">🚫</span>' : "");
    }
    return '<div class="lc-msg" data-id="' + m.id + '"' + (m.user_id ? ' data-user="' + esc(m.user_id) + '"' : "") + ">" +
      '<span class="lc-name">' + esc(m.name) + "</span>" +
      '<span class="lc-t">' + fmtTime(m.created_at) + "</span>" + admin +
      "<div>" + esc(m.msg) + "</div></div>";
  }

  function _append(msgs) {
    var list = $("lcList"); if (!list) return;
    var fresh = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (!m || _seen[m.id]) continue;
      _seen[m.id] = true;
      if (m.id > _lastId) _lastId = m.id;
      fresh.push(m);
    }
    if (!fresh.length) return;
    var empty = list.querySelector(".lc-empty"); if (empty) empty.remove();
    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    list.insertAdjacentHTML("beforeend", fresh.map(_msgHtml).join(""));
    if (nearBottom) list.scrollTop = list.scrollHeight;
    if (isAdmin()) _wireMod();
  }

  // ---- data ----
  function _fetchMsgs() {
    // cached edge read first (protects Supabase from per-viewer polling); fall back to direct Supabase.
    return fetch("/api/live-chat?live=" + encodeURIComponent(LIVE_ID), { headers: { "Cache-Control": "no-cache" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok && Array.isArray(j.messages)) return j.messages;
        return _directMsgs();
      })
      .catch(function () { return _directMsgs(); });
  }
  function _directMsgs() {
    var c = client(); if (!c) return Promise.resolve([]);
    return c.from("live_chat").select("id,name,msg,created_at,user_id")
      .eq("live_id", LIVE_ID).eq("hidden", false).order("id", { ascending: false }).limit(60)
      .then(function (r) { return (r && r.data ? r.data.slice().reverse() : []); })
      .catch(function () { return []; });
  }

  function _send(raw) {
    var u = user(); var c = client();
    var msg = cleanMsg(raw);
    if (!u || !c || !msg) return Promise.resolve({ error: "empty" });
    return c.from("live_chat").insert({ live_id: LIVE_ID, user_id: u.id, name: displayName(u), msg: msg }).select()
      .then(function (r) {
        if (r && r.error) { var em = r.error.message || ""; toast(/banned/i.test(em) ? "אין באפשרותך לכתוב בצ'אט" : /rate/i.test(em) ? "רגע… אל תשלח כל כך מהר" : "השליחה נכשלה"); return { error: r.error }; }
        if (r && r.data && r.data.length) _append(r.data);   // show my own message INSTANTLY (no waiting for the poll)
        return { ok: true };
      })
      .catch(function (e) { toast("השליחה נכשלה"); return { error: e }; });
  }

  function _hide(id) {
    var c = client(); if (!c || !isAdmin()) return;
    c.from("live_chat").update({ hidden: true }).eq("id", id).then(function () {
      var el = document.querySelector('.lc-msg[data-id="' + id + '"]'); if (el) el.remove();
    }).catch(function () { toast("ההסתרה נכשלה"); });
  }
  // ban a user: add to live_chat_bans (blocks future posts via the DB trigger) + hide all their messages.
  function _ban(userId, name) {
    var c = client(); if (!c || !isAdmin() || !userId) return;
    if (typeof confirm === "function" && !confirm("לחסום את " + (name || "המשתמש") + "? הוא לא יוכל לכתוב יותר בצ'אט, וכל הודעותיו יוסתרו.")) return;
    c.from("live_chat_bans").upsert({ user_id: userId, name: name || "" }, { onConflict: "user_id", ignoreDuplicates: true })
      .then(function (r) {
        if (r && r.error) { toast("החסימה נכשלה"); return; }
        c.from("live_chat").update({ hidden: true }).eq("user_id", userId).then(function () {
          var nodes = document.querySelectorAll('.lc-msg[data-user="' + userId + '"]');
          for (var i = 0; i < nodes.length; i++) nodes[i].remove();
          toast("🚫 המשתמש נחסם וכל הודעותיו הוסתרו");
        }).catch(function () { toast("המשתמש נחסם (הסתרת ההודעות נכשלה)"); });
      }).catch(function () { toast("החסימה נכשלה"); });
  }

  function _refreshMsgs() { _fetchMsgs().then(_append); }

  function _beat() {
    var c = client(); if (!c) { _refreshCount(); return; }
    var u = user();
    if (u) {   // only logged-in users contribute a heartbeat (RLS), then everyone reads the count
      c.from("live_presence").upsert({ user_id: u.id, live_id: LIVE_ID, last_seen: new Date().toISOString() }, { onConflict: "user_id,live_id" })
        .then(_refreshCount).catch(_refreshCount);
    } else { _refreshCount(); }
  }
  function _refreshCount() {
    var c = client(); if (!c) return;
    c.rpc("live_active_count", { p_live: LIVE_ID }).then(function (r) {
      var n = (r && typeof r.data === "number") ? r.data : 0;
      var el = $("lcCount"); if (el) el.innerHTML = '<span class="lc-dot"></span>' + esc(countLabel(_phase, n));
    }).catch(function () {});
  }

  // ---- wiring ----
  function _wireMod() {   // wire the admin 🗑️ (delete one) + 🚫 (ban user) controls
    var hid = document.querySelectorAll(".lc-hide");
    for (var i = 0; i < hid.length; i++) hid[i].onclick = function () { _hide(parseInt(this.getAttribute("data-hide"), 10)); };
    var ban = document.querySelectorAll(".lc-ban");
    for (var j = 0; j < ban.length; j++) ban[j].onclick = function () { _ban(this.getAttribute("data-ban"), this.getAttribute("data-banname")); };
  }
  function _wireForm() {
    var f = $("lcForm");
    if (f) f.onsubmit = function (e) {
      e.preventDefault();
      var inp = $("lcInput"); if (!inp) return;
      var v = inp.value; inp.value = "";
      _send(v);
    };
    var lg = $("lcLogin");
    if (lg) lg.onclick = function () { try { SNAuth.signInWithGoogle(); } catch (e) {} };
  }

  // ---- lifecycle (called by live.js) ----
  function setPhase(vs) {
    _phase = vs;
    var el = $("lcCount");
    if (el) {   // keep the current number, just swap the noun
      var n = (el.textContent.match(/\d+/) || [0])[0];
      el.innerHTML = '<span class="lc-dot"></span>' + esc(countLabel(_phase, Number(n)));
    }
  }
  function mount() {
    var root = $("liveChatRoot"); if (!root || _mounted) return;
    _css();
    _mounted = true; _lastId = 0; _seen = {};
    root.innerHTML = _shell();
    _wireForm();
    if (!_authHooked && window.SNAuth && SNAuth.onChange) {   // session may arrive after mount → resync input + count
      _authHooked = true;
      SNAuth.onChange(function () { if (_mounted) { _syncInput(); _refreshCount(); } });
    }
    _refreshMsgs(); _beat();
    _msgTimer = setInterval(function () {
      if (!$("liveChatRoot")) { unmount(); return; }   // page gone
      _syncInput(); _refreshMsgs();
    }, MSG_POLL_MS);
    _beatTimer = setInterval(_beat, BEAT_MS);
  }
  function unmount() {
    if (_msgTimer) { clearInterval(_msgTimer); _msgTimer = null; }
    if (_beatTimer) { clearInterval(_beatTimer); _beatTimer = null; }
    _mounted = false; _lastId = 0; _seen = {};
    var root = $("liveChatRoot"); if (root) root.innerHTML = "";
  }

  var api = { mount: mount, unmount: unmount, setPhase: setPhase,
    // exported for unit tests:
    cleanMsg: cleanMsg, cleanName: cleanName, displayName: displayName, countLabel: countLabel, esc: esc, fmtTime: fmtTime };
  if (typeof window !== "undefined") window.LiveChat = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
