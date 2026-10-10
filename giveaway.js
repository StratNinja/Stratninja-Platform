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
  var _wheel = { round: -1, n: -1, spun: false };      // wheel render/spin bookkeeping
  var _stageSig = "";                                  // memoize the stage render to avoid flicker / preserve the spin
  var WHEEL_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316", "#06b6d4"];

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
      ".gvw-wheel-rot{transform-origin:50% 50%;transition:none}",
      ".gvw-ptr{position:absolute;top:-6px;left:50%;transform:translateX(-50%);font-size:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5));z-index:2;line-height:1}",
      ".gvw-wheel-cap{font-size:16px;color:var(--muted);margin-bottom:4px}",
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
      '<label style="font-size:12px;color:var(--muted)">פרסים (תווית · משקל הסיכוי)</label>' +
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
      if (!$("gvwRoot")) { clearInterval(_timer); _timer = null; _stopChatPoll(); return; }   // left the page → stop polling
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
      return '<span class="gvw-chip' + (mine ? " me" : "") + '">' + (e.source === "youtube" ? "▶️ " : "") + esc(e.name) + "</span>";
    }).join("");
  }

  function _paintStage() {
    var el = $("gvwStage"); if (!el) return;
    var s = _row.status;
    // memoize: rebuild only when something visible changed — keeps the wheel spin alive across polls
    var sig = s + "|" + _entries.length + "|" + (_row.winner ? 1 : 0) + "|" + _row.round + "|" + (me() ? (_iJoined() ? "in" : "out") : "anon");
    if (sig === _stageSig && el.children.length) {
      if (s === "drawing" && !_wheel.spun) { _wheel.spun = true; setTimeout(_spinWheel, 60); }
      return;
    }
    _stageSig = sig;

    if (s === "idle") {
      el.innerHTML = '<div class="note">אין הגרלה פעילה כרגע. עקבו אחרי הלייבים — ההגרלה הבאה בקרוב! 🎁</div>';
      return;
    }
    if (s === "open") {
      var kw = esc(_row.keyword || "NINJA");
      var join;
      if (!me()) join = '<button class="btn primary gvw-join" data-gvw-login>🔓 התחבר כדי להשתתף</button>';
      else if (_iJoined()) join = '<div class="note" style="color:var(--green);font-weight:700">✅ אתה בפנים! בהצלחה 🍀</div>';
      else join = '<button class="btn primary gvw-join" data-gvw-join>🙋 אני בפנים!</button>';
      el.innerHTML =
        '<div style="font-size:20px;font-weight:800;color:var(--green);margin-bottom:6px">🎉 ההרשמה פתוחה!</div>' +
        '<div class="muted" style="margin-bottom:12px">כתבו <b>"' + kw + '"</b> בצ׳אט של הלייב — או לחצו כאן באתר:</div>' +
        join +
        (_entries.length ? '<div class="gvw-wheel-cap" style="margin-top:14px">🎡 הגלגל מתמלא… ' + _entries.length + ' משתתפים</div>' + _wheelBlock() : "");
      return;
    }
    if (s === "closed") {
      el.innerHTML = '<div style="font-size:20px;font-weight:800;color:#eab308;margin-bottom:2px">🔒 ההרשמה נסגרה</div>' +
        '<div class="gvw-wheel-cap">הגלגל מוכן — ' + _entries.length + ' משתתפים · לחץ "הגרל זוכה"!</div>' +
        (_entries.length ? _wheelBlock() : '<div class="note">אין משתתפים.</div>');
      return;
    }
    if (s === "drawing") {
      el.innerHTML = '<div class="gvw-wheel-cap" style="color:#818cf8;font-weight:700">🥁 מגרילים…</div>' + _wheelBlock();
      _wheel.round = _row.round; _wheel.spun = true;
      setTimeout(_spinWheel, 60);
      return;
    }
    if (s === "done") { _showWinner(el); return; }
  }

  function _iJoined() {
    var uid = (me() || {}).id; if (!uid) return false;
    return _entries.some(function (e) { return e.user_key === uid; });
  }

  // ---- prize-wheel: a static wheel of all entrants, ready to spin 20-30s onto the winner ----
  function _wheelBlock() {
    var names = _entries.map(function (e) { return e.name || "צופה"; });
    if (!names.length) names = ["—"];
    _wheel.n = names.length;
    return '<div class="gvw-wheelwrap"><div class="gvw-ptr">🔻</div>' + _wheelSVG(names) + "</div>";
  }
  function _wheelSVG(names) {
    var n = names.length, cx = 160, cy = 160, r = 152;
    var fs = n > 30 ? 8 : n > 18 ? 10 : n > 10 ? 12 : 14;
    var segs = "", labels = "";
    for (var i = 0; i < n; i++) {
      var a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
      var a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      var col = WHEEL_COLORS[i % WHEEL_COLORS.length];
      if (n === 1) { segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + col + '"/>'; }
      else {
        var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        var large = (a1 - a0) > Math.PI ? 1 : 0;
        segs += '<path d="M' + cx + ',' + cy + ' L' + x0.toFixed(1) + ',' + y0.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' Z" fill="' + col + '" stroke="rgba(0,0,0,.28)" stroke-width="1"/>';
      }
      var am = (a0 + a1) / 2, lr = r * 0.6;
      var lx = cx + lr * Math.cos(am), ly = cy + lr * Math.sin(am);
      var deg = am * 180 / Math.PI;
      var nm = names[i]; if (nm.length > 14) nm = nm.slice(0, 13) + "…";
      labels += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="#fff" font-size="' + fs + '" font-weight="700" text-anchor="middle" dominant-baseline="central" transform="rotate(' + deg.toFixed(1) + " " + lx.toFixed(1) + " " + ly.toFixed(1) + ')">' + esc(nm) + "</text>";
    }
    return '<svg viewBox="0 0 320 320" width="330" height="330" style="max-width:88vw;height:auto">' +
      '<g class="gvw-wheel-rot" id="gvwWheelRot">' + segs + labels + "</g>" +
      '<circle cx="160" cy="160" r="30" fill="var(--panel)" stroke="var(--border)" stroke-width="3"/>' +
      '<text x="160" y="160" font-size="26" text-anchor="middle" dominant-baseline="central">🎁</text>' +
      "</svg>";
  }
  function _spinWheel() {
    var g = $("gvwWheelRot"); if (!g || !_row) return;
    var n = _entries.length || 1, w = -1;
    for (var i = 0; i < _entries.length; i++) { if (_row.winner && _entries[i].user_key === _row.winner.user_key) { w = i; break; } }
    if (w < 0) w = 0;
    var seg = 360 / n;
    var center = (w + 0.5) * seg + (Math.random() - 0.5) * seg * 0.5;   // winner-center angle (clockwise from the top pointer)
    var dur = _row.draw_until ? Math.max(3000, new Date(_row.draw_until).getTime() - now() - 500) : 25000;
    var target = 360 * 6 + (360 - center);   // several full turns, then land the winner under the top pointer
    g.style.transition = "none";
    g.style.transform = "rotate(0deg)";
    void g.getBoundingClientRect();           // reflow so the transition animates from 0
    g.style.transition = "transform " + dur + "ms cubic-bezier(.13,.66,.1,1)";
    g.style.transform = "rotate(" + target + "deg)";
  }

  function _showWinner(el) {
    if (_anim.iv) { clearInterval(_anim.iv); _anim.iv = null; }
    var w = _row.winner || {};
    var prize = w.prize || {};
    el.innerHTML = '<div class="gvw-winner">' +
      '<div style="font-size:18px;color:var(--muted)">🎊 הזוכה בהגרלה הוא 🎊</div>' +
      '<div class="wn-name">' + esc(w.name || "—") + '</div>' +
      '<div class="wn-prize">' + esc(prize.emoji || "🎁") + " זכה ב: <b>" + esc(prize.label || "פרס") + "</b></div>" +
      '<div class="muted" style="margin-top:10px">מזל טוב! 🎁 (צור קשר עם המנהל לקבלת הפרס)</div>' +
    '</div>';
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
    if (add) add.onclick = function () { _ensureDraft(); _przDraft.push({ id: "p" + now(), emoji: "🎁", label: "", weight: 1 }); _renderPrizes(); };
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
        '<input type="number" class="w" data-pw="' + i + '" value="' + (p.weight || 1) + '" min="1" title="משקל הסיכוי">' +
        '<button class="btn ghost" data-px="' + i + '" style="padding:4px 9px">✕</button>' +
      '</div>';
    }).join("") || '<div class="muted" style="font-size:12px">אין פרסים — הוסף לפחות אחד.</div>';
    box.querySelectorAll("[data-pe]").forEach(function (el) { el.oninput = function () { _przDraft[+el.dataset.pe].emoji = el.value; }; });
    box.querySelectorAll("[data-pl]").forEach(function (el) { el.oninput = function () { _przDraft[+el.dataset.pl].label = el.value; }; });
    box.querySelectorAll("[data-pw]").forEach(function (el) { el.oninput = function () { _przDraft[+el.dataset.pw].weight = Math.max(1, +el.value || 1); }; });
    box.querySelectorAll("[data-px]").forEach(function (el) { el.onclick = function () { _przDraft.splice(+el.dataset.px, 1); _renderPrizes(); }; });
  }

  function _paintAdminBtns() {
    var row = $("gvwAdmBtns"); if (!row) return;
    var s = _row.status, h = "";
    if (s === "idle" || s === "done") h = '<button class="btn primary" data-gadm="open">🚀 פתח הרשמה</button>';
    else if (s === "open") h = '<button class="btn" data-gadm="close">🔒 סגור הרשמה</button>';
    else if (s === "closed") h = '<button class="btn primary" data-gadm="draw">🥁 הגרל זוכה!</button>';
    else if (s === "drawing") h = '<button class="btn ghost" data-gadm="reset">עצור / איפוס</button>';
    h += '<button class="btn ghost" data-gadm="save">💾 שמור הגדרות</button>';
    if (s !== "idle") h += '<button class="btn ghost" data-gadm="reset">↺ איפוס</button>';
    row.innerHTML = h;
    var hint = $("gvwAdmHint");
    if (hint) hint.textContent = ({
      idle: 'לחץ "פתח הרשמה" כשאתה מוכן — אז תתחיל להתמלא רשימת המשתתפים.',
      open: "המשתתפים נכנסים עכשיו. כשסיימת — סגור הרשמה.",
      closed: 'הכל מוכן — לחץ "הגרל זוכה" ל-30 שניות מתח ואז זוכה + פרס.',
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
    if (act === "reset") return _patch({ status: "idle", winner: null, draw_until: null });
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
      // auto-detect failed → manual fallback: paste the live URL/ID
      var url = window.prompt("לא נמצא לייב פעיל אוטומטית.\nהדבק כאן קישור או מזהה של הלייב ב-YouTube (אפשר Unlisted):", "");
      if (!url) { toast("בוטל — אין לייב פעיל"); return; }
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

  var DRAW_MS = 26000;   // wheel-spin duration
  function _startDraw() {
    if (_busy) return;
    var prizes = (_row.prizes || []).filter(function (p) { return (p.label || "").trim(); });
    if (!_entries.length) { toast("אין משתתפים עדיין"); return; }
    if (!prizes.length) { toast("אין פרסים מוגדרים"); return; }
    // pick the winner + a weighted-random prize UP FRONT so every client's wheel lands on the same spot
    var winnerEntry = _entries[Math.floor(Math.random() * _entries.length)];
    var total = prizes.reduce(function (a, p) { return a + (+p.weight || 1); }, 0);
    var rnd = Math.random() * total, prize = prizes[0];
    for (var i = 0; i < prizes.length; i++) { rnd -= (+prizes[i].weight || 1); if (rnd <= 0) { prize = prizes[i]; break; } }
    _wheel.round = -1; _wheel.spun = false; _stageSig = "";   // force a fresh wheel + spin
    _patch({
      status: "drawing", draw_until: new Date(now() + DRAW_MS).toISOString(),
      winner: { name: winnerEntry.name, user_key: winnerEntry.user_key, prize: { emoji: prize.emoji || "🎁", label: prize.label } },
    }).then(function () {
      setTimeout(function () { if (_row && _row.status === "drawing") _patch({ status: "done" }); }, DRAW_MS + 500);   // reveal after the spin
    });
  }

  return { render: render, wire: wire };
})();
