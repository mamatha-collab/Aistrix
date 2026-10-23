-- Real per-app sharing with roles, mirroring the existing flow_members model.
-- Replaces the placeholder app_access table (AccessControlPanel.jsx used to
-- store the invited person's raw email string as `user_id`, which never
-- actually granted anyone access to anything).
-- Run this in the Supabase SQL editor.

create table if not exists app_members (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references apps(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text,
  role text not null default 'viewer' check (role in ('viewer', 'editor', 'owner')),
  created_at timestamptz not null default now(),
  constraint app_members_has_identity check (user_id is not null or invited_email is not null)
);

create index if not exists app_members_app_id_idx on app_members(app_id);
create index if not exists app_members_user_id_idx on app_members(user_id);
create index if not exists app_members_invited_email_idx on app_members(invited_email);

alter table app_members enable row level security;

-- SECURITY DEFINER helpers so the policies below never need to evaluate the
-- OTHER table's RLS policies while evaluating this one's — apps policies
-- check membership, and app_members policies check app ownership, so a plain
-- subquery in either direction causes Postgres to detect infinite recursion
-- (42P17). These functions run with the privileges of their owner, bypassing
-- RLS internally, which breaks the cycle.
create or replace function is_app_owner(target_app_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from apps where id = target_app_id and created_by = auth.uid()
  );
$$;

create or replace function is_app_member(target_app_id uuid, allowed_roles text[] default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from app_members
    where app_id = target_app_id
      and (user_id = auth.uid() or invited_email = auth.jwt() ->> 'email')
      and (allowed_roles is null or role = any(allowed_roles))
  );
$$;

-- Members can see the membership rows for apps they're a member of (needed so
-- the "who has access" list in ShareModal-equivalent UI can render), plus the
-- app's owner (created_by) can always see and manage them.
drop policy if exists "app_members_select" on app_members;
create policy "app_members_select" on app_members
  for select using (
    auth.uid() = user_id
    or invited_email = auth.jwt() ->> 'email'
    or is_app_owner(app_id)
  );

-- Only the app's creator can invite/remove members — matches how apps are
-- currently owned (created_by), not a separate "owner" role on app_members.
drop policy if exists "app_members_insert" on app_members;
create policy "app_members_insert" on app_members
  for insert with check (is_app_owner(app_id));

drop policy if exists "app_members_delete" on app_members;
create policy "app_members_delete" on app_members
  for delete using (is_app_owner(app_id));

-- Additive policies on `apps` — Postgres RLS OR's together every permissive
-- policy for the same command, so these grant access on top of whatever
-- policies already exist without needing to know or touch them.
--
-- 1) Members (any role) can see an app even if it isn't public.
drop policy if exists "apps_select_via_membership" on apps;
create policy "apps_select_via_membership" on apps
  for select using (is_app_member(id));

-- 2) Editors (and owners) can update the app's config — e.g. via the same
--    edit flow the creator uses in CreateAppModal.
drop policy if exists "apps_update_via_membership" on apps;
create policy "apps_update_via_membership" on apps
  for update using (is_app_member(id, array['editor', 'owner']));
