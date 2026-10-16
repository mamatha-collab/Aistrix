-- One purchases row per real Stripe payment (payment intent or invoice id).
-- Stripe delivers webhooks more than once and several events describe the
-- same payment; the unique key makes recording (and the developer payout
-- that follows it) happen once.
alter table public.purchases add column if not exists stripe_payment_ref text;
create unique index if not exists purchases_stripe_payment_ref_key
  on public.purchases (stripe_payment_ref) where stripe_payment_ref is not null;
