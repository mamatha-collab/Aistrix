-- Security: published apps' rows are readable by everyone (RLS limits rows,
-- not columns), so prompts, webhook URLs and custom model endpoints were
-- readable with the public anon key. From here on, browsers can read only the
-- public columns of apps. The app's own editors (and staff) read the private
-- ones through app_private_fields(); the backend uses the service role.
--
-- New columns are private by default: add them to the grant below only if
-- end users should be able to read them.

-- Multi-page apps keep each page's prompt in pages[].system_prompt. Runners
-- need the page names and fields, so expose a copy without the prompts.
create or replace function public.strip_page_prompts(p_pages jsonb)
returns jsonb
language sql
immutable
as $$
  select case when jsonb_typeof(p_pages) = 'array'
    then coalesce((select jsonb_agg(page - 'system_prompt' - 'prompt') from jsonb_array_elements(p_pages) page), '[]'::jsonb)
    else p_pages end
$$;

alter table public.apps add column if not exists pages_public jsonb
  generated always as (public.strip_page_prompts(pages)) stored;

revoke select on public.apps from anon, authenticated;
grant select (
  id, domain_id, name, description, emoji, color, tags, input_placeholder, ai_provider, ai_model,
  workflow_order, next_app_id, is_published, total_runs, created_at, created_by, is_verified, is_trending,
  is_top_rated, is_new, required_context, compose_hint, app_type, form_schema, output_type, visibility,
  is_paid, price_per_run, pages_public, has_memory, status, is_featured, sample_input, max_runs_per_day,
  version, has_draft_changes, embed_allowed_domains, embed_public, workspace_id, greeting, tone,
  billing_mode, free_runs_per_user_day, promoted_at, live_version
) on public.apps to anon, authenticated;
-- Private (not granted): system_prompt, pages, prod_snapshot, webhook_url,
-- custom_model_url, custom_model_name, change_note, review_notes.

-- The private columns, for apps the caller can edit (or staff can review).
create or replace function public.app_private_fields(p_app_ids uuid[])
returns table (id uuid, system_prompt text, pages jsonb, prod_snapshot jsonb, webhook_url text,
               custom_model_url text, custom_model_name text, change_note jsonb, review_notes text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.system_prompt, a.pages, a.prod_snapshot, a.webhook_url,
         a.custom_model_url, a.custom_model_name, a.change_note, a.review_notes
    from apps a
   where a.id = any(p_app_ids)
     and (can_edit_app(a.id) or is_staff())
$$;
revoke all on function public.app_private_fields(uuid[]) from public, anon;
grant execute on function public.app_private_fields(uuid[]) to authenticated, service_role;

-- The current values of an app, for update_app_fields' comparison (editors only).
create or replace function public.app_row_for_editor(p_app_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(a) from apps a where a.id = p_app_id and (can_edit_app(a.id) or is_staff())
$$;
revoke all on function public.app_row_for_editor(uuid) from public, anon;
grant execute on function public.app_row_for_editor(uuid) to authenticated, service_role;

-- Same contract as before; reads the current values through the editor-only
-- function instead of selecting private columns directly.
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
  if p_patch ? 'id' or p_patch ? 'pages_public' then
    raise exception 'That field cannot be changed' using errcode = '22023';
  end if;

  -- Lock the row (needs the caller's UPDATE rights: RLS hides other apps).
  perform 1 from apps a where a.id = p_app_id for update;
  v_row := app_row_for_editor(p_app_id);
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
