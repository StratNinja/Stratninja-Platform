// StratNinja — ENTITLEMENT SYNC.
//   POST (with a user token) → ask Discord "is this user a member of our guild?"
//   and upsert / revoke their 'community' entitlement accordingly. Returns { entitled }.
//
// Flow (all server-side — the browser can NEVER grant itself access):
//   1. verify the Supabase JWT → resolve the Supabase user id + their Discord id.
//   2. GET https://discord.com/api/v10/guilds/{GUILD}/members/{discordId}  (Bot token)
//        200 ⇒ member  → upsert entitlement (scope 'community', source 'discord')
//        404 ⇒ not a member → delete their discord-sourced 'community' entitlement
//        anything else (bad token / rate-limit / outage) ⇒ transient → DO NOT change
//        the stored entitlement (fail safe: never revoke on a flaky Discord call).
//   3. ROLE-READY: if DISCORD_REQUIRED_ROLE_ID is set, also require that role id to be
//      present in member.roles — a one-line gate for the future (tiers / course).
//
// Secrets (Vercel env, server only — NEVER in the browser/logs):
//   SUPABASE_SERVICE_ROLE_KEY   privileged Supabase write (bypasses RLS)
//   DISCORD_BOT_TOKEN           the bot token (needs "Server Members Intent")
//   DISCORD_GUILD_ID            the community guild (server) id
//   DISCORD_REQUIRED_ROLE_ID    (optional) require this role id too — future tiers
//   DISCORD_COURSE_ROLE_ID      (optional) role id(s) that grant the course — comma/space separated
//                               (e.g. the Advanced + Advanced_Founder + Pro tier roles). ANY match unlocks.
// (SUPABASE_URL / SUPABASE_ANON_KEY as in api/live-presence.js.)

const SUPA_URL = process.env.SUPABASE_URL || "https://iujeekdtimlmgwzzlauj.supabase.co";
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1amVla2R0aW1sbWd3enpsYXVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxODg5NTcsImV4cCI6MjA5ODc2NDk1N30.LLF0AJ3rx4Y3NBeLuki6lF6FEPZSWGrTnNsaWWT7ov4";

const BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || "").trim();
const GUILD_ID = (process.env.DISCORD_GUILD_ID || "").trim();
const REQUIRED_ROLE = (process.env.DISCORD_REQUIRED_ROLE_ID || "").trim();  // optional — role gate for community
// one OR MORE role ids that grant the course (comma/space separated) — e.g. Advanced + Advanced_Founder + Pro.
// Having ANY of these roles unlocks course_the_strat. Empty ⇒ nobody auto-granted via Discord (manual grants stand).
const COURSE_ROLES = (process.env.DISCORD_COURSE_ROLE_ID || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const SCOPE = "community";
const COURSE_SCOPE = "course_the_strat";
const DISCORD_TIMEOUT_MS = 6000;

function sb(path, opts) {
  opts = opts || {};
  return fetch(SUPA_URL + "/rest/v1/" + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: SVC, Authorization: "Bearer " + SVC, "Content-Type": "application/json" }, opts.headers || {}),
  }));
}

// Verify the Supabase JWT and return the FULL user object (so we can read identities), or null.
async function getUser(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  if (!auth) return null;
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: auth } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

// Resolve the user's Discord snowflake from their Supabase identity. Discord may be a LINKED identity
// (identities[] with provider 'discord') or the PRIMARY login (user_metadata.provider_id / sub). We also
// fall back to a service-role admin read in case the /auth/v1/user payload omitted identities.
function discordIdFromUser(u) {
  if (!u) return null;
  const ids = Array.isArray(u.identities) ? u.identities : [];
  for (let i = 0; i < ids.length; i++) {
    const it = ids[i];
    if (it && it.provider === "discord") {
      const d = it.identity_data || {};
      const id = d.provider_id || d.sub || it.id;
      if (id) return String(id);
    }
  }
  const md = u.user_metadata || {};
  if ((md.iss && /discord/i.test(md.iss)) || md.provider_id || md.sub) {
    // only trust user_metadata if Discord is actually the provider (avoid using a Google 'sub')
    const appProv = (u.app_metadata && (u.app_metadata.provider || (u.app_metadata.providers || []).join(","))) || "";
    if (/discord/i.test(appProv)) return String(md.provider_id || md.sub);
  }
  return null;
}

// Service-role admin read of the user (the auth admin API is under /auth/v1, NOT /rest/v1, so the
// sb() helper can't be used here). Used only as a fallback when /auth/v1/user omitted identities.
async function discordIdViaAdmin(userId) {
  try {
    const r = await fetch(SUPA_URL + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
      headers: { apikey: SVC, Authorization: "Bearer " + SVC },
    });
    if (!r.ok) return null;
    return discordIdFromUser(await r.json());
  } catch (e) { return null; }
}

