/* StratNinja Platform — configuration.
 *
 * To enable cloud mode (Google sign-in + per-user cloud storage), fill in your
 * Supabase project's URL and anon (public) key below. Leave them empty to run in
 * LOCAL MODE (no login, data saved only in this browser) — useful for development.
 *
 * These are PUBLIC values, safe to commit (the anon key is meant for the browser;
 * real security is enforced by Supabase Row-Level Security policies).
 */
window.SN_CONFIG = {
  SUPABASE_URL: "",       // e.g. "https://xxxxxxxx.supabase.co"
  SUPABASE_ANON_KEY: "",  // e.g. "eyJhbGciOi..."
};

// cloud mode is active only when both values are provided
window.SN_CLOUD = !!(window.SN_CONFIG.SUPABASE_URL && window.SN_CONFIG.SUPABASE_ANON_KEY);
