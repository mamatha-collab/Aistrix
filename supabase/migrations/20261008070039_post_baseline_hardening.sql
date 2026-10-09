-- Small hardening found in the post-workspaces review.

-- The one-off schema export used to create the baseline isn't needed any more.
drop function if exists public.aistrix_schema_ddl();
drop function if exists public.aistrix_schema_report();

-- personal_workspace_id() maps a user id to their workspace id. Only the
-- default-workspace trigger (signed-in inserts) and the backend need it;
-- signed-out visitors don't.
revoke execute on function public.personal_workspace_id(uuid) from public, anon;
grant execute on function public.personal_workspace_id(uuid) to authenticated, service_role;
