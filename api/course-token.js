// StratNinja — COURSE signed-URL minter (the course "vault" gate).
//   POST { uid } (with a user token) → verify JWT → check an active 'course_the_strat'
//   entitlement → verify `uid` is a REAL published lesson in course_lessons → mint a
//   short-lived Cloudflare Stream SIGNED token for that uploaded video → return the
//   signed iframe/HLS URL. Not entitled → 403 { error:'not_entitled' }.
//
// Why real gate: each course video is uploaded to Cloudflare Stream with
// requireSignedURLs=true, so Cloudflare itself refuses to serve it without a valid
// signed token. The signing key (PEM) never leaves the server, and we only ever sign a
// uid that is a published row in course_lessons — the endpoint can never sign an
// arbitrary account video. Same RS256 scheme + key as api/live-token.js (the vault).
//
// Secrets (Vercel env, server only): SUPABASE_SERVICE_ROLE_KEY, CF_STREAM_KEY_ID,
// CF_STREAM_KEY_PEM (base64), CF_CUSTOMER_CODE (public). SUPABASE_URL/ANON as elsewhere.

import crypto from "crypto";

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

const CF_CODE = (process.env.CF_CUSTOMER_CODE || "").trim();
const KEY_ID = (process.env.CF_STREAM_KEY_ID || "").trim();
const KEY_PEM_RAW = process.env.CF_STREAM_KEY_PEM || "";

const SCOPE = "course_the_strat";
const TTL_SEC = Math.min(Math.max(Number(process.env.COURSE_TOKEN_TTL_SEC) || 10800, 60), 86400);  // default 3h; clamp [60s,24h]
const RE_HEX32 = /^[a-f0-9]{32}$/i;
const RE_CF_CODE = /^[a-z0-9]+$/i;

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
// Active, non-expired 'course_the_strat' entitlement for this user?
async function isEntitled(uid) {
  try {
    const r = await sb("entitlements?user_id=eq." + encodeURIComponent(uid) + "&scope=eq." + SCOPE + "&select=expires_at");
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return false;
    const now = Date.now();
    return rows.some((row) => !row.expires_at || new Date(row.expires_at).getTime() > now);
  } catch (e) { return false; }
}
// Is `uid` a REAL published course lesson? (never sign an arbitrary account video)
async function isLesson(uid) {
  try {
    const r = await sb("course_lessons?video_uid=eq." + encodeURIComponent(uid) + "&published=is.true&select=video_uid&limit=1");
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0;
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
function signToken(sub) {
  const pem = privateKeyPem();
  if (!pem || !KEY_ID) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KEY_ID };
  const payload = { sub: sub, kid: KEY_ID, exp: now + TTL_SEC, nbf: now - 10 };
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  try {
    const key = crypto.createPrivateKey(pem);
    const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), key);
    return signingInput + "." + b64url(sig);
  } catch (e) {
    console.warn("[course-token] sign failed " + JSON.stringify({ type: (e && e.code) || (e && e.name) || "Error" }));
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  if (!(RE_CF_CODE.test(CF_CODE) && KEY_ID && KEY_PEM_RAW)) { res.status(500).json({ error: "course_token_not_configured" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const uid = String((body && body.uid) || "").trim();
  if (!RE_HEX32.test(uid)) { res.status(400).json({ error: "bad_uid" }); return; }

  const user = await userId(req);
  if (!user) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!(await isEntitled(user))) { res.status(403).json({ error: "not_entitled" }); return; }
  if (!(await isLesson(uid))) { res.status(404).json({ error: "not_a_lesson" }); return; }

  const token = signToken(uid);
  if (!token) { res.status(500).json({ error: "sign_failed" }); return; }

  const base = "https://customer-" + CF_CODE + ".cloudflarestream.com/" + token;
  res.status(200).json({
    ok: true,
    iframe: base + "/iframe",   // the player appends ?autoplay=true; CF shows controls by default
    hls: base + "/manifest/video.m3u8",
    expires_in: TTL_SEC,
  });
}
