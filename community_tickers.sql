-- ============================================================================
-- StratNinja · Community Tickers (viewer-suggested scanner stocks)
-- Run ONCE in the Supabase SQL editor (project iujeekdtimlmgwzzlauj).
-- Flow: viewer submits a ticker (pending, unvalidated) → server validates it
-- against the data provider (real, liquid US stock?) → Adi approves in the
-- in-site admin panel → the ticker joins the scanner under the "Community" universe.
-- ============================================================================

create table if not exists public.community_tickers (
  id           bigint generated always as identity primary key,
  ticker       text        not null,
  status       text        not null default 'pending',   -- pending | approved | rejected
  validated    boolean     not null default false,        -- has the server checked it?
  sector       text,                                       -- auto-classified on validation
  reason       text,                                       -- why rejected (if rejected)
  requested_by text,                                        -- submitter email (optional)
  notified     boolean     not null default false,          -- Discord "pending" ping sent?
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- one row per ticker (case-insensitive) — no duplicate submissions
create unique index if not exists community_tickers_ticker_uidx
  on public.community_tickers (upper(ticker));

-- table-level privileges (RLS still gates WHICH rows each role may touch)
grant select, insert on public.community_tickers to anon, authenticated;
grant update, delete on public.community_tickers to authenticated;

alter table public.community_tickers enable row level security;

-- anyone may SUBMIT a pending, unvalidated ticker (cannot self-approve)
drop policy if exists ct_insert_anon on public.community_tickers;
create policy ct_insert_anon on public.community_tickers
  for insert to anon, authenticated
  with check (status = 'pending' and validated = false);

-- admin (Adi) sees everything; the public sees only approved rows
drop policy if exists ct_select on public.community_tickers;
create policy ct_select on public.community_tickers
  for select to anon, authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com'
    or status = 'approved'
  );

-- only admin (Adi) may approve / reject / edit
drop policy if exists ct_update_admin on public.community_tickers;
create policy ct_update_admin on public.community_tickers
  for update to authenticated
  using (coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com')
  with check (coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com');

-- only admin (Adi) may delete
drop policy if exists ct_delete_admin on public.community_tickers;
create policy ct_delete_admin on public.community_tickers
  for delete to authenticated
  using (coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com');
