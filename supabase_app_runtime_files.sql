-- Production runtime files for Aistrix apps: the app_files registry plus the
-- two private Storage buckets and their access policies.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Object paths used by the app:
--   apps/{app_id}/users/{user_id}/inputs/...    (aistrix-input-files)
--   apps/{app_id}/users/{user_id}/outputs/...   (aistrix-output-files)
-- Users may only touch objects under their own users/{user_id}/ folder.

-- ── Registry table ──────────────────────────────────────────────────────────
create table if not exists app_files (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid not null references apps(id) on delete cascade,
  run_id        uuid,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  file_kind     text not null check (file_kind in ('input', 'output')),
  bucket        text not null check (bucket in ('aistrix-input-files', 'aistrix-output-files')),
  storage_path  text not null,
  file_name     text,
  mime_type     text,
  size_bytes    bigint,
  metadata      jsonb not null default '{}',
  expires_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists app_files_app_id_idx on app_files(app_id);
create index if not exists app_files_owner_id_idx on app_files(owner_id);
create index if not exists app_files_run_id_idx on app_files(run_id);
create index if not exists app_files_expires_at_idx on app_files(expires_at) where expires_at is not null;

alter table app_files enable row level security;

drop policy if exists "app_files_owner_select" on app_files;
create policy "app_files_owner_select" on app_files
  for select using (auth.uid() = owner_id);

drop policy if exists "app_files_owner_insert" on app_files;
create policy "app_files_owner_insert" on app_files
  for insert with check (auth.uid() = owner_id);

drop policy if exists "app_files_owner_delete" on app_files;
create policy "app_files_owner_delete" on app_files
  for delete using (auth.uid() = owner_id);

drop policy if exists "app_files_app_owner_select" on app_files;
create policy "app_files_app_owner_select" on app_files
  for select using (
    exists (
      select 1 from apps
      where apps.id = app_files.app_id
        and apps.created_by = auth.uid()
    )
  );

-- ── Storage buckets (private) ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('aistrix-input-files',  'aistrix-input-files',  false, 10485760),   -- 10 MB
  ('aistrix-output-files', 'aistrix-output-files', false, 52428800)    -- 50 MB
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ── Storage policies: own folder only ───────────────────────────────────────
-- storage.foldername('apps/A/users/U/inputs/x.csv') = {apps,A,users,U,inputs}
drop policy if exists "aistrix_files_insert_own" on storage.objects;
create policy "aistrix_files_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('aistrix-input-files', 'aistrix-output-files')
    and (storage.foldername(name))[1] = 'apps'
    and (storage.foldername(name))[3] = 'users'
    and (storage.foldername(name))[4] = auth.uid()::text
  );

drop policy if exists "aistrix_files_select_own" on storage.objects;
create policy "aistrix_files_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('aistrix-input-files', 'aistrix-output-files')
    and (storage.foldername(name))[4] = auth.uid()::text
  );

drop policy if exists "aistrix_files_delete_own" on storage.objects;
create policy "aistrix_files_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('aistrix-input-files', 'aistrix-output-files')
    and (storage.foldername(name))[4] = auth.uid()::text
  );

-- Downloads for others (e.g. an app owner viewing a user's output) go through
-- the backend's /v1/files/{id}/download-url, which signs a short-lived URL.

-- Optional cleanup query for a cron/Edge Function:
-- select bucket, storage_path from app_files where expires_at < now();
-- After deleting those objects from Storage, delete their rows:
-- delete from app_files where expires_at < now();
