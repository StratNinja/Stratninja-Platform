// StratNinja — LIVE chat moderation (admin, server-side). Hides a message or bans a user RELIABLY by
// writing with the service-role key (bypasses RLS), after verifying the caller is the admin via their
// Supabase token. This replaces client-side RLS writes that could silently affect 0 rows (a hidden
// message reappearing on refresh). Hidden = hidden for EVERYONE (reads filter hidden=false).
//
// POST /api/live-mod  (Authorization: Bearer <supabase access token>)
//   { action:"hide",   id }            → hide one message
//   { action:"unhide", id }            → un-hide one message
//   { action:"ban",    user_id, name } → ban the user + hide all their messages
//   { action:"unban",  user_id }       → lift a ban

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
async function adminUser(req) {   // returns the admin's user object, or null if the caller isn't the admin
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return null;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return (((u && u.email) || "").toLowerCase() === ADMIN_EMAIL) ? u : null;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  const admin = await adminUser(req);
  if (!admin) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const action = body.action;

  try {
    if ((action === "hide" || action === "unhide") && body.id != null && /^[0-9]+$/.test(String(body.id))) {
      const r = await sb("live_chat?id=eq." + String(body.id), { method: "PATCH", body: JSON.stringify({ hidden: action === "hide" }) });
      res.status(r.ok ? 200 : 502).json({ ok: r.ok, action: action });
      return;
    }
    if ((action === "ban" || action === "unban") && typeof body.user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.user_id)) {
      if (action === "ban" && body.user_id === admin.id) { res.status(400).json({ error: "cannot_ban_self" }); return; }   // never ban the admin
      if (action === "ban") {
        await sb("live_chat_bans", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: JSON.stringify({ user_id: body.user_id, name: String(body.name || "").slice(0, 40) }) });
        await sb("live_chat?user_id=eq." + body.user_id, { method: "PATCH", body: JSON.stringify({ hidden: true }) });
      } else {
        await sb("live_chat_bans?user_id=eq." + body.user_id, { method: "DELETE" });
      }
      res.status(200).json({ ok: true, action: action });
      return;
    }
    res.status(400).json({ error: "bad_action" });
  } catch (e) {
    res.status(502).json({ error: "write_failed" });
  }
}
