-- ============================================================================
-- StratNinja — PUBLIC LIVE status  (single-row state machine, like `giveaways`)
-- ============================================================================
-- Review before running. Run once in the Supabase SQL editor.
--
-- Design / security:
--   * `is_live` reflects the REAL Cloudflare stream state and is written ONLY by
--     the server (Cloudflare webhook + a throttled CF-API reconcile) using the
--     service-role key, which bypasses RLS. Clients can NEVER set it → the LIVE
--     badge cannot be faked (requirement #6).
--   * Admin edits (title / description / mode / schedule) also go through the
--     server (api/live POST, admin JWT verified server-side), so NO client write
--     policy is needed: RLS = public READ only; every write is service-role.
--   * `id` is a PK so a future 'community' row can live in the same table without
--     any schema change (COMMUNITY LIVE is NOT built yet).
-- ============================================================================

create table if not exists public.live_status (
  id            text primary key,                 -- 'public'  (future: 'community')
  is_live       boolean     not null default false,-- REAL state — server/webhook only
  mode          text        not null default 'auto', -- 'auto' | 'offline' | 'soon'
  title         text        default '',
  description   text        default '',
  scheduled_at  timestamptz,                       -- optional "starting soon" time
  started_at    timestamptz,                       -- when it last went live
  cf_status     text        default '',            -- last Cloudflare API status (debug)
  last_event_ts bigint      not null default 0,    -- ts of last applied webhook event (dedup/order)
  verified_at   timestamptz,                       -- last server-side CF reconcile (throttle)
  platforms     jsonb       not null default '[]'::jsonb, -- [{name,url}] "also watch on"
  updated_at    timestamptz not null default now()
);

-- seed the single public row (id = 'public')
insert into public.live_status (id) values ('public')
  on conflict (id) do nothing;

-- COMMUNITY LIVE (the "vault"): visibility of the CURRENT broadcast. 'public' = the normal public
-- stream; 'community' = gated — the browser gets NO playable URL from /api/live, only a short-lived
-- signed URL from /api/live-token after the server verifies a 'community' entitlement. Added as an
-- idempotent ALTER so this file stays safe to re-run on the existing production row.
alter table public.live_status add column if not exists visibility text not null default 'public';

alter table public.live_status enable row level security;

-- PUBLIC READ — anyone can read the live status (needed for the /live page).
-- `drop ... if exists` first → the whole script is safe to re-run (idempotent, no dup policy).
drop policy if exists live_status_read on public.live_status;
create policy live_status_read on public.live_status
  for select using (true);

-- NO insert/update/delete policy on purpose: all writes are done server-side with
-- the service-role key (api/live + api/live-webhook), which bypasses RLS. This is
-- what guarantees the LIVE state is real and unspoofable from the browser.

-- ============================================================================
-- EXPLICIT PRIVILEGE HARDENING (defense in depth, IN ADDITION to RLS)
-- Table-scoped to public.live_status ONLY — does not touch any other table.
-- anon + authenticated: SELECT only.  service_role: full write.  Idempotent.
-- ============================================================================
-- 1) clear every inherited privilege on THIS table from the public-facing roles
revoke all privileges on table public.live_status from anon, authenticated;
-- 2) explicitly deny every write (redundant with the blanket revoke above — stated
--    on purpose per the security spec, incl. TRUNCATE)
revoke insert, update, delete, truncate on table public.live_status from anon, authenticated;
-- 3) grant ONLY read to the public-facing roles
grant select on table public.live_status to anon, authenticated;
-- 4) keep full write for service_role (the server writes with the service-role key)
grant all privileges on table public.live_status to service_role;

-- ============================================================================
-- PERMISSION CHECK — verifies the effective grants with has_table_privilege()
-- (no role switching → safe in PL/pgSQL). Asserts anon + authenticated have
-- SELECT only, service_role keeps write. Raises an exception on any mismatch,
-- else a NOTICE "OK: grants verified".
-- ============================================================================
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not has_table_privilege(r, 'public.live_status', 'SELECT') then
      raise exception 'SECURITY FAIL: % is missing SELECT on live_status', r;
    end if;
    if has_table_privilege(r, 'public.live_status', 'INSERT') then
      raise exception 'SECURITY FAIL: % has INSERT on live_status', r;
    end if;
    if has_table_privilege(r, 'public.live_status', 'UPDATE') then
      raise exception 'SECURITY FAIL: % has UPDATE on live_status', r;
    end if;
    if has_table_privilege(r, 'public.live_status', 'DELETE') then
      raise exception 'SECURITY FAIL: % has DELETE on live_status', r;
    end if;
  end loop;
  -- service_role must retain write access
  if not has_table_privilege('service_role', 'public.live_status', 'INSERT')
     or not has_table_privilege('service_role', 'public.live_status', 'UPDATE')
     or not has_table_privilege('service_role', 'public.live_status', 'DELETE') then
    raise exception 'SECURITY FAIL: service_role lost write access to live_status';
  end if;
  raise notice 'OK: grants verified — anon/authenticated = SELECT only; service_role retains write.';
end $$;

-- Optional: list the effective grants to eyeball them (anon/authenticated = SELECT only):
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'live_status' order by grantee, privilege_type;
