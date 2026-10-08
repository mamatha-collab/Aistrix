-- ════════════════════════════════════════════════════════════════════════════
-- Aistrix database cleanup — PART 1 (safe; keeps all data)
-- Run in the Supabase SQL editor. Re-runnable. Run BEFORE deploying the
-- matching code (it copies data the new code reads).
-- Part 2 (supabase_db_cleanup_2_drop.sql) removes the dead tables/columns
-- afterwards.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Data: one canonical column each ─────────────────────────────────────
-- run_history.result → output (runners already write output; history pages
-- read result, so recent runs showed blank). rating → rating_value.
update run_history set output = result where output is null and result is not null;
update run_history set rating_value = rating, rating_type = coalesce(rating_type, 'thumb')
 where rating_value is null and rating is not null;

-- ── 2. Helper: platform staff (admin or moderator) ─────────────────────────
create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'moderator'))
$$;

-- ── 3. Server-only run metering (rate limits) ──────────────────────────────
-- Rate limits used to count run_history, which browsers write and users can
-- delete. The backend now writes one row here per platform-metered run.
create table if not exists run_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  app_id      uuid references apps(id) on delete set null,
  source      text not null default 'app',
  created_at  timestamptz not null default now()
);
create index if not exists run_events_user_time_idx on run_events(user_id, created_at desc);
alter table run_events enable row level security;   -- no policies: backend (service role) only

-- ── 4. Relationships ───────────────────────────────────────────────────────
-- Deleting a run from history failed when a payment/record referenced it.
alter table app_payments drop constraint if exists app_payments_run_id_fkey;
alter table app_payments add constraint app_payments_run_id_fkey
  foreign key (run_id) references run_history(id) on delete set null;
alter table app_records drop constraint if exists app_records_run_id_fkey;
alter table app_records add constraint app_records_run_id_fkey
  foreign key (run_id) references run_history(id) on delete set null;

-- These blocked deleting a user account.
alter table app_entitlements drop constraint if exists app_entitlements_user_id_fkey;
alter table app_entitlements add constraint app_entitlements_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table app_versions drop constraint if exists app_versions_user_id_fkey;
alter table app_versions add constraint app_versions_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
alter table developer_settings drop constraint if exists developer_settings_user_id_fkey;
alter table developer_settings add constraint developer_settings_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- user_goals.app_id pointed nowhere.
update user_goals g set app_id = null where app_id is not null and not exists (select 1 from apps a where a.id = g.app_id);
alter table user_goals drop constraint if exists user_goals_app_id_fkey;
alter table user_goals add constraint user_goals_app_id_fkey
  foreign key (app_id) references apps(id) on delete cascade;

-- Owner columns that are always set (verified: no nulls today).
alter table favorites alter column user_id set not null, alter column app_id set not null;
alter table run_history alter column user_id set not null;
alter table user_career_profiles alter column user_id set not null;
alter table user_business_profiles alter column user_id set not null;
alter table user_memory alter column user_id set not null;
alter table app_entitlements alter column app_id set not null, alter column user_id set not null;
alter table user_data_sources alter column user_id set not null;
alter table app_tools alter column app_id set not null;
alter table notifications alter column user_id set not null;
alter table marketplace_listings alter column app_id set not null, alter column user_id set not null;
alter table developer_settings alter column user_id set not null;
alter table app_versions alter column app_id set not null;
alter table user_api_keys alter column user_id set not null;
alter table developer_profiles alter column user_id set not null;
alter table user_goals alter column user_id set not null;
alter table scheduled_events alter column user_id set not null, alter column app_id set not null;
alter table app_knowledge alter column app_id set not null;
alter table app_records alter column app_id set not null, alter column user_id set not null;
alter table user_alerts alter column user_id set not null;
alter table developer_api_keys alter column user_id set not null;
alter table conversation_threads alter column app_id set not null, alter column user_id set not null;
alter table app_test_cases alter column app_id set not null, alter column user_id set not null;
alter table blueprint_test_results alter column app_id set not null, alter column user_id set not null;
alter table purchases alter column app_id set not null;
alter table app_payments alter column app_id set not null, alter column user_id set not null;

