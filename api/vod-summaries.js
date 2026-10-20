// StratNinja — short "at a glance" blurbs for ALL recordings, in ONE request.
//   GET /api/vod-summaries -> { ok, items: { "<uid>": "<tldr>" } }
// The recordings grid shows a 1-line teaser under each card without opening the player.
// Public read (summaries of public recordings). Derives a short teaser from the stored summary,
// so no DB change / reprocessing is needed. Produced by the worker (vod_summary_worker.py).

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

// first sentence of the summary, capped — a punchy teaser for the card.
function tldr(s) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const m = s.match(/^[\s\S]{0,180}?[.!?׃]/);   // up to the first sentence end
  let t = (m ? m[0] : s).trim();
  if (t.length > 160) t = t.slice(0, 157).replace(/\s+\S*$/, "").trim() + "…";
  return t;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.setHeader("Cache-Control", "no-store"); res.status(405).json({ error: "method" }); return; }
  try {
    const url = SUPA_URL + "/rest/v1/vod_summaries?status=eq.done&summary=not.is.null&select=video_uid,summary";
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const items = {};
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const t = tldr(row && row.summary);
      if (row && row.video_uid && t) items[row.video_uid] = t;
    });
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ ok: true, items: items });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, items: {} });
  }
}
