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
