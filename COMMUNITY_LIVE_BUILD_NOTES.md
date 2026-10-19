# Community Live ("the vault") — build notes

Server-side gated community live for StratNinja. An admin marks a live as **community**
(private); only entitled members (= members of the Discord guild, which Patreon gates) can
watch and chat. Everyone else sees a Hebrew "🔒 private — join the community" screen + a
Patreon link. Enforcement is **server-side**: the closed Cloudflare live input has
`requireSignedURLs=true`, and the stream only plays via a short-lived **signed URL** the
server mints **only** for entitled users. Build is **additive and reversible** — Google
login, public lives, chat, and the journal are untouched.

---

## What Adi must do next (in order)

1. **Run `entitlements.sql`** in the Supabase SQL editor (creates the `entitlements` table +
   RLS + grants; prints `OK: grants verified`).
2. **Re-run `live_status.sql`** in the Supabase SQL editor — it now adds the `visibility`
   column to the existing `live_status` row (idempotent `alter … add column if not exists`,
   safe to re-run). *(Or just run the one line: `alter table public.live_status add column if
   not exists visibility text not null default 'public';`)*
3. **Redeploy Vercel** (so the new `api/*.js` functions and the front-end changes ship).
4. **Confirm the env config**: hit `GET /api/env-check` while logged in as the admin
   (`koriatmanagement@gmail.com`). It returns `{ env:{…}, checks:{ all_required_set,
   pem_decodes_to_key } }` — all five new vars should be `true` and `pem_decodes_to_key: true`.
   Easiest: open the site logged-in as admin, then in the browser console:
   ```js
   (async()=>{const s=await SNAuth.getClient().auth.getSession();const t=s.data.session.access_token;
   console.log(await (await fetch('/api/env-check',{headers:{Authorization:'Bearer '+t}})).json());})()
   ```
5. **Make sure the admin is in the Discord guild** (so the admin themself is "entitled" and
   can preview the community stream) — or add a manual grant (see `entitlements.sql`, bottom).

### How to run a community live
- In OBS, stream to the **CLOSED** input's Stream Key (the one with Require Signed URLs =
  ON) — **not** the public key.
- On `/live` → 🎛️ ניהול → set **נראות השידור = 🔒 קהילה בלבד** → שמור.
- Entitled members see the stream; everyone else sees the locked screen. Switch back to
  **🌐 ציבורי** for a normal public live.

---

## Files created

| File | What it does |
|---|---|
| `entitlements.sql` | New `entitlements` table (user_id, scope, source, discord_user_id, granted_at, expires_at; unique(user_id,scope)). RLS: user reads only own rows; all writes service-role. Mirrors `live_status.sql` hardening + a `has_table_privilege` assertion. Includes a commented manual-grant snippet. |
| `api/entitlement-sync.js` | POST, verifies the Supabase JWT, resolves the user's Discord id (from their Supabase identity, with a service-role admin fallback), calls `GET /guilds/{GUILD}/members/{discordId}` with the bot token. Member → upsert `community` entitlement; 404 → delete their discord-sourced entitlement; transient error → **leaves it unchanged** (fail-safe). Role gate is a one-liner via optional `DISCORD_REQUIRED_ROLE_ID`. Returns `{entitled}`. |
| `api/live-token.js` | POST, verifies JWT → checks an active, non-expired `community` entitlement → mints a short-lived **Cloudflare Stream signed JWT** (RS256, `kid`=`CF_STREAM_KEY_ID`, signed with the base64-decoded `CF_STREAM_KEY_PEM`) and returns the signed iframe/HLS URL. Not entitled → `403 {error:'not_entitled'}`. |
| `api/env-check.js` | GET, admin-only. Returns a **safe** true/false presence map of the required env vars (never a value) + `all_required_set` and `pem_decodes_to_key` sanity booleans. |
| `COMMUNITY_LIVE_BUILD_NOTES.md` | this file. |

## Files changed (all additive)

| File | Change |
|---|---|
| `live_status.sql` | Added an idempotent `alter table … add column if not exists visibility text not null default 'public'` (+ comment). Nothing else touched. |
| `auth.js` | Added `signInWithDiscord()` (Supabase `signInWithOAuth({provider:'discord'})`) and exported it. Google left exactly as-is. |
| `platform.js` | Wires `#discordBtn` → `SNAuth.signInWithDiscord()` and unhides it in cloud mode. |
| `index.html` | Added a hidden "התחבר עם Discord" button (`#discordBtn`) next to the Google button. |
| `landing.css` | Added `.btn.discord` styling (Discord blurple). |
| `api/live.js` | Added `CF_CLOSED_INPUT_ID` support. `cfLiveStatus()`/`activeVideoUid()` now take an input id (default = public, back-compat). Admin POST accepts `visibility` ('public'\|'community'). GET reconcile uses the **closed** input when the row is community. `publicView` exposes `visibility` and, for community lives, returns **no** `playback`/`live_video_uid` (the browser gets nothing playable — only a signed URL via `/api/live-token`). |
| `live.js` | Admin window: a נראות (visibility) selector that saves via the existing POST. `/live` gating: for a **community live**, it does not use the public iframe — it calls `/api/live-token` (with a one-time `/api/entitlement-sync` retry on 403). Entitled → signed player; else → the Hebrew "🔒 private — join the community" screen with a Patreon link + "sign in with Discord" button. Chat + presence are locked to members for community lives ("🔒 הצ׳אט פתוח לחברי הקהילה בלבד"). Public lives behave exactly as before. |

