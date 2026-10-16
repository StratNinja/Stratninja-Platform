-- StratNinja — "giveaway live alert" (📢 הודע לכולם). Idempotent & safe to re-run.
-- Adds ONE column to the existing `giveaways` row. No new tables, no policy changes:
-- the admin already updates this row (via the giveaway admin panel, under the existing RLS),
-- and the row is already publicly readable (the giveaway page reads it for everyone), so the
-- site-wide flashing banner can read `announce_until` with no further grants.
--
-- When the admin presses "📢 הודע לכולם", the app sets announce_until = now()+N minutes.
-- The banner shows while announce_until is in the future; it clears itself when the time passes.

alter table giveaways add column if not exists announce_until timestamptz;
-- announce_test = true → the banner (and later the push) is shown/sent ONLY to the admin, so the
-- admin can rehearse "📢 הודע" without alerting anyone else. "📢 הודע לכולם" sets it false.
alter table giveaways add column if not exists announce_test boolean not null default false;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'giveaways' and column_name = 'announce_until')
 and exists (select 1 from information_schema.columns where table_name = 'giveaways' and column_name = 'announce_test') then
    raise notice 'OK: giveaways.announce_until + announce_test present (giveaway live-alert + test mode ready).';
  else
    raise exception 'FAIL: announce columns were not added';
  end if;
end $$;
