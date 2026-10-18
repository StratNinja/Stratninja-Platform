// StratNinja — upload the LIVE thumbnail, server-side (reliable). The client sends the image as a
// data URL; this verifies the caller is the admin, then uploads to Supabase Storage AND saves the URL
// on the live_status row — all with the service role, so it bypasses the storage RLS (a client upload
// was failing with "new row violates row-level security policy"). No new env needed.
//
//   POST /api/live-thumb  (Authorization: Bearer <token>)  { data_url }  → { ok, thumbnail_url }

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";
const BUCKET = "live-thumbnails";

async function adminUser(req) {
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
  if (!(await adminUser(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  // remove the thumbnail → clear it on the row + best-effort delete the stored files
  if (body.remove === true) {
    try {
      await fetch(SUPA_URL + "/rest/v1/live_status?id=eq.public", {
        method: "PATCH",
        headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnail_url: null, updated_at: new Date().toISOString() }),
      });
      for (const ext of ["png", "jpg", "webp", "gif"]) {
        try { await fetch(SUPA_URL + "/storage/v1/object/" + BUCKET + "/public-live." + ext, { method: "DELETE", headers: { apikey: SVC, Authorization: "Bearer " + SVC } }); } catch (e) {}
      }
      res.status(200).json({ ok: true, thumbnail_url: null });
    } catch (e) {
      res.status(502).json({ error: "remove_failed" });
    }
    return;
  }

  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ""));
  if (!m) { res.status(400).json({ error: "bad_image" }); return; }
  const contentType = m[1];
  const ext = m[2].toLowerCase().replace("jpeg", "jpg");
  const buf = Buffer.from(m[3], "base64");
  if (!buf.length || buf.length > 3 * 1024 * 1024) { res.status(413).json({ error: "too_large" }); return; }

  const path = "public-live." + ext;
  try {
    const up = await fetch(SUPA_URL + "/storage/v1/object/" + BUCKET + "/" + path, {
      method: "POST",
      headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": contentType, "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) { res.status(502).json({ error: "upload_failed" }); return; }
    const thumbnail_url = SUPA_URL + "/storage/v1/object/public/" + BUCKET + "/" + path + "?t=" + Date.now();
    await fetch(SUPA_URL + "/rest/v1/live_status?id=eq.public", {
      method: "PATCH",
      headers: { apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" },
      body: JSON.stringify({ thumbnail_url: thumbnail_url, updated_at: new Date().toISOString() }),
    });
    res.status(200).json({ ok: true, thumbnail_url: thumbnail_url });
  } catch (e) {
    res.status(502).json({ error: "upload_failed" });
  }
}
