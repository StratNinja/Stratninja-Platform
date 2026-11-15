// StratNinja — Cloudflare Stream LIVE webhook receiver (Notifications system).
//
// Cloudflare Stream Live events (live_input.connected / disconnected / errored)
// come through Cloudflare *Notifications*, which authenticate with a SHARED SECRET
// in the `cf-webhook-auth` header — there is NO HMAC signature and NO timestamp in
// the request (verified against the official docs). So we:
//   1. constant-time compare `cf-webhook-auth` against CF_WEBHOOK_SECRET,
//   2. cross-check data.input_id is the PUBLIC or the COMMUNITY (closed) input (ignore others),
//   3. dedup/order by `ts` (reject events older-or-equal to the last applied one) —
//      our own replay/duplicate protection, since the platform provides none.
// is_live is then written with the service-role key (bypasses RLS) — for the PUBLIC input only.
// Also (best-effort): on connect, auto-create the Cloudflare Output that forwards to the scheduled
// live's dedicated YouTube key (so the planned broadcast goes live with no manual key-paste); torn
// down on disconnect. Needs CF_ACCOUNT_ID + CF_STREAM_API_TOKEN (Stream:Edit) + the YT_* secrets.
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
const CF_CLOSED = (process.env.CF_CLOSED_INPUT_ID || "").trim();   // COMMUNITY (requireSignedURLs) input
const ROW_ID = "public";

// --- Cloudflare + YouTube (scheduled-live auto-simulcast) ------------------------------------
// When Adi starts streaming (CF live_input.connected), auto-create a CF Stream Output that forwards
// to the dedicated YouTube key of the scheduled live on this input — so the planned YouTube broadcast
// goes live by itself, with NO manual key-paste into Cloudflare. Torn down on disconnect/errored.
const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const YT_CLIENT_ID = (process.env.YT_CLIENT_ID || "").trim();
const YT_CLIENT_SECRET = (process.env.YT_CLIENT_SECRET || "").trim();
const YT_REFRESH_TOKEN = (process.env.YT_REFRESH_TOKEN || "").trim();
const YT_READY = !!(YT_CLIENT_ID && YT_CLIENT_SECRET && YT_REFRESH_TOKEN);
const CF_AUTO = !!(CF_ACCOUNT && CF_TOKEN && YT_READY);

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}

function inputVisibility(inputId) {
  if (inputId && inputId === CF_INPUT) return "public";
  if (inputId && CF_CLOSED && inputId === CF_CLOSED) return "community";
  return null;
}

// --- YouTube: refresh an access token + read a dedicated stream's current RTMP key ---
async function ytAccessToken() {
  try {
    const body = new URLSearchParams({ client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: "refresh_token" });
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.access_token) { console.warn("[sched-cf] YT token refresh failed " + JSON.stringify({ http: r.status })); return null; }
    return j.access_token;
  } catch (e) { console.warn("[sched-cf] YT token threw"); return null; }
}
async function ytStreamInfo(tok, streamId) {
  try {
    const r = await fetch("https://www.googleapis.com/youtube/v3/liveStreams?part=cdn&id=" + encodeURIComponent(streamId), { headers: { Authorization: "Bearer " + tok } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !Array.isArray(j.items) || !j.items[0]) return null;
    const info = (j.items[0].cdn && j.items[0].cdn.ingestionInfo) || {};
    return { stream_key: info.streamName || "", ingest_url: info.ingestionAddress || "" };
  } catch (e) { return null; }
}

// --- Cloudflare Stream: create / delete a live Output on a live input ---
async function cfCreateOutput(inputId, url, streamKey) {
  if (!(CF_ACCOUNT && CF_TOKEN && inputId && url && streamKey)) return null;
  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/live_inputs/" + inputId + "/outputs",
      { method: "POST", headers: { Authorization: "Bearer " + CF_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ url: url, streamKey: streamKey, enabled: true }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success || !j.result || !j.result.uid) {
      console.warn("[sched-cf] CF output.create failed " + JSON.stringify({ http: r.status, code: j && j.errors && j.errors[0] && j.errors[0].code }));
      return null;
    }
    return j.result.uid;
  } catch (e) { console.warn("[sched-cf] CF output.create threw"); return null; }
}
async function cfDeleteOutput(inputId, outputId) {
  if (!(CF_ACCOUNT && CF_TOKEN && inputId && outputId)) return;
  try {
    await fetch("https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/live_inputs/" + inputId + "/outputs/" + outputId,
      { method: "DELETE", headers: { Authorization: "Bearer " + CF_TOKEN } });
  } catch (e) { /* best-effort */ }
}

