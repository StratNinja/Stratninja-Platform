-- StratNinja — LIVE chat moderation: BAN a user (block from posting). Idempotent & safe to re-run.
-- Deleting a single message already works (admin "hidden" flag via live_engagement.sql). This adds a
-- ban list + enforces it in the insert guard, so a banned user can never post again (DB-enforced).

create table if not exists live_chat_bans (
  user_id   uuid primary key,
  name      text,
  banned_at timestamptz not null default now()
);
alter table live_chat_bans enable row level security;

-- only the admin may ban / unban (the insert-guard trigger reads the table via SECURITY DEFINER).
drop policy if exists live_bans_admin_all on live_chat_bans;
create policy live_bans_admin_all on live_chat_bans
  for all to authenticated
  using      ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');

revoke all on live_chat_bans from anon, authenticated;
grant  select, insert, delete on live_chat_bans to authenticated;   -- gated by the admin policy above
grant  all on live_chat_bans to service_role;

-- extend the chat insert guard: reject BANNED users first, then the existing rate limit.
create or replace function live_chat_rate_limit() returns trigger
language plpgsql security definer as $$
declare last_ts timestamptz; recent int;
begin
  if exists (select 1 from live_chat_bans where user_id = new.user_id) then
    raise exception 'banned: blocked from the chat';
  end if;
  select max(created_at) into last_ts from live_chat where user_id = new.user_id;
  if last_ts is not null and now() - last_ts < interval '2 seconds' then
    raise exception 'rate_limited: slow down';
  end if;
  select count(*) into recent from live_chat where user_id = new.user_id and created_at > now() - interval '60 seconds';
  if recent >= 12 then
    raise exception 'rate_limited: too many messages';
  end if;
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'live_chat_bans') then
    raise notice 'OK: live_chat_bans ready — banned users are blocked from posting; admin can ban + bulk-hide.';
  else
    raise exception 'FAIL: live_chat_bans not created';
  end if;
end $$;
