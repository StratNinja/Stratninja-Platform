-- StratNinja — outbox for admin-triggered phone Push ("אני בלייב", giveaway, …).
-- The web only ENQUEUES a row here (service role, via /api/live-push). The Hetzner worker
-- (web_feed.py --push-outbox, run every minute by the scheduler) reads pending rows and sends the
-- actual Web Push to every subscriber via pywebpush + the VAPID private key (which lives ONLY on the
-- server). This keeps the push secret off Vercel and reuses the proven push pipeline.
-- Idempotent: safe to run more than once.

create table if not exists public.push_outbox (
  id          bigint generated always as identity primary key,
  kind        text        not null default 'live',
  title       text        not null,
  body        text        not null,
  url         text        not null default '/live',
  status      text        not null default 'pending',   -- pending → sent
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_count  integer,
  only_user   uuid                                       -- set → self-test: send ONLY to this user (the admin)
);
-- if the table already existed from an earlier run, add the self-test column
alter table public.push_outbox add column if not exists only_user uuid;

-- fast lookup of what still needs sending
create index if not exists push_outbox_pending_idx on public.push_outbox (status, id) where status = 'pending';

-- Lock it down: only the service role (which bypasses RLS) may read/write. With RLS enabled and NO
-- policies, anon and logged-in users get nothing — the queue is server-only.
alter table public.push_outbox enable row level security;
