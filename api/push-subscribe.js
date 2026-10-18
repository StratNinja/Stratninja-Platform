// StratNinja — save a Web-Push subscription DIRECTLY to the user's prefs, server-side (service role).
// Previously a new subscription only reached the server via cloudsync, which could silently not run
// (not fully logged in, sync race) → the device was never registered and got no pushes. This endpoint
// writes the sub the moment the user enables notifications, so registration no longer depends on sync.
//
// POST /api/push-subscribe  (Authorization: Bearer <user access token>)
//   { subscription:{endpoint,keys,…}, remove?:"<old endpoint>" }  → { ok, devices }

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const MAX_SUBS = 20;

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
async function userIdOf(req) {   // any logged-in user (the sub is saved to THEIR row)
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return null;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) || null;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  const uid = await userIdOf(req);
  if (!uid) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const sub = body.subscription;
  const removeEp = typeof body.remove === "string" ? body.remove : null;
  if ((!sub || !sub.endpoint) && !removeEp) { res.status(400).json({ error: "no_subscription" }); return; }

  try {
    // read-modify-write this user's prefs row (service role bypasses RLS). We keep every OTHER field intact.
    const r0 = await sb("user_prefs?select=data&user_id=eq." + encodeURIComponent(uid) + "&limit=1");
    const rows = r0.ok ? await r0.json() : [];
    const existed = Array.isArray(rows) && rows.length > 0;
    const data = (existed && rows[0] && rows[0].data) ? rows[0].data : {};
    let subs = Array.isArray(data.pushSubs) ? data.pushSubs.slice() : [];

    if (removeEp) subs = subs.filter((s) => s && s.endpoint !== removeEp);
    if (sub && sub.endpoint && !subs.some((s) => s && s.endpoint === sub.endpoint)) subs.push(sub);
    if (subs.length > MAX_SUBS) subs = subs.slice(subs.length - MAX_SUBS);   // keep the most recent
    data.pushSubs = subs;

    let w;
    if (existed) {
      w = await sb("user_prefs?user_id=eq." + encodeURIComponent(uid),
        { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ data }) });
    } else {
      w = await sb("user_prefs",
        { method: "POST", headers: { Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify({ user_id: uid, data }) });
    }
    res.status(w.ok ? 200 : 502).json(w.ok ? { ok: true, devices: subs.length } : { ok: false, error: "save_failed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: "server" });
  }
}
