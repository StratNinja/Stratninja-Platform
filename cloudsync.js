/* StratNinja Platform — cloud sync (journal + preferences), per-user.
 *
 * The CLOUD is the single source of truth for a logged-in user. localStorage is
 * only a working cache. Because localStorage is shared per-browser (not per-user),
 * we CLEAR it whenever the logged-in user changes, then load that user's cloud row.
 * We never migrate leftover local data up to a user (that caused cross-user leaks).
 */
(function () {
  "use strict";

  const SYNCS = [
    { key: "stratninja_journal_v1", table: "user_journal", empty: { fills: [], manual: [] },
      hasData: d => d && (((d.fills || []).length) || ((d.manual || []).length)),
      rerender: () => { if (window.Journal && window.Journal.rerender) window.Journal.rerender(); } },
    { key: "stratninja_prefs_v1", table: "user_prefs", empty: { favorites: [], alerts: [], scanPanels: null, scanPresets: [], alertFeed: [], pushSubs: [] },
      hasData: d => d && (((d.favorites || []).length) || ((d.alerts || []).length) || ((d.scanPresets || []).length) || (d.scanPanels != null) || ((d.alertFeed || []).length) || ((d.pushSubs || []).length)),
      rerender: () => { if (window.Prefs && window.Prefs.notify) window.Prefs.notify(); } },
  ];
  const byKey = {}; SYNCS.forEach(s => { byKey[s.key] = s; s._timer = null; });

  let client = null, userId = null, currentUserId = "__init__", pulling = false;
  const origSet = localStorage.setItem.bind(localStorage);
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  // intercept journal/prefs writes → debounced push (only while a user is active)
  localStorage.setItem = function (k, v) {
    origSet(k, v);
    const s = byKey[k];
    if (s && client && userId && !pulling) {
      clearTimeout(s._timer);
      s._timer = setTimeout(() => pushOne(s), 900);
    }
  };

  // reset local caches WITHOUT triggering a cloud push (origSet bypasses the patch)
  function clearLocal() {
    SYNCS.forEach(s => origSet(s.key, JSON.stringify(s.empty)));
  }
  function rerenderAll() { SYNCS.forEach(s => { try { s.rerender(); } catch (e) {} }); }

  async function pushOne(s) {
    if (!client || !userId) return;
    const data = safeParse(localStorage.getItem(s.key)) || s.empty;
    try {
      const { error } = await client.from(s.table).upsert(
        { user_id: userId, data: data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) console.error("[cloudsync] push " + s.table + ":", error.message);
    } catch (e) { console.error("[cloudsync] push exception " + s.table + ":", e); }
  }

  async function pullOne(s) {
    if (!client || !userId) return;
    try {
      const { data, error } = await client.from(s.table).select("data").eq("user_id", userId).maybeSingle();
      if (error) { console.error("[cloudsync] pull " + s.table + ":", error.message); return; }
      const cloud = data ? data.data : null;
      // cloud is authoritative — set local to cloud (or empty). NO local→cloud migration.
      origSet(s.key, JSON.stringify(s.hasData(cloud) ? cloud : s.empty));
      s.rerender();
    } catch (e) { console.error("[cloudsync] pull exception " + s.table + ":", e); }
  }

  async function pullAll() {
    pulling = true;
    try { for (const s of SYNCS) await pullOne(s); }
    finally { pulling = false; }
  }

  function onUser(user) {
    const newId = user ? user.id : null;
    if (newId === currentUserId) return;   // same user (e.g. token refresh) → nothing to do
    currentUserId = newId;

    // whoever was here before, wipe their local cache immediately so it can never
    // bleed into the next user (guard with `pulling` so no push is triggered).
    pulling = true;
    SYNCS.forEach(s => clearTimeout(s._timer));
    clearLocal();
    rerenderAll();
    pulling = false;

    if (user && window.SNAuth && window.SNAuth.getClient()) {
      client = window.SNAuth.getClient();
      userId = newId;
      pullAll();                            // load THIS user's cloud data
    } else {
      client = null; userId = null;         // logged out — stays cleared
    }
  }

  function boot() {
    if (!window.SN_CLOUD || !window.SNAuth) return;
    window.SNAuth.onChange(onUser);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
