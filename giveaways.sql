-- StratNinja — Giveaways ("הגרלות") schema.
-- Run this ONCE in the Supabase SQL editor (project iujeekdtimlmgwzzlauj).
-- Safe to re-run (idempotent).

-- ========== tables ==========
-- Single-row config/state for the ACTIVE giveaway (id = 'current').
create table if not exists public.giveaways (
  id         text primary key default 'current',
  status     text not null default 'idle',            -- idle | open | closed | drawing | done
  round      bigint not null default 0,               -- bumps each "open"; entries are filtered by it
  title      text not null default 'הגרלת StratNinja',
  keyword    text not null default 'אני בפנים',        -- the YouTube-chat trigger word (stage 2)
  prizes     jsonb not null default '[]'::jsonb,       -- [{id,emoji,label,weight}]
  winner     jsonb,                                    -- {name,user_key,prize:{emoji,label}}
  draw_until timestamptz,                              -- when the 30s spinner ends (all clients sync to it)
  yt_video_id     text,                                -- stage 2 (chat poller)
  yt_live_chat_id text,
  yt_page_token   text,
  opened_at  timestamptz,
  closed_at  timestamptz,
  updated_at timestamptz not null default now()
);

-- One row per entrant per round.
create table if not exists public.giveaway_entries (
  id         bigserial primary key,
  round      bigint not null default 0,
  source     text not null default 'site',            -- site | youtube
  user_key   text not null,                            -- site: supabase uid ; youtube: channel id
  name       text not null,                            -- display name
  created_at timestamptz not null default now(),
  unique (round, user_key)
);
create index if not exists giveaway_entries_round_idx on public.giveaway_entries(round);

-- ========== seed the single config row ==========
insert into public.giveaways (id, status, round, prizes)
values ('current', 'idle', 0,
  '[{"id":"adv1","emoji":"🥈","label":"מסלול Advanced — חודש מתנה","weight":3},
    {"id":"pro1","emoji":"🥇","label":"מסלול PRO — חודש מתנה","weight":2},
    {"id":"call","emoji":"🎯","label":"שיחת ניתוח אישית (30 דקות)","weight":1}]'::jsonb)
on conflict (id) do nothing;

-- ========== row-level security ==========
alter table public.giveaways        enable row level security;
alter table public.giveaway_entries enable row level security;

-- everyone (even logged-out) can READ the giveaway state + the live entrant list
drop policy if exists "giveaway readable" on public.giveaways;
create policy "giveaway readable" on public.giveaways for select using (true);

drop policy if exists "entries readable" on public.giveaway_entries;
create policy "entries readable" on public.giveaway_entries for select using (true);

-- a logged-in user may add ONLY their own site entry (dedup enforced by the unique index)
drop policy if exists "entries insert self" on public.giveaway_entries;
create policy "entries insert self" on public.giveaway_entries for insert
  to authenticated with check (source = 'site' and user_key = auth.uid()::text);

-- the admin (Adi) controls everything from the browser: open/close/draw + manage entries
drop policy if exists "giveaway admin write" on public.giveaways;
create policy "giveaway admin write" on public.giveaways for all
  to authenticated
  using      ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');

drop policy if exists "entries admin all" on public.giveaway_entries;
create policy "entries admin all" on public.giveaway_entries for all
  to authenticated
  using      ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');
