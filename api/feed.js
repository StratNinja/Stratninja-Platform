// Edge-cached read proxy for the big PUBLIC Supabase rows (scanner_data / market_snapshot).
// Every visitor pulls the ~7.7MB scan feed on page load; routing those reads through Vercel's edge
// cache means Supabase is hit ~ONCE PER CACHE WINDOW GLOBALLY instead of once per visitor — cutting
// DB load + egress by orders of magnitude (protects against traffic spikes; keeps the nano/Small DB calm).
// User-specific/auth reads (journal, prefs, favorites sync, community writes) still go DIRECT to Supabase.
//
// Returns the raw PostgREST array `[{data}]` unchanged, so the client parses it exactly like a direct read.
// The anon key + URL are PUBLIC (see config.js — browser-side by design; RLS enforces real security).
const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

// allowlist of proxyable PUBLIC rows → edge TTL (seconds). Nothing else is served.
const ALLOW = {
  scanner_data:    { latest: 120, flat: 150, yesterday: 3600 },
  market_snapshot: { latest: 45, prices: 45, breadth: 300, news: 300, flow: 300 },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const table = String((req.query && req.query.t) || "");
  const id = String((req.query && req.query.id) || "");
  const ttl = ALLOW[table] && ALLOW[table][id];
  if (!ttl) { res.setHeader("Cache-Control", "no-store"); res.status(400).json({ error: "not_allowed", t: table, id: id }); return; }

  try {
    const r = await fetch(SUPA_URL + "/rest/v1/" + table + "?id=eq." + encodeURIComponent(id) + "&select=data", {
      headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY },
    });
    if (!r.ok) {
      const txt = await r.text();
      res.setHeader("Cache-Control", "no-store");   // NEVER cache an upstream error
      res.status(502).json({ error: "upstream_" + r.status, detail: txt.slice(0, 200) });
      return;
    }
    const body = await r.text();   // pass the raw [{data}] array through untouched
    res.setHeader("Content-Type", "application/json");
    // browser always revalidates (max-age=0) but the SHARED edge cache serves cached for `ttl` seconds,
    // so Supabase is hit ~once per ttl across ALL visitors. stale-while-revalidate keeps it snappy on refresh.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=" + ttl + ", stale-while-revalidate=" + (ttl * 6));
    res.status(200).send(body);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "fetch_failed", detail: String((e && e.message) || e) });
  }
}
