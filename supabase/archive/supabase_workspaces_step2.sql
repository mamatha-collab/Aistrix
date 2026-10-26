-- ════════════════════════════════════════════════════════════════════════════
-- Workspaces — STEP 2: access rules use workspace membership
--
-- Roles:  owner, admin  → manage everything in the workspace
--         developer     → build and edit apps, tools, keys
--         member        → see and run the workspace's apps, use shared data
--         billing       → purchases and payouts
-- Everything a user could do before (as the creator/owner of a row) still
-- works: their Personal workspace makes them owner of their own data.
--
-- Still per user in this step (moved with the billing work later):
--   user_business_profiles, developer_profiles, user_api_keys (provider keys)
-- Run in the Supabase SQL editor after step 1. Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Permission helpers ───────────────────────────────────────────────────
-- Owner/admin of the app's workspace (or its creator). Existing policies on
-- app_members etc. call this, so they pick up workspaces automatically.
create or replace function is_app_owner(target_app_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from apps a
     where a.id = target_app_id
       and (a.created_by = auth.uid()
            or (a.workspace_id is not null and is_workspace_member(a.workspace_id, array['owner', 'admin'])))
  )
$$;

-- Can build/edit this app: creator, workspace owner/admin/developer, an app
-- shared with them as editor, or platform staff.
create or replace function can_edit_app(p_app_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from apps a
     where a.id = p_app_id
       and (a.created_by = auth.uid()
            or (a.workspace_id is not null and is_workspace_member(a.workspace_id, array['owner', 'admin', 'developer']))
            or is_app_member(a.id, array['editor', 'owner'])
            or is_staff())
  )
$$;

-- Members of a workspace with their email/name (auth.users isn't readable
-- from the browser). Only callable by members of that workspace.
create or replace function workspace_member_list(p_workspace_id uuid)
returns table(user_id uuid, email text, full_name text, role text, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name')::text, m.role, m.created_at
    from workspace_members m
    join auth.users u on u.id = m.user_id
   where m.workspace_id = p_workspace_id
     and is_workspace_member(p_workspace_id)
   order by m.created_at
$$;
revoke execute on function workspace_member_list(uuid) from public, anon;
grant execute on function workspace_member_list(uuid) to authenticated;

-- ── 2. Moving an app between workspaces needs rights on both sides ─────────
create or replace function protect_app_admin_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    if tg_op = 'INSERT' then
      new.is_verified := false; new.is_featured := false; new.is_trending := false;
      new.is_top_rated := false; new.is_new := false; new.total_runs := 0;
      new.status := 'approved'; new.review_notes := null;
    else
      new.is_verified := old.is_verified; new.is_featured := old.is_featured;
      new.is_trending := old.is_trending; new.is_top_rated := old.is_top_rated;
      new.is_new := old.is_new; new.total_runs := old.total_runs;
      new.status := old.status; new.review_notes := old.review_notes;
      if new.workspace_id is distinct from old.workspace_id then
        if not ((old.workspace_id is null and old.created_by = auth.uid())
                or is_workspace_member(old.workspace_id, array['owner', 'admin'])) then
          raise exception 'Only an owner or admin of the current workspace can move this app';
        end if;
        if new.workspace_id is not null
           and not is_workspace_member(new.workspace_id, array['owner', 'admin', 'developer']) then
          raise exception 'You can only move an app into a workspace where you can build apps';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- ── 3. Publishing: any app builder, not just the creator ────────────────────
create or replace function validate_app_publish_ready(p_app_id uuid)
returns table(ok boolean, errors text[])
language plpgsql security definer set search_path = public as $$
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
  select * into v_app from apps where id = p_app_id;
  if not found then
    return query select false, array['App not found']::text[];
    return;
  end if;

  if not can_edit_app(p_app_id) then
    return query select false, array['Only people who can edit this app can publish it']::text[];
    return;
  end if;

  select blueprint into v_blueprint from app_blueprints where app_id = p_app_id;

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
    elsif v_format <> 'json' and (jsonb_typeof(v_format_rules) <> 'object' or v_format_rules = '{}'::jsonb) then
      v_errors := array_append(v_errors, 'Design readiness requires output contract rules');
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_input_fields, '[]'::jsonb)) f
       where coalesce(f->>'field', '') = '' or coalesce(f->>'type', '') = ''
          or not (f->>'field' ~ '^[a-z][a-z0-9_]*$')
    ) then
      v_errors := array_append(v_errors, 'Every input schema field needs a valid field and type');
    end if;
    if v_format = 'json' and exists (
      select 1 from jsonb_array_elements(coalesce(v_output_fields, '[]'::jsonb)) f
       where coalesce(f->>'field', '') = '' or coalesce(f->>'type', '') = ''
          or not (f->>'field' ~ '^[a-z][a-z0-9_]*$')
    ) then
      v_errors := array_append(v_errors, 'Every output schema field needs a valid field and type');
    end if;
    if v_permissions is null or jsonb_typeof(v_permissions) <> 'object' then
      v_errors := array_append(v_errors, 'Design readiness requires permissions to be reviewed');
    end if;
  end if;

  return query select cardinality(v_errors) = 0, v_errors;
