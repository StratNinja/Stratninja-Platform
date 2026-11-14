// StratNinja — SCHEDULED LIVES API (planned future broadcasts: site event + YouTube).
//
//   GET                         → public: list of upcoming / live scheduled lives (for the /live banner)
//   POST  (admin)  action:save  → create or update a scheduled live (and, if YouTube is configured,
//                                 create/refresh the matching scheduled YouTube broadcast)
//   POST  (admin)  action:cancel→ mark a row canceled (and best-effort delete the YouTube broadcast)
//   POST  (admin)  action:delete→ hard-delete a row (admin cleanup)
//
// Security: PUBLIC can only GET. Every write verifies the admin JWT server-side and writes with the
// service-role key (bypasses RLS). is_live-style fields (pre_push_sent, youtube_*) are server-only.
//
// Secrets (Vercel env, server only — NEVER in the browser/logs):
//   SUPABASE_SERVICE_ROLE_KEY   privileged Supabase write (bypasses RLS)
//   --- YouTube (Stage 2; OPTIONAL — until all three are set, the site side works and YouTube is skipped):
//   YT_CLIENT_ID                OAuth 2.0 client id       (Google Cloud → Credentials)
//   YT_CLIENT_SECRET            OAuth 2.0 client secret
//   YT_REFRESH_TOKEN            long-lived refresh token for Adi's channel (koriatmanagement@gmail.com)
//   YT_STREAM_ID                OPTIONAL advanced override — pin EVERY broadcast to one fixed liveStream id.
//                               Leave UNSET (recommended): each scheduled live then gets its OWN dedicated
//                               stream key, so multiple scheduled broadcasts never collide ("key in use").
//   YT_PRIVACY                  OPTIONAL — 'public' (default) | 'unlisted' | 'private'

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

const YT_CLIENT_ID = (process.env.YT_CLIENT_ID || "").trim();
const YT_CLIENT_SECRET = (process.env.YT_CLIENT_SECRET || "").trim();
const YT_REFRESH_TOKEN = (process.env.YT_REFRESH_TOKEN || "").trim();
const YT_STREAM_ID = (process.env.YT_STREAM_ID || "").trim();
const YT_PRIVACY = (["public", "unlisted", "private"].indexOf((process.env.YT_PRIVACY || "").trim()) >= 0)
  ? (process.env.YT_PRIVACY || "").trim() : "public";
const YT_READY = !!(YT_CLIENT_ID && YT_CLIENT_SECRET && YT_REFRESH_TOKEN);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["scheduled", "live", "ended", "canceled"];

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
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

// shape a row for public consumption (never leak internal fields beyond what the banner needs)
function publicView(row) {
  return {
    id: row.id,
    title: row.title || "",
    description: row.description || "",
    thumbnail_url: row.thumbnail_url || "",
    scheduled_start: row.scheduled_start || null,
    status: row.status || "scheduled",
    visibility: row.visibility === "community" ? "community" : "public",
    youtube_watch_url: row.youtube_watch_url || "",
  };
}

