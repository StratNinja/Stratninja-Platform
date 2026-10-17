-- StratNinja — enable Supabase Realtime for the live chat.
-- Lets the overlay + chat dock receive INSERT/UPDATE events INSTANTLY (featured on/off,
-- new messages, deletes) over a websocket, instead of waiting for the next poll.
-- Idempotent: safe to run more than once. Anon RLS still applies (realtime only delivers
-- rows the subscriber may SELECT — i.e. non-hidden rows), so no data is exposed.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_chat'
  ) then
    alter publication supabase_realtime add table public.live_chat;
  end if;
end $$;