## Env vars (Vercel, server-only)
**New:** `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `CF_CLOSED_INPUT_ID`, `CF_STREAM_KEY_ID`,
`CF_STREAM_KEY_PEM` (base64, as `POST /stream/keys` returns it).
**Optional:** `DISCORD_REQUIRED_ROLE_ID` (future role gate — one-line activation),
`LIVE_TOKEN_TTL_SEC` (signed-URL lifetime, default 7200 = 2h, clamped 60s–24h).
**Existing (reused):** `CF_ACCOUNT_ID`, `CF_CUSTOMER_CODE`, `CF_STREAM_API_TOKEN`,
`CF_PUBLIC_INPUT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Top risks / uncertainties (please review)

1. **⚠️ Cloudflare signed-token `sub` for a LIVE input — the #1 thing to test with a real
   broadcast.** Cloudflare's official "Securing your Stream" example signs `sub: <videoUID>`
   (a specific video), and the "Watch a live stream" doc says live playback *can* use the
   live-input id (which carries the input's own `requireSignedURLs` setting) but does **not**
   document what `sub` to use when signing for a live input. To be safe, `api/live-token.js`
   **prefers the currently-live broadcast's video UID** (resolved from the closed input via the
   CF API) and signs that, playing via the video-UID URL — the documented path. **If** no
   active video can be resolved it falls back to signing the **live-input UID** and the
   input-UID URL. The response includes `"via":"video"|"input"` so you can see which path ran.
   *Action:* do one real end-to-end test — start a community broadcast to the closed input,
   confirm an entitled user plays it and a non-entitled user is blocked by Cloudflare (403 on
   the manifest). If the `input` fallback ever fails to play, we should force the video-UID
   path (it's the documented, reliable one).

2. **Signed-URL TTL vs. live length.** The task suggested "a few minutes", but a token that
   short would cut a live viewer off mid-stream (the player would need to re-mint and reload,
   causing a visible reload). I defaulted to **2 hours** (`LIVE_TOKEN_TTL_SEC`, clamped ≤24h,
   Cloudflare's max). Lower it if you want tighter link-sharing protection, but expect a player
   reload when a token expires mid-live. The front-end mints once per community-live session
   (not every poll).

3. **Chat read is UI-gated, not server-gated, for community lives.** The video is fully
   server-enforced (signed URL). The chat UI is hidden from non-members, and posting already
   requires login (RLS), but the chat *read* endpoint (`/api/live-chat`) still serves non-hidden
   messages to anyone via the anon key (unchanged behaviour). Fully gating chat *reads* by
   entitlement would need a new server endpoint — out of scope here. Community chat also shares
   the same `live_id='public'` channel as public lives (one live at a time), so clear the chat
   (🧹) between a community and a public session if you don't want crossover.

4. **Discord id resolution depends on the Supabase identity shape.** `entitlement-sync.js`
   reads `identities[].identity_data.provider_id|sub` (Discord linked) or
   `user_metadata.provider_id|sub` when Discord is the primary provider (guarded by
   `app_metadata.provider(s)` containing "discord"), with a service-role admin-API fallback.
   A user who only ever logged in with **Google** has no Discord identity → they'll get the
   locked screen with a "sign in with Discord" button (correct). Verify the real payload once:
   the exact field used by your Supabase/GoTrue version for the Discord snowflake.

5. **`Server Members Intent`** must be ON for the bot (Discord dev portal) or
   `GET /guilds/{id}/members/{user}` returns 403/empty. If `/api/entitlement-sync` returns
   `502` with `discord_api`, that's the usual cause (also check the bot is actually in the guild
   and `DISCORD_GUILD_ID` is right).

6. **Admin preview.** The admin isn't special-cased for the vault — they watch through the same
   entitlement gate. As long as the admin account is in the Discord guild (it's their server),
   they're entitled and can preview. Otherwise add a manual grant.

Verified: all changed JS passes `node --check`. Not deployed, not pushed, no git run (per the task).