-- ── 5. Timestamps: everything in timestamptz (stored values are UTC) ───────
-- Browsers parsed the zone-less ones as local time, skewing dates.
do $$ begin if (select data_type from information_schema.columns where table_schema='public' and table_name='apps' and column_name='created_at') = 'timestamp without time zone' then alter table apps alter column created_at type timestamptz using created_at at time zone 'UTC'; end if; end $$;
do $$ begin if (select data_type from information_schema.columns where table_schema='public' and table_name='run_history' and column_name='created_at') = 'timestamp without time zone' then alter table run_history alter column created_at type timestamptz using created_at at time zone 'UTC'; end if; end $$;
do $$ begin if (select data_type from information_schema.columns where table_schema='public' and table_name='favorites' and column_name='created_at') = 'timestamp without time zone' then alter table favorites alter column created_at type timestamptz using created_at at time zone 'UTC'; end if; end $$;
do $$ begin if (select data_type from information_schema.columns where table_schema='public' and table_name='user_api_keys' and column_name='created_at') = 'timestamp without time zone' then alter table user_api_keys alter column created_at type timestamptz using created_at at time zone 'UTC'; end if; end $$;
do $$ begin if (select data_type from information_schema.columns where table_schema='public' and table_name='domains' and column_name='created_at') = 'timestamp without time zone' then alter table domains alter column created_at type timestamptz using created_at at time zone 'UTC'; end if; end $$;
do $$ begin if (select data_type from information_schema.columns where table_schema='public' and table_name='developer_profiles' and column_name='created_at') = 'timestamp without time zone' then alter table developer_profiles alter column created_at type timestamptz using created_at at time zone 'UTC'; end if; end $$;

-- ── 6. Indexes: cover hot paths and foreign keys; drop duplicates ──────────
-- Rate limits + History page (was a sequential scan on every run).
create index if not exists run_history_user_time_idx  on run_history(user_id, created_at desc);
create index if not exists run_history_app_time_idx   on run_history(app_id, created_at desc);
-- Read on every run.
create index if not exists app_tools_app_id_idx       on app_tools(app_id);
create index if not exists app_knowledge_app_id_idx   on app_knowledge(app_id);
-- Foreign keys / RLS filters.
create index if not exists apps_domain_id_idx              on apps(domain_id);
create index if not exists apps_published_idx              on apps(created_at desc) where is_published;
create index if not exists app_entitlements_user_id_idx    on app_entitlements(user_id);
create index if not exists app_payments_user_id_idx        on app_payments(user_id);
create index if not exists app_payments_app_id_idx         on app_payments(app_id);
create index if not exists app_payments_run_id_idx         on app_payments(run_id);
create index if not exists app_records_user_time_idx       on app_records(user_id, created_at desc);
create index if not exists app_records_app_id_idx          on app_records(app_id);
create index if not exists app_records_run_id_idx          on app_records(run_id);
create index if not exists app_reviews_user_id_idx         on app_reviews(user_id);
create index if not exists app_test_cases_app_id_idx       on app_test_cases(app_id);
create index if not exists app_versions_app_time_idx       on app_versions(app_id, created_at desc);
create index if not exists batch_jobs_app_id_idx           on batch_jobs(app_id);
create index if not exists conversation_threads_user_idx   on conversation_threads(user_id, created_at desc);
create index if not exists conversation_threads_app_idx    on conversation_threads(app_id);
create index if not exists thread_messages_thread_time_idx on thread_messages(thread_id, created_at);
create index if not exists developer_api_keys_user_id_idx  on developer_api_keys(user_id);
create index if not exists favorites_app_id_idx            on favorites(app_id);
create index if not exists flow_members_user_id_idx        on flow_members(user_id);
create index if not exists flow_schedules_flow_id_idx      on flow_schedules(flow_id);
create index if not exists flow_schedules_user_id_idx      on flow_schedules(user_id);
create index if not exists knowledge_vault_user_id_idx     on knowledge_vault(user_id);
create index if not exists marketplace_listings_user_idx   on marketplace_listings(user_id);
create index if not exists notifications_user_time_idx     on notifications(user_id, created_at desc);
create index if not exists purchases_buyer_id_idx          on purchases(buyer_id);
create index if not exists scheduled_events_user_id_idx    on scheduled_events(user_id);
create index if not exists scheduled_events_app_id_idx     on scheduled_events(app_id);
create index if not exists user_alerts_user_id_idx         on user_alerts(user_id);
create index if not exists user_data_sources_user_id_idx   on user_data_sources(user_id);
create index if not exists user_goals_user_id_idx          on user_goals(user_id);
-- Duplicates / never useful.
drop index if exists developer_api_keys_api_key_active_idx;   -- same column as the unique key
drop index if exists marketplace_listings_app_status_idx;     -- app_id is already unique
drop index if exists app_entitlements_active_idx;             -- low-selectivity, never used
drop index if exists app_versions_app_id_idx;                 -- replaced by app_versions_app_time_idx
drop index if exists app_versions_created_at_idx;             -- replaced by app_versions_app_time_idx

