-- ============================================================================
-- StratNinja · Shared Presets (short links for sharing scanner presets)
-- Run ONCE in the Supabase SQL editor (project iujeekdtimlmgwzzlauj).
-- Flow: a user clicks "🔗 שתף" on a saved preset → the preset (name + config)
-- is stored here under a short random code → the share link becomes
-- stratninja.win/?s=<code> → anyone who opens it can add the preset.
-- The links are PUBLIC by design (meant to be shared with the community).
-- ============================================================================

-- NOTE: no email/owner column on purpose — the SELECT policy is public (anyone
-- with the link must be able to read it), so storing emails here would expose them.
create table if not exists public.shared_presets (
  code         text        primary key,           -- short random code (e.g. "ab3kq9")
  name         text        not null,              -- preset display name (shown on import)
  cfg          jsonb       not null,              -- minified scan config (applyScanConfig re-fills defaults)
  created_at   timestamptz not null default now()
);

-- table-level privileges (RLS still gates WHICH rows each role may touch)
grant select, insert on public.shared_presets to anon, authenticated;
grant update, delete on public.shared_presets to authenticated;

alter table public.shared_presets enable row level security;

-- anyone may CREATE a share link (name + cfg required)
drop policy if exists sp_insert_anon on public.shared_presets;
create policy sp_insert_anon on public.shared_presets
  for insert to anon, authenticated
  with check (length(coalesce(name, '')) between 1 and 120 and cfg is not null);

-- anyone may READ a shared preset (needed to resolve the ?s=<code> link)
drop policy if exists sp_select on public.shared_presets;
create policy sp_select on public.shared_presets
  for select to anon, authenticated
  using (true);

-- only admin (Adi) may edit / delete shared presets
drop policy if exists sp_update_admin on public.shared_presets;
create policy sp_update_admin on public.shared_presets
  for update to authenticated
  using (coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com')
  with check (coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com');

drop policy if exists sp_delete_admin on public.shared_presets;
create policy sp_delete_admin on public.shared_presets
  for delete to authenticated
  using (coalesce(auth.jwt() ->> 'email', '') = 'koriatmanagement@gmail.com');
