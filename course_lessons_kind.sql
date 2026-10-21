-- ============================================================================
-- StratNinja — add `kind` to course_lessons  (course vs community videos)
-- ============================================================================
-- Run once in the Supabase SQL editor, AFTER course_lessons.sql. Idempotent &
-- additive — touches ONLY the existing public.course_lessons table.
--
-- Why: the recordings page now has THREE tabs — community lives, the gated
-- "The Strat" course, and gated "community videos" (open to any community
-- member). Course + community videos share the SAME table + upload/summary
-- pipeline; `kind` tells them apart and drives the entitlement gate:
--   kind='course'    → playback needs a 'course_the_strat' entitlement
--   kind='community' → playback needs the 'community' entitlement (any guild member)
-- The gate itself lives in api/course-token.js (looks up the row's kind).
--
-- Existing rows default to 'course' so the current course is untouched.
-- ============================================================================

alter table public.course_lessons
  add column if not exists kind text not null default 'course';

-- only allow the two known kinds (idempotent: drop + recreate the constraint)
alter table public.course_lessons drop constraint if exists course_lessons_kind_chk;
alter table public.course_lessons
  add constraint course_lessons_kind_chk check (kind in ('course', 'community'));

-- list queries filter by kind, then order by module/sort — index both
create index if not exists idx_course_lessons_kind_order
  on public.course_lessons (kind, module, sort, id);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'course_lessons' and column_name = 'kind'
  ) then
    raise exception 'FAIL: kind column missing on course_lessons';
  end if;
  raise notice 'OK: course_lessons.kind added (default course); constraint + index in place.';
end $$;
