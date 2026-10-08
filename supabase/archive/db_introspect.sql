-- Read-only schema report for review. Creates one function that only the
-- service role (the backend) can call. It reads catalog metadata — no row data.
-- Drop it afterwards with:  drop function if exists aistrix_schema_report();

create or replace function aistrix_schema_report()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
select jsonb_build_object(
  'foreign_keys', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', conrelid::regclass::text,
      'name', conname,
      'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text), '[]')
    from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace
  ),
  'unique_and_checks', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', conrelid::regclass::text,
      'type', contype,
      'name', conname,
      'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text), '[]')
    from pg_constraint
    where contype in ('u', 'c') and connamespace = 'public'::regnamespace
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', indexname, 'def', indexdef) order by tablename), '[]')
    from pg_indexes where schemaname = 'public'
  ),
  'index_usage', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', relname, 'index', indexrelname, 'scans', idx_scan,
      'size', pg_size_pretty(pg_relation_size(indexrelid)))), '[]')
    from pg_stat_user_indexes where schemaname = 'public'
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles,
      'using', qual, 'check', with_check) order by tablename), '[]')
    from pg_policies where schemaname = 'public'
  ),
  'rls', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', relname, 'enabled', relrowsecurity)), '[]')
    from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', event_object_table, 'name', trigger_name,
      'timing', action_timing, 'event', event_manipulation, 'action', action_statement)), '[]')
    from information_schema.triggers where trigger_schema = 'public'
  ),
  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'def', left(pg_get_functiondef(p.oid), 1500))), '[]')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and p.proname <> 'aistrix_schema_report'
  ),
  'column_defaults', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', table_name, 'column', column_name, 'nullable', is_nullable,
      'default', column_default, 'type', data_type)), '[]')
    from information_schema.columns where table_schema = 'public'
  ),
  'sizes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table', relname, 'total', pg_size_pretty(pg_total_relation_size(relid)),
      'seq_scans', seq_scan, 'idx_scans', idx_scan, 'live_rows', n_live_tup)), '[]')
    from pg_stat_user_tables where schemaname = 'public'
  )
);
$$;

revoke all on function aistrix_schema_report() from public, anon, authenticated;
grant execute on function aistrix_schema_report() to service_role;
