-- Developer tiers (both free): Free and Verified (staff mark a developer
-- verified: developer_profiles.is_verified, which developers can't set).
-- Limits live in a table so they can change without a deploy. Staff
-- (user_roles admin/moderator) have no limits.

create table if not exists public.developer_limits (
  tier text primary key check (tier in ('free', 'verified')),
  draft_apps integer not null check (draft_apps >= 0),
  published_apps integer not null check (published_apps >= 0),
  tests_per_day integer not null check (tests_per_day >= 0),
  concurrent_tests integer not null check (concurrent_tests >= 1),
  analytics text not null check (analytics in ('basic', 'standard'))
);
insert into public.developer_limits (tier, draft_apps, published_apps, tests_per_day, concurrent_tests, analytics) values
  ('free', 10, 1, 20, 1, 'basic'),
  ('verified', 30, 5, 100, 3, 'standard')
on conflict (tier) do nothing;
alter table public.developer_limits enable row level security;
revoke all on public.developer_limits from anon, authenticated;
grant select on public.developer_limits to authenticated;          -- the limits are public information
drop policy if exists developer_limits_read on public.developer_limits;
create policy developer_limits_read on public.developer_limits for select to authenticated using (true);

-- 'staff' | 'verified' | 'free' for any user (server and triggers).
create or replace function public.developer_tier(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from user_roles where user_id = p_user and role in ('admin', 'moderator')) then 'staff'
    when exists (select 1 from developer_profiles where user_id = p_user and is_verified) then 'verified'
    else 'free'
  end
$$;
revoke all on function public.developer_tier(uuid) from public, anon, authenticated;
grant execute on function public.developer_tier(uuid) to service_role;

-- Draft apps: a developer can have up to N apps that aren't published
-- (including apps waiting for review). Checked whoever creates the app.
create or replace function public.enforce_draft_app_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text := developer_tier(new.created_by);
  v_limit integer;
  v_drafts integer;
begin
  if new.created_by is null or v_tier = 'staff' then
    return new;
  end if;
  select draft_apps into v_limit from developer_limits where tier = v_tier;
  if v_limit is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('draft_apps:' || new.created_by::text));   -- two creates at once can't both slip in
  select count(*) into v_drafts from apps where created_by = new.created_by and not coalesce(is_published, false);
  if v_drafts >= v_limit then
    raise exception 'You can have up to % draft apps (% developer). Publish or delete one to create another.',
      v_limit, initcap(v_tier) using errcode = 'P0001', hint = 'draft_app_limit';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_draft_app_limit on public.apps;
create trigger enforce_draft_app_limit before insert on public.apps
  for each row execute function public.enforce_draft_app_limit();

-- Test runs: a daily count and "at once" slots per developer, claimed and
-- released by the server. A slot left by a stopped server frees itself after
-- 10 minutes.
create table if not exists public.developer_test_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  runs integer not null default 0,
  primary key (user_id, day)
);
create table if not exists public.developer_test_slots (
  user_id uuid not null references auth.users(id) on delete cascade,
  slot integer not null,
  started_at timestamptz not null default now(),
  primary key (user_id, slot)
);
alter table public.developer_test_usage enable row level security;
alter table public.developer_test_slots enable row level security;
revoke all on public.developer_test_usage, public.developer_test_slots from anon, authenticated;

create or replace function public.claim_test_run(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text := developer_tier(p_user);
  v_lim developer_limits%rowtype;
  v_slot integer;
  v_runs integer;
begin
  if v_tier = 'staff' then
    return jsonb_build_object('ok', true, 'slot', null, 'tier', v_tier);
  end if;
  select * into v_lim from developer_limits where tier = v_tier;
  delete from developer_test_slots where user_id = p_user and started_at < now() - interval '10 minutes';
  insert into developer_test_slots (user_id, slot)
    select p_user, s from generate_series(1, v_lim.concurrent_tests) s
     where not exists (select 1 from developer_test_slots t where t.user_id = p_user and t.slot = s)
     order by s limit 1
  on conflict do nothing
  returning slot into v_slot;
  if v_slot is null then
    return jsonb_build_object('ok', false, 'reason', 'concurrent', 'limit', v_lim.concurrent_tests, 'tier', v_tier);
  end if;
  insert into developer_test_usage (user_id, day, runs) values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set runs = developer_test_usage.runs + 1
    where developer_test_usage.runs < v_lim.tests_per_day
  returning runs into v_runs;
  if v_runs is null then
    delete from developer_test_slots where user_id = p_user and slot = v_slot;
    return jsonb_build_object('ok', false, 'reason', 'daily', 'limit', v_lim.tests_per_day, 'tier', v_tier);
  end if;
  return jsonb_build_object('ok', true, 'slot', v_slot, 'used', v_runs, 'limit', v_lim.tests_per_day, 'tier', v_tier);
end;
$$;
create or replace function public.release_test_run(p_user uuid, p_slot integer)
returns void
language sql
security definer
set search_path = public
as $$
  delete from developer_test_slots where user_id = p_user and slot = p_slot;
$$;
revoke all on function public.claim_test_run(uuid), public.release_test_run(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_test_run(uuid), public.release_test_run(uuid, integer) to service_role;

-- First publish waits for staff. An app approved once (publish_approved_at)
-- releases later versions straight away. Apps already published are approved.
alter table public.apps add column if not exists publish_approved_at timestamptz;
update public.apps set publish_approved_at = coalesce(promoted_at, now())
 where publish_approved_at is null and (is_published or live_version is not null);

-- Approval by staff (Moderator → Approve) records when; developers can't set it.
create or replace function public.record_publish_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    new.publish_approved_at := case when tg_op = 'INSERT' then null else old.publish_approved_at end;
  elsif new.status = 'approved' and new.is_published and new.publish_approved_at is null then
    new.publish_approved_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists record_publish_approval on public.apps;
create trigger record_publish_approval before insert or update on public.apps
  for each row execute function public.record_publish_approval();
