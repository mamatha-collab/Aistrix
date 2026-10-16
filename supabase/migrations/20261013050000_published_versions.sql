-- Published versions: every publish saves v1, v2, v3… (the exact snapshot end
-- users run, what changed, and its test results); apps.live_version says
-- which one is live. Only the server (service role) creates published
-- versions or changes the live one — browsers can't fake either.

alter table public.app_versions add column if not exists version_num integer;
alter table public.app_versions add column if not exists tests jsonb;
create unique index if not exists app_versions_app_version_num
  on public.app_versions (app_id, version_num) where version_num is not null;

alter table public.apps add column if not exists live_version integer;

create or replace function public.app_versions_published_via_server()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    if tg_op = 'INSERT' and new.version_num is not null then
      raise exception 'Published versions are saved by publishing from Dev Studio → Deploy.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.version_num is distinct from old.version_num or new.version_data is distinct from old.version_data
                             or new.tests is distinct from old.tests) then
      raise exception 'Published versions can''t be edited.' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' and old.version_num is not null then
      raise exception 'Published versions can''t be deleted.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists app_versions_published_via_server on public.app_versions;
create trigger app_versions_published_via_server
  before insert or update or delete on public.app_versions
  for each row execute function public.app_versions_published_via_server();

-- Same guard as before, now also covering live_version.
create or replace function public.apps_publish_via_promote()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    if tg_op = 'INSERT' then
      if new.is_published or new.prod_snapshot is not null or new.promoted_at is not null or new.live_version is not null then
        raise exception 'New apps start as drafts. Publish from Dev Studio → Deploy once the checks and tests pass.'
          using errcode = '42501';
      end if;
    else
      if new.is_published and not old.is_published then
        raise exception 'Publish from Dev Studio → Deploy: it runs the publish checks and tests and saves the live version.'
          using errcode = '42501';
      end if;
      if new.prod_snapshot is distinct from old.prod_snapshot or new.promoted_at is distinct from old.promoted_at
         or new.live_version is distinct from old.live_version then
        raise exception 'The live version is set by promoting from Dev Studio → Deploy.'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
