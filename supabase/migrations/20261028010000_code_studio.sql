-- Revision-fenced drafts and pre-deployment previews. Existing source/build APIs remain available.
alter table public.code_sources add column studio_contract boolean not null default false;
create table public.code_studio_drafts (
  app_id uuid primary key references public.apps(id) on delete cascade,
  source_id uuid not null references public.code_sources(id),
  revision bigint not null check (revision > 0)
);
create table public.code_studio_revisions (
  app_id uuid not null references public.apps(id) on delete cascade,
  revision bigint not null,
  source_id uuid not null references public.code_sources(id),
  created_at timestamptz not null default now(),
  primary key(app_id, revision)
);
alter table public.code_studio_drafts enable row level security;
alter table public.code_studio_revisions enable row level security;
revoke all on public.code_studio_drafts, public.code_studio_revisions from public, anon, authenticated;
grant all on public.code_studio_drafts, public.code_studio_revisions to service_role;

create function public.save_code_studio_draft(p_app uuid, p_user uuid, p_expected bigint, p_hash text, p_files jsonb, p_manifest jsonb)
returns setof public.code_studio_drafts language plpgsql security definer set search_path = public as $$
declare draft code_studio_drafts; src code_sources;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not exists(select 1 from apps where id=p_app and created_by=p_user and app_type='code_job') then raise exception 'Code app not found'; end if;
  select * into draft from code_studio_drafts where app_id=p_app for update;
  if coalesce(draft.revision,0) is distinct from p_expected then raise exception 'Draft revision changed. Reload before saving.'; end if;
  select * into src from save_code_source(p_app,p_user,p_hash,p_files,p_manifest);
  update code_sources set studio_contract=true where id=src.id;
  if draft.source_id = src.id then return query select * from code_studio_drafts where app_id=p_app; return; end if;
  insert into code_studio_drafts(app_id,source_id,revision) values(p_app,src.id,coalesce(draft.revision,0)+1)
    on conflict(app_id) do update set source_id=excluded.source_id, revision=excluded.revision;
  insert into code_studio_revisions(app_id,revision,source_id) values(p_app,coalesce(draft.revision,0)+1,src.id);
  return query select * from code_studio_drafts where app_id=p_app;
end $$;

create function public.enqueue_code_preview(p_app uuid,p_user uuid,p_build uuid,p_input jsonb)
returns setof public.code_tasks language plpgsql security definer set search_path = public as $$
declare build code_tasks; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if not exists(select 1 from apps where id=p_app and created_by=p_user and app_type='code_job') then raise exception 'Code app not found'; end if;
  if not exists(select 1 from code_workers where kind='run' and seen_at>clock_timestamp()-interval '90 seconds') then raise exception 'No healthy worker is available'; end if;
  perform recover_code_tasks(p_app);
  select count(*) into n from code_tasks where user_id=p_user and status in ('queued','running');
  if n>=2 then raise exception 'Two jobs are already active'; end if;
  select count(*) into n from code_tasks where user_id=p_user and kind='run'
    and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  if n>=100 then raise exception 'Daily code job quota reached'; end if;
  select * into build from code_tasks where id=p_build and app_id=p_app and user_id=p_user and kind='build' and status='succeeded';
  if build.id is null or build.result->>'image' is null then raise exception 'Only a successful build can be previewed'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>65536 then raise exception 'Invalid preview input'; end if;
  return query insert into code_tasks(app_id,user_id,source_id,kind,input,image)
    values(p_app,p_user,build.source_id,'run',p_input,build.result->>'image') returning *;
end $$;
revoke all on function public.save_code_studio_draft(uuid,uuid,bigint,text,jsonb,jsonb), public.enqueue_code_preview(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_code_studio_draft(uuid,uuid,bigint,text,jsonb,jsonb), public.enqueue_code_preview(uuid,uuid,uuid,jsonb) to service_role;
