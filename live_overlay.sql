-- StratNinja — OBS overlay "feature a message": the admin picks which chat messages appear on the
-- stream overlay. Idempotent. Adds one column; the admin sets it via /api/live-mod (action=feature),
-- the overlay (?feed=featured) shows messages featured in the last few seconds, each for ~10s.

alter table live_chat add column if not exists featured_at timestamptz;
create index if not exists idx_live_chat_featured on live_chat (featured_at) where featured_at is not null;

do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'live_chat' and column_name = 'featured_at') then
    raise notice 'OK: live_chat.featured_at ready (overlay feature-a-message).';
  else raise exception 'FAIL: featured_at not added'; end if;
end $$;
