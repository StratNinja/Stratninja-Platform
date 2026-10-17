-- StratNinja — LIVE thumbnail (background image for the "starting soon" / offline states).
-- Idempotent & safe to re-run. Adds one column + a public Storage bucket the admin can upload to.

-- 1) where the chosen thumbnail URL is stored (read by /api/live → shown behind the countdown)
alter table live_status add column if not exists thumbnail_url text;

-- 2) a PUBLIC storage bucket for the uploaded image (public = anyone can VIEW via the public URL)
insert into storage.buckets (id, name, public)
values ('live-thumbnails', 'live-thumbnails', true)
on conflict (id) do update set public = true;

-- 3) only the admin may upload / replace the thumbnail (reads are public via the bucket).
drop policy if exists "live_thumb_admin_insert" on storage.objects;
create policy "live_thumb_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'live-thumbnails' and (auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');

drop policy if exists "live_thumb_admin_update" on storage.objects;
create policy "live_thumb_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'live-thumbnails' and (auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com')
  with check (bucket_id = 'live-thumbnails' and (auth.jwt() ->> 'email') = 'koriatmanagement@gmail.com');

do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'live_status' and column_name = 'thumbnail_url')
 and exists (select 1 from storage.buckets where id = 'live-thumbnails') then
    raise notice 'OK: live_status.thumbnail_url + public bucket live-thumbnails ready.';
  else
    raise exception 'FAIL: thumbnail setup incomplete';
  end if;
end $$;
