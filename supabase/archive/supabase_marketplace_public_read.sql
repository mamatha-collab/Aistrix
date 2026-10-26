-- Allow anyone (including unauthenticated users) to read live marketplace listings.
-- Run once in Supabase SQL editor.

-- Public read policy for live listings
create policy "public_read_live" on marketplace_listings
  for select
  using (status = 'live');

-- Also allow joining apps table for listing detail pages.
-- The apps table already has its own RLS; to let marketplace pages read
-- the system_prompt of listed apps without auth, add a read policy:
create policy "public_read_listed" on apps
  for select
  using (
    id in (
      select app_id from marketplace_listings where status = 'live'
    )
  );
