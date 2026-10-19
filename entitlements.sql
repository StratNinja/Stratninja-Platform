-- ============================================================================
-- StratNinja — ENTITLEMENTS  (who is allowed to watch what — the "vault" gate)
-- ============================================================================
-- Review before running. Run once in the Supabase SQL editor. Idempotent &
-- additive — it touches ONLY the new `public.entitlements` table and never any
-- existing table (live_status / giveaways / live_chat / scanner_data / …).
--
-- Design / security (mirrors live_status.sql's hardening):
--   * This table is the single source of truth for "is this user entitled to X".
--     A row (user_id, scope) that is present AND not expired = entitled.
--   * A user may SELECT **only their own** rows (so the SPA can show "you're a
--     member") — enforced by RLS: user_id = auth.uid().
--   * ALL writes are service-role ONLY (api/entitlement-sync.js with the
--     service-role key, which bypasses RLS). A browser can NEVER insert/update a
--     row → a user cannot grant themselves access. This is what makes the gate
--     real: entitlement can only be written by the server after it has verified
--     Discord guild membership (or by a manual admin grant).
--   * `scope` is a free text tag ('community' now; 'course_the_strat' later) so
--     new tiers need no schema change — exactly the model in VIDEO_HUB_2.0_PLAN.md.
--   * `expires_at` is always re-checked server-side at token-minting time, so a
--     lapsed membership loses access even if the row lingers.
-- ============================================================================

create table if not exists public.entitlements (
  id              bigint generated always as identity primary key,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  scope           text        not null,              -- 'community' | (future) 'course_the_strat' | …
  source          text        not null default 'discord', -- 'discord' | 'manual'
  discord_user_id text,                               -- the Discord snowflake we verified (null for manual grants)
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz,                        -- null = no expiry; otherwise re-checked server-side
  unique (user_id, scope)                             -- one row per (user, scope); sync upserts it
);

-- fast lookup for the token endpoint: "does THIS user have THIS scope?"
create index if not exists idx_entitlements_user_scope on public.entitlements (user_id, scope);

alter table public.entitlements enable row level security;

-- OWN-ROW READ — a logged-in user can read only their OWN entitlements (never anyone else's).
-- `drop ... if exists` first → the whole script is safe to re-run (idempotent, no dup policy).
drop policy if exists entitlements_read_own on public.entitlements;
create policy entitlements_read_own on public.entitlements
  for select using (auth.uid() = user_id);

-- NO insert/update/delete policy on purpose: every write is done server-side with the
-- service-role key (api/entitlement-sync.js), which bypasses RLS. This guarantees a user
-- cannot fabricate their own entitlement from the browser.

-- ============================================================================
-- EXPLICIT PRIVILEGE HARDENING (defense in depth, IN ADDITION to RLS)
-- Table-scoped to public.entitlements ONLY — does not touch any other table.
-- anon: no access.  authenticated: SELECT only (RLS further limits to own rows).
-- service_role: full write.  Idempotent.
-- ============================================================================
-- 1) clear every inherited privilege on THIS table from the public-facing roles
revoke all privileges on table public.entitlements from anon, authenticated;
-- 2) explicitly deny every write (redundant with the blanket revoke above — stated
--    on purpose per the security spec, incl. TRUNCATE)
revoke insert, update, delete, truncate on table public.entitlements from anon, authenticated;
-- 3) grant ONLY read to authenticated (RLS still limits it to the user's own rows).
--    anon gets nothing — entitlements are meaningless for a logged-out visitor.
grant select on table public.entitlements to authenticated;
-- 4) keep full write for service_role (the server writes with the service-role key)
grant all privileges on table public.entitlements to service_role;

-- ============================================================================
-- PERMISSION CHECK — verifies the effective grants with has_table_privilege()
-- (no role switching → safe in PL/pgSQL). Asserts authenticated has SELECT only,
-- anon has NO access, service_role keeps write. Raises on any mismatch, else a
-- NOTICE "OK: grants verified".
-- ============================================================================
do $$
begin
  -- authenticated: SELECT yes; every write no
  if not has_table_privilege('authenticated', 'public.entitlements', 'SELECT') then
    raise exception 'SECURITY FAIL: authenticated is missing SELECT on entitlements';
  end if;
  if has_table_privilege('authenticated', 'public.entitlements', 'INSERT')
     or has_table_privilege('authenticated', 'public.entitlements', 'UPDATE')
     or has_table_privilege('authenticated', 'public.entitlements', 'DELETE') then
    raise exception 'SECURITY FAIL: authenticated has a write privilege on entitlements';
  end if;
  -- anon: no access at all
  if has_table_privilege('anon', 'public.entitlements', 'SELECT')
     or has_table_privilege('anon', 'public.entitlements', 'INSERT')
     or has_table_privilege('anon', 'public.entitlements', 'UPDATE')
     or has_table_privilege('anon', 'public.entitlements', 'DELETE') then
    raise exception 'SECURITY FAIL: anon has access to entitlements';
  end if;
  -- service_role must retain write access
  if not has_table_privilege('service_role', 'public.entitlements', 'INSERT')
     or not has_table_privilege('service_role', 'public.entitlements', 'UPDATE')
     or not has_table_privilege('service_role', 'public.entitlements', 'DELETE') then
    raise exception 'SECURITY FAIL: service_role lost write access to entitlements';
  end if;
  raise notice 'OK: grants verified — authenticated = SELECT own rows only; anon = none; service_role retains write.';
end $$;

-- Optional: eyeball the effective grants:
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'entitlements' order by grantee, privilege_type;

-- ----------------------------------------------------------------------------
-- MANUAL GRANT (admin exception — run by hand if you ever need to grant access
-- to someone who isn't in the Discord guild, e.g. a comp member). Replace the
-- uuid; scope 'community'; no expiry. Service-role (the SQL editor) bypasses RLS.
--   insert into public.entitlements (user_id, scope, source)
--   values ('00000000-0000-0000-0000-000000000000', 'community', 'manual')
--   on conflict (user_id, scope) do update set source = 'manual', expires_at = null;
-- ----------------------------------------------------------------------------
