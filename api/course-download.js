// StratNinja — admin: prepare a Cloudflare Stream MP4 download for a lesson/community video.
//   POST { uid } with the admin's Supabase token:
//     1) enable MP4 downloads on the video (CF POST /stream/{uid}/downloads)
//     2) while CF is still generating the MP4 → { ok:true, status:"processing", percent }
//     3) once ready → { ok:true, status:"ready", url } — a direct MP4 the browser downloads.
//   For a gated video (requireSignedURLs) the URL carries a short-lived RS256 signed token, so
//   the download works even though Cloudflare refuses the bare video id. Admin only.
//
//   Secrets (Vercel env, server only): CF_ACCOUNT_ID, CF_STREAM_API_TOKEN (Stream:Edit),
//   CF_CUSTOMER_CODE (public), CF_STREAM_KEY_ID, CF_STREAM_KEY_PEM (base64) — same signing
//   key/scheme as api/course-token.js.

import crypto from "crypto";

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const CF_CODE = (process.env.CF_CUSTOMER_CODE || "").trim();
const KEY_ID = (process.env.CF_STREAM_KEY_ID || "").trim();
const KEY_PEM_RAW = process.env.CF_STREAM_KEY_PEM || "";

const RE_UID = /^[a-f0-9]{32}$/i;
const RE_CF_CODE = /^[a-z0-9]+$/i;
const DL_TTL_SEC = 3600;   // the signed download token lives 1h — plenty to finish a download

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

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function privateKeyPem() {
  const raw = KEY_PEM_RAW.trim();
  if (!raw) return "";
  if (/-----BEGIN/.test(raw)) return raw;
  try { return Buffer.from(raw, "base64").toString("utf8"); } catch (e) { return ""; }
}
// RS256 signed Stream token (sub = video uid) — same scheme as api/course-token.js. A plain
// playback token also authorizes the /downloads/*.mp4 endpoint for that same uid.
function signToken(sub) {
  const pem = privateKeyPem();
  if (!pem || !KEY_ID) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KEY_ID };
  const payload = { sub: sub, kid: KEY_ID, exp: now + DL_TTL_SEC, nbf: now - 10 };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  try {
    const key = crypto.createPrivateKey(pem);
    const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), key);
    return signingInput + "." + b64url(sig);
  } catch (e) {
    console.warn("[course-download] sign failed " + JSON.stringify({ type: (e && e.code) || (e && e.name) || "Error" }));
    return null;
  }
}

function cfErrors(j) {
  return (j && Array.isArray(j.errors)) ? j.errors.map((e) => (e && (e.code + ": " + e.message)) || "").filter(Boolean) : [];
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!(CF_ACCOUNT && CF_TOKEN && RE_CF_CODE.test(CF_CODE))) { res.status(500).json({ error: "cf_not_configured" }); return; }
  if (!(await isAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const uid = String(body.uid || "").trim();
  if (!RE_UID.test(uid)) { res.status(400).json({ ok: false, error: "bad_uid" }); return; }

  const cfBase = "https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/" + uid;
  try {
    // 1) is this video gated? (requireSignedURLs → the download URL must carry a signed token)
    let signed = false;
    try {
      const gr = await fetch(cfBase, { headers: { Authorization: "Bearer " + CF_TOKEN } });
      const gj = await gr.json().catch(() => null);
      if (gr.ok && gj && gj.success && gj.result) signed = !!gj.result.requireSignedURLs;
    } catch (e) { /* fall through — default to signed=false */ }

    // 2) enable / fetch the MP4 download job (idempotent: POST returns the current state)
    const dr = await fetch(cfBase + "/downloads", {
      method: "POST",
      headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" },
      body: "{}",
    });
    const dj = await dr.json().catch(() => null);
    if (!dr.ok || !dj || !dj.success || !dj.result || !dj.result.default) {
      console.warn("[course-download] CF downloads failed " + JSON.stringify({ http: dr.status, errors: cfErrors(dj) }));
      res.status(502).json({ ok: false, error: "cf_download_failed", http: dr.status, cf: cfErrors(dj) });
      return;
    }
    const def = dj.result.default;
    if (def.status !== "ready") {
      res.status(200).json({ ok: true, status: "processing", percent: Math.round(def.percentComplete || 0) });
      return;
    }

    // 3) ready → build the direct MP4 URL. Gated video → put a signed token in place of the uid.
    let url;
    if (signed) {
      const token = signToken(uid);
      if (!token) { res.status(500).json({ ok: false, error: "sign_failed" }); return; }
      url = "https://customer-" + CF_CODE + ".cloudflarestream.com/" + token + "/downloads/default.mp4";
    } else {
      url = (typeof def.url === "string" && def.url) ||
        ("https://customer-" + CF_CODE + ".cloudflarestream.com/" + uid + "/downloads/default.mp4");
    }
    res.status(200).json({ ok: true, status: "ready", url: url });
  } catch (e) {
    res.status(502).json({ ok: false, error: "cf_unreachable" });
  }
}
