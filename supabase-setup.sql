-- StratNinja Platform — Supabase schema
-- Run in Supabase → SQL Editor. RLS ensures each user only touches their own row.

-- 1) JOURNAL (already created earlier) -----------------------------------
create table if not exists public.user_journal (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"fills":[],"manual":[]}',
  updated_at timestamptz not null default now()
);
alter table public.user_journal enable row level security;
do $$ begin
  create policy "own journal select" on public.user_journal for select using (auth.uid() = user_id);
  create policy "own journal insert" on public.user_journal for insert with check (auth.uid() = user_id);
  create policy "own journal update" on public.user_journal for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 2) PREFERENCES — favorites + alerts (NEW, run this) --------------------
create table if not exists public.user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"favorites":[],"alerts":[]}',
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
do $$ begin
  create policy "own prefs select" on public.user_prefs for select using (auth.uid() = user_id);
  create policy "own prefs insert" on public.user_prefs for insert with check (auth.uid() = user_id);
  create policy "own prefs update" on public.user_prefs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- 3) MARKET SNAPSHOT — public live data pushed by web_feed.py (server) --------
-- Public READ (anyone can view market data); WRITES only via the service key
-- (which bypasses RLS), so no insert/update policy is granted to anon.
create table if not exists public.market_snapshot (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.market_snapshot enable row level security;
do $$ begin
  create policy "public read market" on public.market_snapshot for select using (true);
exception when duplicate_object then null; end $$;

-- 4) SCANNER DATA — per-ticker multi-TF candles + FTFC (server-fed) ----------
create table if not exists public.scanner_data (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.scanner_data enable row level security;
do $$ begin
  create policy "public read scanner" on public.scanner_data for select using (true);
exception when duplicate_object then null; end $$;
