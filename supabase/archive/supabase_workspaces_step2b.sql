-- ════════════════════════════════════════════════════════════════════════════
-- Workspaces — STEP 2b: new rows go into the ACTIVE workspace
--
-- The web app sends the workspace the user is working in as an
-- `X-Workspace-Id` request header. When a row is inserted without a
-- workspace_id (apps, flows, run history, knowledge…), use that workspace —
-- but only if the row's owner is a member of it. Otherwise fall back to the
-- owner's Personal workspace, exactly as in step 1.
-- Access rules still decide whether the insert is allowed (e.g. a "member"
-- can't create apps in a team workspace). Run after step 2. Re-runnable.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function default_workspace_from_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  v_owner  uuid;
  v_header text;
begin
  if new.workspace_id is null then
    v_owner := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
    begin
      v_header := current_setting('request.headers', true)::json ->> 'x-workspace-id';
    exception when others then
      v_header := null;   -- not called through the API (SQL editor, cron…)
    end;
    if v_owner is not null
       and v_header ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       and exists (select 1 from workspace_members m
                    where m.workspace_id = v_header::uuid and m.user_id = v_owner) then
      new.workspace_id := v_header::uuid;
    elsif v_owner is not null then
      new.workspace_id := personal_workspace_id(v_owner);
    end if;
  end if;
  return new;
end $$;
