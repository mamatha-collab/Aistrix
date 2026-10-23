-- Fix: adding, editing or removing an app tool failed for everyone with
-- 'record "new" has no field "blueprint"'. mark_app_draft_changed() runs on
-- app_blueprints AND app_tools, and Postgres evaluates a whole IF condition
-- for the row it has — app_tools rows have no blueprint column. Check the
-- table first, then read the blueprint only for app_blueprints rows.
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
  if tg_table_name = 'app_blueprints' and tg_op = 'UPDATE' then
    if (new.blueprint - 'dev_phase') is not distinct from (old.blueprint - 'dev_phase') then
      return new;
    end if;
  end if;
  update apps set has_draft_changes = true where id = v_app and not has_draft_changes;
  return coalesce(new, old);
end;
$$;