end $$;

create or replace function set_app_published_with_gate(p_app_id uuid, p_publish boolean)
returns table(ok boolean, errors text[], is_published boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_validation record;
begin
  if not can_edit_app(p_app_id) then
    return query select false, array['Only people who can edit this app can change publishing']::text[], false;
    return;
  end if;
  if p_publish is false then
    update apps set is_published = false where id = p_app_id;
    return query select true, array[]::text[], false;
    return;
  end if;
  select * into v_validation from validate_app_publish_ready(p_app_id);
  if not v_validation.ok then
    return query select false, v_validation.errors, false;
    return;
  end if;
  update apps set is_published = true where id = p_app_id;
  return query select true, array[]::text[], true;
end $$;

-- ── 4. Access rules ─────────────────────────────────────────────────────────
-- apps
drop policy if exists apps_select on apps;
create policy apps_select on apps for select to anon, authenticated
  using (is_published
         or created_by = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id))
         or is_app_member(id) or is_staff()
         or exists (select 1 from marketplace_listings m where m.app_id = apps.id and m.status = 'live'));
drop policy if exists apps_insert on apps;
create policy apps_insert on apps for insert to authenticated
  with check (created_by = (select auth.uid())
              and (workspace_id is null or is_workspace_member(workspace_id, array['owner', 'admin', 'developer'])));
drop policy if exists apps_update on apps;
create policy apps_update on apps for update to authenticated
  using (can_edit_app(id))
  with check (can_edit_app(id) or is_staff());
drop policy if exists apps_delete on apps;
create policy apps_delete on apps for delete to authenticated
  using (is_app_owner(id) or is_staff());

-- app child records: whoever can edit the app
drop policy if exists app_blueprints_select on app_blueprints;
create policy app_blueprints_select on app_blueprints for select to authenticated
  using (user_id = (select auth.uid()) or can_edit_app(app_id));
drop policy if exists app_blueprints_insert on app_blueprints;
create policy app_blueprints_insert on app_blueprints for insert to authenticated
  with check (user_id = (select auth.uid()) and can_edit_app(app_id));
drop policy if exists app_blueprints_update on app_blueprints;
create policy app_blueprints_update on app_blueprints for update to authenticated
  using (can_edit_app(app_id)) with check (can_edit_app(app_id));
drop policy if exists app_blueprints_delete on app_blueprints;
create policy app_blueprints_delete on app_blueprints for delete to authenticated
  using (can_edit_app(app_id));

drop policy if exists app_tools_owner on app_tools;
create policy app_tools_owner on app_tools for all to authenticated
  using (can_edit_app(app_id)) with check (can_edit_app(app_id));

drop policy if exists app_knowledge_owner on app_knowledge;
create policy app_knowledge_owner on app_knowledge for all to authenticated
  using (can_edit_app(app_id)) with check (can_edit_app(app_id));

drop policy if exists app_versions_select on app_versions;
create policy app_versions_select on app_versions for select to authenticated
  using (user_id = (select auth.uid()) or can_edit_app(app_id));
drop policy if exists app_versions_insert on app_versions;
create policy app_versions_insert on app_versions for insert to authenticated
  with check (user_id = (select auth.uid()) and can_edit_app(app_id));

drop policy if exists app_test_cases_own on app_test_cases;
create policy app_test_cases_own on app_test_cases for all to authenticated
  using (user_id = (select auth.uid()) or can_edit_app(app_id))
  with check (user_id = (select auth.uid()) and can_edit_app(app_id));

drop policy if exists blueprint_test_results_own on blueprint_test_results;
create policy blueprint_test_results_own on blueprint_test_results for all to authenticated
  using (user_id = (select auth.uid()) or can_edit_app(app_id))
  with check (user_id = (select auth.uid()) and can_edit_app(app_id));

