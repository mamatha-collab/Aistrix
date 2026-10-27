-- Private Python job hosting. Payloads and worker leases are server-only.
create function public.guard_private_code_app() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.app_type='code_job' and (coalesce(new.is_published,false) or new.visibility is distinct from 'private' or coalesce(new.embed_public,false))
    then raise exception 'Code applications are private jobs; public publication and embeds are not enabled'; end if;
  return new;
end $$;
create trigger guard_private_code_app before insert or update on public.apps
for each row execute function public.guard_private_code_app();
revoke all on function public.guard_private_code_app() from public, anon, authenticated;

create table public.code_sources (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  files jsonb not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  unique(app_id, source_hash)
);
create table public.code_workers (
  id text primary key,
  kind text not null check (kind in ('build','run')),
  seen_at timestamptz not null default now()
);
create table public.code_tasks (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  source_id uuid not null references public.code_sources(id),
  kind text not null check (kind in ('build','run')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','cancelled','interrupted')),
  input jsonb,
  image text,
  result jsonb,
  logs text not null default '',
  error text,
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  deadline timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  elapsed_ms bigint
);
create index code_tasks_queue on public.code_tasks(kind, created_at) where status = 'queued';
create index code_tasks_owner_day on public.code_tasks(user_id, kind, created_at);
create index code_tasks_active_lease on public.code_tasks(lease_expires_at) where status='running';
create table public.code_deployments (
  app_id uuid primary key references public.apps(id) on delete cascade,
  build_id uuid not null references public.code_tasks(id),
  source_id uuid not null references public.code_sources(id),
  image text not null,
  deployed_by uuid not null references auth.users(id),
  deployed_at timestamptz not null default now()
);
-- Direct browser writes/reads would bypass ownership, quotas and lease fencing.
alter table public.code_sources enable row level security;
alter table public.code_workers enable row level security;
alter table public.code_tasks enable row level security;
alter table public.code_deployments enable row level security;
revoke all on public.code_sources, public.code_workers, public.code_tasks, public.code_deployments from public, anon, authenticated;
grant all on public.code_sources, public.code_workers, public.code_tasks, public.code_deployments to service_role;

create function public.guard_active_code_app_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from code_tasks where app_id=old.id and status in ('queued','running'))
    then raise exception 'Cancel or finish active code jobs before deleting this app'; end if;
  return old;
end $$;
create trigger guard_active_code_app_delete before delete on public.apps
for each row execute function public.guard_active_code_app_delete();
revoke all on function public.guard_active_code_app_delete() from public, anon, authenticated;

create function public.save_code_source(p_app uuid, p_user uuid, p_hash text, p_files jsonb, p_manifest jsonb)
returns setof public.code_sources language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not exists(select 1 from apps where id=p_app and created_by=p_user and app_type='code_job')
    then raise exception 'Code app not found'; end if;
  if exists(select 1 from code_sources where app_id=p_app and source_hash=p_hash) then
    return query select * from code_sources where app_id=p_app and source_hash=p_hash;
    return;
  end if;
  if octet_length(p_files::text)>1048576 or jsonb_typeof(p_files)<>'object' or p_files is null
    or octet_length(p_manifest::text)>2048 or jsonb_typeof(p_manifest)<>'object' or p_manifest is null
    then raise exception 'Invalid source bundle'; end if;
  if (select count(*) from code_sources where app_id=p_app)>=100
    or (select count(*) from code_sources where user_id=p_user and created_at>clock_timestamp()-interval '1 day')>=20
    then raise exception 'Source version quota reached'; end if;
  return query insert into code_sources(app_id,user_id,source_hash,files,manifest)
    values(p_app,p_user,p_hash,p_files,p_manifest) returning *;
end $$;

