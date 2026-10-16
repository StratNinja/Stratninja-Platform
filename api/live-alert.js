// StratNinja — site-wide "giveaway live" alert state (GET only). Read by the flashing banner on
// EVERY page, so it is edge-cached (s-maxage) → the giveaways row is read ~once per window globally,
// not once per viewer. Uses the PUBLIC anon key (the giveaways row is already publicly readable).
// The admin SETS announce_until via the giveaway admin panel (direct Supabase under admin RLS) — not here.
//
// GET /api/live-alert  → { ok:true, active:bool, until:<iso|null>, title:<string>, href:"/live" }

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.setHeader("Cache-Control", "no-store"); res.status(405).json({ error: "method" }); return; }

  const url = SUPA_URL + "/rest/v1/giveaways?select=announce_until,announce_test,title,status&id=eq.current";
  try {
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
    if (!r.ok) { res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: false, active: false }); return; }
    const rows = await r.json();
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
    const until = row && row.announce_until ? row.announce_until : null;
    const active = !!(until && new Date(until).getTime() > Date.now());
    // short edge cache shared by all viewers; the admin press shows up within a few seconds.
    // `test` means the client only shows it to the admin (rehearsal) — enforced client-side in live_alert.js.
    res.setHeader("Cache-Control", "public, s-maxage=4, stale-while-revalidate=6");
    res.status(200).json({ ok: true, active: active, test: !!(row && row.announce_test), until: until, title: (row && row.title) || "", href: "/live" });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, active: false });
  }
}
