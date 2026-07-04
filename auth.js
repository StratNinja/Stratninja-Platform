/* StratNinja Platform — authentication wrapper around Supabase.
 * Falls back gracefully to "local mode" (no login) when Supabase isn't configured,
 * so the app is fully usable/testable without any backend.
 */
window.SNAuth = (function () {
  "use strict";
  let client = null;
  let currentUser = null;
  const listeners = [];

  function isCloud() { return !!window.SN_CLOUD && !!(window.supabase && window.supabase.createClient); }

  async function init() {
    if (!isCloud()) return { mode: "local", user: null };
    try {
      client = window.supabase.createClient(window.SN_CONFIG.SUPABASE_URL, window.SN_CONFIG.SUPABASE_ANON_KEY);
      const { data } = await client.auth.getSession();
      currentUser = data && data.session ? data.session.user : null;
      client.auth.onAuthStateChange((_event, session) => {
        currentUser = session ? session.user : null;
        listeners.forEach(cb => cb(currentUser));
      });
      return { mode: "cloud", user: currentUser };
    } catch (e) {
      console.error("Supabase init failed, falling back to local mode:", e);
      window.SN_CLOUD = false;
      return { mode: "local", user: null };
    }
  }

  async function signInWithGoogle() {
    if (!isCloud()) return;
    await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + location.pathname },
    });
  }

  async function signOut() {
    if (client) { try { await client.auth.signOut(); } catch (e) {} }
    currentUser = null;
    listeners.forEach(cb => cb(null));
  }

  function user() { return currentUser; }
  function getClient() { return client; }
  function onChange(cb) { listeners.push(cb); }

  return { init, signInWithGoogle, signOut, user, getClient, onChange, isCloud };
})();
