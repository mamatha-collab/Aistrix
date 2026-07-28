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

-- Members can see the membership rows for apps they're a member of (needed so
-- the "who has access" list in ShareModal-equivalent UI can render), plus the
-- app's owner (created_by) can always see and manage them.
create policy "app_members_select" on app_members
  for select using (
    auth.uid() = user_id
    or invited_email = auth.jwt() ->> 'email'
    or app_id in (select id from apps where created_by = auth.uid())
  );

-- Only the app's creator can invite/remove members — matches how apps are
-- currently owned (created_by), not a separate "owner" role on app_members.
create policy "app_members_insert" on app_members
  for insert with check (
    app_id in (select id from apps where created_by = auth.uid())
  );

create policy "app_members_delete" on app_members
  for delete using (
    app_id in (select id from apps where created_by = auth.uid())
  );

-- Additive policies on `apps` — Postgres RLS OR's together every permissive
-- policy for the same command, so these grant access on top of whatever
-- policies already exist without needing to know or touch them.
--
-- 1) Members (any role) can see an app even if it isn't public.
create policy "apps_select_via_membership" on apps
  for select using (
    id in (
      select app_id from app_members
      where user_id = auth.uid() or invited_email = auth.jwt() ->> 'email'
    )
  );

-- 2) Editors (and owners) can update the app's config — e.g. via the same
--    edit flow the creator uses in CreateAppModal.
create policy "apps_update_via_membership" on apps
  for update using (
    id in (
      select app_id from app_members
      where (user_id = auth.uid() or invited_email = auth.jwt() ->> 'email')
        and role in ('editor', 'owner')
    )
  );
