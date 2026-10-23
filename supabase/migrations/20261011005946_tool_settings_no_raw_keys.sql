-- Keys never live in an app's tool settings (app_tools.config): they are app
-- secrets (app_secrets, encrypted by the backend) referenced as
-- {{secrets.NAME}} and filled in only when a tool runs. This rejects any
-- new or edited tool whose settings hold a raw key, so a key can't travel
-- with the app's definition. Existing raw keys: run
-- aistrix-backend/scripts/move_tool_keys_to_secrets.py.

create or replace function public.config_has_raw_key(config jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  k text;
  v text;
begin
  if config is null then
    return false;
  end if;
  -- Credential-named settings must be a {{secrets.NAME}} reference.
  for k, v in select e.key, e.value #>> '{}' from jsonb_each(config) e loop
    if lower(k) in ('api_key', 'apikey', 'token', 'access_token', 'auth_token', 'secret', 'password')
       and coalesce(v, '') <> ''
       and v !~ '^\s*\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}\s*$' then
      return true;
    end if;
  end loop;
  -- Anywhere else (e.g. headers): no recognisable provider keys or tokens.
  return config::text ~ '(sk-ant-[A-Za-z0-9_-]{8,}|sk-(proj-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|ak_live_[A-Za-z0-9]{8,}|SG\.[A-Za-z0-9_.-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})';
end;
$$;

create or replace function public.app_tools_no_raw_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.config_has_raw_key(new.config) then
    raise exception 'Tool "%" has an API key in its settings. Save it as an app secret and use {{secrets.NAME}} instead.', new.name
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists app_tools_no_raw_keys on public.app_tools;
create trigger app_tools_no_raw_keys
  before insert or update on public.app_tools
  for each row execute function public.app_tools_no_raw_keys();
