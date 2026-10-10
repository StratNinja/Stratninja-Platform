// StratNinja — Giveaways YouTube live-chat poller (server-side, admin-only).
// Reads the channel owner's live chat (works for UNLISTED + public) and writes
// entrants to Supabase. Driven by the admin's browser while a giveaway is "open".
//
// Actions (?action=):
//   find    → auto-detect the owner's currently-active live broadcast → {video_id, live_chat_id, title}
//   resolve → given ?video=<url|id>, return its activeLiveChatId (manual fallback)
//   poll    → read new chat msgs, collect authors who wrote the keyword, upsert as entries
//
// Secrets (Vercel env, Production): GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET /
// GOOGLE_REFRESH_TOKEN (owner OAuth, youtube.readonly) + SUPABASE_SERVICE_ROLE_KEY
// (privileged write, bypasses RLS — NEVER exposed to the browser).

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";

// ---- Google access token (refresh → access), cached per warm instance ----
let _tok = { v: null, exp: 0 };
async function getAccessToken() {
  if (_tok.v && Date.now() < _tok.exp - 60000) return _tok.v;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "",
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("token_exchange_failed: " + JSON.stringify(j).slice(0, 200));
  _tok = { v: j.access_token, exp: Date.now() + (j.expires_in || 3500) * 1000 };
  return _tok.v;
}

// ---- Supabase (service key) ----
function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
async function getRow() {
  const r = await sb("giveaways?id=eq.current&select=*");
  const a = await r.json();
  return Array.isArray(a) ? a[0] : null;
}
async function patchRow(fields) {
  return sb("giveaways?id=eq.current", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(fields) });
}

