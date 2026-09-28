/* StratNinja Platform — controls the landing ⇄ app flow and the auth UI. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);

  // Versioned per-tab notice: closing it survives refreshes during this visit.
  let designNoticeSeen = false;
  function showDesignNotice(afterClose) {
    const key = "sn-design-notice-2026-09";
    let seen = designNoticeSeen;
    try { seen = seen || sessionStorage.getItem(key) === "1"; } catch (_) {}
    if (seen) { afterClose(); return; }
    if (document.getElementById("snDesignNotice")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "snDesignNotice";
    dialog.className = "sn-design-notice";
    dialog.dir = "rtl";
    dialog.setAttribute("aria-labelledby", "snDesignNoticeTitle");
    dialog.setAttribute("aria-describedby", "snDesignNoticeText");
    dialog.innerHTML = '<button type="button" class="sn-design-notice-close" aria-label="סגירת ההודעה">×</button>' +
      '<div class="sn-design-notice-label">StratNinja · עדכון האתר</div>' +
      '<h2 id="snDesignNoticeTitle">אנחנו משדרגים את חוויית השימוש</h2>' +
      '<p id="snDesignNoticeText">אנחנו מבצעים כעת עדכונים ושינויים עיצוביים באתר. במהלך העבודה ייתכנו שינויים במראה ובממשק.<br><br>מתנצלים על אי הנוחות הזמנית ותודה על הסבלנות!</p>' +
      '<button type="button" class="btn primary sn-design-notice-confirm" autofocus>הבנתי, המשך לאתר</button>';
    dialog.querySelectorAll("button").forEach(button => button.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("close", () => {
      designNoticeSeen = true;
      try { sessionStorage.setItem(key, "1"); } catch (_) {}
      dialog.remove();
      afterClose();
    }, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
  }
  function showApp() {
    $("#landing").classList.add("hidden");
    $("#appRoot").classList.remove("hidden");
    document.body.classList.add("in-app");
    // first-time users get the guided tour once (the 📖 button re-opens it anytime)
    showDesignNotice(() => {
      if (window.SNGuide && window.SNGuide.autoStartIfNew) window.SNGuide.autoStartIfNew();
    });
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
