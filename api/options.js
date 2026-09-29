// Serverless proxy for CBOE delayed option quotes (free, ~15-min delayed, no auth).
// The browser can't fetch cdn.cboe.com directly (no CORS), so the journal calls this
// same-origin endpoint instead: GET /api/options?sym=AAPL
// Returns a compact chain: { sym, px, opts:[{o:<OCC contract>, b:bid, a:ask, l:last}] }.
// This keeps option pricing FREE — no Massive/Polygon options entitlement needed.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const sym = String((req.query && req.query.sym) || "").toUpperCase().replace(/[^A-Z.]/g, "").slice(0, 8);
  if (!sym) { res.status(400).json({ error: "sym required" }); return; }

  try {
    const r = await fetch("https://cdn.cboe.com/api/global/delayed_quotes/options/" + encodeURIComponent(sym) + ".json", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    if (!r.ok) { res.status(502).json({ error: "cboe_http_" + r.status, sym }); return; }
    const j = await r.json();
    const data = (j && j.data) || {};
    const opts = (data.options || []).map((o) => ({ o: o.option, b: o.bid, a: o.ask, l: o.last_trade_price }));
    // cache at Vercel's edge so ALL viewers of the same ticker share ONE upstream CBOE hit per window.
    // CBOE quotes are ~15-min delayed, so a 15-min edge cache costs ZERO freshness and caps upstream
    // hits at ~4/hour per ticker no matter how many users/refreshes — the strongest guard against blocks.
    res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
    res.status(200).json({ sym, px: data.current_price != null ? data.current_price : null, ts: data.last_trade_time || null, opts });
  } catch (e) {
    res.status(500).json({ error: "fetch_failed", detail: String(e && e.message || e), sym });
  }
}
