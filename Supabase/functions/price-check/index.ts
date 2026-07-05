// Supabase Edge Function: price-check
// Returns the daily OHLC range for a symbol on a date (via Massive/Polygon).
// The API key stays server-side (function secret MASSIVE_WEB_KEY), never in the browser.
//
// Deploy:  supabase functions deploy price-check --no-verify-jwt
// Secret:  supabase secrets set MASSIVE_WEB_KEY=<your key>
//   (or set both in the Supabase Dashboard → Edge Functions)
//
// Call:    GET {SUPABASE_URL}/functions/v1/price-check?symbol=AAPL&date=2026-06-15

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const symbol = (url.searchParams.get("symbol") || "").toUpperCase().trim();
    const date = (url.searchParams.get("date") || "").trim(); // YYYY-MM-DD
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return json({ error: "missing or invalid symbol/date" }, 400);
    }
    const key = Deno.env.get("MASSIVE_WEB_KEY");
    if (!key) return json({ error: "server not configured" }, 500);

    const api = `https://api.massive.com/v1/open-close/${encodeURIComponent(symbol)}/${date}?adjusted=true&apiKey=${key}`;
    const r = await fetch(api);
    const d = await r.json();
    if (d.status !== "OK" || d.high == null || d.low == null) {
      return json({ found: false }, 200); // no trading data that day (weekend/holiday/unknown)
    }
    return json({
      found: true, symbol, date,
      open: d.open, high: d.high, low: d.low, close: d.close,
    }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
