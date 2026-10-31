-- StratNinja — giveaway entry via the LIVE CHAT keyword. Idempotent & safe to re-run.
-- When a user posts the current giveaway's magic word (e.g. "NINJA") in the live chat while the giveaway
-- is OPEN, they are auto-entered into giveaway_entries (source='chat'). Replaces the retired YouTube-chat
-- keyword poller. DB-enforced via a trigger (SECURITY DEFINER, so it can read giveaways + insert entries).

create or replace function live_chat_giveaway_entry() returns trigger
language plpgsql security definer as $$
declare gw_round int; gw_keyword text; gw_status text;
begin
  select round, keyword, status into gw_round, gw_keyword, gw_status from giveaways where id = 'current';
  if gw_status = 'open'
     and gw_keyword is not null and length(btrim(gw_keyword)) > 0
     and lower(btrim(new.msg)) = lower(btrim(gw_keyword)) then
    begin
      insert into giveaway_entries (round, user_key, name, source)
      values (gw_round, new.user_id, coalesce(new.name, 'משתתף'), 'chat')
      on conflict (round, user_key) do nothing;
    exception when others then null;   -- never let an entry error block the chat message
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_live_chat_giveaway on live_chat;
create trigger trg_live_chat_giveaway after insert on live_chat
  for each row execute function live_chat_giveaway_entry();

do $$ begin
  raise notice 'OK: posting the giveaway magic word in the live chat now auto-enters the user (source=chat).';
end $$;
