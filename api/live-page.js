// StratNinja — server-rendered /live shell with DYNAMIC Open Graph tags, so a shared
// stratninja.win/live link previews the LIVE thumbnail + title (WhatsApp/Discord/X read OG from the
// HTML head and do NOT run JS). It fetches the static SPA shell, swaps the og:/twitter: image/title/
// description/url to the current live_status values, and returns it. Real users still get the full SPA.
// vercel.json routes /live here.

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

const RE_HTTPS_IMG = /^https:\/\/[^\s"'<>]+$/i;
function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function setMeta(html, kind, key, value) {   // replace the content="" of an existing <meta kind="key" ...>
  var re = new RegExp('(<meta ' + kind + '="' + key.replace(/[:]/g, "\\$&") + '" content=")[^"]*(")', "i");
  return html.replace(re, function (m, a, b) { return a + esc(value) + b; });
}

export default async function handler(req, res) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "www.stratninja.win";
  // 1) fetch the static SPA shell (index.html). "/" is static, so there is no loop back to this function.
  let html = "";
  try {
    const r = await fetch("https://" + host + "/", { headers: { "user-agent": "stratninja-og" } });
    if (r.ok) html = await r.text();
  } catch (e) {}
  if (!html || html.indexOf("og:image") < 0) { res.setHeader("Location", "/"); res.status(307).end(); return; }   // fallback to the SPA

  // 2) current live status → dynamic OG values
  let thumb = "", title = "", desc = "";
  try {
    const sr = await fetch(SUPA_URL + "/rest/v1/live_status?select=thumbnail_url,title,description&id=eq.public",
      { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
    if (sr.ok) { const rows = await sr.json(); const row = rows && rows[0]; if (row) { thumb = row.thumbnail_url || ""; title = row.title || ""; desc = row.description || ""; } }
  } catch (e) {}

  const ogTitle = title ? (title + " · StratNinja LIVE 🔴") : "StratNinja — שידור חי 🔴";
  const ogDesc = desc || "צפו בשידור החי של StratNinja — ניתוח שוק וסריקות בזמן אמת.";
  const ogUrl = "https://www.stratninja.win/live";
  html = setMeta(html, "property", "og:title", ogTitle);
  html = setMeta(html, "name", "twitter:title", ogTitle);
  html = setMeta(html, "property", "og:description", ogDesc);
  html = setMeta(html, "name", "twitter:description", ogDesc);
  html = setMeta(html, "property", "og:url", ogUrl);
  if (RE_HTTPS_IMG.test(thumb)) {
    html = setMeta(html, "property", "og:image", thumb);
    html = setMeta(html, "name", "twitter:image", thumb);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");   // refresh the preview quickly after an edit
  res.status(200).send(html);
}
