-- Aistrix Phase 2: schema-aware publish gate
-- Run in Supabase SQL editor after supabase_app_blueprints.sql.

create or replace function public.validate_app_publish_ready(p_app_id uuid)
returns table(ok boolean, errors text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app record;
  v_blueprint jsonb;
  v_errors text[] := array[]::text[];
  v_format text;
  v_input_fields jsonb;
  v_output_fields jsonb;
  v_format_rules jsonb;
  v_permissions jsonb;
begin
  select * into v_app from public.apps where id = p_app_id;
  if not found then
    return query select false, array['App not found']::text[];
    return;
  end if;

  if v_app.created_by is not null and v_app.created_by <> auth.uid() then
    return query select false, array['Only the app owner can publish this app']::text[];
    return;
  end if;

  select blueprint into v_blueprint from public.app_blueprints where app_id = p_app_id;

  if length(coalesce(trim(v_app.system_prompt), '')) <= 200 then
    v_errors := array_append(v_errors, 'Design readiness requires a system prompt longer than 200 characters');
  end if;
  if coalesce(trim(v_app.description), '') = '' then
    v_errors := array_append(v_errors, 'Description is required');
  end if;
  if coalesce(trim(v_app.ai_model), '') = '' then
    v_errors := array_append(v_errors, 'AI model is required');
  end if;
  if v_app.is_paid is true and v_app.price_per_run is null then
    v_errors := array_append(v_errors, 'Paid apps require price_per_run');
  end if;

  if v_blueprint is null then
    v_errors := array_append(v_errors, 'Blueprint is required before publishing');
  else
    v_input_fields := coalesce(v_blueprint #> '{input_schema,fields}', '[]'::jsonb);
    v_output_fields := coalesce(v_blueprint #> '{output_schema,fields}', v_blueprint #> '{output_contract,fields}', '[]'::jsonb);
    v_format := coalesce(v_blueprint #>> '{output_contract,format}', '');
    v_format_rules := coalesce(v_blueprint #> '{output_contract,format_rules}', '{}'::jsonb);
    v_permissions := v_blueprint #> '{permissions}';

    if coalesce(trim(v_blueprint #>> '{business_problem}'), '') = '' then
      v_errors := array_append(v_errors, 'Design readiness requires a business problem');
    end if;

    if coalesce(trim(v_blueprint #>> '{audience}'), '') = '' then
      v_errors := array_append(v_errors, 'Design readiness requires an audience');
    end if;

    if jsonb_typeof(v_input_fields) <> 'array' or jsonb_array_length(v_input_fields) = 0 then
      v_errors := array_append(v_errors, 'At least one input schema field is required');
    end if;

    if coalesce(v_format, '') = '' then
      v_errors := array_append(v_errors, 'Design readiness requires an output format');
    elsif v_format = 'json' and (jsonb_typeof(v_output_fields) <> 'array' or jsonb_array_length(v_output_fields) = 0) then
      v_errors := array_append(v_errors, 'JSON output apps require output_schema.fields');
    elsif v_format <> 'json' and (
      jsonb_typeof(v_format_rules) <> 'object'
      or v_format_rules = '{}'::jsonb
    ) then
      v_errors := array_append(v_errors, 'Design readiness requires output contract rules');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(coalesce(v_input_fields, '[]'::jsonb)) f
      where coalesce(f->>'field', '') = ''
        or coalesce(f->>'type', '') = ''
        or not (f->>'field' ~ '^[a-z][a-z0-9_]*$')
    ) then
      v_errors := array_append(v_errors, 'Every input schema field needs a valid field and type');
    end if;

    if v_format = 'json' and exists (
      select 1
      from jsonb_array_elements(coalesce(v_output_fields, '[]'::jsonb)) f
      where coalesce(f->>'field', '') = ''
        or coalesce(f->>'type', '') = ''
        or not (f->>'field' ~ '^[a-z][a-z0-9_]*$')
    ) then
      v_errors := array_append(v_errors, 'Every output schema field needs a valid field and type');
    end if;

    if v_permissions is null or jsonb_typeof(v_permissions) <> 'object' then
      v_errors := array_append(v_errors, 'Design readiness requires permissions to be reviewed');
    end if;
  end if;

  return query select cardinality(v_errors) = 0, v_errors;
end;
$$;

create or replace function public.set_app_published_with_gate(p_app_id uuid, p_publish boolean)
returns table(ok boolean, errors text[], is_published boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validation record;
begin
  if p_publish is false then
    update public.apps set is_published = false where id = p_app_id and (created_by = auth.uid() or created_by is null);
    return query select true, array[]::text[], false;
    return;
  end if;

  select * into v_validation from public.validate_app_publish_ready(p_app_id);
  if not v_validation.ok then
    return query select false, v_validation.errors, false;
    return;
  end if;

  update public.apps set is_published = true where id = p_app_id and (created_by = auth.uid() or created_by is null);
  return query select true, array[]::text[], true;
end;
$$;

grant execute on function public.validate_app_publish_ready(uuid) to authenticated;
grant execute on function public.set_app_published_with_gate(uuid, boolean) to authenticated;
