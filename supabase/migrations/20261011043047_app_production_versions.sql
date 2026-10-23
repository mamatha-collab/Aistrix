-- Draft vs production. End users run a frozen production copy of an app
-- (prod_snapshot: prompt, model, form, tone, blueprint, tools…); editors run
-- the draft. The backend writes prod_snapshot when an app is promoted
-- (POST /v1/apps/{id}/promote), which also requires the publish checks and
-- passing tests for the current draft. Browsers can't publish or write the
-- live version themselves.

alter table public.apps add column if not exists prod_snapshot jsonb;
alter table public.apps add column if not exists promoted_at timestamp with time zone;

-- Apps that are live today keep behaving exactly as they do now: their
-- current state becomes their production version.
update public.apps a set
  prod_snapshot = jsonb_build_object(
    'system_prompt', a.system_prompt, 'ai_provider', a.ai_provider, 'ai_model', a.ai_model,
    'output_type', a.output_type, 'form_schema', a.form_schema, 'tone', a.tone, 'greeting', a.greeting,
    'input_placeholder', a.input_placeholder, 'pages', a.pages, 'app_type', a.app_type, 'has_memory', a.has_memory,
    'blueprint', coalesce((select b.blueprint from public.app_blueprints b where b.app_id = a.id), '{}'::jsonb),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'description', t.description, 'type', t.type,
                                                           'config', t.config, 'input_schema', t.input_schema) order by t.name)
                       from public.app_tools t where t.app_id = a.id), '[]'::jsonb)),
  promoted_at = now(),
  has_draft_changes = false
where a.is_published and a.prod_snapshot is null;

-- Only the backend (promote) or staff may publish or set the live version.
create or replace function public.apps_publish_via_promote()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    if tg_op = 'INSERT' then
      if new.is_published or new.prod_snapshot is not null or new.promoted_at is not null then
        raise exception 'New apps start as drafts. Publish from Dev Studio → Deploy once the checks and tests pass.'
          using errcode = '42501';
      end if;
    else
      if new.is_published and not old.is_published then
        raise exception 'Publish from Dev Studio → Deploy: it runs the publish checks and tests and saves the live version.'
          using errcode = '42501';
      end if;
      if new.prod_snapshot is distinct from old.prod_snapshot or new.promoted_at is distinct from old.promoted_at then
        raise exception 'The live version is set by promoting from Dev Studio → Deploy.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_publish_via_promote on public.apps;
create trigger apps_publish_via_promote
  before insert or update on public.apps
  for each row execute function public.apps_publish_via_promote();

-- Any edit to what decides an app's behaviour marks it as having draft
-- changes (wherever the edit happens: Design, Prompt Studio, AI Behavior…).
create or replace function public.apps_mark_draft_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.system_prompt is distinct from old.system_prompt or new.ai_provider is distinct from old.ai_provider
    or new.ai_model is distinct from old.ai_model or new.output_type is distinct from old.output_type
    or new.form_schema is distinct from old.form_schema or new.tone is distinct from old.tone
    or new.greeting is distinct from old.greeting or new.input_placeholder is distinct from old.input_placeholder
    or new.pages is distinct from old.pages or new.app_type is distinct from old.app_type
    or new.has_memory is distinct from old.has_memory) then
    new.has_draft_changes := true;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_mark_draft_changes on public.apps;
create trigger apps_mark_draft_changes
  before update on public.apps
  for each row execute function public.apps_mark_draft_changes();

create or replace function public.mark_app_draft_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app uuid := coalesce(new.app_id, old.app_id);
begin
  -- app_blueprints: only the draft blueprint counts (promote writes blueprint_prod).
  if tg_table_name = 'app_blueprints' and tg_op = 'UPDATE' and new.blueprint is not distinct from old.blueprint then
    return new;
  end if;
  update apps set has_draft_changes = true where id = v_app and not has_draft_changes;
  return coalesce(new, old);
end;
$$;

drop trigger if exists app_blueprints_mark_draft on public.app_blueprints;
create trigger app_blueprints_mark_draft
  after insert or update on public.app_blueprints
  for each row execute function public.mark_app_draft_changed();

drop trigger if exists app_tools_mark_draft on public.app_tools;
create trigger app_tools_mark_draft
  after insert or update or delete on public.app_tools
  for each row execute function public.mark_app_draft_changed();

-- The publish RPC keeps unpublishing for editors; publishing through it is
-- for staff (moderation) only — everyone else promotes from Deploy.
create or replace function public.set_app_published_with_gate(p_app_id uuid, p_publish boolean)
returns table(ok boolean, errors text[], is_published boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_validation record;
begin
  if not can_edit_app(p_app_id) and not is_staff() then
    return query select false, array['Only people who can edit this app can change publishing']::text[], false;
    return;
  end if;
  if p_publish is false then
    update apps set is_published = false where id = p_app_id;
    return query select true, array[]::text[], false;
    return;
  end if;
  if not is_staff() then
    return query select false, array['Publish from Dev Studio → Deploy: it runs the publish checks and tests and saves the live version']::text[], false;
    return;
  end if;
  select * into v_validation from validate_app_publish_ready(p_app_id);
  if not v_validation.ok then
    return query select false, v_validation.errors, false;
    return;
  end if;
  update apps set is_published = true where id = p_app_id;
  return query select true, array[]::text[], true;
end $function$;
