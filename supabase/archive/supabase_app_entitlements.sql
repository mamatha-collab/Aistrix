-- App entitlements table — tracks which users have paid access to which apps.
-- Rows are created automatically by Stripe webhook handler on successful checkout.
-- Run once in Supabase SQL editor.

create table app_entitlements (
  id                   uuid primary key default gen_random_uuid(),
  app_id               uuid references apps(id) on delete cascade,
  user_id              uuid references auth.users(id),
  plan                 text not null default 'pay_per_run',
  status               text not null default 'active',
  stripe_customer_id   text,
  stripe_sub_id        text,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  runs_this_period     int  not null default 0,
  run_quota            int,
  created_at           timestamptz default now()
);

alter table app_entitlements enable row level security;

-- Developer sees all entitlements for their apps; user sees their own
create policy "owner_or_user" on app_entitlements
  using (
    app_id in (select id from apps where created_by = auth.uid())
    or user_id = auth.uid()
  );