// Ask Discord whether discordId is a member of our guild. Returns:
//   { ok:true, member:true, roles:[…] } | { ok:true, member:false } | { ok:false, reason, http? }
// Only the HTTP status / failure type is ever logged — never the bot token.
async function guildMember(discordId) {
  if (!(BOT_TOKEN && GUILD_ID)) return { ok: false, reason: "not_configured" };
  if (!/^\d{5,25}$/.test(discordId)) return { ok: false, reason: "bad_discord_id" };
  const url = "https://discord.com/api/v10/guilds/" + GUILD_ID + "/members/" + discordId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DISCORD_TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { Authorization: "Bot " + BOT_TOKEN }, signal: ctrl.signal });
    if (r.status === 404) return { ok: true, member: false };
    if (!r.ok) {
      console.warn("[entitlement-sync] discord member GET failed " + JSON.stringify({ http: r.status }));
      return { ok: false, reason: "discord_api", http: r.status };
    }
    const m = await r.json().catch(() => null);
    return { ok: true, member: true, roles: (m && Array.isArray(m.roles)) ? m.roles : [] };
  } catch (e) {
    const name = (e && e.name) || "Error";
    console.warn("[entitlement-sync] discord member GET threw " + JSON.stringify({ type: name }));
    return { ok: false, reason: name === "AbortError" ? "timeout" : "fetch_threw" };
  } finally {
    clearTimeout(timer);
  }
}

async function upsertEntitlement(userId, discordId, scope) {
  // upsert on the (user_id, scope) unique constraint; refresh source + discord id, clear any expiry.
  return sb("entitlements?on_conflict=user_id,scope", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, scope: scope, source: "discord", discord_user_id: discordId, expires_at: null }),
  }).then(r => r.ok).catch(() => false);
}
async function revokeDiscordEntitlement(userId, scope) {
  // remove ONLY the discord-sourced row — never a manual admin grant (source='manual').
  return sb("entitlements?user_id=eq." + encodeURIComponent(userId) + "&scope=eq." + scope + "&source=eq.discord", { method: "DELETE" })
    .then(r => r.ok).catch(() => false);
}
// grant or revoke one scope's discord-sourced entitlement for this user.
async function syncScope(userId, discordId, scope, entitled) {
  if (entitled) return upsertEntitlement(userId, discordId, scope);
  return revokeDiscordEntitlement(userId, scope);
}
// does this user have ANY active (non-expired) entitlement for this scope? (reflects manual grants too)
async function hasActiveEntitlement(userId, scope) {
  try {
    const r = await sb("entitlements?user_id=eq." + encodeURIComponent(userId) + "&scope=eq." + scope + "&select=expires_at");
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    const now = Date.now();
    return Array.isArray(rows) && rows.some((row) => !row.expires_at || new Date(row.expires_at).getTime() > now);
  } catch (e) { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  if (!SVC) { res.status(500).json({ error: "missing_service_key" }); return; }
  if (!(BOT_TOKEN && GUILD_ID)) { res.status(500).json({ error: "discord_not_configured" }); return; }

  const u = await getUser(req);
  if (!u || !u.id) { res.status(401).json({ error: "unauthorized" }); return; }

  let discordId = discordIdFromUser(u);
  if (!discordId) discordId = await discordIdViaAdmin(u.id);
  if (!discordId) { res.status(200).json({ ok: true, entitled: false, error: "no_discord_identity" }); return; }

  const gm = await guildMember(discordId);
  if (!gm.ok) {
    // transient / config problem — do NOT touch the stored entitlement (fail safe, never wrongly revoke).
    res.status(502).json({ ok: false, entitled: null, error: gm.reason || "discord_error" });
    return;
  }

  const roles = gm.roles || [];
  // community: guild membership (optionally gated by a required role).
  const entitled = gm.member && (!REQUIRED_ROLE || roles.indexOf(REQUIRED_ROLE) >= 0);
  // course: a member who holds ANY of the configured course roles (Advanced / Pro tiers). If no
  // course role is configured yet, nobody is auto-granted via Discord (manual grants still stand).
  let course = gm.member && COURSE_ROLES.length > 0 && roles.some((r) => COURSE_ROLES.indexOf(r) >= 0);

  await syncScope(u.id, discordId, SCOPE, entitled);
  if (COURSE_ROLES.length) await syncScope(u.id, discordId, COURSE_SCOPE, course);  // only manage the role-sourced course row when role(s) are set
  // reflect a manual/admin grant too, so the UI unlocks even without the Discord role
  if (!course) course = await hasActiveEntitlement(u.id, COURSE_SCOPE);

  res.status(200).json({ ok: true, entitled: entitled, course: course });
}
