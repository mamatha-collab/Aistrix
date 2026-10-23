-- Production-readiness migration for the "Ready" app types.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- ── Embeddable widgets: allowed host sites + anonymous visitor access ───────
alter table apps add column if not exists embed_allowed_domains text[] not null default '{}';
alter table apps add column if not exists embed_public boolean not null default false;

-- Visitor access is only for free apps (the backend also enforces this).
alter table apps drop constraint if exists apps_embed_public_free_only;
alter table apps add constraint apps_embed_public_free_only
  check (not (embed_public and coalesce(is_paid, false)));

-- ── Paid apps: atomic, server-side quota consumption ────────────────────────
-- Called by the backend (service role) after each successful run. Returns the
-- new run count. The old client-side increment was blocked by RLS, so quotas
-- were never actually counted.
create or replace function consume_entitlement_run(p_entitlement_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update app_entitlements
     set runs_this_period = runs_this_period + 1
   where id = p_entitlement_id
  returning runs_this_period;
$$;

revoke all on function consume_entitlement_run(uuid) from public, anon, authenticated;
grant execute on function consume_entitlement_run(uuid) to service_role;

-- ── API apps: developer keys are looked up by value on every API call ───────
create index if not exists developer_api_keys_api_key_active_idx
  on developer_api_keys(api_key) where is_active;
