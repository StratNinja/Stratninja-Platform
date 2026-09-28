/* StratNinja Platform — controls the landing ⇄ app flow and the auth UI. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);

  // Temporary "under renovation" ticker at the very top of every page (landing + app).
  // Dismissible; the dismissal survives refreshes within this visit (sessionStorage).
  function showRenovationBar() {
    const key = "sn-reno-2026-09";
    try { if (sessionStorage.getItem(key) === "1") return; } catch (_) {}
    if (document.getElementById("snRenoBar")) return;
    const msg = "🚧 האתר בשיפוצים — אנחנו משדרגים את חוויית השימוש · סליחה על אי הנוחות ותודה על הסבלנות 🚧";
    const bar = document.createElement("div");
    bar.id = "snRenoBar";
    bar.className = "sn-reno-bar";
    bar.dir = "rtl";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<div class="sn-reno-track"><span class="sn-reno-msg">' + msg + "</span>" +
      '<span class="sn-reno-msg" aria-hidden="true">' + msg + "</span></div>" +
      '<button type="button" class="sn-reno-x" aria-label="סגירת ההודעה">×</button>';
    bar.querySelector(".sn-reno-x").addEventListener("click", () => {
      bar.remove();
      try { sessionStorage.setItem(key, "1"); } catch (_) {}
    });
    document.body.insertBefore(bar, document.body.firstChild);
  }
  // luxury/uniform look: WRAP the leading emoji of each sidebar link in a span so CSS can hide it on
  // desktop (clean, icon-free labels) but SHOW it on mobile — where the sidebar collapses to a narrow
  // icon rail and the text labels are hidden. (Deleting the emoji outright left the mobile rail empty.)
  function stripNavEmojis() {
    document.querySelectorAll(".side-nav a").forEach(a => {
      if (a.querySelector(".nav-emoji")) return;   // already processed
      [...a.childNodes].forEach(n => {
        if (n.nodeType === 3 && /[\p{Extended_Pictographic}]/u.test(n.textContent)) {
          const span = document.createElement("span");
          span.className = "nav-emoji";
          span.textContent = n.textContent.trim();
          n.replaceWith(span);
        }
      });
    });
  }
  function showApp() {
    $("#landing").classList.add("hidden");
    $("#appRoot").classList.remove("hidden");
    document.body.classList.add("in-app");
    // first-time users get the guided tour once (the 📖 button re-opens it anytime)
    if (window.SNGuide && window.SNGuide.autoStartIfNew) window.SNGuide.autoStartIfNew();
  }
  function showLanding() {
    $("#appRoot").classList.add("hidden");
    $("#landing").classList.remove("hidden");
    document.body.classList.remove("in-app");
  }

  function renderUserArea(user) {
    const area = $("#userArea");
    if (!area) return;
    if (user) {
      const md = user.user_metadata || {};
      const name = md.full_name || md.name || user.email || "משתמש";
      const avatar = md.avatar_url || md.picture;
      area.innerHTML =
        (avatar ? '<img src="' + avatar + '" class="avatar" referrerpolicy="no-referrer">' : "") +
        '<span class="uname">' + name + "</span>" +
        '<button class="btn ghost" id="logoutBtn">התנתק</button>';
      area.querySelector("#logoutBtn").onclick = () => SNAuth.signOut();
      area.classList.remove("hidden");
    } else {
      area.innerHTML = "";
      area.classList.add("hidden");
    }
  }

  async function boot() {
    await SNAuth.init();
    const loginBtn = $("#googleBtn");
    const isLocalhost = ["localhost", "127.0.0.1"].indexOf(location.hostname) >= 0;
    if (SNAuth.isCloud()) {
      loginBtn.querySelector(".lbl").textContent = "התחבר עם Google";
      loginBtn.onclick = () => SNAuth.signInWithGoogle();
      // dev-only bypass so the UI stays testable locally before Google OAuth is set up
      if (isLocalhost) {
        const note = $("#modeNote");
        if (note) {
          note.classList.remove("hidden");
          note.innerHTML = 'מצב ענן פעיל · <a href="#" id="devEnter" style="color:#cfd6e2">כניסה למצב פיתוח (ללא התחברות)</a>';
          const dev = note.querySelector("#devEnter");
          if (dev) dev.onclick = e => { e.preventDefault(); showApp(); };
        }
      }
    } else {
      loginBtn.querySelector(".lbl").textContent = "כניסה (מצב הדגמה)";
      loginBtn.onclick = () => showApp();
      const note = $("#modeNote");
      if (note) note.classList.remove("hidden");
    }

    if (SNAuth.isCloud() && SNAuth.user()) { showApp(); renderUserArea(SNAuth.user()); }
    else { showLanding(); renderUserArea(null); }

    // showRenovationBar();   // removed — the redesign is now live, so the "under renovation" notice is retired
    stripNavEmojis();      // clean, icon-free sidebar for the premium look

    SNAuth.onChange(user => {
      if (user) { showApp(); renderUserArea(user); }
      else { renderUserArea(null); showLanding(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