// ============================================================================
// YouTube Data API v3 helpers (Stage 2). All no-ops until YT_READY; every call
// is best-effort — a YouTube failure NEVER blocks the site-side save (the admin
// gets a warning instead). Logs only status codes / error reasons, never tokens.
// ============================================================================
async function ytAccessToken() {
  const body = new URLSearchParams({
    client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET,
    refresh_token: YT_REFRESH_TOKEN, grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) {
    console.warn("[sched-lives] YT token refresh failed " + JSON.stringify({ http: r.status, err: j && j.error }));
    return null;
  }
  return j.access_token;
}
function ytApi(tok, path, opts) {
  opts = opts || {};
  return fetch("https://www.googleapis.com/youtube/v3/" + path, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: "Bearer " + tok, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
// Create a FRESH dedicated liveStream for one broadcast. Each scheduled live gets its OWN
// stream key, so multiple scheduled broadcasts never collide on one shared key ("key in use").
// → { stream_id, stream_key, ingest_url } on success, or null. The key is a SECRET — it is
// never persisted to Supabase (public-read); only the non-secret stream_id is stored, and the
// key is re-fetched live for the verified admin via ytStreamKeys().
async function ytCreateStream(tok, title) {
  try {
    const body = {
      snippet: { title: ("SN · " + (title || "Live")).slice(0, 128) },
      cdn: { frameRate: "variable", resolution: "variable", ingestionType: "rtmp" },
    };
    const r = await ytApi(tok, "liveStreams?part=snippet,cdn,contentDetails", { method: "POST", body: JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.id) {
      console.warn("[sched-lives] YT liveStreams.insert failed " + JSON.stringify({ http: r.status, err: j && j.error && j.error.message }));
      return null;
    }
    const info = (j.cdn && j.cdn.ingestionInfo) || {};
    return { stream_id: j.id, stream_key: info.streamName || "", ingest_url: info.ingestionAddress || "" };
  } catch (e) { console.warn("[sched-lives] YT liveStreams.insert threw"); return null; }
}
// best-effort delete of a dedicated stream (on cancel/delete) so streams don't pile up.
async function ytDeleteStream(tok, streamId) {
  try { if (streamId) await ytApi(tok, "liveStreams?id=" + encodeURIComponent(streamId), { method: "DELETE" }); }
  catch (e) { /* best-effort */ }
}
// Batch-fetch the current RTMP key + ingest url for a set of dedicated stream ids (admin only).
// Returns { [streamId]: { stream_key, ingest_url } }. Never throws.
async function ytStreamKeys(tok, ids) {
  const out = {};
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return out;
  try {
    // liveStreams.list accepts a comma-joined id list; chunk to stay well under URL limits.
    for (let i = 0; i < uniq.length; i += 25) {
      const chunk = uniq.slice(i, i + 25);
      const r = await ytApi(tok, "liveStreams?part=cdn&id=" + chunk.map(encodeURIComponent).join(","));
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !Array.isArray(j.items)) continue;
      j.items.forEach(s => {
        const info = (s && s.cdn && s.cdn.ingestionInfo) || {};
        out[s.id] = { stream_key: info.streamName || "", ingest_url: info.ingestionAddress || "" };
      });
    }
  } catch (e) { console.warn("[sched-lives] YT streamKeys failed"); }
  return out;
}
// set the broadcast's thumbnail from a URL (best-effort). broadcastId doubles as the videoId.
async function ytSetThumbnail(tok, broadcastId, thumbUrl) {
  try {
    const img = await fetch(thumbUrl);
    if (!img.ok) return;
    const ct = img.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await img.arrayBuffer());
    if (!buf.length || buf.length > 2 * 1024 * 1024) return;   // YouTube thumbnail cap is 2MB
    const up = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=" + encodeURIComponent(broadcastId),
      { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": ct }, body: buf });
    if (!up.ok) console.warn("[sched-lives] YT thumbnails.set failed " + JSON.stringify({ http: up.status }));
  } catch (e) { console.warn("[sched-lives] YT thumbnail error"); }
}
// Create a scheduled YouTube broadcast and bind it to the reusable stream.
// → { broadcast_id, watch_url } on success, or { error } (never throws to the caller).
async function ytCreateBroadcast(title, description, scheduledStartISO, thumbUrl, privacy) {
  try {
    const tok = await ytAccessToken();
    if (!tok) return { error: "yt_auth" };
    const priv = (["public", "unlisted", "private"].indexOf(privacy) >= 0) ? privacy : YT_PRIVACY;
    const insBody = {
      snippet: { title: (title || "StratNinja Live").slice(0, 100), description: (description || "").slice(0, 5000), scheduledStartTime: scheduledStartISO },
      status: { privacyStatus: priv, selfDeclaredMadeForKids: false },
      contentDetails: { enableAutoStart: true, enableAutoStop: true, enableDvr: true },
    };
    const r = await ytApi(tok, "liveBroadcasts?part=snippet,status,contentDetails", { method: "POST", body: JSON.stringify(insBody) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.id) {
      console.warn("[sched-lives] YT liveBroadcasts.insert failed " + JSON.stringify({ http: r.status, err: j && j.error && j.error.message }));
      return { error: "yt_insert" };
    }
    const broadcastId = j.id;
    // Give THIS broadcast its own dedicated stream key (no sharing → no "key in use" conflicts),
    // then bind it so OBS/Cloudflare→YouTube on that key flows into THIS broadcast and auto-starts it.
    let stream = null;
    if (YT_STREAM_ID) {
      // explicit override still honoured (advanced): bind to a fixed stream id.
      stream = { stream_id: YT_STREAM_ID, stream_key: "", ingest_url: "" };
    } else {
      stream = await ytCreateStream(tok, title);
    }
    if (stream && stream.stream_id) {
      const b = await ytApi(tok, "liveBroadcasts/bind?part=id&id=" + encodeURIComponent(broadcastId) + "&streamId=" + encodeURIComponent(stream.stream_id), { method: "POST" });
      if (!b.ok) console.warn("[sched-lives] YT bind failed " + JSON.stringify({ http: b.status }));
    } else {
      console.warn("[sched-lives] YT could not create a dedicated stream to bind");
    }
    if (thumbUrl) await ytSetThumbnail(tok, broadcastId, thumbUrl);
    return {
      broadcast_id: broadcastId, watch_url: "https://youtu.be/" + broadcastId,
      stream_id: stream ? stream.stream_id : "", stream_key: stream ? stream.stream_key : "", ingest_url: stream ? stream.ingest_url : "",
    };
  } catch (e) {
    console.warn("[sched-lives] YT create threw");
    return { error: "yt_threw" };
  }
}
async function ytDeleteBroadcast(broadcastId) {
  try {
    const tok = await ytAccessToken();
    if (!tok) return;
    await ytApi(tok, "liveBroadcasts?id=" + encodeURIComponent(broadcastId), { method: "DELETE" });
  } catch (e) { /* best-effort */ }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }

  // ---- public read: upcoming + currently-live scheduled lives --------------
  if (req.method === "GET") {
    // keep recently-started (last 3h) so a live-in-progress banner survives; drop ended/canceled.
    const since = new Date(Date.now() - 3 * 3600000).toISOString();
    const r = await sb("scheduled_lives?select=id,title,description,thumbnail_url,scheduled_start,status,visibility,youtube_watch_url" +
      "&status=in.(scheduled,live)&scheduled_start=gte." + encodeURIComponent(since) +
      "&order=scheduled_start.asc&limit=20");
    const rows = await r.json().catch(() => []);
    res.status(200).json({ ok: true, lives: Array.isArray(rows) ? rows.map(publicView) : [], ts: Date.now() });
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!(await verifyAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const action = String(body.action || "save").trim();
  const id = String(body.id || "").trim();

  // ---- admin list: upcoming + live rows, enriched with the LIVE YouTube stream key ---------
  // (the key is a secret fetched fresh from YouTube per request — never stored in Supabase).
  if (action === "list") {
    const since = new Date(Date.now() - 3 * 3600000).toISOString();
    const r = await sb("scheduled_lives?select=id,title,description,thumbnail_url,scheduled_start,status,visibility,youtube_broadcast_id,youtube_watch_url,youtube_stream_id" +
      "&status=in.(scheduled,live)&scheduled_start=gte." + encodeURIComponent(since) +
      "&order=scheduled_start.asc&limit=50");
    const rows = await r.json().catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    let keys = {};
    if (YT_READY) {
      const tok = await ytAccessToken();
      if (tok) keys = await ytStreamKeys(tok, list.map(x => x.youtube_stream_id));
    }
    const out = list.map(row => Object.assign(publicView(row), {
      youtube_broadcast_id: row.youtube_broadcast_id || "",
      stream_key: (keys[row.youtube_stream_id] && keys[row.youtube_stream_id].stream_key) || "",
      ingest_url: (keys[row.youtube_stream_id] && keys[row.youtube_stream_id].ingest_url) || "",
    }));
    res.status(200).json({ ok: true, lives: out, ts: Date.now() });
    return;
  }

  // ---- cancel: mark canceled + best-effort delete the YouTube broadcast ----
  if (action === "cancel" || action === "delete") {
    if (!RE_UUID.test(id)) { res.status(400).json({ error: "bad_id" }); return; }
    const cur = await sb("scheduled_lives?id=eq." + id + "&select=youtube_broadcast_id,youtube_stream_id").then(r => r.json()).catch(() => []);
    const ybid = Array.isArray(cur) && cur[0] ? cur[0].youtube_broadcast_id : null;
    const ysid = Array.isArray(cur) && cur[0] ? cur[0].youtube_stream_id : null;
    if ((ybid || ysid) && YT_READY) {
      const tok = await ytAccessToken();
      if (tok) {
        if (ybid) await ytDeleteBroadcast(ybid);
        if (ysid && !YT_STREAM_ID) await ytDeleteStream(tok, ysid);   // never delete an explicit shared override
      }
    }
    if (action === "delete") {
      const r = await sb("scheduled_lives?id=eq." + id, { method: "DELETE" });
      res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { ok: false, error: "delete_failed" });
      return;
    }
    const r = await sb("scheduled_lives?id=eq." + id, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "canceled", updated_at: new Date().toISOString() }),
    });
    res.status(r.ok ? 200 : 502).json(r.ok ? { ok: true } : { ok: false, error: "cancel_failed" });
    return;
  }

  // ---- save: create a new scheduled live, or update an existing one --------
  const title = String(body.title == null ? "" : body.title).replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 200);
  const description = String(body.description == null ? "" : body.description).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim().slice(0, 1000);
  const thumbnail_url = (typeof body.thumbnail_url === "string" && /^https:\/\/[^\s'"()]+$/i.test(body.thumbnail_url)) ? body.thumbnail_url.slice(0, 500) : null;
  const when = body.scheduled_start ? new Date(body.scheduled_start) : null;
  if (!title) { res.status(400).json({ error: "missing_title" }); return; }
  if (!when || isNaN(when.getTime())) { res.status(400).json({ error: "bad_time" }); return; }
  const status = STATUSES.indexOf(body.status) >= 0 ? body.status : "scheduled";
  const visibility = body.visibility === "community" ? "community" : "public";   // private = community (gated vault)

  // UPDATE path (existing row) — never touches pre_push_sent / youtube_* on an edit of core fields.
  if (RE_UUID.test(id)) {
    const patch = { title, description, thumbnail_url, scheduled_start: when.toISOString(), status, visibility, updated_at: new Date().toISOString() };
    const r = await sb("scheduled_lives?id=eq." + id, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
    const a = await r.json().catch(() => []);
    if (!r.ok || !Array.isArray(a) || !a[0]) { res.status(502).json({ ok: false, error: "update_failed" }); return; }
    res.status(200).json({ ok: true, live: publicView(a[0]), youtube: !!a[0].youtube_broadcast_id });
    return;
  }

  // CREATE path — insert the site row first (always succeeds even if YouTube is off/fails),
  // then create the matching YouTube broadcast and patch its id in.
  const ins = await sb("scheduled_lives", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ title, description, thumbnail_url, scheduled_start: when.toISOString(), status: "scheduled", visibility }),
  });
  const created = await ins.json().catch(() => []);
  if (!ins.ok || !Array.isArray(created) || !created[0]) { res.status(502).json({ ok: false, error: "create_failed" }); return; }
  let row = created[0];

  let ytWarn = "";
  let streamKey = "", ingestUrl = "";
  if (YT_READY) {
    // community (private) lives → unlisted on YouTube (match the community simulcast approach); public → public.
    const yt = await ytCreateBroadcast(title, description, when.toISOString(), thumbnail_url, visibility === "community" ? "unlisted" : "public");
    if (yt.broadcast_id) {
      streamKey = yt.stream_key || ""; ingestUrl = yt.ingest_url || "";   // returned to the admin now; NOT stored (secret)
      const pr = await sb("scheduled_lives?id=eq." + row.id, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ youtube_broadcast_id: yt.broadcast_id, youtube_watch_url: yt.watch_url, youtube_stream_id: yt.stream_id || null, updated_at: new Date().toISOString() }),
      });
      const pa = await pr.json().catch(() => []);
      if (Array.isArray(pa) && pa[0]) row = pa[0];
    } else {
      ytWarn = yt.error || "yt_failed";   // site row is saved; the YouTube broadcast was not created
    }
  } else {
    ytWarn = "yt_not_configured";
  }

  res.status(200).json({ ok: true, live: publicView(row), youtube: !!row.youtube_broadcast_id, yt_warn: ytWarn, stream_key: streamKey, ingest_url: ingestUrl });
}
