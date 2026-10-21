// StratNinja — COURSE curriculum (public list of lessons).
//   GET /api/course-lessons -> { ok, lessons:[{ uid, title, module, sort, duration, summary }] }
// Public: the curriculum (titles/modules) is marketing — everyone may see what the course
// contains. Returning the video_uid is harmless: each video has requireSignedURLs=true, so it
// is unplayable without a signed token (api/course-token.js, which checks the entitlement).
// Uses the anon key; course_lessons RLS allows SELECT for everyone.

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.setHeader("Cache-Control", "no-store"); res.status(405).json({ error: "method" }); return; }
  try {
    const url = SUPA_URL + "/rest/v1/course_lessons?published=is.true" +
      "&select=video_uid,title,module,sort,duration,summary,kind&order=module.asc,sort.asc,id.asc";
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
    const rows = r.ok ? await r.json().catch(() => []) : [];
    const lessons = (Array.isArray(rows) ? rows : []).map((v) => ({
      uid: v.video_uid,
      title: v.title || "",
      module: v.module || "",
      sort: v.sort || 0,
      duration: v.duration || 0,
      summary: v.summary || "",
      kind: v.kind === "community" ? "community" : "course",   // default/legacy rows are the course
    }));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ ok: true, lessons: lessons });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, lessons: [] });
  }
}
