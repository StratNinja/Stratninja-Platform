// StratNinja — PUBLIC LIVE status API.
//   GET            → public: current live status (+ throttled Cloudflare reconcile)
//   POST  (admin)  → set title / description / mode / scheduled_at / platforms
//
// is_live is NEVER settable by a client. It is written only here (CF reconcile)
// and by api/live-webhook.js, both with the service-role key. Admin POST can set
// presentation + 'mode' (auto|offline|soon) but NOT is_live.
//
// Secrets (Vercel env, server only — NEVER in the browser/logs):
//   SUPABASE_SERVICE_ROLE_KEY   privileged Supabase write (bypasses RLS)
//   CF_ACCOUNT_ID               Cloudflare account id      (for the reconcile GET)
//   CF_STREAM_API_TOKEN         Cloudflare token, Stream:Read (reconcile GET)
//   CF_PUBLIC_INPUT_ID          the PUBLIC live input uid
//   CF_CUSTOMER_CODE            the "customer-<CODE>" stream subdomain (PUBLIC value)
// (SUPABASE_URL / SUPABASE_ANON_KEY as in api/giveaway.js.)

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const CF_ACCOUNT = process.env.CF_ACCOUNT_ID || "";
const CF_TOKEN = process.env.CF_STREAM_API_TOKEN || "";
const CF_INPUT = process.env.CF_PUBLIC_INPUT_ID || "";
const CF_CODE = process.env.CF_CUSTOMER_CODE || "";

// PREVIEW-ONLY read-only test mode. Vercel sets VERCEL_ENV automatically ("production" on the
// Production deployment), so this can NEVER be true in Production — no way to enable it by accident.
// In this mode /api/live serves live/offline straight from the Cloudflare API with ZERO Supabase
// reads/writes, and every admin write is refused. Lets us validate /live on a Preview deploy
// without the Production service-role key.
const TEST_MODE = process.env.VERCEL_ENV === "preview";

const RECONCILE_MS = 90000;   // reconcile against the Cloudflare API at most once per 90s
const MAX_LIVE_MS = (Number(process.env.LIVE_MAX_HOURS) || 12) * 3600000;  // safety cap on an unconfirmed LIVE
const ROW_ID = "public";

// Cloudflare live-input status values that mean "receiving a stream".
const LIVE_STATES = { connected: 1, reconnected: 1 };

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
async function getRow() {
  const r = await sb("live_status?id=eq." + ROW_ID + "&select=*");
  const a = await r.json().catch(() => []);
  return Array.isArray(a) ? a[0] : null;
}
async function patchRow(fields) {
  return sb("live_status?id=eq." + ROW_ID, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(fields) })
    .then(r => r.json()).then(a => (Array.isArray(a) ? a[0] : null)).catch(() => null);
}

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

// Ask Cloudflare for the live input's REAL current status.
// Endpoint (official): GET /accounts/{account_id}/stream/live_inputs/{live_input_id}  (needs Stream:Read).
// Always returns a structured result (never null): { ok:true, live, status } on success, or
// { ok:false, reason, http?, code? } on failure — so callers can surface a DIAGNOSABLE reason instead
// of a blind "cf_unreachable". Logs ONLY the HTTP status / CF error code / failure type — never the
// token, the Authorization header, or any secret.
async function cfLiveStatus() {
  if (!(CF_ACCOUNT && CF_TOKEN && CF_INPUT)) {
    console.warn("[live] CF not configured (account/token/input missing in this environment)");
    return { ok: false, reason: "not_configured" };
  }
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/live_inputs/" + CF_INPUT, {
      headers: { Authorization: "Bearer " + CF_TOKEN },
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.success) {
      const code = (j && j.errors && j.errors[0] && j.errors[0].code);
      console.warn("[live] CF live_inputs GET failed " + JSON.stringify({ http: r.status, cf_code: code != null ? code : null, success: j ? !!j.success : null }));
      return { ok: false, reason: "api_error", http: r.status, code: code != null ? code : null };
    }
    const st = (j.result && j.result.status) || "";   // CF can report null status on an idle input
    return { ok: true, live: !!LIVE_STATES[st], status: st || "idle" };
  } catch (e) {
    console.warn("[live] CF live_inputs GET threw " + JSON.stringify({ type: (e && e.name) || "Error" }));
    return { ok: false, reason: "fetch_threw" };
  }
}

// compact, secret-free failure string for cf_status (surfaced in /api/live so it's diagnosable)
function cfErrStr(cf) {
  return "cf_error:" + (cf.reason || "unknown") + (cf.http ? (":http" + cf.http) : "") + (cf.code != null ? (":code" + cf.code) : "");
}

