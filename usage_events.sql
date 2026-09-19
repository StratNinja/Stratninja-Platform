-- StratNinja — usage analytics events (run ONCE in the Supabase SQL editor)
-- Tracks feature/page usage per logged-in user so the admin can see what's used most
-- and where to improve. RLS: each user inserts ONLY their own rows; only the admin reads all.

create table if not exists public.usage_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ts      timestamptz not null default now(),
  event   text not null,          -- e.g. 'page:scanner', 'click:share_card', 'scan:preset_save'
  page    text,                    -- page/context the event happened on
  meta    jsonb                    -- optional extra detail
);

create index if not exists usage_events_ts_idx    on public.usage_events (ts);
create index if not exists usage_events_event_idx  on public.usage_events (event);
create index if not exists usage_events_user_idx   on public.usage_events (user_id);

alter table public.usage_events enable row level security;

-- authenticated users may INSERT only rows tagged with their own id
drop policy if exists usage_insert_own on public.usage_events;
create policy usage_insert_own on public.usage_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- only the admin (Adi) may READ the full table (for the analytics dashboard)
drop policy if exists usage_admin_select on public.usage_events;
create policy usage_admin_select on public.usage_events
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');

-- optional housekeeping: drop events older than 180 days (keeps the table small).
-- Re-run manually, or wire to pg_cron if available:
-- delete from public.usage_events where ts < now() - interval '180 days';
