-- Provider-routed jobs. Dedicated workers keep their existing default executor.
alter table public.code_tasks add column executor text not null default 'dedicated' check (executor in ('dedicated','e2b'));
alter table public.code_tasks add column reserved_seconds integer not null default 0 check (reserved_seconds between 0 and 180);
alter table public.code_workers add column executor text not null default 'dedicated' check (executor in ('dedicated','e2b'));

create function public.enqueue_e2b_task(p_app uuid,p_user uuid,p_kind text,p_source uuid default null,p_input jsonb default null,
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
  select coalesce(sum(reserved_seconds),0) into n from code_tasks where executor='e2b'
    and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  -- Reservations are retained on cancellation/failure: uncertain provider usage is not refunded.
  if n+seconds>p_daily_seconds then raise exception 'Daily managed runtime allowance reached'; end if;
  return query update code_tasks set executor='e2b',reserved_seconds=seconds where id=job.id returning *;
end $$;

create or replace function public.claim_code_task(p_worker text,p_kind text)
returns setof public.code_tasks language plpgsql security definer set search_path=public as $$
declare job code_tasks; seconds integer; selected_executor text;
begin
  select executor into selected_executor from code_workers where id=p_worker and kind=p_kind and seen_at>clock_timestamp()-interval '90 seconds';
  if selected_executor is null then raise exception 'Worker is not healthy'; end if;
  update code_tasks set status='interrupted',finished_at=clock_timestamp(),lease_token=null,error='Worker ownership expired. This job was not replayed.'
    where status='running' and (lease_expires_at<=clock_timestamp() or deadline<=clock_timestamp());
  update code_tasks set status='failed',finished_at=clock_timestamp(),error='Queue wait exceeded 15 minutes.'
    where status='queued' and created_at<clock_timestamp()-interval '15 minutes';
  select * into job from code_tasks where kind=p_kind and executor=selected_executor and status='queued' order by created_at for update skip locked limit 1;
  if job.id is null then return; end if;
  if selected_executor='e2b' then seconds:=job.reserved_seconds+30;
  else select case when p_kind='build' then 600 else (manifest->>'timeout_seconds')::integer+60 end into seconds from code_sources where id=job.source_id;
  end if;
  return query update code_tasks set status='running',worker_id=p_worker,lease_token=gen_random_uuid(),started_at=clock_timestamp(),
    lease_expires_at=clock_timestamp()+interval '90 seconds',deadline=clock_timestamp()+make_interval(secs=>seconds) where id=job.id returning *;
end $$;

create or replace function public.finish_code_task(p_id uuid,p_token uuid,p_status text,p_result jsonb,p_logs text,p_error text,p_elapsed bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare job code_tasks; expected_hash text;
begin
  if p_status is null or p_status not in ('succeeded','failed') then raise exception 'Invalid completion'; end if;
  if octet_length(coalesce(p_result::text,''))>131072 or octet_length(coalesce(p_logs,''))>65536 then raise exception 'Result or logs exceed 64 KiB'; end if;
  select * into job from code_tasks where id=p_id;
  if p_status='succeeded' and job.kind='build' then
    if job.executor='e2b' then
      select source_hash into expected_hash from code_sources where id=job.source_id;
      if coalesce(p_result->>'provider','')<>'e2b' or coalesce(p_result->>'image','') !~ '^e2b://[A-Za-z0-9_./:-]+@sha256:[a-f0-9]{64}$'
        or right(p_result->>'image',64)<>expected_hash then raise exception 'Build needs an immutable E2B source artifact'; end if;
    elsif coalesce(p_result->>'image','') !~ '^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$' then raise exception 'Build needs an immutable image digest';
    end if;
  end if;
  update code_tasks set status=p_status,result=p_result,logs=coalesce(p_logs,''),error=left(p_error,2000),elapsed_ms=greatest(0,p_elapsed),
    finished_at=clock_timestamp(),lease_token=null,lease_expires_at=null
    where id=p_id and lease_token=p_token and status='running' and lease_expires_at>clock_timestamp() and deadline>clock_timestamp();
  return found;
end $$;
revoke all on function public.enqueue_e2b_task(uuid,uuid,text,uuid,jsonb,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.enqueue_e2b_task(uuid,uuid,text,uuid,jsonb,uuid,uuid,integer) to service_role;
