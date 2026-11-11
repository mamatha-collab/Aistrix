-- Runtime reservations survive app deletion and task retention cleanup.
create table public.code_runtime_reservations (
  task_id uuid primary key,
  reserved_seconds integer not null check (reserved_seconds between 31 and 150),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.code_runtime_reservations enable row level security;
revoke all on public.code_runtime_reservations from public, anon, authenticated;
grant all on public.code_runtime_reservations to service_role;
create index code_runtime_reservations_day on public.code_runtime_reservations(created_at);
insert into public.code_runtime_reservations(task_id,reserved_seconds,created_at)
select id,reserved_seconds,created_at from public.code_tasks where executor='e2b';

create or replace function public.enqueue_e2b_task(p_app uuid,p_user uuid,p_kind text,p_source uuid default null,p_input jsonb default null,
  p_expected_build uuid default null,p_preview_build uuid default null,p_daily_seconds integer default 3600)
returns setof public.code_tasks language plpgsql security definer set search_path=public as $$
declare job code_tasks; n bigint; seconds integer; src code_sources;
begin
  if p_kind is null or p_kind not in ('build','run') then raise exception 'Invalid task kind'; end if;
  if p_daily_seconds is null or p_daily_seconds<1 or p_daily_seconds>86400 then raise exception 'Invalid managed runtime allowance'; end if;
  perform pg_advisory_xact_lock(hashtextextended('aistrix-e2b-admission',0));
  if not exists(select 1 from apps where id=p_app and created_by=p_user and app_type='code_job') then raise exception 'Code app not found'; end if;
  if not exists(select 1 from code_workers where executor='e2b' and kind=p_kind and seen_at>clock_timestamp()-interval '90 seconds')
    then raise exception 'No healthy worker is available'; end if;
  if p_preview_build is not null then
    if p_kind<>'run' or not exists(select 1 from code_tasks where id=p_preview_build and app_id=p_app and user_id=p_user and executor='e2b' and kind='build' and status='succeeded')
      then raise exception 'Only a successful build from the selected execution provider can be previewed'; end if;
    select * into job from enqueue_code_preview(p_app,p_user,p_preview_build,p_input);
  else
    select * into job from enqueue_code_task(p_app,p_user,p_kind,p_source,p_input,p_expected_build);
  end if;
  select * into src from code_sources where id=job.source_id and app_id=p_app and user_id=p_user;
  if src.id is null then raise exception 'Source version not found'; end if;
  if p_kind='run' and (job.image is null or job.image !~ '^e2b://[A-Za-z0-9_./:-]+@sha256:[a-f0-9]{64}$'
    or right(job.image,64)<>src.source_hash) then raise exception 'Deployment changed execution provider. Build and deploy with E2B first'; end if;
  seconds := case when p_kind='build' then 90 else (src.manifest->>'timeout_seconds')::integer+30 end;
  if seconds is null or seconds<31 or seconds>150 then raise exception 'Invalid managed timeout'; end if;
  select coalesce(sum(reserved_seconds),0) into n from code_runtime_reservations where created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  -- Reservations are retained on cancellation/failure: uncertain provider usage is not refunded.
  if n+seconds>p_daily_seconds then raise exception 'Daily managed runtime allowance reached'; end if;
  insert into code_runtime_reservations(task_id,reserved_seconds) values(job.id,seconds);
  return query update code_tasks set executor='e2b',reserved_seconds=seconds where id=job.id returning *;
end $$;

