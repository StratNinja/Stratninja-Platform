// StratNinja — ENV presence check (admin-only). Returns a SAFE true/false map of whether each required
// server env var is SET — NEVER the value. Lets us confirm the Vercel config after a deploy without
// exposing any secret. Admin = the fixed admin email, verified server-side (same pattern as api/live.js).
//
//   GET /api/env-check  (Authorization: Bearer <admin token>) → { ok, env:{NAME:true|false, …}, checks:{…} }

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

// vars the community-live feature needs on the server (NEW + the EXISTING ones it reuses)
const REQUIRED = [
  // new (this feature)
  "DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID", "CF_CLOSED_INPUT_ID", "CF_STREAM_KEY_ID", "CF_STREAM_KEY_PEM",
  // existing (reused)
  "CF_ACCOUNT_ID", "CF_CUSTOMER_CODE", "CF_STREAM_API_TOKEN", "CF_PUBLIC_INPUT_ID",
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
];
const OPTIONAL = ["DISCORD_REQUIRED_ROLE_ID", "LIVE_TOKEN_TTL_SEC"];

async function verifyAdmin(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return false;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return false;
    const u = await r.json();
    return ((u && u.email) || "").toLowerCase() === ADMIN_EMAIL;
  } catch (e) { return false; }
}

function isSet(name) { return !!String(process.env[name] || "").trim(); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "method" }); return; }
  if (!(await verifyAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  const env = {};
  REQUIRED.forEach((n) => { env[n] = isSet(n); });
  const optional = {};
  OPTIONAL.forEach((n) => { optional[n] = isSet(n); });

  // a couple of SAFE sanity checks (booleans only — never any value):
  //  - the signing PEM is present AND decodes (base64) to something that looks like a PEM private key.
  const pemRaw = String(process.env.CF_STREAM_KEY_PEM || "").trim();
  let pemLooksValid = false;
  if (pemRaw) {
    try { pemLooksValid = /-----BEGIN/.test(pemRaw) || /-----BEGIN/.test(Buffer.from(pemRaw, "base64").toString("utf8")); } catch (e) {}
  }
  const checks = {
    all_required_set: REQUIRED.every((n) => env[n]),
    pem_decodes_to_key: pemLooksValid,
  };

  res.status(200).json({ ok: true, env: env, optional: optional, checks: checks, ts: Date.now() });
}
