// StratNinja — serve a recording's auto summary + key-moment chapters.
//   GET /api/vod-summary?uid=<32hex> -> { ok, summary, chapters:[{t,title}], duration }
// Public read: the vod_summaries RLS allows SELECT for everyone (summaries of public
// recordings). Uses the anon key. Produced by the server worker (vod_summary_worker.py).

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

const RE_UID = /^[a-f0-9]{32}$/i;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.setHeader("Cache-Control", "no-store"); res.status(405).json({ error: "method" }); return; }
  const uid = String((req.query && req.query.uid) || "").trim();
  if (!RE_UID.test(uid)) { res.setHeader("Cache-Control", "no-store"); res.status(400).json({ ok: false, error: "bad_uid" }); return; }
  try {
    const url = SUPA_URL + "/rest/v1/vod_summaries?video_uid=eq." + uid +
      "&status=eq.done&select=summary,chapters,duration&limit=1";
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const row = Array.isArray(rows) && rows[0];
    if (!row) {
      // not summarised yet (or still processing) — short cache so it appears soon after the worker runs
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
      res.status(200).json({ ok: true, summary: "", chapters: [] });
      return;
    }
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");   // a finished summary is stable
    res.status(200).json({
      ok: true,
      summary: row.summary || "",
      chapters: Array.isArray(row.chapters) ? row.chapters : [],
      duration: row.duration || 0,
    });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, summary: "", chapters: [] });
  }
}