// Public playback URLs built from the LIVE INPUT uid (CF_PUBLIC_INPUT_ID) — this is the live
// stream, NOT a recording/VOD id (those are separate video objects with their own uids; we never
// fetch or use them here). All values are PUBLIC (no secret). Empty until configured.
function playback() {
  if (!(CF_CODE && CF_INPUT)) return null;
  const base = "https://customer-" + CF_CODE + ".cloudflarestream.com/" + CF_INPUT;   // <customer-CODE>/<LIVE_INPUT_UID>
  return { uid: CF_INPUT, customer: CF_CODE, iframe: base + "/iframe", hls: base + "/manifest/video.m3u8" };
}

// shape the row for public consumption (never leak internal/debug fields beyond what's useful)
function publicView(row) {
  if (!row) return { ok: false };
  return {
    ok: true,
    is_live: !!row.is_live,
    mode: row.mode || "auto",
    title: row.title || "",
    description: row.description || "",
    scheduled_at: row.scheduled_at || null,
    started_at: row.started_at || null,
    platforms: Array.isArray(row.platforms) ? row.platforms : [],
    playback: playback(),
    ts: Date.now(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  // ---- PREVIEW TEST MODE (never Production) — read-only, Cloudflare-API only, no Supabase ----
  if (TEST_MODE) {
    if (req.method === "POST") { res.status(403).json({ error: "disabled_in_preview" }); return; }   // all writes refused
    const cf = await cfLiveStatus();
    const unknown = !cf.ok;   // couldn't reach/parse Cloudflare → UNKNOWN, never a false OFFLINE
    res.status(200).json({
      ok: true, preview: true, unknown,
      is_live: cf.ok ? !!cf.live : false, mode: "auto",
      title: "", description: "", scheduled_at: null, started_at: null, platforms: [],
      playback: playback(), cf_status: cf.ok ? cf.status : cfErrStr(cf), ts: Date.now(),
    });
    return;
  }

  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }

  // ---- admin writes -------------------------------------------------------
  if (req.method === "POST") {
    if (!(await verifyAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const patch = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string") patch.title = body.title.slice(0, 200);
    if (typeof body.description === "string") patch.description = body.description.slice(0, 1000);
    if (["auto", "offline", "soon"].indexOf(body.mode) >= 0) patch.mode = body.mode;
    if ("scheduled_at" in body) patch.scheduled_at = body.scheduled_at || null;   // ISO string or null
    if (Array.isArray(body.platforms)) {
      patch.platforms = body.platforms
        .filter(p => p && typeof p.url === "string")
        .slice(0, 8)
        .map(p => ({ name: String(p.name || "").slice(0, 40), url: String(p.url).slice(0, 300) }));
    }
    const row = await patchRow(patch);
    res.status(200).json(publicView(row));
    return;
  }

  // ---- public read (+ throttled Cloudflare reconcile) ---------------------
  let row = await getRow();
  if (!row) { res.status(200).json({ ok: false, error: "no_row" }); return; }

  // Reconcile against Cloudflare at most once per RECONCILE_MS (cost-efficient, rate-limited).
  // When CF is configured this reconcile is the AUTHORITY on live/offline:
  //   • it catches a MISSED disconnect — CF reports not-connected → we flip is_live false (req #2);
  //   • a stream CF keeps confirming stays live for as long as it runs — the max-duration cap below
  //     is reached ONLY in a webhook-only deployment (no CF reconcile), so a stream that continues to
  //     be verified against Cloudflare is NEVER force-stopped (requirement #1).
  const cfConfigured = !!(CF_ACCOUNT && CF_TOKEN && CF_INPUT);
  const stale = !row.verified_at || (Date.now() - new Date(row.verified_at).getTime() > RECONCILE_MS);
  if (stale) {
    if (cfConfigured) {
      const cf = await cfLiveStatus();
      if (cf.ok) {
        const fields = { verified_at: new Date().toISOString(), cf_status: cf.status };
        if (cf.live !== !!row.is_live) {
          fields.is_live = cf.live;
          if (cf.live && !row.started_at) fields.started_at = new Date().toISOString();
          fields.updated_at = new Date().toISOString();
        }
        const updated = await patchRow(fields);
        if (updated) row = updated;
      } else {
        // CF call failed — don't change is_live (keep last known), but record WHY (diagnosable) and back off
        await patchRow({ verified_at: new Date().toISOString(), cf_status: cfErrStr(cf) });
      }
    } else if (row.is_live && row.started_at &&
               (Date.now() - new Date(row.started_at).getTime() > MAX_LIVE_MS)) {
      // Webhook-only deployment (no CF reconcile): a missed disconnect must not leave LIVE on
      // indefinitely. This branch never runs once CF is configured, so it can't kill a verified stream.
      const capped = await patchRow({ is_live: false, cf_status: "max_duration_guard", updated_at: new Date().toISOString() });
      if (capped) row = capped;
    }
  }

  res.status(200).json(publicView(row));
}
