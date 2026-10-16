-- StratNinja — "giveaway live alert" (📢 הודע לכולם). Idempotent & safe to re-run.
-- Adds ONE column to the existing `giveaways` row. No new tables, no policy changes:
-- the admin already updates this row (via the giveaway admin panel, under the existing RLS),
-- and the row is already publicly readable (the giveaway page reads it for everyone), so the
-- site-wide flashing banner can read `announce_until` with no further grants.
--
-- When the admin presses "📢 הודע לכולם", the app sets announce_until = now()+N minutes.
-- The banner shows while announce_until is in the future; it clears itself when the time passes.

alter table giveaways add column if not exists announce_until timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'giveaways' and column_name = 'announce_until'
  ) then
    raise notice 'OK: giveaways.announce_until is present (giveaway live-alert ready).';
  else
    raise exception 'FAIL: giveaways.announce_until was not added';
  end if;
end $$;
