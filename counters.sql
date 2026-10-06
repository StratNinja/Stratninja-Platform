-- Site-wide counters (ALL visitors, incl. logged-out) — powers the ninja-deal click metric
-- in the admin "מטריצת שימוש" dashboard. Run ONCE in Supabase → SQL Editor.
--
-- Why an RPC: PostgREST can't do "n = n + 1" in a PATCH, so a SECURITY DEFINER function
-- gives an ATOMIC increment that anonymous visitors may call (no race, no table write grant).

create table if not exists public.counters (
  name       text primary key,
  n          bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.counters enable row level security;

-- Anyone may READ the counts (they're not sensitive — just totals shown to the admin).
drop policy if exists "counters readable" on public.counters;
create policy "counters readable" on public.counters for select using (true);
-- NOTE: no INSERT/UPDATE policy on purpose — all writes go through bump_counter() below.

-- Atomic increment, callable by anonymous + logged-in visitors.
create or replace function public.bump_counter(cname text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.counters(name, n, updated_at)
  values (cname, 1, now())
  on conflict (name) do update set n = public.counters.n + 1, updated_at = now();
end;
$$;

grant execute on function public.bump_counter(text) to anon, authenticated;

-- (optional) seed the two ninja rows so they show as 0 before the first click:
insert into public.counters(name, n) values ('ninja_deal_open', 0), ('ninja_code_copy', 0)
on conflict (name) do nothing;
