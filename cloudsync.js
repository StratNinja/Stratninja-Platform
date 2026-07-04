/* StratNinja Platform — cloud sync (journal + preferences).
 *
 * Keeps localStorage blobs in sync with per-user Supabase rows (RLS: own-row).
 * Generic over several {key -> table} mappings. The journal/prefs keep using
 * localStorage synchronously; we intercept writes (debounced push) and pull the
 * cloud copy on login (cloud wins; first login migrates local up), then re-render.
 */
(function () {
  "use strict";

  const SYNCS = [
    { key: "stratninja_journal_v1", table: "user_journal", empty: { fills: [], manual: [] },
      hasData: d => d && (((d.fills || []).length) || ((d.manual || []).length)),
      rerender: () => { if (window.Journal && window.Journal.rerender) window.Journal.rerender(); } },
    { key: "stratninja_prefs_v1", table: "user_prefs", empty: { favorites: [], alerts: [] },
      hasData: d => d && (((d.favorites || []).length) || ((d.alerts || []).length)),
      rerender: () => { if (window.Prefs && window.Prefs.notify) window.Prefs.notify(); } },
  ];
  const byKey = {}; SYNCS.forEach(s => { byKey[s.key] = s; s._timer = null; });

  let client = null, userId = null, pulling = false;
  const origSet = localStorage.setItem.bind(localStorage);
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  localStorage.setItem = function (k, v) {
    origSet(k, v);
    const s = byKey[k];
    if (s && client && userId && !pulling) {
      clearTimeout(s._timer);
      s._timer = setTimeout(() => pushOne(s), 900);
    }
  };

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
      const local = safeParse(localStorage.getItem(s.key));
      if (s.hasData(cloud)) origSet(s.key, JSON.stringify(cloud));       // cloud wins
      else if (s.hasData(local)) { await pushOne(s); }                    // migrate local up
      else origSet(s.key, JSON.stringify(s.empty));
      s.rerender();
    } catch (e) { console.error("[cloudsync] pull exception " + s.table + ":", e); }
  }

  async function pullAll() {
    pulling = true;
    try { for (const s of SYNCS) await pullOne(s); }
    finally { pulling = false; }
  }

  function onUser(user) {
    if (user && window.SNAuth && window.SNAuth.getClient()) {
      client = window.SNAuth.getClient(); userId = user.id; pullAll();
    } else { client = null; userId = null; SYNCS.forEach(s => clearTimeout(s._timer)); }
  }

  function boot() {
    if (!window.SN_CLOUD || !window.SNAuth) return;
    window.SNAuth.onChange(onUser);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
