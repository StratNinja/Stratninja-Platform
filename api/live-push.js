// StratNinja — admin-triggered phone Push ("אני בלייב", giveaway, …). The web only ENQUEUES a request
// into push_outbox (service role); the Hetzner worker (web_feed.py --push-outbox, run every minute by the
// scheduler) sends the actual Web Push to every subscriber via pywebpush + the VAPID private key (which
// lives only on the server). This keeps the push secret off Vercel and reuses the proven push pipeline.
//
// POST /api/live-push  (Authorization: Bearer <admin access token>)
//   { kind:"live" | "giveaway" }  → { ok:true } | { ok:false, cooldown:true, wait } | { ok:false, error }

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";
const ADMIN_EMAIL = "koriatmanagement@gmail.com";
const COOLDOWN_MIN = 10;   // can't fire the same kind again within this window (guards against double-click / spam)

// Server-defined copy (never taken from the client) so a push can't be abused to send arbitrary content.
const MESSAGES = {
  live:     { title: "🔴 StratNinja בלייב עכשיו!", body: "הצטרפו ללייב — ניתוח שוק חי מתחיל עכשיו 🥷", url: "/live" },
  giveaway: { title: "🎁 הגרלה בלייב — StratNinja", body: "הגרלה מתחילה עכשיו בלייב! הצטרפו כדי להשתתף 🎁", url: "/live" },
};

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}
async function adminUser(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return null;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return (((u && u.email) || "").toLowerCase() === ADMIN_EMAIL) ? u : null;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  const admin = await adminUser(req);
  if (!admin) { res.status(403).json({ error: "forbidden" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const kind = body.kind === "giveaway" ? "giveaway" : "live";
  const test = body.test === true;             // self-test: send ONLY to the admin, no cooldown, doesn't block real sends
  const msg = MESSAGES[kind];

  try {
    if (!test) {
      // cooldown — reject if a real (non-test) broadcast of this kind was enqueued within the window
      const since = new Date(Date.now() - COOLDOWN_MIN * 60000).toISOString();
      const r0 = await sb("push_outbox?select=created_at&kind=eq." + kind +
        "&only_user=is.null&created_at=gte." + encodeURIComponent(since) + "&order=created_at.desc&limit=1");
      if (r0.ok) {
        const rows = await r0.json();
        if (Array.isArray(rows) && rows.length) {
          const ageMs = Date.now() - new Date(rows[0].created_at).getTime();
          const wait = Math.max(1, Math.ceil((COOLDOWN_MIN * 60000 - ageMs) / 60000));
          res.status(200).json({ ok: false, cooldown: true, wait });
          return;
        }
      }
    }
    const row = { kind, title: msg.title, body: msg.body, url: msg.url, status: "pending" };
    if (test) row.only_user = admin.id;        // the admin's own user id → worker sends only to them
    const ins = await sb("push_outbox", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    res.status(ins.ok ? 200 : 502).json(ins.ok ? { ok: true, kind, test } : { ok: false, error: "enqueue_failed" });
  } catch (e) {
    res.status(502).json({ ok: false, error: "server" });
  }
}