drop policy if exists app_files_select on app_files;
create policy app_files_select on app_files for select to authenticated
  using (owner_id = (select auth.uid()) or can_edit_app(app_id));
drop policy if exists app_files_delete on app_files;
create policy app_files_delete on app_files for delete to authenticated
  using (owner_id = (select auth.uid()) or can_edit_app(app_id));

-- purchases: a purchase covers the buying workspace
drop policy if exists app_entitlements_select on app_entitlements;
create policy app_entitlements_select on app_entitlements for select to authenticated
  using (user_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id))
         or is_app_owner(app_id));
drop policy if exists purchases_select on purchases;
create policy purchases_select on purchases for select to authenticated
  using (buyer_id = (select auth.uid()) or dev_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin', 'billing']))
         or is_app_owner(app_id));

-- developer API keys belong to the workspace (created via POST /v1/keys)
drop policy if exists developer_api_keys_select on developer_api_keys;
create policy developer_api_keys_select on developer_api_keys for select to authenticated
  using (user_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin', 'developer'])));
drop policy if exists developer_api_keys_update on developer_api_keys;
create policy developer_api_keys_update on developer_api_keys for update to authenticated
  using (user_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])))
  with check (user_id = (select auth.uid())
              or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])));
drop policy if exists developer_api_keys_delete on developer_api_keys;
create policy developer_api_keys_delete on developer_api_keys for delete to authenticated
  using (user_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])));

-- flows: shared with the workspace; members create, creator/admins manage
drop policy if exists flows_select on flows;
create policy flows_select on flows for select to anon, authenticated
  using (user_id = (select auth.uid()) or is_published or is_flow_member(id)
         or (workspace_id is not null and is_workspace_member(workspace_id)));
drop policy if exists flows_insert on flows;
create policy flows_insert on flows for insert to authenticated
  with check (user_id = (select auth.uid())
              and (workspace_id is null or is_workspace_member(workspace_id)));
drop policy if exists flows_update on flows;
create policy flows_update on flows for update to authenticated
  using (user_id = (select auth.uid()) or is_flow_editor(id)
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin', 'developer'])))
  with check (workspace_id is null or is_workspace_member(workspace_id) or is_flow_editor(id));
drop policy if exists flows_delete on flows;
create policy flows_delete on flows for delete to authenticated
  using (user_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])));

-- shared company knowledge
do $$
declare t text;
begin
  foreach t in array array['knowledge_vault', 'user_data_sources'] loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format($p$create policy %I on %I for select to authenticated
      using (user_id = (select auth.uid()) or (workspace_id is not null and is_workspace_member(workspace_id)))$p$,
      t || '_select', t);
    execute format($p$create policy %I on %I for insert to authenticated
      with check (user_id = (select auth.uid()) and (workspace_id is null or is_workspace_member(workspace_id)))$p$,
      t || '_insert', t);
    execute format($p$create policy %I on %I for update to authenticated
      using (user_id = (select auth.uid()) or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])))
      with check (workspace_id is null or is_workspace_member(workspace_id))$p$,
      t || '_update', t);
    execute format($p$create policy %I on %I for delete to authenticated
      using (user_id = (select auth.uid()) or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])))$p$,
      t || '_delete', t);
  end loop;
end $$;

-- personal activity, visible to workspace owners/admins for team analytics
do $$
declare t text;
begin
  foreach t in array array['run_history', 'app_records', 'scheduled_events'] loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format('drop policy if exists %I on %I', t || '_admin_read', t);
    execute format($p$create policy %I on %I for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t || '_own', t);
    execute format($p$create policy %I on %I for select to authenticated
      using (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin']))$p$,
      t || '_admin_read', t);
  end loop;
end $$;

drop policy if exists batch_jobs_select on batch_jobs;
create policy batch_jobs_select on batch_jobs for select to authenticated
  using (user_id = (select auth.uid())
         or (workspace_id is not null and is_workspace_member(workspace_id, array['owner', 'admin'])));
drop policy if exists batch_job_rows_select on batch_job_rows;
create policy batch_job_rows_select on batch_job_rows for select to authenticated
  using (exists (select 1 from batch_jobs j
                  where j.id = batch_job_rows.job_id
                    and (j.user_id = (select auth.uid())
                         or (j.workspace_id is not null and is_workspace_member(j.workspace_id, array['owner', 'admin'])))));

commit;
