-- ============================================================================
-- StratNinja — COURSE LESSONS  (the "The Strat" course curriculum)
-- ============================================================================
-- Run once in the Supabase SQL editor. Idempotent & additive — touches ONLY the
-- new `public.course_lessons` table.
--
-- Each row is one lesson: a Cloudflare Stream video (uploaded with
-- requireSignedURLs=true) + its title, module and order. The admin adds rows via
-- api/course-admin.js (or by hand here). The site shows the curriculum to EVERYONE
-- (titles are marketing), but PLAYBACK is gated: api/course-token.js mints a signed
-- URL only after verifying a 'course_the_strat' entitlement AND that the uid is a
-- real published lesson in THIS table (so the endpoint can never sign an arbitrary
-- video). Entitlement itself lives in public.entitlements (scope 'course_the_strat').
--
-- Security: metadata is public (anon/authenticated may SELECT). All writes are
-- service-role only (the admin endpoint uses the service key after an admin check).
-- ============================================================================

create table if not exists public.course_lessons (
  id          bigint generated always as identity primary key,
  video_uid   text        not null unique,             -- Cloudflare Stream video UID (requireSignedURLs=true)
  title       text        not null,                    -- lesson title (Hebrew)
  module      text        not null default '',         -- section/chapter grouping (e.g. 'יסודות'); '' = ungrouped
  sort        integer     not null default 0,          -- display order (ascending; ties broken by id)
  duration    integer     not null default 0,          -- length in seconds (for the curriculum list)
  summary     text,                                    -- optional short blurb under the lesson
  published   boolean     not null default true,       -- hide a draft lesson without deleting it
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_course_lessons_order on public.course_lessons (module, sort, id);

alter table public.course_lessons enable row level security;

-- PUBLIC READ — the curriculum (titles/modules/duration) is visible to everyone.
-- Playback is NOT here; it is gated separately by api/course-token.js.
drop policy if exists course_lessons_read_all on public.course_lessons;
create policy course_lessons_read_all on public.course_lessons
  for select using (true);

-- No insert/update/delete policy: every write is the admin endpoint with the
-- service-role key (bypasses RLS). The browser can never add/edit a lesson.

-- ---------------------------------------------------------------------------
-- EXPLICIT PRIVILEGE HARDENING (defense in depth) — this table only. Idempotent.
--   anon + authenticated: SELECT only.  service_role: full write.
-- ---------------------------------------------------------------------------
revoke all privileges on table public.course_lessons from anon, authenticated;
revoke insert, update, delete, truncate on table public.course_lessons from anon, authenticated;
grant select on table public.course_lessons to anon, authenticated;
grant all privileges on table public.course_lessons to service_role;

do $$
begin
  if not has_table_privilege('anon', 'public.course_lessons', 'SELECT')
     or not has_table_privilege('authenticated', 'public.course_lessons', 'SELECT') then
    raise exception 'SECURITY FAIL: read roles missing SELECT on course_lessons';
  end if;
  if has_table_privilege('anon', 'public.course_lessons', 'INSERT')
     or has_table_privilege('authenticated', 'public.course_lessons', 'INSERT')
     or has_table_privilege('anon', 'public.course_lessons', 'UPDATE')
     or has_table_privilege('authenticated', 'public.course_lessons', 'UPDATE')
     or has_table_privilege('anon', 'public.course_lessons', 'DELETE')
     or has_table_privilege('authenticated', 'public.course_lessons', 'DELETE') then
    raise exception 'SECURITY FAIL: a public role has write on course_lessons';
  end if;
  if not has_table_privilege('service_role', 'public.course_lessons', 'INSERT') then
    raise exception 'SECURITY FAIL: service_role lost write on course_lessons';
  end if;
  raise notice 'OK: course_lessons grants verified — public SELECT only; writes service-role.';
end $$;
