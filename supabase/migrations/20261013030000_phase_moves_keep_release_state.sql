-- Moving an app between Design, Test and Deploy writes blueprint.dev_phase.
-- That is workflow state, not app behaviour, so it must not mark a published
-- app as having unpublished draft changes (the backend's tested-version
-- fingerprint ignores it too).
create or replace function public.mark_app_draft_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app uuid := coalesce(new.app_id, old.app_id);
begin
  -- app_blueprints: only the draft blueprint counts (promote writes blueprint_prod),
  -- and not the workflow phase.
  if tg_table_name = 'app_blueprints' and tg_op = 'UPDATE'
     and (new.blueprint - 'dev_phase') is not distinct from (old.blueprint - 'dev_phase') then
    return new;
  end if;
  update apps set has_draft_changes = true where id = v_app and not has_draft_changes;
  return coalesce(new, old);
end;
$$;
