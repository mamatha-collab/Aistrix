-- Pay-per-run: each purchase is one run.
--
-- * app_entitlements gets the (app_id, user_id) key the server's upserts rely
--   on (without it every grant failed with "no unique constraint matching").
-- * Runs are reserved before the model is called, atomically, so two runs
--   started together can't both use the last purchased run; a failed run
--   gives its reservation back.
-- * record_purchase records a Stripe payment and grants its runs in one
--   transaction, once per payment (the webhook and the in-app confirmation
--   can both report the same payment).

-- Keep the newest row per buyer and app, then add the key.
delete from public.app_entitlements e
 using public.app_entitlements newer
 where e.app_id = newer.app_id and e.user_id = newer.user_id
   and (e.created_at, e.id) < (newer.created_at, newer.id);
alter table public.app_entitlements
  add constraint app_entitlements_app_user_key unique (app_id, user_id);

-- Earlier pay-per-run purchases had no run limit; they keep one more run.
update public.app_entitlements
   set run_quota = runs_this_period + 1
 where plan = 'pay_per_run' and run_quota is null;

-- Reserve one run. Returns the runs used including this one, or null when
-- none are left (or access isn't active).
create or replace function public.reserve_entitlement_run(p_entitlement_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update app_entitlements
     set runs_this_period = runs_this_period + 1
   where id = p_entitlement_id
     and status = 'active'
     and (run_quota is null or runs_this_period < run_quota)
  returning runs_this_period;
$$;

-- Give back a reserved run when the run failed.
create or replace function public.release_entitlement_run(p_entitlement_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update app_entitlements
     set runs_this_period = greatest(runs_this_period - 1, 0)
   where id = p_entitlement_id
  returning runs_this_period;
$$;

-- Record one Stripe payment (keyed by stripe_payment_ref) and grant
-- p_grant_runs pay-per-run runs to the buyer. Returns the new purchase id,
-- or null when this payment was already recorded (nothing is granted again).
-- An active subscription is never replaced by a pay-per-run grant.
create or replace function public.record_purchase(p_purchase jsonb, p_grant_runs integer default 0)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_app uuid := (p_purchase->>'app_id')::uuid;
  v_buyer uuid := nullif(p_purchase->>'buyer_id', '')::uuid;
  v_workspace uuid := nullif(p_purchase->>'workspace_id', '')::uuid;
begin
  insert into purchases (app_id, buyer_id, dev_id, plan, gross_amount, platform_fee, dev_share,
                         stripe_customer_id, stripe_sub_id, stripe_payment_ref, workspace_id, payout_status)
  values (v_app, v_buyer, nullif(p_purchase->>'dev_id', '')::uuid, p_purchase->>'plan',
          coalesce((p_purchase->>'gross_amount')::numeric, 0), coalesce((p_purchase->>'platform_fee')::numeric, 0),
          coalesce((p_purchase->>'dev_share')::numeric, 0), p_purchase->>'stripe_customer_id',
          p_purchase->>'stripe_sub_id', p_purchase->>'stripe_payment_ref', v_workspace,
          coalesce(p_purchase->>'payout_status', 'pending'))
  on conflict (stripe_payment_ref) where stripe_payment_ref is not null do nothing
  returning id into v_id;

  if v_id is null or coalesce(p_grant_runs, 0) <= 0 or v_buyer is null then
    return v_id;
  end if;

  insert into app_entitlements (app_id, user_id, plan, status, run_quota, runs_this_period, workspace_id)
  values (v_app, v_buyer, 'pay_per_run', 'active', p_grant_runs, 0, v_workspace)
  on conflict (app_id, user_id) do update set
    run_quota = case when app_entitlements.plan = 'pay_per_run' and app_entitlements.status = 'active'
                     then coalesce(app_entitlements.run_quota, app_entitlements.runs_this_period) + p_grant_runs
                     else p_grant_runs end,
    runs_this_period = case when app_entitlements.plan = 'pay_per_run' and app_entitlements.status = 'active'
                            then app_entitlements.runs_this_period else 0 end,
    plan = 'pay_per_run',
    status = 'active',
    current_period_start = null,
    current_period_end = null,
    workspace_id = coalesce(excluded.workspace_id, app_entitlements.workspace_id)
  where not (app_entitlements.plan = 'subscription' and app_entitlements.status = 'active');

  return v_id;
end $$;

revoke all on function public.reserve_entitlement_run(uuid) from public, anon, authenticated;
revoke all on function public.release_entitlement_run(uuid) from public, anon, authenticated;
revoke all on function public.record_purchase(jsonb, integer) from public, anon, authenticated;
grant execute on function public.reserve_entitlement_run(uuid) to service_role;
grant execute on function public.release_entitlement_run(uuid) to service_role;
grant execute on function public.record_purchase(jsonb, integer) to service_role;