// On CONNECT: find the scheduled live happening now on this input and wire up its YouTube Output.
async function activateScheduledOutput(inputId) {
  if (!CF_AUTO) return;
  const vis = inputVisibility(inputId); if (!vis) return;
  const lo = new Date(Date.now() - 6 * 3600000).toISOString();   // window around the planned time: [-6h, +2h]
  const hi = new Date(Date.now() + 2 * 3600000).toISOString();
  const q = "scheduled_lives?select=id,youtube_stream_id,cf_output_id,scheduled_start" +
    "&visibility=eq." + vis + "&status=in.(scheduled,live)&youtube_stream_id=not.is.null" +
    "&scheduled_start=gte." + encodeURIComponent(lo) + "&scheduled_start=lte." + encodeURIComponent(hi) +
    "&order=scheduled_start.desc&limit=10";
  const rows = await sb(q).then(r => r.json()).catch(() => []);
  if (!Array.isArray(rows) || !rows.length) return;               // no scheduled live now → ad-hoc stream, leave it alone
  const now = Date.now();
  rows.sort((a, b) => Math.abs(new Date(a.scheduled_start).getTime() - now) - Math.abs(new Date(b.scheduled_start).getTime() - now));
  const row = rows[0];
  if (row.cf_output_id) return;                                   // already wired (idempotent on duplicate events)
  const tok = await ytAccessToken(); if (!tok) return;
  const info = await ytStreamInfo(tok, row.youtube_stream_id);
  if (!info || !info.stream_key) return;
  const uid = await cfCreateOutput(inputId, info.ingest_url || "rtmp://a.rtmp.youtube.com/live2", info.stream_key);
  if (!uid) return;
  await sb("scheduled_lives?id=eq." + row.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ cf_output_id: uid, updated_at: new Date().toISOString() }) });
  console.warn("[sched-cf] activated output for scheduled live " + row.id + " on " + vis + " input");
}
// On DISCONNECT/ERRORED: remove the Output(s) we created for this input (never touches Adi's other outputs).
async function cleanupScheduledOutputs(inputId) {
  if (!CF_AUTO) return;
  const vis = inputVisibility(inputId); if (!vis) return;
  const rows = await sb("scheduled_lives?select=id,cf_output_id&visibility=eq." + vis + "&cf_output_id=not.is.null&limit=20").then(r => r.json()).catch(() => []);
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    await cfDeleteOutput(inputId, row.cf_output_id);
    await sb("scheduled_lives?id=eq." + row.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ cf_output_id: null, updated_at: new Date().toISOString() }) });
  }
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

  // 2) cross-check the live input id — accept the PUBLIC or the COMMUNITY (closed) input; ignore others.
  const isPublic = !!(inputId && inputId === CF_INPUT);
  const isClosed = !!(inputId && CF_CLOSED && inputId === CF_CLOSED);
  if (!isPublic && !isClosed) { res.status(200).json({ ignored: "other_input" }); return; }
  if (eventType.indexOf("live_input.") !== 0) { res.status(200).json({ ignored: "other_event" }); return; }

  // 2b) scheduled-live auto-simulcast — best-effort, NEVER blocks or breaks the live_status update below.
  //     connected → wire the planned YouTube Output; disconnected/errored → tear it down.
  try {
    if (eventType === "live_input.connected") await activateScheduledOutput(inputId);
    else if (eventType === "live_input.disconnected" || eventType === "live_input.errored") await cleanupScheduledOutputs(inputId);
  } catch (e) { console.warn("[sched-cf] automation threw (ignored)"); }

  // The COMMUNITY (closed) input has no public live_status row here — its is_live is reconciled
  // elsewhere (api/live.js against the closed input). So for the closed input we stop after automation.
  if (isClosed) { res.status(200).json({ ok: true, event: eventType, input: "closed", ts }); return; }

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