create function public.recover_code_tasks(p_app uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare recovered integer;
begin
  update code_tasks set status='interrupted', finished_at=clock_timestamp(), lease_token=null,
    error='Worker ownership expired. This job was not replayed. Inspect outputs before running again.'
    where (p_app is null or app_id=p_app) and status='running'
      and (lease_expires_at<=clock_timestamp() or deadline<=clock_timestamp());
  get diagnostics recovered=row_count;
  update code_tasks set status='failed', finished_at=clock_timestamp(), error='Queue wait exceeded 15 minutes.'
    where (p_app is null or app_id=p_app) and status='queued' and created_at<clock_timestamp()-interval '15 minutes';
  return recovered;
end $$;

create function public.enqueue_code_task(p_app uuid, p_user uuid, p_kind text, p_source uuid, p_input jsonb default null, p_expected_build uuid default null)
returns setof public.code_tasks language plpgsql security definer set search_path = public as $$
declare src code_sources; dep code_deployments; n integer;
begin
  if p_kind not in ('build','run') or p_kind is null then raise exception 'Invalid task kind'; end if;
  -- Serializes concurrent requests across all of this owner's apps.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  if not exists(select 1 from apps where id=p_app and created_by=p_user and app_type='code_job')
    then raise exception 'Code app not found'; end if;
  if not exists(select 1 from code_workers where kind=p_kind and seen_at > clock_timestamp()-interval '90 seconds')
    then raise exception 'No healthy worker is available'; end if;
  -- Expired work is never replayed automatically.
  update code_tasks set status='interrupted', finished_at=clock_timestamp(), lease_token=null,
    error='Worker ownership expired. This job was not replayed. Inspect its outputs before running again.'
    where user_id=p_user and status='running' and (lease_expires_at <= clock_timestamp() or deadline <= clock_timestamp());
  update code_tasks set status='failed', finished_at=clock_timestamp(), error='Queue wait exceeded 15 minutes.'
    where user_id=p_user and status='queued' and created_at < clock_timestamp()-interval '15 minutes';
  select count(*) into n from code_tasks where user_id=p_user and status in ('queued','running');
  if n >= 2 then raise exception 'Two jobs are already active. Wait or cancel one.'; end if;
  select count(*) into n from code_tasks where user_id=p_user and kind=p_kind
    and created_at >= date_trunc('day', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  if n >= (case when p_kind='build' then 5 else 100 end) then raise exception 'Daily code job quota reached'; end if;
  if p_kind='run' then
    select * into dep from code_deployments where app_id=p_app;
    if dep.app_id is null then raise exception 'Deploy a successful build before running'; end if;
    if p_expected_build is not null and dep.build_id is distinct from p_expected_build
      then raise exception 'Deployment changed. Refresh before running.'; end if;
    p_source := dep.source_id;
    if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 65536
      then raise exception 'Input must be a JSON object of at most 64 KiB'; end if;
  end if;
  select * into src from code_sources where id=p_source and app_id=p_app and user_id=p_user;
  if src.id is null then raise exception 'Source version not found'; end if;
  return query insert into code_tasks(app_id,user_id,source_id,kind,input,image)
    values(p_app,p_user,src.id,p_kind,case when p_kind='run' then p_input end,dep.image) returning *;
end $$;

create function public.claim_code_task(p_worker text, p_kind text)
returns setof public.code_tasks language plpgsql security definer set search_path = public as $$
declare job code_tasks; seconds integer;
begin
  if not exists(select 1 from code_workers where id=p_worker and kind=p_kind and seen_at>clock_timestamp()-interval '90 seconds')
    then raise exception 'Worker is not healthy'; end if;
  update code_tasks set status='interrupted', finished_at=clock_timestamp(), lease_token=null,
    error='Worker ownership expired. This job was not replayed.'
    where status='running' and (lease_expires_at<=clock_timestamp() or deadline<=clock_timestamp());
  update code_tasks set status='failed', finished_at=clock_timestamp(), error='Queue wait exceeded 15 minutes.'
    where status='queued' and created_at<clock_timestamp()-interval '15 minutes';
  select * into job from code_tasks where kind=p_kind and status='queued' order by created_at for update skip locked limit 1;
  if job.id is null then return; end if;
  select case when p_kind='build' then 600 else (manifest->>'timeout_seconds')::integer+60 end into seconds
    from code_sources where id=job.source_id;
  return query update code_tasks set status='running', worker_id=p_worker, lease_token=gen_random_uuid(),
    started_at=clock_timestamp(), lease_expires_at=clock_timestamp()+interval '90 seconds',
    deadline=clock_timestamp()+make_interval(secs=>seconds)
    where id=job.id returning *;
end $$;

create function public.heartbeat_code_task(p_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update code_tasks set lease_expires_at=least(deadline,clock_timestamp()+interval '90 seconds')
    where id=p_id and lease_token=p_token and status='running'
      and lease_expires_at>clock_timestamp() and deadline>clock_timestamp();
  return found;
end $$;

create function public.finish_code_task(p_id uuid, p_token uuid, p_status text, p_result jsonb, p_logs text, p_error text, p_elapsed bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('succeeded','failed') or p_status is null then raise exception 'Invalid completion'; end if;
  -- JSONB text can add whitespace around a <=64 KiB compact JSON output.
  if octet_length(coalesce(p_result::text,''))>131072 or octet_length(coalesce(p_logs,''))>65536
    then raise exception 'Result or logs exceed 64 KiB'; end if;
  if p_status='succeeded' and exists(select 1 from code_tasks where id=p_id and kind='build')
    and coalesce(p_result->>'image','') !~ '^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$'
    then raise exception 'Build needs an immutable image digest'; end if;
  update code_tasks set status=p_status, result=p_result, logs=coalesce(p_logs,''), error=left(p_error,2000),
    elapsed_ms=greatest(0,p_elapsed), finished_at=clock_timestamp(), lease_token=null, lease_expires_at=null
    where id=p_id and lease_token=p_token and status='running' and lease_expires_at>clock_timestamp() and deadline>clock_timestamp();
  return found;
end $$;

create function public.update_code_task_logs(p_id uuid, p_token uuid, p_logs text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if octet_length(p_logs)>65536 then raise exception 'Logs exceed 64 KiB'; end if;
  update code_tasks set logs=coalesce(p_logs,'') where id=p_id and lease_token=p_token and status='running'
    and lease_expires_at>clock_timestamp() and deadline>clock_timestamp();
  return found;
end $$;

-- Compare-and-swap prevents two browser tabs from silently overwriting a release.
create function public.deploy_code_build(p_app uuid, p_user uuid, p_build uuid, p_expected uuid default null)
returns setof public.code_deployments language plpgsql security definer set search_path = public as $$
declare job code_tasks; current_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_app::text,1));
  if not exists(select 1 from apps where id=p_app and created_by=p_user and app_type='code_job')
    then raise exception 'Code app not found'; end if;
  select build_id into current_id from code_deployments where app_id=p_app;
  if current_id is distinct from p_expected then raise exception 'Deployment changed. Refresh before deploying.'; end if;
  select * into job from code_tasks where id=p_build and app_id=p_app and user_id=p_user and kind='build' and status='succeeded';
  if job.id is null then raise exception 'Only a successful build of this app can be deployed'; end if;
  return query insert into code_deployments(app_id,build_id,source_id,image,deployed_by)
    values(p_app,job.id,job.source_id,job.result->>'image',p_user)
    on conflict(app_id) do update set build_id=excluded.build_id,source_id=excluded.source_id,image=excluded.image,
      deployed_by=excluded.deployed_by,deployed_at=clock_timestamp() returning *;
end $$;

revoke all on function public.enqueue_code_task(uuid,uuid,text,uuid,jsonb,uuid), public.claim_code_task(text,text),
  public.heartbeat_code_task(uuid,uuid), public.finish_code_task(uuid,uuid,text,jsonb,text,text,bigint),
  public.deploy_code_build(uuid,uuid,uuid,uuid), public.save_code_source(uuid,uuid,text,jsonb,jsonb),
  public.update_code_task_logs(uuid,uuid,text), public.recover_code_tasks(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_code_task(uuid,uuid,text,uuid,jsonb,uuid), public.claim_code_task(text,text),
  public.heartbeat_code_task(uuid,uuid), public.finish_code_task(uuid,uuid,text,jsonb,text,text,bigint),
  public.deploy_code_build(uuid,uuid,uuid,uuid), public.save_code_source(uuid,uuid,text,jsonb,jsonb),
  public.update_code_task_logs(uuid,uuid,text), public.recover_code_tasks(uuid) to service_role;
notify pgrst, 'reload schema';
