-- apps.max_runs_per_day ("Run quota" on Deploy): end-user runs per app per
-- UTC day, across all users and website visitors. The backend claims a run
-- before calling the model; the developer's own runs aren't counted.
create table if not exists public.app_run_days (
  app_id uuid not null references public.apps(id) on delete cascade,
  day date not null,
  runs integer not null default 0,
  constraint app_run_days_pkey primary key (app_id, day)
);
alter table public.app_run_days enable row level security;
-- No policies: only the backend (service role) reads or writes it.

-- Counts the run and returns true while the app is under p_limit today;
-- false (and nothing counted) once the quota is used up.
create or replace function public.claim_app_daily_run(p_app_id uuid, p_limit integer)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_runs integer;
begin
  insert into app_run_days as d (app_id, day, runs)
  values (p_app_id, (now() at time zone 'utc')::date, 1)
  on conflict (app_id, day) do update set runs = d.runs + 1 where d.runs < p_limit
  returning runs into v_runs;
  return v_runs is not null and v_runs <= p_limit;
end;
$function$;

revoke all on function public.claim_app_daily_run(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_app_daily_run(uuid, integer) to service_role;
