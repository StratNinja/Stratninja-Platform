-- StratNinja — DVR support: remember the Video ID of the CURRENT live broadcast. Idempotent.
-- The server resolves it from Cloudflare during the reconcile (while live) and the player uses it +
-- dvrEnabled=true so viewers can rewind during the live. Cleared when the broadcast ends.

alter table live_status add column if not exists live_video_uid text;

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'live_status' and column_name = 'live_video_uid') then
    raise notice 'OK: live_status.live_video_uid ready (DVR).';
  else
    raise exception 'FAIL: live_video_uid not added';
  end if;
end $$;
