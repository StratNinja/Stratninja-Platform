// Edge-cached per-symbol OHLC read for the NATIVE chart grid (lightweight-charts).
// Reads the pre-built public row scanner_data id='ohlc:<SYM>' (built by web_feed.py --ohlc) and
// serves it gzipped through Vercel's shared edge cache — so Supabase is hit ~once per symbol per
// cache window across ALL visitors, not once per chart per viewer. Daily data → long TTL.
// The anon key + URL are PUBLIC by design (see api/feed.js); RLS enforces real security.
import { gzipSync } from "zlib";

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const sym = String((req.query && req.query.sym) || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!sym) { res.setHeader("Cache-Control", "no-store"); res.status(400).json({ error: "no_sym" }); return; }

  try {
    const r = await fetch(SUPA_URL + "/rest/v1/scanner_data?id=eq." + encodeURIComponent("ohlc:" + sym) + "&select=data", {
      headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY },
    });
    if (!r.ok) {
      const txt = await r.text();
      res.setHeader("Cache-Control", "no-store");
      res.status(502).json({ error: "upstream_" + r.status, detail: txt.slice(0, 200) });
      return;
    }
    const body = await r.text();   // raw PostgREST [{data}] array (or [] when absent) — client handles both
    res.setHeader("Content-Type", "application/json");
    // daily data refreshes once a day → 1h edge cache, long stale-while-revalidate keeps it snappy.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
    const gz = gzipSync(Buffer.from(body));
    res.setHeader("Content-Encoding", "gzip");
    res.status(200).send(gz);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "fetch_failed", detail: String((e && e.message) || e) });
  }
}
