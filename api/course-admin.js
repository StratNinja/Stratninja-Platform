// StratNinja — admin: manage course lessons (add / edit / delete).
//   POST { action:'save',   uid, title, module?, sort?, summary?, published? }  → upsert a lesson
//   POST { action:'delete', uid }                                              → remove a lesson
// Admin only (Supabase email === ADMIN_EMAIL). Writes course_lessons with the service key.
// On save it also looks the video up on Cloudflare to auto-fill duration and to WARN if the
// video doesn't exist or isn't gated (requireSignedURLs=false) — so a broken/public lesson
// can't be added silently. The warning is returned but does not block (admin's call).

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const RE_HEX32 = /^[a-f0-9]{32}$/i;

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
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
// Look the video up on Cloudflare → { ok, duration, signed } or { ok:false }.
async function cfVideo(uid) {
  if (!(CF_ACCOUNT && CF_TOKEN)) return { ok: false };
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/" + uid, {
      headers: { Authorization: "Bearer " + CF_TOKEN },
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success || !j.result) return { ok: false };
    return { ok: true, duration: Math.round(j.result.duration || 0), signed: !!j.result.requireSignedURLs };
  } catch (e) { return { ok: false }; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  if (!(await isAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || "save").trim();
  const uid = String(body.uid || "").trim();
  if (!RE_HEX32.test(uid)) { res.status(400).json({ error: "bad_uid" }); return; }

  if (action === "delete") {
    const r = await sb("course_lessons?video_uid=eq." + encodeURIComponent(uid), { method: "DELETE" });
    if (r.ok) { res.status(200).json({ ok: true }); return; }
    res.status(502).json({ ok: false, error: "delete_failed" }); return;
  }

  // save / upsert
  const title = String(body.title == null ? "" : body.title).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 160);
  if (!title) { res.status(400).json({ error: "missing_title" }); return; }
  const module = String(body.module == null ? "" : body.module).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80);
  const summary = String(body.summary == null ? "" : body.summary).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 400);
  const sort = Number.isFinite(+body.sort) ? Math.round(+body.sort) : 0;
  const published = body.published === false ? false : true;

  const cf = await cfVideo(uid);
  const duration = cf.ok ? cf.duration : (Number.isFinite(+body.duration) ? Math.round(+body.duration) : 0);
  const warn = !cf.ok ? "cf_lookup_failed" : (!cf.signed ? "video_not_gated" : "");

  const row = { video_uid: uid, title: title, module: module, summary: summary || null, sort: sort, duration: duration, published: published, updated_at: new Date().toISOString() };
  const r = await sb("course_lessons?on_conflict=video_uid", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (r.ok) { res.status(200).json({ ok: true, duration: duration, warn: warn }); return; }
  const t = await r.text().catch(() => "");
  console.warn("[course-admin] upsert failed " + JSON.stringify({ http: r.status }));
  res.status(502).json({ ok: false, error: "save_failed", http: r.status, detail: t.slice(0, 200) });
}
