/* StratNinja Platform — controls the landing ⇄ app flow and the auth UI. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);

  function showApp() {
    $("#landing").classList.add("hidden");
    $("#appRoot").classList.remove("hidden");
    document.body.classList.add("in-app");
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
          note.innerHTML = 'מצב ענן פעיל · <a href="#" id="devEnter" style="color:#b3a9e8">כניסה למצב פיתוח (ללא התחברות)</a>';
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

    SNAuth.onChange(user => {
      if (user) { showApp(); renderUserArea(user); }
      else { renderUserArea(null); showLanding(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
