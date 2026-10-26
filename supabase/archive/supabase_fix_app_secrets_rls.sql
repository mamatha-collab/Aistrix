-- Fix: app_secrets RLS — deny all direct client access
-- Secrets are read and written exclusively by the backend via service-role.
-- Service-role bypasses RLS, so the backend is unaffected.
-- Without this, any authenticated user can read all secrets directly.

-- Create table if it doesn't exist (in case it was created manually)
create table if not exists app_secrets (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references apps(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  key             text not null,
  encrypted_value text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(app_id, key)
);

alter table app_secrets enable row level security;

-- Deny everything from client-side — service-role only
create policy "secrets_deny_all_reads" on app_secrets
  for select using (false);

create policy "secrets_deny_all_writes" on app_secrets
  for insert with check (false);

create policy "secrets_deny_all_updates" on app_secrets
  for update using (false);

create policy "secrets_deny_all_deletes" on app_secrets
  for delete using (false);

-- Index for the hot lookup: GET /apps/{id}/secrets (app_id + user_id)
create index if not exists app_secrets_app_user_idx on app_secrets(app_id, user_id);
