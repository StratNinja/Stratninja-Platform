// StratNinja — admin: create a Cloudflare Stream RESUMABLE (tus) upload for a course lesson.
//   POST { name?, uploadLength, maxDurationSeconds? } (admin token)
//     -> { ok, location, uid }   (location = the tus upload URL the BROWSER uploads the file to)
// The tus creation is done here with the CF token (server only); the returned `location` is a
// pre-authorized one-time URL, so the browser uploads the (large, multi-GB) file straight to
// Cloudflare in chunks — never through our serverless function. Created with requireSignedURLs=true
// so the resulting video is GATED (playable only via api/course-token after the entitlement check).
// Admin only. Uses CF_STREAM_API_TOKEN (needs Stream:Edit).

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();

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
const b64 = (s) => Buffer.from(String(s), "utf8").toString("base64");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // expose the tus response headers to the browser just in case (this response is same-origin anyway)
  res.setHeader("Access-Control-Expose-Headers", "Location, stream-media-id, Upload-Offset, Tus-Resumable");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!(CF_ACCOUNT && CF_TOKEN)) { res.status(500).json({ error: "cf_not_configured" }); return; }
  if (!(await isAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const name = String(body.name == null ? "" : body.name).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 160);
  const uploadLength = parseInt(body.uploadLength, 10);
  if (!(uploadLength > 0)) { res.status(400).json({ error: "bad_length" }); return; }
  const maxDur = Math.min(Math.max(parseInt(body.maxDurationSeconds, 10) || 21600, 60), 43200);

  // tus Upload-Metadata: comma-separated "key base64value" (or bare key for a flag).
  const meta = ["requiresignedurls", "maxDurationSeconds " + b64(String(maxDur))];
  if (name) meta.push("name " + b64(name));

  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + CF_TOKEN,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(uploadLength),
        "Upload-Metadata": meta.join(","),
      },
    });
    const location = r.headers.get("location") || r.headers.get("Location");
    const uid = r.headers.get("stream-media-id");
    if (r.status === 201 && location && uid) { res.status(200).json({ ok: true, location: location, uid: uid }); return; }
    const txt = await r.text().catch(() => "");
    console.warn("[course-upload] tus create failed " + JSON.stringify({ http: r.status, hasLoc: !!location }));
    res.status(502).json({ ok: false, error: "cf_tus_create_failed", http: r.status, detail: txt.slice(0, 200) });
  } catch (e) {
    res.status(502).json({ ok: false, error: "cf_unreachable" });
  }
}