-- ── 7. Admin-only columns can't be self-set ────────────────────────────────
-- Owners could mark their own apps verified/featured/approved or set
-- total_runs. Staff, the backend and SECURITY DEFINER functions still can.
create or replace function protect_app_admin_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    if tg_op = 'INSERT' then
      new.is_verified := false; new.is_featured := false; new.is_trending := false;
      new.is_top_rated := false; new.is_new := false; new.total_runs := 0;
      new.status := 'approved'; new.review_notes := null;
    else
      new.is_verified := old.is_verified; new.is_featured := old.is_featured;
      new.is_trending := old.is_trending; new.is_top_rated := old.is_top_rated;
      new.is_new := old.is_new; new.total_runs := old.total_runs;
      new.status := old.status; new.review_notes := old.review_notes;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists apps_protect_admin_columns on apps;
create trigger apps_protect_admin_columns before insert or update on apps
  for each row execute function protect_app_admin_columns();

create or replace function protect_developer_profile_columns()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') and not is_staff() then
    if tg_op = 'INSERT' then
      new.is_verified := false; new.total_earnings := 0; new.stripe_account_id := null;
    else
      new.is_verified := old.is_verified; new.total_earnings := old.total_earnings;
      new.stripe_account_id := old.stripe_account_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists developer_profiles_protect_columns on developer_profiles;
create trigger developer_profiles_protect_columns before insert or update on developer_profiles
  for each row execute function protect_developer_profile_columns();

-- ── 8. Functions: pin search_path, close anonymous access ──────────────────
alter function increment_app_runs(uuid)   set search_path = public;
alter function is_flow_editor(uuid)       set search_path = public;
alter function is_flow_member(uuid)       set search_path = public;
alter function resolve_flow_invites()     set search_path = public;
revoke execute on function increment_app_runs(uuid) from public, anon;
grant  execute on function increment_app_runs(uuid) to authenticated, service_role;
revoke execute on function resolve_flow_invites()  from public, anon;
grant  execute on function resolve_flow_invites()  to authenticated, service_role;

-- Badges now read rating_value (rating is removed in part 2).
create or replace function update_app_badges()
returns void language plpgsql security definer set search_path = public as $$
begin
  update apps set is_trending = false, is_top_rated = false, is_new = false
   where is_trending or is_top_rated or is_new;
  with trending as (
    select app_id, count(*) run_count from run_history
     where created_at >= now() - interval '7 days' and app_id is not null
     group by app_id order by run_count desc limit 15
  )
  update apps set is_trending = true where id in (select app_id from trending);
  with rated as (
    select app_id,
           count(*) filter (where rating_value = 1) pos,
           count(*) filter (where rating_value is not null) total
      from run_history where app_id is not null
     group by app_id
    having count(*) filter (where rating_value is not null) >= 5
  )
  update apps set is_top_rated = true
   where id in (select app_id from rated where pos::float / total >= 0.7);
  update apps set is_new = true
   where created_at >= now() - interval '14 days' and is_published;
end $$;
revoke execute on function update_app_badges() from public, anon;
grant  execute on function update_app_badges() to authenticated, service_role;

