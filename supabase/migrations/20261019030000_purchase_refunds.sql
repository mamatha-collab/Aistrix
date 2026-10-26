-- Revenue: refunds, disputes and payouts sent later.
-- * refunded_amount / refunded_at: a refund reduces the sale (and the
--   developer's share); a full refund marks the purchase refunded.
-- * stripe_transfer_id: the payout to the developer, so a refund can take
--   back the developer's share of it.
-- * disputed: the buyer's bank opened a chargeback.
alter table public.purchases add column if not exists refunded_amount numeric(10,6) not null default 0;
alter table public.purchases add column if not exists refunded_at timestamptz;
alter table public.purchases add column if not exists stripe_transfer_id text;
alter table public.purchases add column if not exists disputed boolean not null default false;

-- A fully refunded pay-per-run purchase takes back its run if it wasn't used.
create or replace function public.revoke_purchased_run(p_app_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with taken as (
    update app_entitlements
       set run_quota = run_quota - 1
     where app_id = p_app_id and user_id = p_user_id and plan = 'pay_per_run'
       and run_quota is not null and run_quota > runs_this_period
    returning 1
  )
  select exists (select 1 from taken);
$$;
revoke all on function public.revoke_purchased_run(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_purchased_run(uuid, uuid) to service_role;
