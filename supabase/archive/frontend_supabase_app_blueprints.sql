-- Aistrix Developer Studio: App Blueprints
-- Run this in the Supabase SQL editor, then refresh the app.

create table if not exists public.app_blueprints (
  app_id uuid primary key references public.apps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  blueprint jsonb not null default '{}'::jsonb,
  readiness_score integer not null default 0 check (readiness_score >= 0 and readiness_score <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_blueprints_user_id_idx
  on public.app_blueprints(user_id);

alter table public.app_blueprints enable row level security;

drop policy if exists "Developers can read own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can insert own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can update own app blueprints" on public.app_blueprints;
drop policy if exists "Developers can delete own app blueprints" on public.app_blueprints;

create policy "Developers can read own app blueprints"
  on public.app_blueprints
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can insert own app blueprints"
  on public.app_blueprints
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can update own app blueprints"
  on public.app_blueprints
  for update
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );

create policy "Developers can delete own app blueprints"
  on public.app_blueprints
  for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.apps
      where apps.id = app_blueprints.app_id
        and apps.created_by = auth.uid()
    )
  );
