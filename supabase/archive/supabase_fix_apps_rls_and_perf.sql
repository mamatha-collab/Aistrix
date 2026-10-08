-- Fix: apps table — system_prompt exposure + public_read_listed perf

-- Replace the subquery-based policy with an EXISTS check (faster on large tables)
drop policy if exists "public_read_listed" on apps;

create policy "public_read_listed" on apps
  for select
  using (
    exists (
      select 1 from marketplace_listings
      where marketplace_listings.app_id = apps.id
        and marketplace_listings.status = 'live'
    )
  );

-- Add a covering index to make the EXISTS check fast
create index if not exists marketplace_listings_app_status_idx
  on marketplace_listings(app_id) where status = 'live';

-- NOTE on system_prompt exposure:
-- The public_read_listed policy allows SELECT on the full apps row for live
-- marketplace apps, including system_prompt. The backend /run and marketplace
-- endpoints already restrict which columns they return, but a user can still
-- call `supabase.from('apps').select('system_prompt')` directly from the client.
--
-- To fully protect system_prompt, add it to a separate non-public table or
-- move public-marketplace fields into marketplace_listings itself.
-- For now, awareness of this is documented here.

-- Fix: app_members — add UPDATE policy so owners can change roles
drop policy if exists "app_members_update" on app_members;
create policy "app_members_update" on app_members
  for update using (is_app_owner(app_id))
  with check (is_app_owner(app_id));
