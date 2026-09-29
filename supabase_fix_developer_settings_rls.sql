-- Fix: developer_settings RLS — protect GitHub OAuth tokens
-- This table stores GitHub access tokens. If RLS is missing, any
-- authenticated user can read another developer's token directly.
-- Service-role (backend) bypasses RLS, so all backend reads/writes still work.

-- Create table if it doesn't exist
create table if not exists developer_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  github_token text,
  github_login text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table developer_settings enable row level security;

-- Only the owning developer can read their own row
create policy "dev_settings_select_own" on developer_settings
  for select using (auth.uid() = user_id);

-- Block all direct writes — backend uses service-role to store tokens
create policy "dev_settings_no_insert" on developer_settings
  for insert with check (false);

create policy "dev_settings_no_update" on developer_settings
  for update using (false);

create policy "dev_settings_no_delete" on developer_settings
  for delete using (false);
