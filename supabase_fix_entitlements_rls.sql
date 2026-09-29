-- Fix: app_entitlements RLS — block direct client writes (payment bypass)
-- Users could previously self-insert status='active' via the anon client.
-- Service-role (backend) bypasses RLS entirely, so all backend writes still work.

-- Remove the single permissive policy
drop policy if exists "owner_or_user" on app_entitlements;

-- Users and app owners can only SELECT
create policy "entitlements_select" on app_entitlements
  for select using (
    user_id = auth.uid()
    or app_id in (select id from apps where created_by = auth.uid())
  );

-- Block all direct writes from anon/authenticated clients
create policy "entitlements_no_insert" on app_entitlements
  for insert with check (false);

create policy "entitlements_no_update" on app_entitlements
  for update using (false);

create policy "entitlements_no_delete" on app_entitlements
  for delete using (false);

-- Performance: composite index for the hot query path
-- (.eq('app_id',...).eq('user_id',...).eq('status','active'))
create index if not exists app_entitlements_app_user_idx
  on app_entitlements(app_id, user_id);

create index if not exists app_entitlements_active_idx
  on app_entitlements(status) where status = 'active';
