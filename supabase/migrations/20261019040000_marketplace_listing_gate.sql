-- Marketplace listings go live only through the server, which checks the app
-- is published (released through the test gate) and the listing is complete.
-- Before, the browser set status = 'live' itself, and a live listing made
-- even an unpublished app (or someone else's app) publicly readable.

-- Only the app's editors manage its listing.
drop policy if exists marketplace_listings_own on public.marketplace_listings;
drop policy if exists marketplace_listings_editors_read on public.marketplace_listings;
drop policy if exists marketplace_listings_editors_insert on public.marketplace_listings;
drop policy if exists marketplace_listings_editors_update on public.marketplace_listings;
drop policy if exists marketplace_listings_editors_delete on public.marketplace_listings;
create policy marketplace_listings_editors_read on public.marketplace_listings for select to authenticated
  using (user_id = (select auth.uid()) or can_edit_app(app_id));
create policy marketplace_listings_editors_insert on public.marketplace_listings for insert to authenticated
  with check (user_id = (select auth.uid()) and can_edit_app(app_id));
create policy marketplace_listings_editors_update on public.marketplace_listings for update to authenticated
  using (can_edit_app(app_id)) with check (can_edit_app(app_id));
create policy marketplace_listings_editors_delete on public.marketplace_listings for delete to authenticated
  using (can_edit_app(app_id));

-- Browsers may keep a listing as a draft (or take it back to draft); going
-- live, approval and rejection happen on the server (or by staff).
create or replace function public.marketplace_listing_status_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff()
     and new.status not in ('draft', 'submitted')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'Listings go live from Dev Studio → Market once the app is published.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists marketplace_listing_status_guard on public.marketplace_listings;
create trigger marketplace_listing_status_guard before insert or update on public.marketplace_listings
  for each row execute function public.marketplace_listing_status_guard();

-- A live listing no longer makes an unpublished app readable: apps are
-- public only when published.
drop policy if exists apps_select on public.apps;
create policy apps_select on public.apps as permissive for select to anon, authenticated
  using (is_published
         or created_by = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id))
         or is_app_member(id)
         or is_staff());
