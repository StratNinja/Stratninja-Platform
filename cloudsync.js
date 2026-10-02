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
  const byKey = {}; SYNCS.forEach(s => { byKey[s.key] = s; s._timer = null; s._pulled = false; });

  let client = null, userId = null, currentUserId = "__init__", pulling = false;
  const origSet = localStorage.setItem.bind(localStorage);
  function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  // intercept journal/prefs writes → debounced push (only while a user is active)
  localStorage.setItem = function (k, v) {
    origSet(k, v);
    const s = byKey[k];
    // only push AFTER a confirmed successful pull for this user — otherwise a failed/incomplete pull
    // would leave local empty and this write would overwrite (wipe) the user's cloud data.
    if (s && client && userId && s._pulled && !pulling) {
      origSet(k + "__mtime", String(Date.now()));   // stamp the local edit (dirty vs last push, clock-skew-free)
      clearTimeout(s._timer);
      s._timer = setTimeout(() => pushOne(s), 400);   // shorter window = less time an edit sits unpushed
    }
  };

  // SAFETY NET: stash the current local copy (if it has data) before it is overwritten/cleared,
  // so a stale or partial cloud pull can never silently lose the user's presets/journal.
  // Recoverable from the manage dialog (📂 שחזר גיבוי אוטומטי). One rolling snapshot per key.
  function snapshot(s) {
    try {
      const cur = safeParse(localStorage.getItem(s.key));
      if (!s.hasData(cur)) return;
      // PRIMARY backup: keep the RICHEST recent copy — do NOT let a smaller/reduced local clobber a fuller,
      // still-fresh backup (this is exactly how good presets got wiped). Ages out after 24h.
      const prev = safeParse(localStorage.getItem(s.key + "__autobak"));
      const curN = JSON.stringify(cur).length;
      if (!(prev && prev.data && s.hasData(prev.data) && JSON.stringify(prev.data).length > curN
            && (Date.now() - (prev.ts || 0)) < 24 * 3600 * 1000)) {
        origSet(s.key + "__autobak", JSON.stringify({ ts: Date.now(), data: cur }));
      }
      // HISTORY: keep up to 6 distinct snapshots for deeper recovery (newest first).
      const hk = s.key + "__bakhist";
      let hist = safeParse(localStorage.getItem(hk)); if (!Array.isArray(hist)) hist = [];
      const sig = JSON.stringify(cur);
      if (!hist.length || JSON.stringify(hist[0].data) !== sig) { hist.unshift({ ts: Date.now(), data: cur }); origSet(hk, JSON.stringify(hist.slice(0, 6))); }
    } catch (e) {}
  }
  // reset local caches WITHOUT triggering a cloud push (origSet bypasses the patch)
  function clearLocal() {
    SYNCS.forEach(s => {
      const cur = safeParse(localStorage.getItem(s.key));
      snapshot(s);                        // richest-recent + 6-deep history → for MANUAL recovery only
      // EXACT pre-clear copy — this is what the dirty-guard restores. It reflects the user's LATEST state
      // including DELETIONS, so deleting presets can never be undone by a "richer" stale backup.
      origSet(s.key + "__preclear", JSON.stringify({ ts: Date.now(), data: (cur != null ? cur : s.empty) }));
      origSet(s.key, JSON.stringify(s.empty));
    });
  }
  function rerenderAll() { SYNCS.forEach(s => { try { s.rerender(); } catch (e) {} }); }

  async function pushOne(s) {
    if (!client || !userId) return;
    const data = safeParse(localStorage.getItem(s.key)) || s.empty;
    const mtimeAtPush = localStorage.getItem(s.key + "__mtime") || String(Date.now());   // capture before await
    try {
      const { error } = await client.from(s.table).upsert(
        { user_id: userId, data: data, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) console.error("[cloudsync] push " + s.table + ":", error.message);
      else origSet(s.key + "__ptime", mtimeAtPush);   // cloud now holds everything up to this local edit-stamp
    } catch (e) { console.error("[cloudsync] push exception " + s.table + ":", e); }
  }

  async function pullOne(s) {
    if (!client || !userId) return;
    try {
      const { data, error } = await client.from(s.table).select("data").eq("user_id", userId).maybeSingle();
      if (error) { console.error("[cloudsync] pull " + s.table + ":", error.message); return; }
      const cloud = data ? data.data : null;
      // DIRTY GUARD: if this device has LOCAL edits that were never pushed (edit-stamp newer than our last
      // successful push), a refresh must NOT let the stale cloud overwrite them. Keep the local copy (from the
      // pre-clear snapshot) and push it UP instead. Purely client-clock based → no server clock-skew issues.
      const mtime = +(localStorage.getItem(s.key + "__mtime") || 0);
      const ptime = +(localStorage.getItem(s.key + "__ptime") || 0);
      // restore the EXACT pre-clear local (reflects DELETIONS) — never the "richest" autobak, which would
      // resurrect presets the user just deleted and then push them back to the cloud.
      const pre = safeParse(localStorage.getItem(s.key + "__preclear"));
      if (mtime > ptime && pre && pre.data) {
        origSet(s.key, JSON.stringify(pre.data));   // honor the user's latest local state (incl. deletions)
        s._pulled = true; s.rerender();
        pushOne(s);                                 // push it up so the cloud matches
        return;
      }
      // cloud is authoritative — set local to cloud (or empty). NO local→cloud migration.
      snapshot(s);   // keep a recoverable copy of whatever local held before the cloud replaces it
      origSet(s.key, JSON.stringify(s.hasData(cloud) ? cloud : s.empty));
      s._pulled = true;                 // pull confirmed → writes may now sync up safely
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
    const prevId = currentUserId;
    currentUserId = newId;

    // whoever was here before, wipe their local cache immediately so it can never
    // bleed into the next user (guard with `pulling` so no push is triggered).
    pulling = true;
    SYNCS.forEach(s => { clearTimeout(s._timer); s._pulled = false; });   // block pushes until this user is re-pulled
    clearLocal();
    // on a REAL account switch (not the first load / refresh), the global edit-stamps + pre-clear copy belong
    // to the PREVIOUS user — reset them so the new user never inherits or pushes the old user's data.
    if (prevId && prevId !== "__init__" && prevId !== newId) {
      SYNCS.forEach(s => { origSet(s.key + "__mtime", "0"); origSet(s.key + "__ptime", "0"); origSet(s.key + "__preclear", JSON.stringify({ ts: Date.now(), data: s.empty })); });
    }
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

  // read the logged-in user's access token from the supabase-persisted session (for the keepalive flush)
  function _authToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && /^sb-.*-auth-token$/.test(k)) {
          const j = safeParse(localStorage.getItem(k));
          if (!j) continue;
          return j.access_token || (j.currentSession && j.currentSession.access_token) || (j.session && j.session.access_token) || null;
        }
      }
    } catch (e) {}
    return null;
  }
  // FLUSH any pending (debounced) push the instant the tab is hidden or the page is unloading. Uses a
  // keepalive fetch so the request SURVIVES the page tear-down — the normal async client push often dies
  // mid-flight on a hard refresh, which is exactly how starred favorites / edits got lost. Dirty-guard backs it up.
  function flushPending() {
    if (!client || !userId) return;
    const cfg = window.SN_CONFIG, token = _authToken();
    SYNCS.forEach(s => {
      if (!(s._timer && s._pulled)) { if (s._timer) { clearTimeout(s._timer); s._timer = null; } return; }
      clearTimeout(s._timer); s._timer = null;
      const data = safeParse(localStorage.getItem(s.key)) || s.empty;
      const mtimeAtPush = localStorage.getItem(s.key + "__mtime") || String(Date.now());
      if (cfg && cfg.SUPABASE_URL && token) {
        // Mark this edit as SYNCED optimistically — the instant we dispatch the keepalive push, not in its
        // .then(). A keepalive fetch is designed to complete AFTER the page tears down, so delivery is ~certain,
        // but its .then() almost never runs on a hard refresh / tab-background (very common on PHONES). Without
        // this, __ptime stays behind forever → the device is permanently "dirty" (mtime>ptime) → every load it
        // IGNORES the cloud and force-pushes its own stale local, overwriting the other device. That ping-pong
        // is exactly why presets differed between phone and computer. (Rare true failure → recoverable via __autobak.)
        try { origSet(s.key + "__ptime", mtimeAtPush); } catch (e) {}
        try {
          fetch(cfg.SUPABASE_URL + "/rest/v1/" + s.table + "?on_conflict=user_id", {
            method: "POST", keepalive: true,
            headers: {
              apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + token,
              "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify({ user_id: userId, data: data, updated_at: new Date().toISOString() }),
          }).catch(() => {});
        } catch (e) { pushOne(s); }
      } else {
        pushOne(s);
      }
    });
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPending(); });
  window.addEventListener("pagehide", flushPending);

  function boot() {
    if (!window.SN_CLOUD || !window.SNAuth) return;
    window.SNAuth.onChange(onUser);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
