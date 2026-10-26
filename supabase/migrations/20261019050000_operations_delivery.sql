-- Idempotent telemetry delivery: workers can retry an acknowledged write after
-- crashing without duplicating a run. Historical rows may have no event ID.
alter table public.app_runs add column if not exists event_id uuid;
create unique index if not exists app_runs_event_id_key on public.app_runs(event_id);

-- Counts are aggregated inside Postgres: PostgREST's response-row cap must not
-- change the number of reports presented to developers.
create or replace function public.app_feedback_counts(p_app_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
  from (select status, count(*) n from public.app_feedback where app_id = p_app_id group by status) s;
$$;
revoke all on function public.app_feedback_counts(uuid) from public, anon, authenticated;
grant execute on function public.app_feedback_counts(uuid) to service_role;
grant select, insert, update on public.app_runs to service_role;
grant usage, select on sequence public.app_runs_id_seq to service_role;
grant select, insert, update on public.app_feedback to service_role;
revoke all on public.app_runs, public.app_feedback from anon, authenticated;

create index if not exists app_feedback_queue_idx on public.app_feedback(app_id, status, created_at desc, id desc);
create index if not exists app_runs_time_id_idx on public.app_runs(app_id, created_at desc, id desc);

-- Previously the author branch allowed a removed teammate to keep reading
-- their own regression inputs. App evidence requires current editor access.
alter policy app_test_cases_own on public.app_test_cases
  using (public.can_edit_app(app_id))
  with check (user_id = auth.uid() and public.can_edit_app(app_id));

-- Read-only deployment check, callable only by the backend operator.
create or replace function public.operations_schema_status()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'telemetry_columns', (select count(*) = 8 from information_schema.columns where table_schema = 'public' and table_name = 'app_runs'
      and column_name in ('event_id', 'status', 'error_kind', 'latency_ms', 'live_version', 'model', 'cost_usd', 'source')),
    'feedback_columns', (select count(*) = 5 from information_schema.columns where table_schema = 'public' and table_name = 'app_feedback'
      and column_name in ('note', 'test_case_id', 'shared_input', 'shared_output', 'status')),
    'server_only', not has_table_privilege('authenticated', 'public.app_feedback', 'SELECT')
      and not has_table_privilege('anon', 'public.app_feedback', 'SELECT')
      and not has_table_privilege('authenticated', 'public.app_runs', 'SELECT')
      and not has_table_privilege('anon', 'public.app_runs', 'SELECT'),
    'rls_enabled', (select bool_and(relrowsecurity) from pg_class where oid in ('public.app_feedback'::regclass, 'public.app_runs'::regclass)),
    'feedback_trigger', exists(select 1 from pg_trigger where tgrelid = 'public.app_feedback'::regclass and tgname = 'app_feedback_touch' and not tgisinternal and tgenabled <> 'D'),
    'test_trigger', exists(select 1 from pg_trigger where tgrelid = 'public.app_test_cases'::regclass and tgname = 'app_test_cases_touch' and not tgisinternal and tgenabled <> 'D'),
    'test_access_policy', (select bool_and(qual like '%can_edit_app%' and qual not like '%user_id%') from pg_policies where schemaname = 'public' and tablename = 'app_test_cases' and cmd in ('ALL','SELECT')),
    'counts_server_only', has_function_privilege('service_role', 'public.app_feedback_counts(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.app_feedback_counts(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.app_feedback_counts(uuid)', 'EXECUTE'),
    'delivery_unique', exists(select 1 from pg_index where indexrelid = 'public.app_runs_event_id_key'::regclass and indisunique)
  );
$$;
revoke all on function public.operations_schema_status() from public, anon, authenticated;
grant execute on function public.operations_schema_status() to service_role;
