-- Spending limits and private-only workflows. Additive: existing rows keep
-- working; no limit applies until someone sets one.
--
-- Every model run reserves its worst-case cost before the provider is called
-- and settles to the reported usage afterwards. Reservations, settlement and
-- cap checks happen in one locked transaction per scope, so concurrent runs and
-- retries can't overspend a cap. A run whose outcome is unknown (crash,
-- timeout before usage was reported) stays counted at its reservation.

alter table public.flows add column if not exists privacy text not null default 'standard';
alter table public.flows drop constraint if exists flows_privacy_check;
alter table public.flows add constraint flows_privacy_check check (privacy in ('standard', 'private_only'));

create table if not exists public.spend_caps (
  scope text not null check (scope in ('key', 'workspace')),
  scope_id uuid not null,
  period text not null default 'month' check (period in ('day', 'month')),
  limit_usd numeric(12, 4) not null check (limit_usd >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (scope, scope_id)
);

create table if not exists public.spend_reservations (
  id uuid primary key,
  key_owner uuid,                       -- whose AI key pays; null: the platform's
  workspace_id uuid,
  payer text not null check (payer in ('platform', 'own', 'developer', 'owner')),
  app_id uuid,
  model text,
  reserved_usd numeric(14, 6),          -- worst-case estimate; null: price unknown
  actual_usd numeric(14, 6),            -- from the provider's reported usage
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'uncertain')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  expires_at timestamptz not null
);
create index if not exists spend_reservations_key on public.spend_reservations(key_owner, created_at) where key_owner is not null;
create index if not exists spend_reservations_workspace on public.spend_reservations(workspace_id, created_at) where workspace_id is not null;
create index if not exists spend_reservations_platform on public.spend_reservations(created_at) where payer = 'platform';
create index if not exists spend_reservations_open on public.spend_reservations(expires_at) where status = 'reserved';

-- Server only: browsers read their usage through the API.
alter table public.spend_caps enable row level security;
alter table public.spend_reservations enable row level security;
revoke all on public.spend_caps from public, anon, authenticated;
revoke all on public.spend_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.spend_caps to service_role;
grant select, insert, update on public.spend_reservations to service_role;

create or replace function public.spend_period_start(p_period text)
returns timestamptz language sql stable set search_path = public as $$
  select (date_trunc(case when p_period = 'day' then 'day' else 'month' end, now() at time zone 'utc')) at time zone 'utc';
$$;

-- Settled runs count their actual cost; open and uncertain runs count the
-- larger of their reservation and any reported cost; released runs count 0.
create or replace function public.spend_used(p_scope text, p_scope_id uuid, p_since timestamptz)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case
      when status = 'settled' then coalesce(actual_usd, 0)
      when status in ('reserved', 'uncertain') then greatest(coalesce(reserved_usd, 0), coalesce(actual_usd, 0))
      else 0 end), 0)
  from spend_reservations
  where created_at >= p_since
    and case p_scope
      when 'key' then key_owner = p_scope_id and payer <> 'platform'
      when 'workspace' then workspace_id = p_scope_id
      else payer = 'platform' end;
$$;

create or replace function public.reserve_spend(
  p_id uuid, p_key_owner uuid, p_workspace uuid, p_payer text, p_app uuid, p_model text,
  p_amount numeric, p_platform_limit numeric default null, p_platform_period text default 'day',
  p_hold_seconds integer default 900)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cap record;
  used numeric;
begin
  if exists(select 1 from spend_reservations where id = p_id) then
    return jsonb_build_object('ok', true, 'repeat', true);
  end if;
  -- One lock per scope, always taken in the same order.
  if p_payer = 'platform' then perform pg_advisory_xact_lock(hashtextextended('spend:platform', 0)); end if;
  if p_key_owner is not null and p_payer <> 'platform' then
    perform pg_advisory_xact_lock(hashtextextended('spend:key:' || p_key_owner::text, 0));
  end if;
  if p_workspace is not null then perform pg_advisory_xact_lock(hashtextextended('spend:workspace:' || p_workspace::text, 0)); end if;

  for cap in
    select 'platform'::text as scope, null::uuid as scope_id, p_platform_period as period, p_platform_limit as limit_usd
      where p_payer = 'platform' and p_platform_limit is not null
    union all
    select scope, scope_id, period, limit_usd from spend_caps
      where (scope = 'key' and scope_id = p_key_owner and p_payer <> 'platform')
         or (scope = 'workspace' and scope_id = p_workspace)
  loop
    if p_amount is null then
      return jsonb_build_object('ok', false, 'code', 'unknown_price', 'scope', cap.scope);
    end if;
    used := spend_used(cap.scope, cap.scope_id, spend_period_start(cap.period));
    if used + p_amount > cap.limit_usd then
      return jsonb_build_object('ok', false, 'code', 'cap_reached', 'scope', cap.scope, 'period', cap.period,
                                'limit_usd', cap.limit_usd, 'used_usd', round(used, 4));
    end if;
  end loop;

  insert into spend_reservations(id, key_owner, workspace_id, payer, app_id, model, reserved_usd, expires_at)
  values (p_id, case when p_payer = 'platform' then null else p_key_owner end, p_workspace, p_payer, p_app, p_model,
          p_amount, clock_timestamp() + make_interval(secs => greatest(p_hold_seconds, 60)));
  return jsonb_build_object('ok', true);
end $$;

-- p_outcome: settled (usage known), released (the provider never ran it),
-- uncertain (it may have run; keep the reservation counted).
create or replace function public.settle_spend(p_id uuid, p_actual numeric, p_outcome text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_outcome not in ('settled', 'released', 'uncertain') then
    raise exception 'unknown spend outcome %', p_outcome;
  end if;
  update spend_reservations set status = p_outcome, actual_usd = coalesce(p_actual, actual_usd), settled_at = clock_timestamp()
    where id = p_id and status = 'reserved';
  return found;
end $$;

-- Reservations whose worker never settled them (crash, lost process) are kept
-- counted and marked for review; they are never assumed free.
create or replace function public.expire_spend_reservations()
returns integer language plpgsql security definer set search_path = public as $$
declare expired integer;
begin
  update spend_reservations set status = 'uncertain', settled_at = clock_timestamp()
    where status = 'reserved' and expires_at <= clock_timestamp();
  get diagnostics expired = row_count;
  return expired;
end $$;

create or replace function public.spend_controls_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ready', to_regprocedure('public.reserve_spend(uuid,uuid,uuid,text,uuid,text,numeric,numeric,text,integer)') is not null
    and to_regprocedure('public.settle_spend(uuid,numeric,text)') is not null);
$$;

revoke all on function public.spend_period_start(text) from public, anon, authenticated;
revoke all on function public.spend_used(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_spend(uuid, uuid, uuid, text, uuid, text, numeric, numeric, text, integer) from public, anon, authenticated;
revoke all on function public.settle_spend(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.expire_spend_reservations() from public, anon, authenticated;
revoke all on function public.spend_controls_status() from public, anon, authenticated;
grant execute on function public.spend_period_start(text) to service_role;
grant execute on function public.spend_used(text, uuid, timestamptz) to service_role;
grant execute on function public.reserve_spend(uuid, uuid, uuid, text, uuid, text, numeric, numeric, text, integer) to service_role;
grant execute on function public.settle_spend(uuid, numeric, text) to service_role;
grant execute on function public.expire_spend_reservations() to service_role;
grant execute on function public.spend_controls_status() to service_role;

notify pgrst, 'reload schema';
