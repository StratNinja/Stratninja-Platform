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
  SUPABASE_URL: "https://iujeekdtimlmgwzzlauj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4",
  // Web Push (VAPID) public key — safe to expose; the private key stays on the server.
  VAPID_PUBLIC: "BEwmNxDuCtfAwwLdEPDKcYvkdssJ0-3CME8B9OHTAFFIuwClvfHTXNYnjNF7E9GbLN4AkkWV0tpIIZqY6W7WHeI",
};

// cloud mode is active only when both values are provided
window.SN_CLOUD = !!(window.SN_CONFIG.SUPABASE_URL && window.SN_CONFIG.SUPABASE_ANON_KEY);
