// StratNinja — list past LIVE recordings (VOD) from Cloudflare Stream. Public + edge-cached.
// Returns the READY recordings of the public live input (the in-progress broadcast is excluded).
// Uses the CF Stream:Read token (server only). Playback is the normal public player by Video ID.
//
//   GET /api/live-vods → { ok, vods:[{ uid, created, duration, name, thumbnail, iframe }] }

const CF_ACCOUNT = (process.env.CF_ACCOUNT_ID || "").trim();
const CF_TOKEN = (process.env.CF_STREAM_API_TOKEN || "").trim();
const CF_INPUT = (process.env.CF_PUBLIC_INPUT_ID || "").trim();
const CF_CODE = (process.env.CF_CUSTOMER_CODE || "").trim();
const RE_CF_CODE = /^[a-z0-9]+$/i;
const CF_TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.setHeader("Cache-Control", "no-store"); res.status(405).json({ error: "method" }); return; }
  if (!CF_ACCOUNT || !CF_TOKEN || !CF_INPUT || !RE_CF_CODE.test(CF_CODE)) {
    res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: false, vods: [] }); return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CF_TIMEOUT_MS);
  try {
    const url = "https://api.cloudflare.com/client/v4/accounts/" + CF_ACCOUNT + "/stream/live_inputs/" + CF_INPUT + "/videos";
    const r = await fetch(url, { headers: { Authorization: "Bearer " + CF_TOKEN }, signal: ctrl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success) {
      console.warn("[vods] CF list failed " + JSON.stringify({ http: r.status, success: j ? !!j.success : null }));
      res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: false, vods: [] }); return;
    }
    const base = "https://customer-" + CF_CODE + ".cloudflarestream.com/";
    const vods = (Array.isArray(j.result) ? j.result : [])
      .filter((v) => v && v.uid && v.status && v.status.state === "ready")   // finished + processed recordings only
      .map((v) => ({
        uid: v.uid,
        created: v.created || v.uploaded || null,
        duration: Math.round(v.duration || 0),
        name: (v.meta && v.meta.name) || "",
        thumbnail: base + v.uid + "/thumbnails/thumbnail.jpg?time=2s",
        iframe: base + v.uid + "/iframe",
      }))
      .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");   // recordings rarely change
    res.status(200).json({ ok: true, vods: vods });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: false, vods: [] });
  } finally {
    clearTimeout(timer);
  }
}
