// StratNinja — LIVE presence (waiting/viewer count), server-side for reliability.
// POST (with a user token) = heartbeat: upsert THAT user's presence with the service role (a client RLS
// upsert could silently write 0 rows → the count stuck at 0). GET = just read the count. The count is the
// SECURITY DEFINER live_active_count() (heartbeats in the last 30s) — it never exposes WHO is present.
//
//   POST /api/live-presence  (Authorization: Bearer <token>) → { ok, count }   // logged-in heartbeat
//   GET  /api/live-presence                                   → { ok, count }   // anyone (guests) read

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
async function userId(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return null;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch (e) { return null; }
}
async function getCount() {
  try {
    const r = await sb("rpc/live_active_count", { method: "POST", body: JSON.stringify({ p_live: "public" }) });
    if (!r.ok) return 0;
    const n = await r.json();
    return typeof n === "number" ? n : 0;
  } catch (e) { return 0; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!SVC) { res.status(200).json({ ok: false, count: 0 }); return; }   // graceful (e.g. preview without the key)

  if (req.method === "POST") {
    const uid = await userId(req);   // null for guests → no heartbeat, just the count
    if (uid) {
      try {
        await sb("live_presence", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ user_id: uid, live_id: "public", last_seen: new Date().toISOString() }) });
      } catch (e) {}
    }
    res.status(200).json({ ok: true, count: await getCount() });
    return;
  }
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
    res.status(200).json({ ok: true, count: await getCount() });
    return;
  }
  res.status(405).json({ error: "method" });
}
