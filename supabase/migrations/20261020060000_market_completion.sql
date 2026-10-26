-- Atomic listing publication/unlisting: hold the app lock and listing lock
-- while validating the live release and expected listing revision.
create or replace function public.set_market_listing_status(p_app_id uuid, p_live boolean, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.apps; m public.marketplace_listings;
begin
  select * into a from public.apps where id=p_app_id for update;
  if not found then raise exception 'App no longer exists'; end if;
  select * into m from public.marketplace_listings where app_id=p_app_id for update;
  if not found then raise exception 'Save a listing first'; end if;
  if m.updated_at is distinct from p_expected_updated_at then
    raise exception 'Listing changed. Refresh Market and review the latest listing.' using errcode='40001';
  end if;
  if p_live then
    if not a.is_published or a.live_version is null then raise exception 'Publish the app in Deploy first'; end if;
    if nullif(trim(m.title),'') is null or nullif(trim(m.tagline),'') is null or nullif(trim(m.category),'') is null then
      raise exception 'Complete the listing title, tagline and category first';
    end if;
    if a.is_paid and coalesce(a.price_per_run,0)<0.5 then raise exception 'Paid apps require a price of at least $0.50'; end if;
    if coalesce(a.total_runs,0)<1 then raise exception 'Run the app at least once before listing'; end if;
  end if;
  update public.marketplace_listings set status=case when p_live then 'live' else 'draft' end,
    updated_at=clock_timestamp() where id=m.id returning * into m;
  return to_jsonb(m);
end $$;
revoke all on function public.set_market_listing_status(uuid,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.set_market_listing_status(uuid,boolean,timestamptz) to service_role;
-- A revoked former listing creator must not retain editor-only draft access.
drop policy if exists marketplace_listings_editors_read on public.marketplace_listings;
create policy marketplace_listings_editors_read on public.marketplace_listings for select to authenticated
  using (can_edit_app(app_id));
