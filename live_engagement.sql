-- StratNinja — LIVE engagement: live CHAT + PRESENCE (waiting / viewer count).
-- Idempotent & safe to re-run. Creates NEW tables only — does NOT touch
-- giveaways / giveaway_entries / scanner_data / market_snapshot / live_status.
--
-- Security model (enforced in the DATABASE, not the UI):
--   • Chat READ   : anyone (anon + logged-in) sees non-hidden messages.
--   • Chat POST   : only a LOGGED-IN user, and only as THEMSELVES (user_id = auth.uid()).
--                   Server-side rate limit (trigger) + length check — cannot be bypassed from the client.
--   • Chat HIDE   : only the admin (koriatmanagement@gmail.com) may hide/unhide.
--   • Presence    : a logged-in user upserts ONLY their own heartbeat. Nobody can read the rows;
--                   the live count comes from a SECURITY DEFINER function that returns just an integer.
-- No service-role key is needed for the normal flow → this works on Preview too (anon key + user session).

-- =========================================================================
-- CHAT
-- =========================================================================
create table if not exists live_chat (
  id          bigint generated always as identity primary key,
  live_id     text        not null default 'public',
  user_id     uuid        not null,                  -- auth.uid() of the poster (RLS-enforced)
  name        text        not null,                  -- display name (client-sanitized; capped below)
  msg         text        not null,
  hidden      boolean     not null default false,    -- admin soft-delete
  created_at  timestamptz not null default now()
);
create index if not exists idx_live_chat_feed on live_chat (live_id, id);
create index if not exists idx_live_chat_rate on live_chat (user_id, created_at);

-- length guards (bypass-proof — enforced on every insert). NOT VALID = don't fail any existing rows.
do $$ begin
  alter table live_chat add constraint live_chat_msg_len  check (char_length(msg)  between 1 and 280) not valid;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table live_chat add constraint live_chat_name_len check (char_length(name) between 1 and 40)  not valid;
exception when duplicate_object then null; end $$;

-- server-side rate limit: reject a 2nd message within 2s, or more than 12 in any 60s window, per user.
create or replace function live_chat_rate_limit() returns trigger
language plpgsql security definer as $$
declare last_ts timestamptz; recent int;
begin
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
drop trigger if exists trg_live_chat_rate on live_chat;
create trigger trg_live_chat_rate before insert on live_chat
  for each row execute function live_chat_rate_limit();

alter table live_chat enable row level security;

drop policy if exists live_chat_read on live_chat;
create policy live_chat_read on live_chat
  for select to anon, authenticated using (hidden = false);

drop policy if exists live_chat_insert on live_chat;
create policy live_chat_insert on live_chat
  for insert to authenticated with check (user_id = auth.uid());

-- only the admin may UPDATE (used to hide/unhide). Column grant below limits it to the `hidden` column.
drop policy if exists live_chat_admin_update on live_chat;
create policy live_chat_admin_update on live_chat
  for update to authenticated
  using      ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');

-- =========================================================================
-- PRESENCE (waiting / viewer count)
-- =========================================================================
create table if not exists live_presence (
  user_id    uuid        not null,
  live_id    text        not null default 'public',
  last_seen  timestamptz not null default now(),
  primary key (user_id, live_id)
);
create index if not exists idx_live_presence_active on live_presence (live_id, last_seen);

alter table live_presence enable row level security;

drop policy if exists live_presence_ins on live_presence;
create policy live_presence_ins on live_presence
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists live_presence_upd on live_presence;
create policy live_presence_upd on live_presence
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- (no SELECT policy → presence rows are never readable; the count comes from the function below)

-- live count = heartbeats seen in the last 30s. SECURITY DEFINER so anyone can read just the NUMBER
-- without being able to read who is present. Callable by anon + authenticated.
create or replace function live_active_count(p_live text default 'public') returns int
language sql security definer stable as $$
  select count(*)::int from live_presence
   where live_id = p_live and last_seen > now() - interval '30 seconds';
$$;

-- =========================================================================
-- GRANTS (defense in depth, on top of RLS)
-- =========================================================================
revoke all on live_chat     from anon, authenticated;
grant  select            on live_chat to anon;
grant  select, insert    on live_chat to authenticated;
grant  update (hidden)    on live_chat to authenticated;   -- limited to `hidden`; gated by the admin policy
grant  all               on live_chat to service_role;

revoke all on live_presence from anon, authenticated;
grant  insert, update     on live_presence to authenticated;
grant  all               on live_presence to service_role;

revoke all on function live_active_count(text) from public;
grant  execute on function live_active_count(text) to anon, authenticated;

-- =========================================================================
-- PERMISSION VERIFICATION (prints NOTICEs; raises if a grant is wrong)
-- =========================================================================
do $$
begin
  -- anon: may read chat, must NOT write chat or presence
  if not has_table_privilege('anon', 'live_chat', 'SELECT')      then raise exception 'FAIL: anon should SELECT live_chat'; end if;
  if     has_table_privilege('anon', 'live_chat', 'INSERT')      then raise exception 'FAIL: anon must NOT INSERT live_chat'; end if;
  if     has_table_privilege('anon', 'live_presence', 'INSERT')  then raise exception 'FAIL: anon must NOT INSERT live_presence'; end if;
  -- authenticated: may insert chat + presence, must NOT delete
  if not has_table_privilege('authenticated', 'live_chat', 'INSERT')     then raise exception 'FAIL: authenticated should INSERT live_chat'; end if;
  if not has_table_privilege('authenticated', 'live_presence', 'INSERT') then raise exception 'FAIL: authenticated should INSERT live_presence'; end if;
  if     has_table_privilege('authenticated', 'live_chat', 'DELETE')     then raise exception 'FAIL: authenticated must NOT DELETE live_chat'; end if;
  -- service_role keeps full write
  if not has_table_privilege('service_role', 'live_chat', 'UPDATE')      then raise exception 'FAIL: service_role should write live_chat'; end if;
  raise notice 'OK: live_engagement grants verified (anon=read-only chat; authenticated=insert chat+presence; admin-hide via policy).';
end $$;
