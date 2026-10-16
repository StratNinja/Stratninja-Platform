/* StratNinja — site-wide "giveaway live" flashing banner (window.LiveAlert).
 *
 * Loads on EVERY page. Polls the cached /api/live-alert; when the admin has pressed "📢 הודע לכולם"
 * (announce_until is in the future) it shows a flashing sticky bar at the top of the site that links
 * to /live. Dismissible per-announcement (dismissing one does NOT hide the next). It clears itself
 * when announce_until passes. Read-only + convenience — the giveaway's own login/entry gate is unchanged.
 */
(function () {
  "use strict";

  var POLL_MS = 6000;
  var _timer = null;
  var _cur = null;        // last alert payload { active, until, href, title }
  var _started = false;

  function active() { return (_cur && _cur.active) ? _cur : null; }   // read by live.js (the /live "השתתף" button)

  // ---- pure helpers (exported for tests) ----
  function isActive(payload, nowMs) {
    if (!payload || !payload.active || !payload.until) return false;
    var t = new Date(payload.until).getTime();
    return !isNaN(t) && t > (nowMs || Date.now());
  }
  function dismissKey(until) { return "sn_gvwalert_x_" + (until || ""); }
  function isDismissed(until) { try { return localStorage.getItem(dismissKey(until)) === "1"; } catch (e) { return false; } }
  function dismiss(until) { try { localStorage.setItem(dismissKey(until), "1"); } catch (e) {} }

  function _css() {
    if (document.getElementById("liveAlertCss")) return;
    var s = document.createElement("style");
    s.id = "liveAlertCss";
    s.textContent = [
      ".sn-gvw-alert{position:sticky;top:0;z-index:9000;display:flex;align-items:center;justify-content:center;gap:12px;",
      "padding:9px 44px 9px 14px;font-weight:800;font-size:14px;color:#fff;cursor:pointer;",
      "background:linear-gradient(90deg,#dc2626,#f59e0b,#dc2626);background-size:200% 100%;",
      "animation:snGvwFlash 1.6s ease-in-out infinite,snGvwShift 6s linear infinite;box-shadow:0 2px 14px rgba(220,38,38,.45);text-align:center}",
      ".sn-gvw-alert .sn-gvw-cta{text-decoration:underline;white-space:nowrap}",
      ".sn-gvw-alert .sn-gvw-x{position:absolute;inset-inline-end:10px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;",
      "background:rgba(0,0,0,.25);border:0;color:#fff;font-size:15px;cursor:pointer;line-height:1}",
      "@keyframes snGvwFlash{0%,100%{filter:brightness(1)}50%{filter:brightness(1.35)}}",
      "@keyframes snGvwShift{0%{background-position:0% 0}100%{background-position:200% 0}}",
      "@media(max-width:560px){.sn-gvw-alert{font-size:12.5px;padding:8px 40px 8px 10px}}",
    ].join("");
    document.head.appendChild(s);
  }

  function _go() {
    // SPA navigation when the app is loaded; otherwise a full load of /live (also works for guests).
    try {
      if (window.setPageExternal && document.body && document.body.classList.contains("in-app")) { window.setPageExternal("live"); return; }
    } catch (e) {}
    try { location.href = "/live"; } catch (e) {}
  }

  function _show(payload) {
    _css();
    var bar = document.getElementById("snGvwAlert");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "snGvwAlert";
      bar.className = "sn-gvw-alert";
      bar.setAttribute("role", "button");
      bar.innerHTML = '<span>🎁🔴 הגרלה חיה עכשיו בלייב — <span class="sn-gvw-cta">הצטרפו והשתתפו! 👈</span></span>' +
        '<button class="sn-gvw-x" aria-label="סגור">×</button>';
      bar.addEventListener("click", function (e) {
        if (e.target && e.target.classList.contains("sn-gvw-x")) { e.stopPropagation(); dismiss(payload.until); _hide(); return; }
        _go();
      });
      if (document.body) document.body.insertBefore(bar, document.body.firstChild);
    }
  }
  function _hide() { var bar = document.getElementById("snGvwAlert"); if (bar) bar.remove(); }

  function _poll() {
    fetch("/api/live-alert", { headers: { "Cache-Control": "no-cache" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        _cur = j || null;
        if (j && isActive(j, Date.now()) && !isDismissed(j.until)) _show(j);
        else _hide();
      })
      .catch(function () {});
  }

  function start() {
    if (_started) return;
    _started = true;
    _poll();
    _timer = setInterval(_poll, POLL_MS);
  }

  var api = { start: start, active: active,
    // exported for unit tests:
    isActive: isActive, dismissKey: dismissKey };
  if (typeof window !== "undefined") {
    window.LiveAlert = api;
    if (typeof document !== "undefined") {   // browser: auto-start (guarded so Node tests can import without a DOM)
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
      else start();
    }
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