// ---- YouTube Data API ----
async function yt(path, at) {
  const r = await fetch("https://www.googleapis.com/youtube/v3/" + path, { headers: { Authorization: "Bearer " + at } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
async function findActiveLive(at) {
  const { j } = await yt("liveBroadcasts?part=snippet,status&broadcastStatus=active&broadcastType=all&maxResults=5", at);
  const items = (j && j.items) || [];
  if (!items.length) return null;
  const b = items[0];
  return { video_id: b.id, live_chat_id: b.snippet && b.snippet.liveChatId, title: (b.snippet && b.snippet.title) || "" };
}
function parseVideoId(s) {
  s = String(s || "").trim();
  let m = s.match(/[?&]v=([\w-]{6,})/) || s.match(/youtu\.be\/([\w-]{6,})/) || s.match(/\/live\/([\w-]{6,})/) || s.match(/\/shorts\/([\w-]{6,})/);
  if (m) return m[1];
  if (/^[\w-]{6,}$/.test(s)) return s;   // raw id
  return "";
}
async function resolveVideo(at, raw) {
  const id = parseVideoId(raw);
  if (!id) return { error: "bad_video" };
  const { j } = await yt("videos?part=liveStreamingDetails,snippet&id=" + id, at);
  const it = (j && j.items || [])[0];
  if (!it) return { error: "not_found" };
  const chat = it.liveStreamingDetails && it.liveStreamingDetails.activeLiveChatId;
  if (!chat) return { error: "no_active_chat" };
  return { video_id: id, live_chat_id: chat, title: (it.snippet && it.snippet.title) || "" };
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }

  const action = String((req.query && req.query.action) || "");
  if (!(await verifyAdmin(req))) { res.status(403).json({ error: "forbidden" }); return; }

  let at;
  try { at = await getAccessToken(); }
  catch (e) { res.status(502).json({ error: "google_auth", detail: String(e.message || e) }); return; }

  try {
    if (action === "find") {
      const live = await findActiveLive(at);
      res.status(200).json({ live: live || null });
      return;
    }
    if (action === "resolve") {
      const out = await resolveVideo(at, (req.query && req.query.video) || "");
      res.status(out.error ? 200 : 200).json(out);
      return;
    }
    if (action === "poll") {
      const row = await getRow();
      if (!row) { res.status(200).json({ error: "no_row" }); return; }
      if (row.status !== "open") { res.status(200).json({ skip: true, status: row.status }); return; }
      let chatId = row.yt_live_chat_id;
      if (!chatId) { res.status(200).json({ error: "no_chat" }); return; }

      function reasonOf(jj) { return (jj && jj.error && jj.error.errors && jj.error.errors[0] && jj.error.errors[0].reason) || ""; }
      async function doPoll(cid, token) {
        let url = "liveChatMessages?part=snippet,authorDetails&maxResults=2000&liveChatId=" + encodeURIComponent(cid);
        if (token) url += "&pageToken=" + encodeURIComponent(token);
        return yt(url, at);
      }

      let token = row.yt_page_token;
      let r1 = await doPoll(chatId, token);
      // stale/expired chat id (or bad page token) → re-resolve the CURRENT active chat from the video, retry fresh
      if (!r1.ok) {
        const reason = reasonOf(r1.j);
        if ((r1.status === 404 || reason === "liveChatNotFound" || reason === "pageTokenInvalid" || reason === "liveChatEnded") && row.yt_video_id) {
          const rv = await resolveVideo(at, row.yt_video_id);
          if (rv && rv.live_chat_id && rv.live_chat_id !== chatId) {
            chatId = rv.live_chat_id; token = null;
            await patchRow({ yt_live_chat_id: chatId, yt_page_token: null });
            r1 = await doPoll(chatId, null);
          }
        }
        if (!r1.ok) {
          const r2 = reasonOf(r1.j);
          const msg = (r1.j.error && r1.j.error.message || "").slice(0, 220);
          // stash the FULL raw error body in the row so it can be inspected without the admin UI
          try { await patchRow({ winner: { debug: "chat_" + r1.status + " | " + JSON.stringify(r1.j).slice(0, 400), chat: chatId, at: new Date().toISOString() } }); } catch (e) {}
          res.status(200).json({ error: "chat_" + r1.status, reason: r2, ended: r2 === "liveChatEnded", detail: msg });
          return;
        }
      }
      const j = r1.j;

      const kw = String(row.keyword || "NINJA").toUpperCase();
      const openedMs = row.opened_at ? new Date(row.opened_at).getTime() : 0;
      const seen = {}, rows = [];
      (j.items || []).forEach(function (it) {
        const msg = (it.snippet && (it.snippet.displayMessage || it.snippet.textMessageDetails && it.snippet.textMessageDetails.messageText)) || "";
        const pubMs = it.snippet && it.snippet.publishedAt ? new Date(it.snippet.publishedAt).getTime() : Date.now();
        if (openedMs && pubMs < openedMs - 60000) return;          // ignore chatter from well before the window opened (60s grace)
        if (msg.toUpperCase().indexOf(kw) < 0) return;             // must contain the keyword
        const nm = (it.authorDetails && it.authorDetails.displayName) || "צופה";
        const norm = nm.trim().replace(/\s+/g, " ").toLowerCase();  // ONE entry per NAME (key = the name)
        if (!norm || seen[norm]) return;
        seen[norm] = 1;
        rows.push({ round: row.round, source: "youtube", user_key: "name:" + norm, name: nm });
      });

      let added = 0, writeErr = null;
      if (rows.length) {
        const ins = await sb("giveaway_entries", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
        if (ins.ok) added = rows.length; else writeErr = (await ins.text().catch(function () { return ""; })).slice(0, 160);
      }
      await patchRow({ yt_page_token: j.nextPageToken || token, updated_at: new Date().toISOString() });
      res.status(200).json({ added: added, scanned: (j.items || []).length, matched: rows.length, writeErr: writeErr, chatId: chatId, pollingIntervalMillis: j.pollingIntervalMillis || 5000 });
      return;
    }
    res.status(400).json({ error: "bad_action" });
  } catch (e) {
    res.status(500).json({ error: "server", detail: String((e && e.message) || e) });
  }
}