-- Ownerless apps could be published/unpublished by anyone.
create or replace function set_app_published_with_gate(p_app_id uuid, p_publish boolean)
returns table(ok boolean, errors text[], is_published boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_validation record;
  v_allowed boolean;
begin
  select exists (
    select 1 from apps a where a.id = p_app_id
       and (a.created_by = auth.uid() or is_app_member(a.id, array['editor','owner']) or is_staff())
  ) into v_allowed;
  if not v_allowed then
    return query select false, array['Only the app owner can change publishing']::text[], false;
    return;
  end if;

  if p_publish is false then
    update apps set is_published = false where id = p_app_id;
    return query select true, array[]::text[], false;
    return;
  end if;

  select * into v_validation from validate_app_publish_ready(p_app_id);
  if not v_validation.ok then
    return query select false, v_validation.errors, false;
    return;
  end if;

  update apps set is_published = true where id = p_app_id;
  return query select true, array[]::text[], true;
end $$;

-- ── 9. Access policies: one clear set per table ────────────────────────────
-- Replaces 128 overlapping policies. Permissive policies are OR-ed, so the
-- old "deny" policies did nothing next to an "allow all" one (e.g. clients
-- could still insert API keys). auth.uid() is wrapped in a sub-select so
-- Postgres evaluates it once per query instead of once per row.
-- Notable behaviour changes (intended):
--   • owners can now see their own unpublished apps
--   • admins/moderators can now moderate other people's apps
--   • app tools/knowledge are no longer world-readable (the backend reads them)
--   • API keys can only be created through the backend

-- app_blueprints
drop policy if exists "Developers can delete own app blueprints" on app_blueprints;
drop policy if exists "Developers can insert own app blueprints" on app_blueprints;
drop policy if exists "Developers can read own app blueprints" on app_blueprints;
drop policy if exists "Developers can update own app blueprints" on app_blueprints;
drop policy if exists "app_blueprints_select" on app_blueprints;
create policy "app_blueprints_select" on app_blueprints for select to authenticated
  using (user_id = (select auth.uid()) or is_app_owner(app_id));
drop policy if exists "app_blueprints_insert" on app_blueprints;
create policy "app_blueprints_insert" on app_blueprints for insert to authenticated
  with check (user_id = (select auth.uid()) and is_app_owner(app_id));
drop policy if exists "app_blueprints_update" on app_blueprints;
create policy "app_blueprints_update" on app_blueprints for update to authenticated
  using (user_id = (select auth.uid()) or is_app_owner(app_id))
  with check (user_id = (select auth.uid()) and is_app_owner(app_id));
drop policy if exists "app_blueprints_delete" on app_blueprints;
create policy "app_blueprints_delete" on app_blueprints for delete to authenticated
  using (user_id = (select auth.uid()) or is_app_owner(app_id));

-- app_entitlements
drop policy if exists "entitlements_no_delete" on app_entitlements;
drop policy if exists "entitlements_no_insert" on app_entitlements;
drop policy if exists "entitlements_no_update" on app_entitlements;
drop policy if exists "entitlements_select" on app_entitlements;
drop policy if exists "app_entitlements_select" on app_entitlements;
create policy "app_entitlements_select" on app_entitlements for select to authenticated
  using (user_id = (select auth.uid()) or is_app_owner(app_id));

-- app_files
drop policy if exists "app_files_app_owner_select" on app_files;
drop policy if exists "app_files_owner_delete" on app_files;
drop policy if exists "app_files_owner_insert" on app_files;
drop policy if exists "app_files_owner_select" on app_files;
drop policy if exists "app_files_select" on app_files;
create policy "app_files_select" on app_files for select to authenticated
  using (owner_id = (select auth.uid()) or is_app_owner(app_id));
drop policy if exists "app_files_insert" on app_files;
create policy "app_files_insert" on app_files for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists "app_files_delete" on app_files;
create policy "app_files_delete" on app_files for delete to authenticated
  using (owner_id = (select auth.uid()));

-- app_knowledge
drop policy if exists "Owners manage knowledge" on app_knowledge;
drop policy if exists "Public read knowledge" on app_knowledge;
drop policy if exists "app_knowledge_owner" on app_knowledge;
drop policy if exists "app_knowledge_published_read" on app_knowledge;
drop policy if exists "app_knowledge_owner" on app_knowledge;
create policy "app_knowledge_owner" on app_knowledge for all to authenticated
  using (is_app_owner(app_id))
  with check (is_app_owner(app_id));

-- app_members
drop policy if exists "app_members_delete" on app_members;
drop policy if exists "app_members_insert" on app_members;
drop policy if exists "app_members_select" on app_members;
drop policy if exists "app_members_update" on app_members;
drop policy if exists "app_members_select" on app_members;
create policy "app_members_select" on app_members for select to authenticated
  using (user_id = (select auth.uid()) or invited_email = (select auth.jwt() ->> 'email') or is_app_owner(app_id));
drop policy if exists "app_members_insert" on app_members;
create policy "app_members_insert" on app_members for insert to authenticated
  with check (is_app_owner(app_id));
drop policy if exists "app_members_update" on app_members;
create policy "app_members_update" on app_members for update to authenticated
  using (is_app_owner(app_id))
  with check (is_app_owner(app_id));
drop policy if exists "app_members_delete" on app_members;
create policy "app_members_delete" on app_members for delete to authenticated
  using (is_app_owner(app_id));

-- app_payments
drop policy if exists "Users insert own payments" on app_payments;
drop policy if exists "Users read own payments" on app_payments;
drop policy if exists "app_payments_select" on app_payments;
create policy "app_payments_select" on app_payments for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "app_payments_insert" on app_payments;
create policy "app_payments_insert" on app_payments for insert to authenticated
  with check (user_id = (select auth.uid()));

-- app_records
drop policy if exists "Users manage own records" on app_records;
drop policy if exists "app_records_own" on app_records;
create policy "app_records_own" on app_records for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- app_reviews
drop policy if exists "app_reviews_delete_own" on app_reviews;
drop policy if exists "app_reviews_insert_own" on app_reviews;
drop policy if exists "app_reviews_public_read" on app_reviews;
drop policy if exists "app_reviews_update_own" on app_reviews;
drop policy if exists "app_reviews_select" on app_reviews;
create policy "app_reviews_select" on app_reviews for select to anon, authenticated
  using (exists (select 1 from marketplace_listings m where m.app_id = app_reviews.app_id and m.status = 'live'));
drop policy if exists "app_reviews_insert" on app_reviews;
create policy "app_reviews_insert" on app_reviews for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "app_reviews_update" on app_reviews;
create policy "app_reviews_update" on app_reviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "app_reviews_delete" on app_reviews;
create policy "app_reviews_delete" on app_reviews for delete to authenticated
  using (user_id = (select auth.uid()));

-- app_secrets
drop policy if exists "owner_delete" on app_secrets;
drop policy if exists "secrets_deny_all_deletes" on app_secrets;
drop policy if exists "secrets_deny_all_reads" on app_secrets;
drop policy if exists "secrets_deny_all_updates" on app_secrets;
drop policy if exists "secrets_deny_all_writes" on app_secrets;

-- app_test_cases
drop policy if exists "owner" on app_test_cases;
drop policy if exists "app_test_cases_own" on app_test_cases;
create policy "app_test_cases_own" on app_test_cases for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- app_tools
drop policy if exists "App creators manage their tools" on app_tools;
drop policy if exists "Public can read tools for published apps" on app_tools;
drop policy if exists "app_tools_owner" on app_tools;
drop policy if exists "app_tools_published_read" on app_tools;
drop policy if exists "app_tools_owner" on app_tools;
create policy "app_tools_owner" on app_tools for all to authenticated
  using (is_app_owner(app_id))
  with check (is_app_owner(app_id));

-- app_versions
drop policy if exists "Users can insert own app versions" on app_versions;
drop policy if exists "Users can read own app versions" on app_versions;
drop policy if exists "Users insert own versions" on app_versions;
drop policy if exists "Users read own versions" on app_versions;
drop policy if exists "app_versions_select" on app_versions;
create policy "app_versions_select" on app_versions for select to authenticated
  using (user_id = (select auth.uid()) or is_app_owner(app_id));
drop policy if exists "app_versions_insert" on app_versions;
create policy "app_versions_insert" on app_versions for insert to authenticated
  with check (user_id = (select auth.uid()));

-- apps
drop policy if exists "Anyone can read published apps" on apps;
drop policy if exists "Developers manage own apps" on apps;
drop policy if exists "Users can delete own apps" on apps;
drop policy if exists "Users can insert own apps" on apps;
drop policy if exists "Users can update own apps" on apps;
drop policy if exists "apps_select_via_membership" on apps;
drop policy if exists "apps_update_via_membership" on apps;
drop policy if exists "public_read_listed" on apps;
drop policy if exists "apps_select" on apps;
create policy "apps_select" on apps for select to anon, authenticated
  using (is_published or created_by = (select auth.uid()) or is_app_member(id) or is_staff() or exists (select 1 from marketplace_listings m where m.app_id = apps.id and m.status = 'live'));
drop policy if exists "apps_insert" on apps;
create policy "apps_insert" on apps for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists "apps_update" on apps;
create policy "apps_update" on apps for update to authenticated
  using (created_by = (select auth.uid()) or is_app_member(id, array['editor','owner']) or is_staff())
  with check (created_by = (select auth.uid()) or is_app_member(id, array['editor','owner']) or is_staff());
drop policy if exists "apps_delete" on apps;
create policy "apps_delete" on apps for delete to authenticated
  using (created_by = (select auth.uid()) or is_staff());

-- batch_job_rows
drop policy if exists "batch_job_rows_select_own" on batch_job_rows;
drop policy if exists "batch_job_rows_select" on batch_job_rows;
create policy "batch_job_rows_select" on batch_job_rows for select to authenticated
  using (exists (select 1 from batch_jobs j where j.id = batch_job_rows.job_id and j.user_id = (select auth.uid())));

-- batch_jobs
drop policy if exists "batch_jobs_select_own" on batch_jobs;
drop policy if exists "batch_jobs_select" on batch_jobs;
create policy "batch_jobs_select" on batch_jobs for select to authenticated
  using (user_id = (select auth.uid()));

-- blueprint_test_results
drop policy if exists "owner" on blueprint_test_results;
drop policy if exists "blueprint_test_results_own" on blueprint_test_results;
create policy "blueprint_test_results_own" on blueprint_test_results for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- conversation_threads
drop policy if exists "Users manage own threads" on conversation_threads;
drop policy if exists "conversation_threads_own" on conversation_threads;
create policy "conversation_threads_own" on conversation_threads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- developer_api_keys
drop policy if exists "Users manage own dev keys" on developer_api_keys;
drop policy if exists "developer_api_keys_delete_own" on developer_api_keys;
drop policy if exists "developer_api_keys_select_own" on developer_api_keys;
drop policy if exists "developer_api_keys_update_own" on developer_api_keys;
drop policy if exists "developer_api_keys_select" on developer_api_keys;
create policy "developer_api_keys_select" on developer_api_keys for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "developer_api_keys_update" on developer_api_keys;
create policy "developer_api_keys_update" on developer_api_keys for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "developer_api_keys_delete" on developer_api_keys;
create policy "developer_api_keys_delete" on developer_api_keys for delete to authenticated
  using (user_id = (select auth.uid()));

-- developer_profiles
drop policy if exists "Users manage own profile" on developer_profiles;
drop policy if exists "developer_profiles_own" on developer_profiles;
create policy "developer_profiles_own" on developer_profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- developer_settings
drop policy if exists "dev_settings_no_delete" on developer_settings;
drop policy if exists "dev_settings_no_insert" on developer_settings;
drop policy if exists "dev_settings_no_update" on developer_settings;
drop policy if exists "dev_settings_select_own" on developer_settings;
drop policy if exists "owner" on developer_settings;
drop policy if exists "developer_settings_own" on developer_settings;
create policy "developer_settings_own" on developer_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- domains
drop policy if exists "Anyone can read domains" on domains;
drop policy if exists "domains_read" on domains;
create policy "domains_read" on domains for select to anon, authenticated
  using (true);

-- favorites
drop policy if exists "Users manage own favorites" on favorites;
drop policy if exists "favorites_own" on favorites;
create policy "favorites_own" on favorites for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- flow_members
drop policy if exists "flow_members_delete" on flow_members;
drop policy if exists "flow_members_insert" on flow_members;
drop policy if exists "flow_members_select" on flow_members;
drop policy if exists "flow_members_select" on flow_members;
create policy "flow_members_select" on flow_members for select to authenticated
  using (user_id = (select auth.uid()) or lower(invited_email) = lower((select auth.jwt() ->> 'email')) or is_flow_owner(flow_id));
drop policy if exists "flow_members_insert" on flow_members;
create policy "flow_members_insert" on flow_members for insert to authenticated
  with check (is_flow_owner(flow_id));
drop policy if exists "flow_members_delete" on flow_members;
create policy "flow_members_delete" on flow_members for delete to authenticated
  using (is_flow_owner(flow_id) or user_id = (select auth.uid()) or lower(invited_email) = lower((select auth.jwt() ->> 'email')));

-- flow_schedules
drop policy if exists "flow_schedules_own" on flow_schedules;
drop policy if exists "flow_schedules_owner_delete" on flow_schedules;
drop policy if exists "flow_schedules_owner_insert" on flow_schedules;
drop policy if exists "flow_schedules_owner_select" on flow_schedules;
drop policy if exists "flow_schedules_owner_update" on flow_schedules;
drop policy if exists "flow_schedules_own" on flow_schedules;
create policy "flow_schedules_own" on flow_schedules for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- flows
drop policy if exists "Users manage own flows" on flows;
drop policy if exists "flows_delete_own" on flows;
drop policy if exists "flows_insert_own" on flows;
drop policy if exists "flows_select_member" on flows;
drop policy if exists "flows_select_own" on flows;
drop policy if exists "flows_select_own_or_shared" on flows;
drop policy if exists "flows_select_published" on flows;
drop policy if exists "flows_update_own" on flows;
drop policy if exists "flows_update_own_or_editor" on flows;
drop policy if exists "flows_select" on flows;
create policy "flows_select" on flows for select to anon, authenticated
  using (user_id = (select auth.uid()) or is_published or is_flow_member(id));
drop policy if exists "flows_insert" on flows;
create policy "flows_insert" on flows for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "flows_update" on flows;
create policy "flows_update" on flows for update to authenticated
  using (user_id = (select auth.uid()) or is_flow_editor(id))
  with check (user_id = (select auth.uid()) or is_flow_editor(id));
drop policy if exists "flows_delete" on flows;
create policy "flows_delete" on flows for delete to authenticated
  using (user_id = (select auth.uid()));

-- knowledge_vault
drop policy if exists "Users manage own vault" on knowledge_vault;
drop policy if exists "Users own their vault items" on knowledge_vault;
drop policy if exists "knowledge_vault_own" on knowledge_vault;
create policy "knowledge_vault_own" on knowledge_vault for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- marketplace_listings
drop policy if exists "owner" on marketplace_listings;
drop policy if exists "public_read_live" on marketplace_listings;
drop policy if exists "marketplace_listings_read_live" on marketplace_listings;
create policy "marketplace_listings_read_live" on marketplace_listings for select to anon, authenticated
  using (status = 'live');
drop policy if exists "marketplace_listings_own" on marketplace_listings;
create policy "marketplace_listings_own" on marketplace_listings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- notifications
drop policy if exists "Users manage own notifications" on notifications;
drop policy if exists "notifications_delete_own" on notifications;
drop policy if exists "notifications_insert_own" on notifications;
drop policy if exists "notifications_select_own" on notifications;
drop policy if exists "notifications_update_own" on notifications;
drop policy if exists "notifications_own" on notifications;
create policy "notifications_own" on notifications for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- purchases
drop policy if exists "buyer reads own purchases" on purchases;
drop policy if exists "dev reads own sales" on purchases;
drop policy if exists "purchases_no_delete" on purchases;
drop policy if exists "purchases_no_insert" on purchases;
drop policy if exists "purchases_no_update" on purchases;
drop policy if exists "purchases_select" on purchases;
drop policy if exists "service role insert" on purchases;
drop policy if exists "service role update" on purchases;
drop policy if exists "purchases_select" on purchases;
create policy "purchases_select" on purchases for select to authenticated
  using (buyer_id = (select auth.uid()) or dev_id = (select auth.uid()) or is_app_owner(app_id));

-- run_history
drop policy if exists "Users manage own history" on run_history;
drop policy if exists "run_history_insert_own" on run_history;
drop policy if exists "run_history_own" on run_history;
create policy "run_history_own" on run_history for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- scheduled_events
drop policy if exists "Users manage own events" on scheduled_events;
drop policy if exists "scheduled_events_own" on scheduled_events;
create policy "scheduled_events_own" on scheduled_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- thread_messages
drop policy if exists "Thread owners access messages" on thread_messages;
drop policy if exists "thread_messages_own" on thread_messages;
create policy "thread_messages_own" on thread_messages for all to authenticated
  using (exists (select 1 from conversation_threads t where t.id = thread_messages.thread_id and t.user_id = (select auth.uid())))
  with check (exists (select 1 from conversation_threads t where t.id = thread_messages.thread_id and t.user_id = (select auth.uid())));

-- user_alerts
drop policy if exists "Users manage own alerts" on user_alerts;
drop policy if exists "user_alerts_own" on user_alerts;
create policy "user_alerts_own" on user_alerts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_api_keys
drop policy if exists "Users can delete own keys" on user_api_keys;
drop policy if exists "Users can insert own keys" on user_api_keys;
drop policy if exists "Users can read own keys" on user_api_keys;
drop policy if exists "Users can update own keys" on user_api_keys;
drop policy if exists "Users manage own api keys" on user_api_keys;
drop policy if exists "user_api_keys_delete_own" on user_api_keys;
drop policy if exists "user_api_keys_insert_own" on user_api_keys;
drop policy if exists "user_api_keys_select_own" on user_api_keys;
drop policy if exists "user_api_keys_update_own" on user_api_keys;
drop policy if exists "user_api_keys_own" on user_api_keys;
create policy "user_api_keys_own" on user_api_keys for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_business_profiles
drop policy if exists "Users manage own business profile" on user_business_profiles;
drop policy if exists "user_business_profiles_own" on user_business_profiles;
create policy "user_business_profiles_own" on user_business_profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_career_profiles
drop policy if exists "Users manage own career profile" on user_career_profiles;
drop policy if exists "user_career_profiles_own" on user_career_profiles;
create policy "user_career_profiles_own" on user_career_profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_data_sources
drop policy if exists "Users manage own data sources" on user_data_sources;
drop policy if exists "user_data_sources_own" on user_data_sources;
create policy "user_data_sources_own" on user_data_sources for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_goals
drop policy if exists "Users manage own goals" on user_goals;
drop policy if exists "user_goals_own" on user_goals;
create policy "user_goals_own" on user_goals for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_memory
drop policy if exists "Users manage own memory" on user_memory;
drop policy if exists "user_memory_own" on user_memory;
create policy "user_memory_own" on user_memory for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- user_roles
drop policy if exists "Users can read own role" on user_roles;
drop policy if exists "user_roles_delete_admin" on user_roles;
drop policy if exists "user_roles_insert_admin" on user_roles;
drop policy if exists "user_roles_select_admin" on user_roles;
drop policy if exists "user_roles_select_own" on user_roles;
drop policy if exists "user_roles_update_admin" on user_roles;
drop policy if exists "user_roles_select" on user_roles;
create policy "user_roles_select" on user_roles for select to authenticated
  using (user_id = (select auth.uid()) or is_admin());
drop policy if exists "user_roles_insert" on user_roles;
create policy "user_roles_insert" on user_roles for insert to authenticated
  with check (is_admin());
drop policy if exists "user_roles_update" on user_roles;
create policy "user_roles_update" on user_roles for update to authenticated
  using (is_admin())
  with check (is_admin());
drop policy if exists "user_roles_delete" on user_roles;
create policy "user_roles_delete" on user_roles for delete to authenticated
  using (is_admin());

commit;
