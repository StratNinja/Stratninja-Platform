/* StratNinja — accessibility widget (כפתור נגישות).
 * Self-contained floating button + panel: font size, high contrast, highlight
 * links, readable font, stop animations, reset. Choices persist in localStorage. */
(function () {
  "use strict";
  const KEY = "sn_a11y";
  let state = { font: 0, contrast: false, links: false, readable: false, noanim: false };
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) state = Object.assign(state, s); } catch (e) {}

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function applyFont() {
    const z = Math.max(0.85, Math.min(1.6, 1 + state.font * 0.12));
    ["#landing", "#appRoot"].forEach(sel => { const e = document.querySelector(sel); if (e) e.style.zoom = z; });
  }
  function applyAll() {
    const h = document.documentElement;
    h.classList.toggle("a11y-contrast", state.contrast);
    h.classList.toggle("a11y-links", state.links);
    h.classList.toggle("a11y-readable", state.readable);
    h.classList.toggle("a11y-noanim", state.noanim);
    applyFont();
    document.querySelectorAll("#a11yPanel [data-a11y]").forEach(b => {
      const k = b.dataset.a11y; if (typeof state[k] === "boolean") b.classList.toggle("on", state[k]);
    });
  }

  function act(a) {
    if (a === "font-inc") state.font = Math.min(4, state.font + 1);
    else if (a === "font-dec") state.font = Math.max(-1, state.font - 1);
    else if (a === "contrast") state.contrast = !state.contrast;
    else if (a === "links") state.links = !state.links;
    else if (a === "readable") state.readable = !state.readable;
    else if (a === "noanim") state.noanim = !state.noanim;
    else if (a === "reset") state = { font: 0, contrast: false, links: false, readable: false, noanim: false };
    else if (a === "stmt") { if (window.openLegal) window.openLegal("accessibility"); return; }
    save(); applyAll();
  }

  function buildUI() {
    const btn = document.createElement("button");
    btn.id = "a11yBtn"; btn.type = "button";
    btn.setAttribute("aria-label", "פתיחת תפריט נגישות"); btn.title = "נגישות";
    btn.textContent = "♿";
    const panel = document.createElement("div");
    panel.id = "a11yPanel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "אפשרויות נגישות"); panel.hidden = true;
    panel.innerHTML =
      '<div class="a11y-head"><span>♿ נגישות</span><button id="a11yClose" type="button" aria-label="סגירה">✕</button></div>' +
      '<div class="a11y-grid">' +
        '<button type="button" data-act="font-inc">➕ הגדל טקסט</button>' +
        '<button type="button" data-act="font-dec">➖ הקטן טקסט</button>' +
        '<button type="button" data-a11y="contrast" data-act="contrast">🌗 ניגודיות גבוהה</button>' +
        '<button type="button" data-a11y="links" data-act="links">🔗 הדגשת קישורים</button>' +
        '<button type="button" data-a11y="readable" data-act="readable">🔤 פונט קריא</button>' +
        '<button type="button" data-a11y="noanim" data-act="noanim">⏸️ עצירת אנימציות</button>' +
      "</div>" +
      '<button class="a11y-reset" type="button" data-act="reset">↺ איפוס נגישות</button>' +
      '<a href="#" class="a11y-stmt" data-act="stmt">קרא את הצהרת הנגישות ←</a>';
    document.body.appendChild(btn);
    document.body.appendChild(panel);
    btn.onclick = () => { panel.hidden = !panel.hidden; };
    panel.querySelector("#a11yClose").onclick = () => { panel.hidden = true; };
    panel.querySelectorAll("[data-act]").forEach(b => { b.onclick = e => { e.preventDefault(); act(b.dataset.act); }; });
    document.addEventListener("keydown", e => { if (e.key === "Escape") panel.hidden = true; });
    document.addEventListener("click", e => { if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true; });
  }

  function boot() { buildUI(); applyAll(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
