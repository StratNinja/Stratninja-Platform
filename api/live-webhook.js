// StratNinja — Cloudflare Stream LIVE webhook receiver (Notifications system).
//
// Cloudflare Stream Live events (live_input.connected / disconnected / errored)
// come through Cloudflare *Notifications*, which authenticate with a SHARED SECRET
// in the `cf-webhook-auth` header — there is NO HMAC signature and NO timestamp in
// the request (verified against the official docs). So we:
//   1. constant-time compare `cf-webhook-auth` against CF_WEBHOOK_SECRET,
//   2. cross-check data.input_id === CF_PUBLIC_INPUT_ID (ignore other inputs),
//   3. dedup/order by `ts` (reject events older-or-equal to the last applied one) —
//      our own replay/duplicate protection, since the platform provides none.
// is_live is then written with the service-role key (bypasses RLS).
//
// Secrets (Vercel env, server only):
//   CF_WEBHOOK_SECRET           the secret you set on the Cloudflare webhook destination
//   CF_PUBLIC_INPUT_ID          the PUBLIC live input uid
//   SUPABASE_SERVICE_ROLE_KEY   privileged Supabase write

import crypto from "node:crypto";

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const WEBHOOK_SECRET = process.env.CF_WEBHOOK_SECRET || "";
const CF_INPUT = process.env.CF_PUBLIC_INPUT_ID || "";
const ROW_ID = "public";

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC || !WEBHOOK_SECRET || !CF_INPUT) { res.status(500).json({ error: "not_configured" }); return; }

  // 1) shared-secret auth (the only mechanism Cloudflare Notifications offers)
  const given = req.headers["cf-webhook-auth"] || req.headers["Cf-Webhook-Auth"] || "";
  if (!safeEqual(given, WEBHOOK_SECRET)) { res.status(401).json({ error: "bad_auth" }); return; }

  // parse body (CF sends application/json)
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const data = body.data || {};
  const eventType = String(data.event_type || "");
  const inputId = String(data.input_id || "");
  const ts = Number(body.ts || 0) || Math.floor(Date.now() / 1000);

  // 2) cross-check the live input id — ignore events from any other input
  if (!inputId || inputId !== CF_INPUT) { res.status(200).json({ ignored: "other_input" }); return; }
  if (eventType.indexOf("live_input.") !== 0) { res.status(200).json({ ignored: "other_event" }); return; }

  // 3) ATOMIC dedup + update — a single conditional UPDATE (WHERE last_event_ts < ts).
  //    Postgres row-locks the row for the UPDATE, so events arriving concurrently cannot
  //    overwrite each other: the higher ts always wins, and a stale/duplicate event updates
  //    0 rows. (No check-then-act race — there is no separate SELECT.)
  //    event mapping: live_input.connected → LIVE; live_input.disconnected / .errored → OFFLINE.
  const now = new Date().toISOString();
  const goingLive = eventType === "live_input.connected";
  const fields = { is_live: goingLive, cf_status: eventType, last_event_ts: ts, verified_at: now, updated_at: now };
  if (goingLive) fields.started_at = now;   // start of the current session
  const r = await sb("live_status?id=eq." + ROW_ID + "&last_event_ts=lt." + ts,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(fields) });
  const applied = await r.json().catch(() => []);
  if (!Array.isArray(applied) || !applied.length) { res.status(200).json({ ignored: "stale_or_norow", ts }); return; }
  res.status(200).json({ ok: true, event: eventType, is_live: goingLive, ts });
}
