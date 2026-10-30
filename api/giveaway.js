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

// ---- YouTube live chat via the INTERNAL innertube endpoint ----
// The official Data API `liveChatMessages.list` returns a bare HTTP 404 even for PUBLIC lives
// (confirmed 2026-10-30), so we read the chat the way the web player does: load the live_chat page
// once to grab the innertube key + an initial continuation, then poll youtubei get_live_chat.
// No OAuth, no extra deps — proven to work from the server (stdlib fetch).
const YT_CK = "CONSENT=YES+cb.20210328-17-p0.en+FX+000; SOCS=CAI";
async function ytFetchText(url, opts) {
  opts = opts || {};
  const r = await fetch(url, {
    method: opts.method || "GET",
    headers: Object.assign({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": YT_CK,
    }, opts.headers || {}),
    body: opts.body,
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}
function _extractJsonAt(s, anchor) {
  let i = s.indexOf(anchor); if (i < 0) return null;
  i = s.indexOf("{", i); if (i < 0) return null;
  let depth = 0, instr = false, esc = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (instr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') instr = false; }
    else if (c === '"') instr = true; else if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return null;
}
function _collectConts(o, out) {
  if (Array.isArray(o)) { for (const v of o) _collectConts(v, out); return; }
  if (o && typeof o === "object") {
    for (const k of ["invalidationContinuationData", "timedContinuationData", "reloadContinuationData"]) {
      const v = o[k]; if (v && v.continuation) out.push(v.continuation);
    }
    for (const k in o) _collectConts(o[k], out);
  }
}
function _parseChatJson(j) {
  const cc = ((j.continuationContents || {}).liveChatContinuation) || {};
  const acts = cc.actions || [];
  let next = null, nextType = null;
  for (const c of (cc.continuations || [])) {
    if (c.invalidationContinuationData && c.invalidationContinuationData.continuation) { next = c.invalidationContinuationData.continuation; nextType = "live"; break; }
    if (c.timedContinuationData && c.timedContinuationData.continuation) { next = c.timedContinuationData.continuation; nextType = "live"; break; }
    if (c.reloadContinuationData && c.reloadContinuationData.continuation) { next = c.reloadContinuationData.continuation; nextType = "reload"; }
  }
  const msgs = [];
  for (const a of acts) {
    const r = (((a.addChatItemAction || {}).item) || {}).liveChatTextMessageRenderer;
    if (!r) continue;
    const nm = (r.authorName || {}).simpleText || "";
    const tx = ((r.message || {}).runs || []).map(x => x.text || "").join("");
    msgs.push({ name: nm, text: tx, tsUsec: +(r.timestampUsec || 0), cid: r.authorExternalChannelId || "" });
  }
  return { msgs, next, nextType };
}
async function ytiPoll(key, ver, continuation) {
  const body = JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: ver } }, continuation });
  const r = await ytFetchText("https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=" + key, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!r.ok) return { error: "iti_" + r.status };
  let j; try { j = JSON.parse(r.text); } catch (e) { return { error: "iti_parse" }; }
  return _parseChatJson(j);
}
// load the live_chat page → innertube key/ver + pick the continuation that actually yields a live feed
async function ytiSeed(videoId) {
  const r = await ytFetchText("https://www.youtube.com/live_chat?is_popout=1&v=" + encodeURIComponent(videoId));
  if (!r.ok) return { error: "seed_" + r.status };
  const page = r.text;
  const mk = page.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!mk) {
    const mr = page.match(/"reason":\{"simpleText":"([^"]+)"/) || page.match(/"reason":\{"runs":\[\{"text":"([^"]+)"/);
    return { error: mr ? "unavailable:" + mr[1].slice(0, 40) : "no_key" };
  }
  const mv = page.match(/"clientVersion":"([\d.]+)"/);
  const key = mk[1], ver = mv ? mv[1] : "2.20240101.00.00";
  const raw = _extractJsonAt(page, "ytInitialData");
  if (!raw) return { error: "no_initdata" };
  let data; try { data = JSON.parse(raw); } catch (e) { return { error: "initdata_parse" }; }
  const cands = []; _collectConts(data, cands);
  // Pick the continuation that leads to the LIVE message feed. Some candidates (reload/"top chat")
  // return a valid next token but a dead chain that never yields messages; the live one yields
  // messages now, or at least a timed/invalidation ("live") next. Prefer: has messages > live next.
  const seen = {};
  let fbLive = null, fbAny = null;
  for (const c of cands) {
    if (seen[c]) continue; seen[c] = 1;
    const res = await ytiPoll(key, ver, c);
    if (res.error || !res.next) continue;
    if (res.msgs && res.msgs.length) return { key, ver, continuation: res.next, msgs: res.msgs };
    if (res.nextType === "live" && !fbLive) fbLive = { key, ver, continuation: res.next, msgs: [] };
    if (!fbAny) fbAny = { key, ver, continuation: res.next, msgs: [] };
  }
  return fbLive || fbAny || { error: "no_live_cont" };
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

  // Only find/resolve need the Google Data API (to detect the live video). Polling reads the chat via
  // innertube and must NOT depend on OAuth, so a token hiccup never blocks an in-progress giveaway.
  let at = null;
  if (action === "find" || action === "resolve") {
    try { at = await getAccessToken(); }
    catch (e) { res.status(502).json({ error: "google_auth", detail: String(e.message || e) }); return; }
  }

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
      const videoId = row.yt_video_id;
      if (!videoId) { res.status(200).json({ error: "no_video" }); return; }

      // innertube state {k:key, v:clientVersion, c:continuation} is stashed in yt_page_token (JSON).
      // Seed it (load the live_chat page) when missing or not-JSON (e.g. a legacy Data-API token).
      let st = null;
      try { st = row.yt_page_token ? JSON.parse(row.yt_page_token) : null; } catch (e) { st = null; }
      let poll;
      if (!st || !st.c || !st.k) {
        const seed = await ytiSeed(videoId);
        if (seed.error) {
          try { await patchRow({ winner: { debug: "seed:" + seed.error, at: new Date().toISOString() } }); } catch (e) {}
          res.status(200).json({ error: "chat_seed", reason: seed.error, ended: /unavailable|no_live_cont/.test(seed.error) });
          return;
        }
        st = { k: seed.key, v: seed.ver, c: seed.continuation };
        poll = { msgs: seed.msgs || [], next: seed.continuation };   // seed already advanced past these msgs
      } else {
        poll = await ytiPoll(st.k, st.v, st.c);
        if (poll.error) {
          const seed = await ytiSeed(videoId);                        // re-seed once (continuation rolled / chat reset)
          if (seed.error) { res.status(200).json({ error: "chat_poll", reason: poll.error }); return; }
          st = { k: seed.key, v: seed.ver, c: seed.continuation };
          poll = { msgs: seed.msgs || [], next: seed.continuation };
        }
      }

      const kw = String(row.keyword || "NINJA").toUpperCase();
      const openedMs = row.opened_at ? new Date(row.opened_at).getTime() : 0;
      const seen = {}, rows = [];
      (poll.msgs || []).forEach(function (m) {
        const pubMs = m.tsUsec ? Math.floor(m.tsUsec / 1000) : Date.now();
        if (openedMs && pubMs < openedMs - 60000) return;             // ignore chatter from before the window opened (60s grace)
        if ((m.text || "").toUpperCase().indexOf(kw) < 0) return;     // must contain the keyword
        const nm = (m.name || "צופה");
        const norm = nm.trim().replace(/\s+/g, " ").toLowerCase();     // ONE entry per NAME
        if (!norm || seen[norm]) return;
        seen[norm] = 1;
        rows.push({ round: row.round, source: "youtube", user_key: "name:" + norm, name: nm });
      });

      let added = 0, writeErr = null;
      if (rows.length) {
        const ins = await sb("giveaway_entries", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows) });
        if (ins.ok) added = rows.length; else writeErr = (await ins.text().catch(function () { return ""; })).slice(0, 160);
      }
      await patchRow({ yt_page_token: JSON.stringify({ k: st.k, v: st.v, c: poll.next || st.c }), updated_at: new Date().toISOString() });
      res.status(200).json({ added: added, scanned: (poll.msgs || []).length, matched: rows.length, writeErr: writeErr });
      return;
    }
    res.status(400).json({ error: "bad_action" });
  } catch (e) {
    res.status(500).json({ error: "server", detail: String((e && e.message) || e) });
  }
}
