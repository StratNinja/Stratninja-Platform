/* StratNinja — Giveaways ("הגרלות") page module.
 * Public page: live entrant list + synced draw animation. Admin (Adi) controls
 * open/close/draw + prize pool. Backed by Supabase (giveaways + giveaway_entries).
 * Stage 1: entry via the site "אני בפנים" button (logged-in users).
 * Stage 2 (later): entry via YouTube live-chat keyword (needs /api/giveaway poller).
 * Registered into the SPA via PAGES.giveaway in pages.js.
 */
window.Giveaway = (function () {
  "use strict";

  var ADMIN_EMAIL = "koriatmanagement@gmail.com";
  var POLL_MS = 3000;

  var _row = null;          // the giveaways 'current' row
  var _entries = [];        // entries of the current round
  var _timer = null;        // supabase poll interval (state + live list)
  var _chatTimer = null;    // youtube chat poll interval (admin only, while open)
  var _busy = false;
  var _anim = { round: -1, iv: null, done: false };   // draw-animation bookkeeping
  var _draw = { round: -1, key: "" };                  // draw-sequence bookkeeping (runs once per draw)
  var _stageSig = "";                                  // memoize the stage render to avoid flicker / preserve the spin
  var PRIZE_MS = 6000, WINNER_MS = 9000;               // phase 1 = prize wheel, phase 2 = name roller
  var WHEEL_COLORS = ["#16a34a", "#dc2626", "#22c55e", "#ef4444", "#15803d", "#b91c1c", "#4ade80", "#f87171", "#166534", "#991b1b"];   // trading red/green

  // ---- tiny helpers (this file has its own scope — don't rely on pages.js closures) ----
  function supa() { try { return window.SNAuth && SNAuth.getClient && SNAuth.getClient(); } catch (e) { return null; } }
  function me() { try { return window.SNAuth && SNAuth.user && SNAuth.user(); } catch (e) { return null; } }
  function isAdmin() { try { return ((me() || {}).email || "").toLowerCase() === ADMIN_EMAIL; } catch (e) { return false; } }
  function myName() {
    var u = me(); if (!u) return "";
    var m = u.user_metadata || {};
    return m.full_name || m.name || m.user_name || (u.email ? u.email.split("@")[0] : "אנונימי");
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function toast(msg) { try { if (window.snToast) return window.snToast(msg); } catch (e) {} try { console.log("[giveaway]", msg); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function now() { return Date.now(); }

  // ---- call the admin-only server poller (/api/giveaway) with the user's Supabase token ----
  function _accessToken() {
    var c = supa(); if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return (r.data && r.data.session && r.data.session.access_token) || null; }).catch(function () { return null; });
  }
  function _apiCall(action, extra) {
    return _accessToken().then(function (tok) {
      if (!tok) return { error: "no_token" };
      var qs = "action=" + encodeURIComponent(action);
      if (extra) Object.keys(extra).forEach(function (k) { qs += "&" + k + "=" + encodeURIComponent(extra[k]); });
      return fetch("/api/giveaway?" + qs, { headers: { Authorization: "Bearer " + tok } }).then(function (r) { return r.json(); });
    });
  }
  // start/stop the YouTube chat polling loop (admin only, while a giveaway is open)
  var _endedToasted = false;
  function _startChatPoll() {
    if (_chatTimer) return;
    var tick = function () {
      if (!$("gvwRoot") || !_row || _row.status !== "open") { _stopChatPoll(); return; }
      _apiCall("poll").then(function (r) {
        var cs = $("gvwChatStat");
        if (r && r.error) {
          if (cs) cs.innerHTML = '🔴 קריאת צ׳אט: ' + esc(r.reason || r.error) + (r.detail ? " · " + esc(r.detail) : "");
          if (r.ended && !_endedToasted) { _endedToasted = true; toast("צ׳אט הלייב הסתיים — אפשר לסגור ולהגריל"); }   // toast ONCE, not every poll
        } else if (r && !r.skip) {
          if (cs) cs.innerHTML = '🟢 קורא צ׳אט · נסרקו ' + (r.scanned || 0) + " · נוספו " + (r.added || 0) +
            (r.writeErr ? ' · <span style="color:var(--red)">כתיבה נכשלה: ' + esc(r.writeErr) + "</span>" : "");
        }
        // new entrants surface via the normal Supabase poll (_fetch → _paint)
      }).catch(function () {});
    };
    tick();
    _chatTimer = setInterval(tick, 5000);
  }
  function _stopChatPoll() { if (_chatTimer) { clearInterval(_chatTimer); _chatTimer = null; } }

  function _injectCss() {
    if ($("gvwCss")) return;
    var s = document.createElement("style"); s.id = "gvwCss";
    s.textContent = [
      ".gvw-wrap{max-width:900px;margin:0 auto}",
      ".gvw-hero{text-align:center;padding:10px 0 4px}",
      ".gvw-hero h1{font-size:30px;margin:0 0 6px;display:flex;gap:10px;justify-content:center;align-items:center}",
      ".gvw-pill{display:inline-block;padding:4px 14px;border-radius:999px;font-weight:700;font-size:13px}",
      ".gvw-pill.idle{background:var(--panel2);color:var(--muted)}",
      ".gvw-pill.open{background:rgba(34,197,94,.16);color:var(--green)}",
      ".gvw-pill.closed{background:rgba(234,179,8,.16);color:#eab308}",
      ".gvw-pill.drawing{background:rgba(99,102,241,.18);color:#818cf8}",
      ".gvw-pill.done{background:rgba(236,72,153,.16);color:#ec4899}",
      ".gvw-stage{margin:16px 0;text-align:center}",
      ".gvw-count{font-size:15px;color:var(--muted);margin:10px 0}",
      ".gvw-count b{color:var(--fg);font-size:22px}",
      ".gvw-list{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px;max-height:320px;overflow:auto;padding:4px}",
      ".gvw-chip{background:var(--panel2);border:1px solid var(--border);border-radius:999px;padding:5px 13px;font-size:13px;font-weight:600;animation:gvwPop .3s ease}",
      ".gvw-chip.me{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}",
      "@keyframes gvwPop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}",
      ".gvw-join{font-size:18px;padding:14px 34px;margin-top:8px}",
      ".gvw-slot{font-size:34px;font-weight:800;letter-spacing:.5px;min-height:46px;color:var(--accent);margin:8px 0}",
      ".gvw-spin-ico{font-size:52px;animation:gvwSpin 1s linear infinite;display:inline-block}",
      "@keyframes gvwSpin{to{transform:rotate(360deg)}}",
      ".gvw-winner{animation:gvwReveal .6s ease}",
      "@keyframes gvwReveal{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}",
      ".gvw-winner .wn-name{font-size:40px;font-weight:900;margin:6px 0;background:linear-gradient(90deg,#fbbf24,#f472b6,#818cf8);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}",
      ".gvw-winner .wn-prize{font-size:22px;font-weight:700;margin-top:4px}",
      ".gvw-admin{background:var(--panel);border:1px dashed var(--accent);border-radius:14px;padding:14px;margin-bottom:18px}",
      ".gvw-admin h3{margin:0 0 10px;font-size:15px}",
      ".gvw-prz{display:flex;gap:8px;align-items:center;margin-bottom:6px}",
      ".gvw-prz input{flex:1}",
      ".gvw-prz input.w{flex:0 0 64px;text-align:center}",
      ".gvw-btnrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}",
      ".gvw-wheelwrap{position:relative;display:inline-block;margin:6px auto 0}",
      ".gvw-wheelwrap svg{filter:drop-shadow(0 0 16px rgba(34,197,94,.4)) drop-shadow(0 0 26px rgba(220,38,38,.25))}",
      ".gvw-wheel-rot{transform-origin:50% 50%;transition:none}",
      ".gvw-ptr{position:absolute;top:-6px;left:50%;transform:translateX(-50%);font-size:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));z-index:2;line-height:1}",
      ".gvw-wheel-cap{font-size:16px;color:var(--muted);margin-bottom:4px}",
      ".gvw-roller{position:relative;height:322px;overflow:hidden;width:min(440px,92vw);margin:10px auto;-webkit-mask-image:linear-gradient(180deg,transparent,#000 20%,#000 80%,transparent);mask-image:linear-gradient(180deg,transparent,#000 20%,#000 80%,transparent)}",
      ".gvw-roller-sel{position:absolute;left:4px;right:4px;top:138px;height:46px;background:var(--panel2);border:2px solid var(--accent);border-radius:12px;z-index:0;box-shadow:0 0 18px rgba(99,102,241,.35)}",
      ".gvw-roller-strip{position:relative;z-index:1;will-change:transform}",
      ".gvw-roller-row{height:46px;line-height:46px;text-align:center;font-size:21px;font-weight:800;color:var(--fg)}",
      ".gvw-ov{position:fixed;inset:0;z-index:99999;background:radial-gradient(circle at 50% 38%,rgba(8,18,12,.98),rgba(0,0,0,.99));display:flex;align-items:center;justify-content:center;padding:14px;overflow:auto}",
      ".gvw-ov-inner{width:100%;max-width:760px;text-align:center;margin:auto}",
      ".gvw-ov h2{font-size:clamp(20px,5vw,30px);margin:0 0 10px;font-weight:900}",
      ".gvw-ov .gvw-wheelwrap svg{width:min(80vmin,580px);height:auto}",
      ".gvw-ov .gvw-roller{width:min(92vw,560px)}",
      ".gvw-ov .gvw-roller-row{font-size:clamp(19px,5.5vw,28px)}",
      ".gvw-ov-close{position:absolute;top:14px;inset-inline-start:14px;font-size:20px;background:var(--panel2);border:1px solid var(--border);border-radius:50%;width:44px;height:44px;cursor:pointer;color:var(--fg);line-height:1}",
      ".gvw-ov-win .wn-name{font-size:clamp(30px,9vw,56px);font-weight:900;margin:6px 0;background:linear-gradient(90deg,#fbbf24,#22c55e,#f472b6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}",
      ".gvw-ov-win .wn-prize{font-size:clamp(18px,5vw,26px);font-weight:800;margin-top:4px}",
      ".gvw-aw{margin:16px auto 0;max-width:460px;text-align:right}",
      ".gvw-aw .aw-row{display:flex;justify-content:space-between;gap:10px;padding:8px 13px;border:1px solid var(--border);border-radius:10px;margin-bottom:6px;background:var(--panel);font-size:14px}",
      ".gvw-aw .aw-row.new{border-color:var(--accent);box-shadow:0 0 12px rgba(99,102,241,.3)}",
      ".gvw-ov-btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px}",
    ].join("");
    document.head.appendChild(s);
  }

  // ======================= render (static shell) =======================
  function render() {
    _injectCss();
    var adm = isAdmin() ? _adminPanel() : "";
    return '<div class="gvw-wrap" id="gvwRoot">' +
      adm +
      '<div class="gvw-hero">' +
        '<h1>🎁 <span id="gvwTitle">הגרלות StratNinja</span></h1>' +
        '<span class="gvw-pill idle" id="gvwPill">טוען…</span>' +
      '</div>' +
      '<div class="gvw-stage" id="gvwStage"></div>' +
      '<div class="gvw-count" id="gvwCount"></div>' +
      '<div class="gvw-list" id="gvwList"></div>' +
    '</div>';
  }

  function _adminPanel() {
    return '<div class="gvw-admin" id="gvwAdmin">' +
      '<h3>🛠️ ניהול הגרלה (אדמין)</h3>' +
      '<div class="fgrp"><label>כותרת</label><input id="gvwAdmTitle" type="text" placeholder="הגרלת StratNinja"></div>' +
      '<div class="fgrp"><label>מילת-קסם לצ׳אט הלייב</label><input id="gvwAdmKw" type="text" placeholder="NINJA"></div>' +
      '<label style="font-size:12px;color:var(--muted)">פרסים (אימוג׳י · תיאור · כמות זוכים)</label>' +
      '<div id="gvwPrizes"></div>' +
      '<button class="btn ghost" id="gvwAddPrize" style="font-size:12px;margin-top:4px">➕ הוסף פרס</button>' +
      '<div class="gvw-btnrow" id="gvwAdmBtns"></div>' +
      '<div class="muted" style="font-size:11px;margin-top:8px" id="gvwAdmHint"></div>' +
      '<div class="muted" style="font-size:11px;margin-top:4px" id="gvwChatStat"></div>' +
    '</div>';
  }

  // ======================= wire =======================
  function wire() {
    if (!supa()) {   // local mode / not configured
      var st = $("gvwStage"); if (st) st.innerHTML = '<div class="note">שירות ההגרלות אינו זמין במצב מקומי.</div>';
      return;
    }
    if (isAdmin()) _wireAdmin();
    // join button (delegated — it lives inside the dynamic stage)
    var root = $("gvwRoot");
    if (root) root.addEventListener("click", function (e) {
      var j = e.target.closest ? e.target.closest("[data-gvw-join]") : null;
      if (j) { e.preventDefault(); _join(); }
      var lg = e.target.closest ? e.target.closest("[data-gvw-login]") : null;
      if (lg) { e.preventDefault(); try { SNAuth.signInWithGoogle(); } catch (e2) {} }
    });
    _fetch().then(function () {
      if (!_row) {   // table missing / backend hiccup → don't spin forever
        var pl = $("gvwPill"); if (pl) { pl.className = "gvw-pill idle"; pl.textContent = "לא זמין"; }
        var st = $("gvwStage"); if (st) st.innerHTML = '<div class="note">שירות ההגרלות בהכנה — נסו שוב בקרוב. 🎁</div>';
        return;
      }
      _paint();
    });
    if (_timer) clearInterval(_timer);
    _timer = setInterval(function () {
      if (!$("gvwRoot")) { clearInterval(_timer); _timer = null; _stopChatPoll(); _closeOverlay(); return; }   // left the page → stop polling + close overlay
      _fetch().then(_paint);
    }, POLL_MS);
  }

  // ======================= data =======================
  function _fetch() {
    var c = supa(); if (!c) return Promise.resolve();
    return c.from("giveaways").select("*").eq("id", "current").single().then(function (r) {
      _row = r.data || _row;
      var round = _row ? _row.round : 0;
      return c.from("giveaway_entries").select("user_key,name,source,created_at").eq("round", round).order("created_at", { ascending: true });
    }).then(function (r) {
      if (r && r.data) _entries = r.data;
      return _row;
    }).catch(function (e) { try { console.warn("giveaway fetch", e); } catch (x) {} return _row; });
  }

  // ======================= paint (dynamic parts) =======================
  function _paint() {
    if (!_row || !$("gvwRoot")) return;
    var t = $("gvwTitle"); if (t) t.textContent = _row.title || "הגרלות StratNinja";
    var pill = $("gvwPill");
    if (pill) {
      pill.className = "gvw-pill " + _row.status;
      pill.textContent = ({ idle: "לא פעילה", open: "● ההרשמה פתוחה", closed: "ההרשמה נסגרה", drawing: "מגרילים…", done: "יש זוכה! 🎉" })[_row.status] || _row.status;
    }
    var cnt = $("gvwCount");
    if (cnt) cnt.innerHTML = (_row.status === "idle") ? "" : ('<b>' + _entries.length + "</b> משתתפים בהגרלה");
    _paintList();
    _paintStage();
    // the big draw happens in a FULLSCREEN overlay (prize wheel → name roller → winner)
    if ((_row.status === "drawing" || _row.status === "done") && _row.winner && _row.winner.last) _syncOverlay();
    else _closeOverlay();
    if (isAdmin()) {
      _paintAdminBtns();
      // drive the YouTube chat reader only while open + a live chat is linked
      if (_row.status === "open" && _row.yt_live_chat_id) _startChatPoll(); else _stopChatPoll();
    }
  }

  function _paintList() {
    var el = $("gvwList"); if (!el) return;
    if (_row.status === "idle" || _row.status === "done") { el.innerHTML = ""; return; }
    var uid = (me() || {}).id;
    el.innerHTML = _entries.map(function (e) {
      var mine = uid && e.user_key === uid;
      var pfx = e.source === "youtube" ? "▶️ " : e.source === "manual" ? "✍️ " : "";
      return '<span class="gvw-chip' + (mine ? " me" : "") + '">' + pfx + esc(e.name) + "</span>";
    }).join("");
  }

  function _paintStage() {
    var el = $("gvwStage"); if (!el) return;
    var s = _row.status;
    // memoize: rebuild only when something visible changed (avoids flicker)
    var sig = s + "|" + _entries.length + "|" + _awarded().length + "|" + _row.round;
    if (sig === _stageSig && el.children.length) return;
    _stageSig = sig;

    if (s === "idle") {
      el.innerHTML = '<div class="note">אין הגרלה פעילה כרגע. עקבו אחרי הלייבים — ההגרלה הבאה בקרוב! 🎁</div>';
      return;
    }
    if (s === "open") {
      var kw = esc(_row.keyword || "NINJA");
      el.innerHTML =
        '<div style="font-size:23px;font-weight:800;color:var(--green);margin-bottom:6px">🎉 ההרשמה פתוחה!</div>' +
        '<div style="font-size:16px;margin-bottom:10px">כתבו <b style="color:var(--accent);font-size:20px">' + kw + '</b> בצ׳אט של הלייב כדי להיכנס 🎥</div>' +
        (_entries.length
          ? '<div class="gvw-wheel-cap">🎡 ' + _entries.length + ' משתתפים בהגרלה</div>' + _wheelBlock(_entries.map(function (e) { return e.name || "צופה"; }))
          : '<div class="note">ממתינים למשתתפים הראשונים… ✍️</div>');
      return;
    }
    if (s === "closed") {
      var pr = (_row.prizes || []).filter(function (p) { return (p.label || "").trim(); });
      el.innerHTML = '<div style="font-size:22px;font-weight:800;color:#eab308;margin-bottom:2px">🔒 ההרשמה נסגרה · ' + _entries.length + ' משתתפים</div>' +
        '<div class="gvw-wheel-cap">🎁 גלגל ההטבות מוכן — לחצו "הגרל זוכה"!</div>' +
        (pr.length ? _wheelBlock(pr.map(function (p) { return (p.emoji ? p.emoji + " " : "") + p.label; })) : '<div class="note">אין פרסים.</div>');
      return;
    }
    if (s === "drawing" || s === "done") { el.innerHTML = '<div class="note" style="font-size:16px">🎬 ההגרלה על המסך — צפו! ⬆️</div>'; return; }
  }

  function _iJoined() {
    var uid = (me() || {}).id; if (!uid) return false;
    return _entries.some(function (e) { return e.user_key === uid; });
  }

  // ---- prize wheel (SVG, red/green trading theme, ninja hub) ----
  function _wheelBlock(labels) {
    if (!labels || !labels.length) labels = ["—"];
    return '<div class="gvw-wheelwrap"><div class="gvw-ptr">🔻</div>' + _wheelSVG(labels) + "</div>";
  }
  function _wheelSVG(labels) {
    var n = labels.length, cx = 160, cy = 160, r = 150;
    var fs = n > 30 ? 8 : n > 18 ? 10 : n > 10 ? 12 : 13;
    var segs = "", txt = "";
    for (var i = 0; i < n; i++) {
      var a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
      var a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      var col = WHEEL_COLORS[i % WHEEL_COLORS.length];
      if (n === 1) { segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + col + '"/>'; }
      else {
        var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        var large = (a1 - a0) > Math.PI ? 1 : 0;
        segs += '<path d="M' + cx + ',' + cy + ' L' + x0.toFixed(1) + ',' + y0.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' Z" fill="' + col + '" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>';
      }
      var am = (a0 + a1) / 2, lr = r * 0.62;
      var lx = cx + lr * Math.cos(am), ly = cy + lr * Math.sin(am);
      var deg = am * 180 / Math.PI;
      var nm = labels[i]; if (nm.length > 15) nm = nm.slice(0, 14) + "…";
      txt += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#fff" font-size="' + fs + '" font-weight="800" text-anchor="middle" dominant-baseline="central" transform="rotate(' + deg.toFixed(1) + " " + lx.toFixed(1) + " " + ly.toFixed(1) + ')">' + esc(nm) + "</text>";
    }
    return '<svg viewBox="0 0 320 320" width="340" height="340" style="max-width:90vw;height:auto">' +
      '<circle cx="160" cy="160" r="157" fill="none" stroke="#0c0c0c" stroke-width="8"/>' +
      '<g class="gvw-wheel-rot" id="gvwWheelRot">' + segs + txt + "</g>" +
      '<circle cx="160" cy="160" r="35" fill="#07120b" stroke="#22c55e" stroke-width="3"/>' +
      '<image href="ninja-icon.png" x="134" y="134" width="52" height="52"/>' +
      "</svg>";
  }
  function _spinTo(targetIndex, n, durMs) {
    var g = $("gvwWheelRot"); if (!g) return;
    n = n || 1;
    var seg = 360 / n;
    var center = (targetIndex + 0.5) * seg + (Math.random() - 0.5) * seg * 0.4;
    var target = 360 * 6 + (360 - center);   // several full turns, then land the target under the top pointer
    g.style.transition = "none"; g.style.transform = "rotate(0deg)";
    void g.getBoundingClientRect();
    g.style.transition = "transform " + durMs + "ms cubic-bezier(.13,.66,.08,1)";
    g.style.transform = "rotate(" + target + "deg)";
  }

  // ---- prize pool (quantities) + eligibility ----
  function _prizeQty(p) { return Math.max(1, p.qty != null ? +p.qty : (p.weight != null ? +p.weight : 1)); }
  function _awarded() { return (_row && _row.winner && _row.winner.awarded) || []; }
  function _livePrizes() { return (_row.prizes || []).filter(function (p) { return (p.label || "").trim(); }); }
  function _remainingUnits() {   // prize objects, each repeated by its REMAINING quantity
    var used = {}; _awarded().forEach(function (w) { var k = w.prize && w.prize.label; if (k) used[k] = (used[k] || 0) + 1; });
    var out = [];
    _livePrizes().forEach(function (p) { var rem = _prizeQty(p) - (used[p.label] || 0); for (var i = 0; i < rem; i++) out.push(p); });
    return out;
  }
  function _eligibleEntries() {
    var won = {}; _awarded().forEach(function (w) { if (w.user_key) won[w.user_key] = 1; });
    return _entries.filter(function (e) { return !won[e.user_key]; });
  }

  // ---- fullscreen overlay (the big draw happens here) ----
  function _ensureOverlay() {
    var ov = $("gvwOv");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "gvwOv"; ov.className = "gvw-ov";
      ov.innerHTML = '<button class="gvw-ov-close" id="gvwOvClose" title="סגור">✕</button><div class="gvw-ov-inner" id="gvwOvBody"></div>';
      document.body.appendChild(ov);
      var cl = $("gvwOvClose"); if (cl) cl.onclick = function () { var o = $("gvwOv"); if (o) o.style.display = "none"; };
    }
    ov.style.display = "flex";
    var cl2 = $("gvwOvClose"); if (cl2) cl2.style.display = isAdmin() ? "" : "none";
    return $("gvwOvBody");
  }
  function _closeOverlay() { var ov = $("gvwOv"); if (ov) ov.remove(); _draw.key = ""; }
  function _syncOverlay() {
    var body = _ensureOverlay();
    if (_row.status === "drawing") {
      if (_draw.key !== _row.draw_until) { _draw.key = _row.draw_until; _runDrawSequence(body); }   // run once per draw
      return;
    }
    if (_row.status === "done") {
      if (_draw.key !== "done:" + _awarded().length) { _draw.key = "done:" + _awarded().length; _overlayDone(body); }
    }
  }

  // ---- two-phase draw: (1) prize wheel → won prize, (2) iOS name roller → winner ----
  function _runDrawSequence(body) {
    var last = (_row.winner && _row.winner.last) || {};
    var prizes = _livePrizes();
    var wonLabel = last.prize && last.prize.label;
    var pIdx = 0; for (var i = 0; i < prizes.length; i++) { if (prizes[i].label === wonLabel) { pIdx = i; break; } }
    var drawEnd = _row.draw_until ? new Date(_row.draw_until).getTime() : (now() + PRIZE_MS + WINNER_MS);
    var prizeDur = Math.max(1500, (drawEnd - WINNER_MS) - now());
    body.innerHTML = '<h2 style="color:#818cf8">🥁 מגרילים את ההטבה…</h2>' +
      _wheelBlock(prizes.length ? prizes.map(function (p) { return (p.emoji ? p.emoji + " " : "") + p.label; }) : ["🎁"]);
    setTimeout(function () { _spinTo(pIdx, prizes.length || 1, prizeDur); }, 70);
    setTimeout(function () { if (_row && _row.status === "drawing") _winnerPhase(body); }, prizeDur + 300);
  }
  function _winnerPhase(body) {
    var last = (_row.winner && _row.winner.last) || {};
    var names = _entries.map(function (e) { return e.name || "צופה"; });
    var wIdx = 0; for (var i = 0; i < _entries.length; i++) { if (_entries[i].user_key === last.user_key) { wIdx = i; break; } }
    var drawEnd = _row.draw_until ? new Date(_row.draw_until).getTime() : (now() + WINNER_MS);
    var dur = Math.max(2500, drawEnd - now());
    var pz = last.prize ? ((last.prize.emoji || "🎁") + " " + last.prize.label) : "";
    body.innerHTML = '<h2 style="color:var(--green)">🎯 ומי הזוכה?</h2>' +
      (pz ? '<div style="font-size:16px;color:var(--muted);margin-bottom:8px">על ההטבה: <b>' + esc(pz) + "</b></div>" : "") +
      '<div class="gvw-roller"><div class="gvw-roller-sel"></div><div class="gvw-roller-strip" id="gvwRoller"></div></div>';
    setTimeout(function () { _spinRoller(names, wIdx, dur); }, 70);
  }
  function _spinRoller(names, wIdx, dur) {
    var strip = $("gvwRoller"); if (!strip) return;
    var n = names.length || 1, rowH = 46, R = n <= 3 ? 16 : 8;
    var reel = [];
    for (var k = 0; k < R + 2; k++) for (var i = 0; i < n; i++) reel.push(names[i]);
    var targetIdx = R * n + wIdx;   // winner centered at the end
    strip.innerHTML = reel.map(function (nm) { return '<div class="gvw-roller-row">' + esc(nm.length > 22 ? nm.slice(0, 21) + "…" : nm) + "</div>"; }).join("");
    strip.style.transition = "none"; strip.style.transform = "translateY(0)";
    void strip.getBoundingClientRect();
    strip.style.transition = "transform " + dur + "ms cubic-bezier(.08,.6,.12,1)";   // fast → slow (decelerates to the winner)
    strip.style.transform = "translateY(" + (-(targetIdx - 3) * rowH) + "px)";
  }
  function _overlayDone(body) {
    var aw = _awarded(), last = (_row.winner && _row.winner.last) || {};
    var lastPrize = last.prize || {};
    var moreLeft = _remainingUnits().length > 0 && _eligibleEntries().length > 0;
    var awHtml = aw.map(function (w, i) {
      var pr = w.prize || {};
      return '<div class="aw-row' + (i === aw.length - 1 ? " new" : "") + '"><b>' + esc(w.name || "—") + "</b><span>" + esc((pr.emoji || "🎁") + " " + (pr.label || "")) + "</span></div>";
    }).join("");
    var ctrls = isAdmin()
      ? '<div class="gvw-ov-btns">' +
        (moreLeft ? '<button class="btn primary" data-gadm="draw">🎁 הגרל את הבא!</button>' : '<div class="note" style="margin:0">כל הפרסים חולקו 🎉</div>') +
        '<button class="btn ghost" data-gadm="reset">↺ סיום / איפוס</button></div>'
      : "";
    body.innerHTML = '<div class="gvw-ov-win">' +
      '<div style="font-size:18px;color:var(--muted)">🎊 הזוכה 🎊</div>' +
      '<div class="wn-name">' + esc(last.name || "—") + '</div>' +
      '<div class="wn-prize">' + esc(lastPrize.emoji || "🎁") + " זכה ב: <b>" + esc(lastPrize.label || "פרס") + "</b></div>" +
      "</div>" +
      (aw.length > 1 ? '<div class="gvw-aw">' + awHtml + "</div>" : "") +
      ctrls;
    if (isAdmin()) body.querySelectorAll("[data-gadm]").forEach(function (b) { b.onclick = function () { _admAction(b.dataset.gadm); }; });
    try { if (window.snConfetti) window.snConfetti(); } catch (e) {}
  }

  // ======================= site join =======================
  function _join() {
    var c = supa(); if (!c) return;
    var u = me(); if (!u) { try { SNAuth.signInWithGoogle(); } catch (e) {} return; }
    if (!_row || _row.status !== "open") { toast("ההרשמה אינה פתוחה כרגע"); return; }
    if (_iJoined()) return;
    c.from("giveaway_entries").insert({ round: _row.round, source: "site", user_key: u.id, name: myName() })
      .then(function (r) {
        if (r.error && r.error.code !== "23505") { toast("ההרשמה נכשלה — נסה שוב"); return; }
        _entries.push({ user_key: u.id, name: myName(), source: "site" });
        _paint();
      }).catch(function () { toast("ההרשמה נכשלה — נסה שוב"); });
  }

  // ======================= admin =======================
  var _przDraft = null;   // local editable copy of the prize list

  function _wireAdmin() {
    _przDraft = null;
    var add = $("gvwAddPrize");
    if (add) add.onclick = function () { _ensureDraft(); _przDraft.push({ id: "p" + now(), emoji: "🎁", label: "", qty: 1 }); _renderPrizes(); };
    // initial fill once the first fetch returns
    _fetch().then(function () {
      var ti = $("gvwAdmTitle"); if (ti) ti.value = _row && _row.title || "";
      var kw = $("gvwAdmKw"); if (kw) kw.value = _row && _row.keyword || "";
      _renderPrizes();
      _paint();
    });
  }

  function _ensureDraft() { if (!_przDraft) _przDraft = JSON.parse(JSON.stringify((_row && _row.prizes) || [])); }

  function _renderPrizes() {
    _ensureDraft();
    var box = $("gvwPrizes"); if (!box) return;
    box.innerHTML = _przDraft.map(function (p, i) {
      return '<div class="gvw-prz">' +
        '<input type="text" data-pe="' + i + '" value="' + esc(p.emoji || "") + '" style="flex:0 0 46px;text-align:center" maxlength="2">' +
        '<input type="text" data-pl="' + i + '" value="' + esc(p.label || "") + '" placeholder="תיאור הפרס">' +
        '<input type="number" class="w" data-pw="' + i + '" value="' + _prizeQty(p) + '" min="1" title="כמות זוכים">' +
        '<button class="btn ghost" data-px="' + i + '" style="padding:4px 9px">✕</button>' +
      '</div>';
    }).join("") || '<div class="muted" style="font-size:12px">אין פרסים — הוסף לפחות אחד.</div>';
    box.querySelectorAll("[data-pe]").forEach(function (el) { el.oninput = function () { _przDraft[+el.dataset.pe].emoji = el.value; }; });
    box.querySelectorAll("[data-pl]").forEach(function (el) { el.oninput = function () { _przDraft[+el.dataset.pl].label = el.value; }; });
    box.querySelectorAll("[data-pw]").forEach(function (el) { el.oninput = function () { var p = _przDraft[+el.dataset.pw]; p.qty = Math.max(1, +el.value || 1); delete p.weight; }; });
    box.querySelectorAll("[data-px]").forEach(function (el) { el.onclick = function () { _przDraft.splice(+el.dataset.px, 1); _renderPrizes(); }; });
  }

  function _paintAdminBtns() {
    var row = $("gvwAdmBtns"); if (!row) return;
    var s = _row.status, h = "";
    if (s === "idle" || s === "done") h = '<button class="btn primary" data-gadm="open">🚀 פתח הרשמה</button>';
    else if (s === "open") h = '<button class="btn" data-gadm="close">🔒 סגור הרשמה</button><button class="btn ghost" data-gadm="manual">➕ ידני</button><button class="btn ghost" data-gadm="demo">🧪 דמה</button>';
    else if (s === "closed") h = '<button class="btn primary" data-gadm="draw">🥁 הגרל זוכה!</button><button class="btn ghost" data-gadm="manual">➕ ידני</button><button class="btn ghost" data-gadm="demo">🧪 דמה</button>';
    else if (s === "drawing") h = '<button class="btn ghost" data-gadm="reset">עצור / איפוס</button>';
    h += '<button class="btn ghost" data-gadm="save">💾 שמור הגדרות</button>';
    if (s !== "idle") h += '<button class="btn ghost" data-gadm="reset">↺ איפוס</button>';
    row.innerHTML = h;
    var hint = $("gvwAdmHint");
    if (hint) hint.textContent = ({
      idle: 'לחץ "פתח הרשמה" כשאתה מוכן — אז תתחיל להתמלא רשימת המשתתפים.',
      open: 'המשתתפים נכנסים (כותבים בצ׳אט). "דמה" מוסיף משתתפי בדיקה. כשסיימת — סגור הרשמה.',
      closed: 'לחץ "הגרל זוכה" — הגלגל ייפתח במסך מלא. כל לחיצה = זוכה נוסף, עד שהפרסים נגמרים.',
      drawing: "מגריל…",
      done: 'ההגרלה הסתיימה. "פתח הרשמה" מתחיל סבב חדש.',
    })[s] || "";
    row.querySelectorAll("[data-gadm]").forEach(function (b) { b.onclick = function () { _admAction(b.dataset.gadm); }; });
  }

  function _admAction(act) {
    if (_busy) return;
    if (act === "save") return _save();
    if (act === "open") return _open();
    if (act === "close") return _patch({ status: "closed", closed_at: new Date().toISOString() });
    if (act === "draw") return _startDraw();
    if (act === "demo") return _addDemo();
    if (act === "manual") return _addManual();
    if (act === "reset") { _closeOverlay(); return _patch({ status: "idle", winner: null, draw_until: null }); }
  }

  function _patch(fields) {
    var c = supa(); if (!c || !_row) return Promise.resolve();
    _busy = true; fields.updated_at = new Date().toISOString();
    return c.from("giveaways").update(fields).eq("id", "current").then(function (r) {
      _busy = false;
      if (r.error) { toast("העדכון נכשל (הרשאות?)"); return; }
      Object.assign(_row, fields);
      if (fields.status && fields.status !== "drawing") { if (_anim.iv) { clearInterval(_anim.iv); _anim.iv = null; } _anim.round = -1; }
      _paint();
    }).catch(function () { _busy = false; toast("העדכון נכשל"); });
  }

  function _save() {
    _ensureDraft();
    var title = ($("gvwAdmTitle") || {}).value || "הגרלת StratNinja";
    var kw = ($("gvwAdmKw") || {}).value || "NINJA";
    var prizes = _przDraft.filter(function (p) { return (p.label || "").trim(); });
    _patch({ title: title.trim(), keyword: kw.trim(), prizes: prizes }).then(function () { toast("ההגדרות נשמרו ✅"); });
  }

  function _open() {
    var c = supa(); if (!c || !_row) return;
    _ensureDraft();
    var prizes = _przDraft.filter(function (p) { return (p.label || "").trim(); });
    if (!prizes.length) { toast("הוסף לפחות פרס אחד לפני פתיחה"); return; }
    var title = (($("gvwAdmTitle") || {}).value || _row.title || "הגרלת StratNinja").trim();
    var kw = (($("gvwAdmKw") || {}).value || _row.keyword || "NINJA").trim();
    _busy = true; toast("מחפש לייב פעיל…");
    _apiCall("find").then(function (r) {
      _busy = false;
      var live = r && r.live;
      if (live && live.live_chat_id) { _doOpen(live, prizes, title, kw); return; }
      // auto-detect failed → manual fallback: paste the live URL/ID (or cancel to open in TEST mode without chat)
      var url = window.prompt("לא נמצא לייב פעיל.\nהדבק קישור/מזהה של לייב Public ב-YouTube — או בטל כדי לפתוח במצב בדיקה (בלי צ׳אט, עם משתתפי דמה/ידני):", "");
      if (!url) { _doOpen({ video_id: null, live_chat_id: null, title: "בדיקה (ללא צ׳אט)" }, prizes, title, kw); return; }
      _busy = true;
      _apiCall("resolve", { video: url }).then(function (rr) {
        _busy = false;
        if (rr && rr.live_chat_id) { _doOpen(rr, prizes, title, kw); }
        else { toast("לא אותר צ׳אט חי בקישור הזה (ודא שהלייב משודר כרגע)"); }
      });
    }).catch(function () { _busy = false; toast("שגיאה בחיפוש הלייב — נסה שוב"); });
  }
  function _doOpen(live, prizes, title, kw) {
    var round = (_row.round || 0) + 1;
    _patch({
      status: "open", round: round, winner: null, draw_until: null, prizes: prizes, title: title, keyword: kw,
      yt_video_id: live.video_id || null, yt_live_chat_id: live.live_chat_id || null, yt_page_token: null,
      opened_at: new Date().toISOString(),
    }).then(function () { _entries = []; _endedToasted = false; _stageSig = ""; _paint(); toast("ההרשמה נפתחה 🎉 — " + (live.title || "לייב") + " (כתבו " + kw + " בצ׳אט)"); });
  }

  function _startDraw() {
    if (_busy) return;
    var units = _remainingUnits(), elig = _eligibleEntries();
    if (!elig.length) { toast("אין עוד משתתפים זמינים"); return; }
    if (!units.length) { toast("כל הפרסים כבר חולקו"); return; }
    // pick ONE eligible entrant + ONE remaining prize unit UP FRONT so every client's wheel+roller sync
    var winnerEntry = elig[Math.floor(Math.random() * elig.length)];
    var prize = units[Math.floor(Math.random() * units.length)];
    var newWin = { name: winnerEntry.name, user_key: winnerEntry.user_key, prize: { emoji: prize.emoji || "🎁", label: prize.label } };
    var DRAW_MS = PRIZE_MS + WINNER_MS;
    _draw.key = ""; _stageSig = "";   // force a fresh draw sequence
    _patch({
      status: "drawing", draw_until: new Date(now() + DRAW_MS).toISOString(),
      winner: { awarded: _awarded().concat([newWin]), last: newWin },
    }).then(function () {
      setTimeout(function () { if (_row && _row.status === "drawing") _patch({ status: "done" }); }, DRAW_MS + 700);   // reveal after both phases
    });
  }

  // admin test helper — inject demo entrants so the draw UX can be tested without a live chat
  function _addDemo() {
    var c = supa(); if (!c || !_row) return;
    var NM = ["דני כהן", "Rachel_T", "משה לוי", "TraderMike", "נועה בר", "StratFan99", "Yossi_K", "ליאת אבני", "BullRunner", "דוד ישראלי"];
    var rows = NM.map(function (nm, i) { return { round: _row.round, source: "youtube", user_key: "demo:" + now() + ":" + i, name: nm }; });
    _busy = true;
    c.from("giveaway_entries").insert(rows).then(function (r) {
      _busy = false;
      if (r.error) { toast("הוספת דמה נכשלה (הרשאות?)"); return; }
      toast("נוספו " + rows.length + " משתתפי דמה 🧪"); _fetch().then(_paint);
    }).catch(function () { _busy = false; toast("הוספת דמה נכשלה"); });
  }

  // admin — add a participant by hand (fallback / manual entry)
  function _addManual() {
    var c = supa(); if (!c || !_row) return;
    var nm = window.prompt("שם המשתתף להוספה ידנית:", "");
    if (!nm || !nm.trim()) return;
    _busy = true;
    c.from("giveaway_entries").insert({ round: _row.round, source: "manual", user_key: "manual:" + now(), name: nm.trim().slice(0, 40) }).then(function (r) {
      _busy = false;
      if (r.error) { toast("ההוספה נכשלה (הרשאות?)"); return; }
      toast("נוסף: " + nm.trim()); _fetch().then(_paint);
    }).catch(function () { _busy = false; toast("ההוספה נכשלה"); });
  }

  return { render: render, wire: wire };
})();
