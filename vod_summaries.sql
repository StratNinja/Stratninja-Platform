-- ============================================================================
-- StratNinja — VOD SUMMARIES  (auto summary + key-moment chapters per recording)
-- ============================================================================
-- Run once in the Supabase SQL editor. Idempotent & additive — touches ONLY the
-- new `public.vod_summaries` table.
--
-- Filled by the server worker (vod_summary_worker.py on Hetzner): for each ready
-- Cloudflare recording it transcribes (Whisper) + summarises (gpt-4o-mini) and
-- upserts a row keyed by the Cloudflare video UID. The platform reads it to show
-- a Hebrew summary + clickable chapters on the recordings page.
--
-- Security: summaries of PUBLIC recordings are public → anon/authenticated may
-- SELECT. All writes are service-role only (the worker uses the service key).
-- (Community/course VODs will gate reads later via their own scope.)
-- ============================================================================

create table if not exists public.vod_summaries (
  video_uid   text primary key,                         -- Cloudflare Stream video UID
  status      text        not null default 'done',      -- 'done' | 'error' | 'processing'
  summary     text,                                     -- Hebrew summary / TL;DR
  chapters    jsonb       not null default '[]'::jsonb,  -- [{ "t": <seconds int>, "title": "<he>" }]
  lang        text        default 'he',
  model       text,                                     -- which models produced it (diagnostics)
  duration    integer,                                  -- recording length (seconds), for context
  err         text,                                     -- short error note when status='error'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.vod_summaries enable row level security;

-- PUBLIC READ — anyone may read a summary (they belong to public recordings).
drop policy if exists vod_summaries_read_all on public.vod_summaries;
create policy vod_summaries_read_all on public.vod_summaries
  for select using (true);

-- No insert/update/delete policy on purpose: every write is the server worker with
-- the service-role key (bypasses RLS). The browser can never write a summary.

-- ---------------------------------------------------------------------------
-- EXPLICIT PRIVILEGE HARDENING (defense in depth) — this table only. Idempotent.
--   anon + authenticated: SELECT only.  service_role: full write.
-- ---------------------------------------------------------------------------
revoke all privileges on table public.vod_summaries from anon, authenticated;
revoke insert, update, delete, truncate on table public.vod_summaries from anon, authenticated;
grant select on table public.vod_summaries to anon, authenticated;
grant all privileges on table public.vod_summaries to service_role;

do $$
begin
  if not has_table_privilege('anon', 'public.vod_summaries', 'SELECT')
     or not has_table_privilege('authenticated', 'public.vod_summaries', 'SELECT') then
    raise exception 'SECURITY FAIL: read roles missing SELECT on vod_summaries';
  end if;
  if has_table_privilege('anon', 'public.vod_summaries', 'INSERT')
     or has_table_privilege('authenticated', 'public.vod_summaries', 'INSERT')
     or has_table_privilege('anon', 'public.vod_summaries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.vod_summaries', 'UPDATE')
     or has_table_privilege('anon', 'public.vod_summaries', 'DELETE')
     or has_table_privilege('authenticated', 'public.vod_summaries', 'DELETE') then
    raise exception 'SECURITY FAIL: a public role has write on vod_summaries';
  end if;
  if not has_table_privilege('service_role', 'public.vod_summaries', 'INSERT') then
    raise exception 'SECURITY FAIL: service_role lost write on vod_summaries';
  end if;
  raise notice 'OK: vod_summaries grants verified — public SELECT only; writes service-role.';
end $$;
