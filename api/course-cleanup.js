// StratNinja — admin: list / purge ORPHANED "pendingupload" videos on Cloudflare Stream.
//   POST { action:'list'  }  → { ok, pending:[{uid,created,sizeMB,maxDurationSeconds}], count }
//   POST { action:'purge' }  → { ok, deleted:[uid...], failed:[uid...], count }
// A failed/abandoned resumable (tus) upload leaves a video stuck in state "pendingupload" that
// RESERVES its maxDurationSeconds against stored minutes — eating the Stream quota. This reclaims
// them. Only videos whose state is exactly "pendingupload" are touched (never a real/ready video,
// never one still processing). Admin only. Uses CF_STREAM_API_TOKEN (needs Stream:Edit).

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const CF_BASE = "https://api.cloudflare.com/client/v4/accounts/";

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

function cfHeaders() { return { Authorization: "Bearer " + CF_TOKEN }; }

// List videos stuck in state "pendingupload".
async function listPending() {
  const r = await fetch(CF_BASE + CF_ACCOUNT + "/stream?status=pendingupload", { headers: cfHeaders() });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.success || !Array.isArray(j.result)) return null;
  // trust but verify: keep only the ones whose state really is pendingupload
  return j.result.filter(function (v) { return v && v.status && v.status.state === "pendingupload"; });
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
  const action = String(body.action || "list").trim();

  const pending = await listPending();
  if (pending === null) { res.status(502).json({ ok: false, error: "cf_list_failed" }); return; }

  const summarize = function (v) {
    const maxDur = v.meta && v.meta.maxDurationSeconds ? parseInt(v.meta.maxDurationSeconds, 10) : (v.maxDurationSeconds || 0);
    return { uid: v.uid, created: v.created || "", sizeMB: Math.round((v.size || 0) / 1048576), maxDurationSeconds: maxDur };
  };

  if (action === "list") {
    res.status(200).json({ ok: true, count: pending.length, pending: pending.map(summarize) });
    return;
  }

  if (action === "purge") {
    const deleted = [], failed = [];
    for (let i = 0; i < pending.length; i++) {
      const uid = pending[i].uid;
      try {
        const d = await fetch(CF_BASE + CF_ACCOUNT + "/stream/" + encodeURIComponent(uid), { method: "DELETE", headers: cfHeaders() });
        if (d.ok) deleted.push(uid); else failed.push(uid);
      } catch (e) { failed.push(uid); }
    }
    res.status(200).json({ ok: true, count: deleted.length, deleted: deleted, failed: failed });
    return;
  }

  res.status(400).json({ ok: false, error: "bad_action" });
}
