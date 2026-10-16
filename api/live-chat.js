// StratNinja — cached READ of the live chat (GET only). Protects Supabase from per-viewer polling:
// every viewer hits the SAME edge-cached response (s-maxage), so Supabase is read ~once per window
// GLOBALLY, not once per viewer (same idea as /api/feed). Uses the PUBLIC anon key; RLS already limits
// anon to non-hidden rows. POSTING and HIDING are NOT here — they go directly through the user's own
// Supabase session (RLS: insert as self; admin-only hide), so no service-role key is needed.
//
// GET /api/live-chat?live=public  → { ok:true, messages:[{id,name,msg,created_at}, …] }  (oldest→newest, ≤60)

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

const RE_LIVE = /^[a-z0-9_-]{1,32}$/i;   // live_id is a short slug — never interpolate anything else

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.setHeader("Cache-Control", "no-store"); res.status(405).json({ error: "method" }); return; }

  const liveRaw = (req.query && (req.query.live || req.query.live_id)) || "public";
  const live = RE_LIVE.test(String(liveRaw)) ? String(liveRaw) : "public";

  // newest 60 non-hidden rows, then flip to chronological for the UI.
  const url = SUPA_URL + "/rest/v1/live_chat" +
    "?select=id,name,msg,created_at&live_id=eq." + encodeURIComponent(live) +
    "&hidden=is.false&order=id.desc&limit=60";
  try {
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
    if (!r.ok) { res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: false, error: "upstream", messages: [] }); return; }
    const rows = await r.json();
    const messages = Array.isArray(rows) ? rows.slice().reverse() : [];
    // edge-cache the SAME response for all viewers for ~2s; serve stale briefly while revalidating.
    res.setHeader("Cache-Control", "public, s-maxage=2, stale-while-revalidate=4");
    res.status(200).json({ ok: true, messages: messages });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, error: "fetch_failed", messages: [] });
  }
}
