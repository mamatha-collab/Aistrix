-- Recovery never replays an uncertain external effect. Expired workflow
-- owners are fenced off and the run is failed for explicit operator review.
alter table public.flow_runs add column if not exists lease_token uuid;
alter table public.flow_runs add column if not exists lease_expires_at timestamptz;
alter table public.flow_runs add column if not exists definition jsonb;
create index if not exists flow_runs_active_lease on public.flow_runs(lease_expires_at) where status = 'running';

create or replace function public.heartbeat_flow_run(p_id uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update flow_runs set lease_expires_at = clock_timestamp() + interval '120 seconds'
    where id = p_id and lease_token = p_token and status = 'running'
      and lease_expires_at > clock_timestamp();
  return found;
end $$;

create or replace function public.recover_interrupted_flow_runs()
returns integer language plpgsql security definer set search_path = public as $$
declare recovered integer;
begin
  update flow_runs set status = 'failed', finished_at = clock_timestamp(), lease_token = null,
    error = 'Execution was interrupted or its worker lost ownership. An external action may have completed. Review step results and the destination before starting another run.'
  where status = 'running' and coalesce(lease_expires_at, started_at + interval '120 seconds') <= clock_timestamp();
  get diagnostics recovered = row_count;
  return recovered;
end $$;

-- Existing rows remain sent: old events have no payload and cannot be retried.
alter table public.developer_notifications
  add column if not exists status text not null default 'sent',
  add column if not exists payload jsonb,
  add column if not exists attempts integer not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists last_error text;
alter table public.developer_notifications add constraint developer_notifications_status_check
  check (status in ('pending', 'sending', 'sent', 'suppressed', 'failed'));
create index if not exists developer_notifications_due on public.developer_notifications(next_attempt_at)
  where status in ('pending', 'sending');

create or replace function public.claim_developer_notifications(p_id bigint default null)
returns setof public.developer_notifications language plpgsql security definer set search_path = public as $$
begin
  return query
  with due as (
    select id from developer_notifications
    where (p_id is null or id = p_id) and payload is not null
      and ((status = 'pending' and next_attempt_at <= clock_timestamp())
        or (status = 'sending' and lease_expires_at <= clock_timestamp()))
    order by next_attempt_at limit 20 for update skip locked
  )
  update developer_notifications n set status = 'sending', attempts = n.attempts + 1,
    lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '120 seconds'
  from due where n.id = due.id returning n.*;
end $$;

revoke all on function public.heartbeat_flow_run(uuid,uuid) from public, anon, authenticated;
revoke all on function public.recover_interrupted_flow_runs() from public, anon, authenticated;
revoke all on function public.claim_developer_notifications(bigint) from public, anon, authenticated;
grant execute on function public.heartbeat_flow_run(uuid,uuid) to service_role;
grant execute on function public.recover_interrupted_flow_runs() to service_role;
grant execute on function public.claim_developer_notifications(bigint) to service_role;

create or replace function public.developer_jobs_schema_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'workflow_lease', exists(select 1 from information_schema.columns where table_schema='public' and table_name='flow_runs' and column_name='lease_token'),
    'workflow_snapshot', exists(select 1 from information_schema.columns where table_schema='public' and table_name='flow_runs' and column_name='definition'),
    'notification_queue', exists(select 1 from information_schema.columns where table_schema='public' and table_name='developer_notifications' and column_name='payload'),
    'recovery_functions', to_regprocedure('public.heartbeat_flow_run(uuid,uuid)') is not null
      and to_regprocedure('public.recover_interrupted_flow_runs()') is not null
      and to_regprocedure('public.claim_developer_notifications(bigint)') is not null,
    'server_only', not has_function_privilege('authenticated','public.claim_developer_notifications(bigint)','execute')
      and not has_function_privilege('anon','public.recover_interrupted_flow_runs()','execute')
      and not has_table_privilege('authenticated','public.developer_notifications','select')
      and not has_table_privilege('authenticated','public.flow_runs','select')
  );
$$;
revoke all on function public.developer_jobs_schema_status() from public, anon, authenticated;
grant execute on function public.developer_jobs_schema_status() to service_role;

-- Make the RPCs visible immediately when applying through the SQL editor.
notify pgrst, 'reload schema';
