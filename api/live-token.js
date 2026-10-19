// StratNinja — COMMUNITY LIVE signed-URL minter (the "vault" gate).
//   POST (with a user token) → verify JWT → check an active 'community' entitlement →
//   if entitled, mint a SHORT-LIVED Cloudflare Stream SIGNED token for the CLOSED live
//   input and return a signed iframe/HLS URL. Not entitled → 403 { error:'not_entitled' }.
//
// Why this is a real gate: the closed Cloudflare live input has requireSignedURLs=true, so
// Cloudflare itself refuses to serve the stream without a valid signed token. The signing key
// (PEM) never leaves the server, so a signed URL can only come from here, and only after the
// entitlement check passes. Hiding the player in the browser is UI convenience, not the gate.
//
// Signing scheme (verified against Cloudflare's "Securing your Stream" docs, 2026-10):
//   * A signed token is a JWT:  header { alg:'RS256', kid } . payload { sub, kid, exp, nbf } . sig
//   * `sub` = the VIDEO UID (per Cloudflare's official example `sub: videoUID`). For a live input we
//     resolve the CURRENTLY-LIVE broadcast's video UID from the closed input and sign THAT, then play
//     via the video-UID URL. If no active broadcast video can be resolved we fall back to signing the
//     LIVE-INPUT UID and the input-UID URL (the "always current" form). See COMMUNITY_LIVE_BUILD_NOTES.
//   * alg RS256 = RSASSA-PKCS1-v1_5 + SHA-256, signed with the private key (decoded from CF_STREAM_KEY_PEM).
//   * exp ≤ 24h from signing. Playback URL embeds the token IN PLACE OF the id:
//       https://customer-<CODE>.cloudflarestream.com/<TOKEN>/iframe
//
// Secrets (Vercel env, server only — NEVER in the browser/logs):
//   SUPABASE_SERVICE_ROLE_KEY   privileged Supabase read of entitlements (bypasses RLS)
//   CF_CLOSED_INPUT_ID          the CLOSED (requireSignedURLs=true) live input uid
//   CF_STREAM_KEY_ID            the Stream signing key id  → JWT 'kid'
//   CF_STREAM_KEY_PEM           the Stream signing key, base64-encoded exactly as POST /stream/keys returns
//   CF_ACCOUNT_ID               (existing) Cloudflare account id — to resolve the active broadcast video
//   CF_STREAM_API_TOKEN         (existing) Cloudflare Stream:Read token — same
//   CF_CUSTOMER_CODE            (existing, PUBLIC value) the customer-<CODE> playback subdomain
// (SUPABASE_URL / SUPABASE_ANON_KEY as in api/live-presence.js.)

import crypto from "crypto";

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const CF_CODE = (process.env.CF_CUSTOMER_CODE || "").trim();
const CLOSED_INPUT = (process.env.CF_CLOSED_INPUT_ID || "").trim();
const KEY_ID = (process.env.CF_STREAM_KEY_ID || "").trim();
const KEY_PEM_RAW = process.env.CF_STREAM_KEY_PEM || "";

const SCOPE = "community";
const TTL_SEC = Math.min(Math.max(Number(process.env.LIVE_TOKEN_TTL_SEC) || 7200, 60), 86400);  // default 2h; clamp [60s,24h]
const CF_TIMEOUT_MS = 6000;
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

// Active, non-expired 'community' entitlement for this user?
async function isEntitled(uid) {
  try {
    const r = await sb("entitlements?user_id=eq." + encodeURIComponent(uid) + "&scope=eq." + SCOPE + "&select=expires_at");
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return false;
    const now = Date.now();
    return rows.some(row => !row.expires_at || new Date(row.expires_at).getTime() > now);
  } catch (e) { return false; }
}

// Resolve the CURRENTLY-LIVE broadcast's video UID from the closed input (so `sub` is a real video id,
// matching Cloudflare's documented example). Returns a 32-hex uid or null (→ caller signs the input uid).
async function activeVideoUid() {
  if (!(CF_ACCOUNT && CF_TOKEN && RE_HEX32.test(CLOSED_INPUT))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CF_TIMEOUT_MS);
  try {
    const url = "https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/live_inputs/" + CLOSED_INPUT + "/videos";
    const r = await fetch(url, { headers: { Authorization: "Bearer " + CF_TOKEN }, signal: ctrl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success || !Array.isArray(j.result)) return null;
    const vids = j.result;
    let v = vids.find((x) => x && x.uid && x.status && /live-?inprogress/i.test(x.status.state || ""));
    if (!v) v = vids.filter((x) => x && x.uid && x.status && !/ready|error/i.test(x.status.state || ""))
      .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0))[0];
    return (v && RE_HEX32.test(v.uid)) ? v.uid : null;
  } catch (e) {
    console.warn("[live-token] activeVideoUid failed " + JSON.stringify({ type: (e && e.name) || "Error" }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
// CF_STREAM_KEY_PEM arrives base64-encoded (as POST /stream/keys returns). Decode to the PEM text.
// Tolerate a raw PEM too (if someone pasted the decoded value), so we never silently fail on either form.
function privateKeyPem() {
  const raw = KEY_PEM_RAW.trim();
  if (!raw) return "";
  if (/-----BEGIN/.test(raw)) return raw;                           // already a PEM
  try { return Buffer.from(raw, "base64").toString("utf8"); } catch (e) { return ""; }
}

// Sign a Cloudflare Stream token (JWT, RS256) for `sub`. Returns the token string, or null on any
// key/sign error (never throws out — the handler turns null into a clean 500, no secret leaked).
function signToken(sub) {
  const pem = privateKeyPem();
  if (!pem || !KEY_ID) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", kid: KEY_ID };
  const payload = { sub: sub, kid: KEY_ID, exp: now + TTL_SEC, nbf: now - 10 };  // -10s skew cushion
  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(payload));
  try {
    const key = crypto.createPrivateKey(pem);
    const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), key);   // RS256 = RSASSA-PKCS1-v1_5 + SHA-256
    return signingInput + "." + b64url(sig);
  } catch (e) {
    console.warn("[live-token] sign failed " + JSON.stringify({ type: (e && e.code) || (e && e.name) || "Error" }));  // type only
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  if (!(RE_CF_CODE.test(CF_CODE) && RE_HEX32.test(CLOSED_INPUT) && KEY_ID && KEY_PEM_RAW)) {
    res.status(500).json({ error: "live_token_not_configured" }); return;
  }

  const uid = await userId(req);
  if (!uid) { res.status(401).json({ error: "unauthorized" }); return; }

  if (!(await isEntitled(uid))) { res.status(403).json({ error: "not_entitled" }); return; }

  // Prefer the active broadcast's video UID (documented `sub`); fall back to the live-input UID.
  const vid = await activeVideoUid();
  const sub = vid || CLOSED_INPUT;
  const token = signToken(sub);
  if (!token) { res.status(500).json({ error: "sign_failed" }); return; }

  const base = "https://customer-" + CF_CODE + ".cloudflarestream.com/" + token;
  res.status(200).json({
    ok: true,
    iframe: base + "/iframe?autoplay=true&muted=true&controls=true&playsinline=true",
    hls: base + "/manifest/video.m3u8",
    via: vid ? "video" : "input",   // which `sub` form was used (diagnostics)
    expires_in: TTL_SEC,
  });
}
