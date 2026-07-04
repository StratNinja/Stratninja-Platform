/* StratNinja Platform — cloud sync for the journal.
 *
 * Keeps the journal's localStorage blob in sync with a per-user row in the
 * Supabase table `user_journal` (RLS: each user only touches their own row).
 *
 * Design: the journal keeps using localStorage synchronously (unchanged). We
 * intercept writes to its key and debounce-push them to the cloud, and on login
 * we pull the cloud copy down into localStorage and re-render. This keeps the
 * journal offline-capable (localStorage is the working cache) while the cloud is
 * the durable, cross-device source of truth.
 */
(function () {
  "use strict";
  const KEY = "stratninja_journal_v1";   // must match journal.js Store KEY
  const TABLE = "user_journal";
  let client = null, userId = null, pushTimer = null, pulling = false;

  const EMPTY = { fills: [], manual: [] };
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function hasData(d) { return !!d && (((d.fills || []).length) || ((d.manual || []).length)); }

  // --- intercept journal writes to localStorage, push to cloud (debounced) ---
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) {
    origSet(k, v);
    if (k === KEY && client && userId && !pulling) schedulePush();
  };

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 900);
  }
  async function pushNow() {
    if (!client || !userId) return;
    const data = safeParse(localStorage.getItem(KEY)) || EMPTY;
    try {
      const { error } = await client.from(TABLE).upsert(
        { user_id: userId, data: data, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
      if (error) console.error("[cloudsync] push failed:", error.message);
    } catch (e) { console.error("[cloudsync] push exception:", e); }
  }

  async function pull() {
    if (!client || !userId) return;
    pulling = true;
    try {
      const { data, error } = await client.from(TABLE).select("data").eq("user_id", userId).maybeSingle();
      if (error) { console.error("[cloudsync] pull failed:", error.message); return; }
      const cloud = data ? data.data : null;
      const local = safeParse(localStorage.getItem(KEY));
      if (hasData(cloud)) {
        origSet(KEY, JSON.stringify(cloud));          // cloud wins across devices
      } else if (hasData(local)) {
        await pushNow();                               // first login: migrate local → cloud
      } else {
        origSet(KEY, JSON.stringify(EMPTY));
      }
      if (window.Journal && window.Journal.rerender) window.Journal.rerender();
    } catch (e) {
      console.error("[cloudsync] pull exception:", e);
    } finally {
      pulling = false;
    }
  }

  function onUser(user) {
    if (user && window.SNAuth && window.SNAuth.getClient()) {
      client = window.SNAuth.getClient();
      userId = user.id;
      pull();
    } else {
      client = null; userId = null;
      clearTimeout(pushTimer);
    }
  }

  function boot() {
    if (!window.SN_CLOUD || !window.SNAuth) return;   // only relevant in cloud mode
    window.SNAuth.onChange(onUser);                   // called immediately + on changes
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
