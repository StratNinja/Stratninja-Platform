// StratNinja — admin: rename a recording (updates the Cloudflare video's meta.name).
//   POST { uid, name } with the admin's Supabase token -> CF POST /stream/{uid} {meta:{name}}.
// The name then flows through /api/live-vods (which reads meta.name). Admin only.

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const RE_UID = /^[a-f0-9]{32}$/i;

async function isAdmin(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return false;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return false;
    const u = await r.json();
    return ((u && u.email) || "").toLowerCase() === ADMIN_EMAIL;
  } catch (e) { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!(CF_ACCOUNT && CF_TOKEN)) { res.status(500).json({ error: "cf_not_configured" }); return; }
  if (!(await isAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const uid = String(body.uid || "").trim();
  if (!RE_UID.test(uid)) { res.status(400).json({ ok: false, error: "bad_uid" }); return; }
  const name = String(body.name == null ? "" : body.name).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 120);

  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/" + uid, {
      method: "POST",
      headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ meta: { name: name } }),
    });
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.success) { res.status(200).json({ ok: true, name: name }); return; }
    console.warn("[vod-rename] CF update failed " + JSON.stringify({ http: r.status, success: j ? !!j.success : null }));
    res.status(502).json({ ok: false, error: "cf_update_failed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: "cf_unreachable" });
  }
}
