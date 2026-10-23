-- Manage hardening.
--
-- Revenue: a payout is claimed before any money moves. The server sets
-- payout_status = 'transferring' only if the status and attempt count are
-- still what it read, so two concurrent attempts can never both pay; the
-- attempt number is part of the Stripe idempotency key. A claim left behind by
-- a stopped server is taken over after a few minutes (payout_claimed_at).
alter table public.purchases add column if not exists payout_attempts integer not null default 0;
alter table public.purchases add column if not exists payout_claimed_at timestamptz;
-- Owed payouts are looked up by developer and status.
create index if not exists purchases_dev_payout_status_idx on public.purchases (dev_id, payout_status);

-- Market: a live listing shows in the Marketplace only while its app is
-- published. Unpublishing takes it out at once (and republishing restores
-- it) without anyone editing the listing.
drop policy if exists marketplace_listings_read_live on public.marketplace_listings;
create policy marketplace_listings_read_live on public.marketplace_listings as permissive for select to anon, authenticated
  using (status = 'live'
         and exists (select 1 from public.apps a where a.id = marketplace_listings.app_id and a.is_published));

-- Reviews of an app are public only while it's listed and published.
drop policy if exists app_reviews_select on public.app_reviews;
create policy app_reviews_select on public.app_reviews as permissive for select to anon, authenticated
  using (exists (select 1 from public.marketplace_listings m join public.apps a on a.id = m.app_id
                 where m.app_id = app_reviews.app_id and m.status = 'live' and a.is_published));
