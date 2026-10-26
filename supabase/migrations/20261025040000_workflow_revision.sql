-- Two people editing the same workflow no longer overwrite each other: the
-- editor saves with the revision it opened, and a stale save changes nothing.
-- The revision moves only when what the editor saves (name, steps, trigger)
-- changes, so turning a webhook on or a run updating memory never causes a
-- false conflict. Existing workflows start at revision 1.
alter table public.flows add column if not exists revision integer not null default 1;

create or replace function public.bump_flow_revision()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.name is distinct from old.name
     or new.steps is distinct from old.steps
     or new."trigger" is distinct from old."trigger" then
    new.revision := old.revision + 1;
  else
    new.revision := old.revision;      -- a client can't set it directly
  end if;
  return new;
end $$;

drop trigger if exists flows_bump_revision on public.flows;
create trigger flows_bump_revision before update on public.flows
  for each row execute function public.bump_flow_revision();

notify pgrst, 'reload schema';
