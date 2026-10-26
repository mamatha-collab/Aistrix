-- Save app settings only if the fields being changed still hold the values the
-- editor loaded (per-field optimistic concurrency): two people editing the
-- same app can no longer silently overwrite each other. Only the changed
-- fields are compared — not updated_at — because live apps are updated by
-- every run (run counters), which would make every save look like a conflict.
--
-- SECURITY INVOKER: runs as the caller, so the apps RLS policies and triggers
-- (publish guard, admin columns) apply exactly as for a direct UPDATE.
create or replace function public.update_app_fields(p_app_id uuid, p_patch jsonb, p_expected jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_conflicts text[];
  v_sets text;
  v_count integer;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nothing to save' using errcode = '22023';
  end if;
  if p_patch ? 'id' then
    raise exception 'The app id cannot be changed' using errcode = '22023';
  end if;

  -- Lock the row so the compare and the write see the same version.
  select to_jsonb(a) into v_row from apps a where a.id = p_app_id for update;
  if v_row is null then
    raise exception 'App not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(k order by k), '{}') into v_conflicts
    from jsonb_object_keys(coalesce(p_expected, '{}'::jsonb)) k
   where (v_row -> k) is distinct from (p_expected -> k);
  if cardinality(v_conflicts) > 0 then
    return jsonb_build_object('ok', false, 'conflicts', to_jsonb(v_conflicts),
      'current', (select jsonb_object_agg(k, v_row -> k) from unnest(v_conflicts) k));
  end if;

  select string_agg(format('%I = r.%I', k, k), ', ') into v_sets from jsonb_object_keys(p_patch) k;
  execute format('update apps a set %s from jsonb_populate_record(null::apps, $2) r where a.id = $1', v_sets)
    using p_app_id, p_patch;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'You can''t edit this app' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.update_app_fields(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_app_fields(uuid, jsonb, jsonb) to authenticated, service_role;
