-- ============================================================================
-- StratNinja — SCHEDULED LIVES  (planned future broadcasts: site event + YouTube)
-- ============================================================================
-- Review before running. Run once in the Supabase SQL editor. Idempotent — safe
-- to re-run (create-if-not-exists + add-column-if-not-exists + drop-then-create
-- policy), so it can be applied on top of an earlier version with no data loss.
--
-- Purpose:
--   A LIST of upcoming lives Adi plans ahead of time. Each row drives (a) the
--   "🔴 לייב קרוב" banner + countdown on /live, (b) an automatic "⏰ עולה לייב
--   בעוד 30 דק'" phone push (via push_outbox, enqueued by the Hetzner worker),
--   and later (c) a matching scheduled YouTube broadcast (youtube_broadcast_id).
--
-- Security (same model as live_status / push_outbox):
--   * PUBLIC READ — anyone can read (the /live banner is public).
--   * EVERY WRITE is server-side with the service-role key (api/scheduled-lives,
--     which verifies the admin JWT). NO client write policy → the list cannot be
--     spoofed/edited from the browser. pre_push_sent / youtube_* are written only
--     by the server + the Hetzner worker (both service-role).
-- ============================================================================

create table if not exists public.scheduled_lives (
  id                  uuid        primary key default gen_random_uuid(),
  title               text        not null default '',
  description         text        not null default '',
  thumbnail_url       text,
  scheduled_start     timestamptz not null,                     -- when the live is planned to begin
  status              text        not null default 'scheduled', -- scheduled | live | ended | canceled
  youtube_broadcast_id text,                                    -- YouTube liveBroadcast id (Stage 2), nullable
  youtube_watch_url    text,                                    -- https://youtu.be/... convenience link (Stage 2)
  pre_push_sent       boolean     not null default false,       -- the "30 min before" push fired once
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- If the table pre-existed from an earlier revision, make sure every column is present.
alter table public.scheduled_lives add column if not exists youtube_broadcast_id text;
alter table public.scheduled_lives add column if not exists youtube_watch_url    text;
alter table public.scheduled_lives add column if not exists pre_push_sent        boolean not null default false;
alter table public.scheduled_lives add column if not exists updated_at           timestamptz not null default now();

-- fast lookup for the worker (find rows whose 30-min pre-push is due) and the banner (next upcoming).
create index if not exists scheduled_lives_upcoming_idx
  on public.scheduled_lives (status, scheduled_start);

alter table public.scheduled_lives enable row level security;

-- PUBLIC READ — anyone can read upcoming lives (the /live banner). Re-runnable.
drop policy if exists scheduled_lives_read on public.scheduled_lives;
create policy scheduled_lives_read on public.scheduled_lives
  for select using (true);

-- NO insert/update/delete policy on purpose: all writes go through the server with
-- the service-role key (api/scheduled-lives + the Hetzner push worker), bypassing RLS.

-- ============================================================================
-- EXPLICIT PRIVILEGE HARDENING (defense in depth, IN ADDITION to RLS)
-- Table-scoped to public.scheduled_lives ONLY. anon + authenticated: SELECT only.
-- service_role: full write. Idempotent.
-- ============================================================================
revoke all privileges on table public.scheduled_lives from anon, authenticated;
revoke insert, update, delete, truncate on table public.scheduled_lives from anon, authenticated;
grant select on table public.scheduled_lives to anon, authenticated;
grant all privileges on table public.scheduled_lives to service_role;

-- ============================================================================
-- PERMISSION CHECK — verify the effective grants (anon/authenticated = SELECT
-- only; service_role keeps write). Raises on any mismatch, else a NOTICE.
-- ============================================================================
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not has_table_privilege(r, 'public.scheduled_lives', 'SELECT') then
      raise exception 'SECURITY FAIL: % is missing SELECT on scheduled_lives', r;
    end if;
    if has_table_privilege(r, 'public.scheduled_lives', 'INSERT')
       or has_table_privilege(r, 'public.scheduled_lives', 'UPDATE')
       or has_table_privilege(r, 'public.scheduled_lives', 'DELETE') then
      raise exception 'SECURITY FAIL: % has a write privilege on scheduled_lives', r;
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.scheduled_lives', 'INSERT')
     or not has_table_privilege('service_role', 'public.scheduled_lives', 'UPDATE')
     or not has_table_privilege('service_role', 'public.scheduled_lives', 'DELETE') then
    raise exception 'SECURITY FAIL: service_role lost write access to scheduled_lives';
  end if;
  raise notice 'OK: grants verified — anon/authenticated = SELECT only; service_role retains write.';
end $$;
