-- RLS: user_roles — prevent any user from granting themselves admin
-- Without this, anyone can call supabase.from('user_roles').upsert({role:'admin'})
-- The SECURITY DEFINER function breaks the recursion: checking if you're admin
-- can't use auth.uid() inside the same RLS-protected table.

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'admin'
  )
$$;

alter table user_roles enable row level security;

-- Any authenticated user can read their own role (used by roles.js everywhere)
create policy "user_roles_select_own" on user_roles
  for select using (auth.uid() = user_id);

-- Admins can read all roles (needed by AdminPage role management table)
create policy "user_roles_select_admin" on user_roles
  for select using (is_admin());

-- Only admins can grant, modify, or revoke roles
create policy "user_roles_insert_admin" on user_roles
  for insert with check (is_admin());

create policy "user_roles_update_admin" on user_roles
  for update using (is_admin()) with check (is_admin());

create policy "user_roles_delete_admin" on user_roles
  for delete using (is_admin());

-- NOTE: the very first admin must be inserted directly via the Supabase dashboard
-- or SQL editor (service-role bypasses RLS), since no admin exists yet to approve it.
