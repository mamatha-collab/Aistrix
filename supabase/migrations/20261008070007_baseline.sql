-- Baseline: production schema when the project moved to Supabase CLI migrations.
-- Already applied on production (recorded with `supabase migration repair`);
-- runs only on new environments (staging, local). Do not edit.

-- Baseline exported 2026-10-08 07:00:03+00 from PostgreSQL 17.6 on aarch64-unknown-linux-gnu
set check_function_bodies = off;
set client_min_messages = warning;

-- Extensions
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- Tables
create table public.app_blueprints (
  app_id uuid not null,
  user_id uuid not null,
  blueprint jsonb default '{}'::jsonb not null,
  readiness_score integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  blueprint_prod jsonb,
  constraint app_blueprints_pkey PRIMARY KEY (app_id),
  constraint app_blueprints_readiness_score_check CHECK (((readiness_score >= 0) AND (readiness_score <= 100)))
);
create table public.app_entitlements (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  plan text default 'pay_per_run'::text not null,
  status text default 'active'::text not null,
  stripe_customer_id text,
  stripe_sub_id text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  runs_this_period integer default 0 not null,
  run_quota integer,
  created_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint app_entitlements_pkey PRIMARY KEY (id)
);
create table public.app_files (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  run_id uuid,
  owner_id uuid not null,
  file_kind text not null,
  bucket text not null,
  storage_path text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  metadata jsonb default '{}'::jsonb not null,
  expires_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint app_files_pkey PRIMARY KEY (id),
  constraint app_files_bucket_check CHECK ((bucket = ANY (ARRAY['aistrix-input-files'::text, 'aistrix-output-files'::text]))),
  constraint app_files_file_kind_check CHECK ((file_kind = ANY (ARRAY['input'::text, 'output'::text])))
);
create table public.app_knowledge (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  title text not null,
  content text not null,
  source_url text,
  type text default 'text'::text,
  created_at timestamp with time zone default now(),
  constraint app_knowledge_pkey PRIMARY KEY (id)
);
create table public.app_members (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid,
  invited_email text,
  role text default 'viewer'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint app_members_pkey PRIMARY KEY (id),
  constraint app_members_has_identity CHECK (((user_id IS NOT NULL) OR (invited_email IS NOT NULL))),
  constraint app_members_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'editor'::text, 'owner'::text])))
);
create table public.app_payments (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  run_id uuid,
  amount numeric not null,
  currency text default 'USD'::text,
  status text default 'completed'::text,
  created_at timestamp with time zone default now(),
  constraint app_payments_pkey PRIMARY KEY (id)
);
create table public.app_records (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  run_id uuid,
  data jsonb not null,
  label text,
  created_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint app_records_pkey PRIMARY KEY (id)
);
create table public.app_reviews (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  rating smallint not null,
  review_text text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint app_reviews_app_id_user_id_key UNIQUE (app_id, user_id),
  constraint app_reviews_pkey PRIMARY KEY (id),
  constraint app_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);
create table public.app_secrets (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  key text not null,
  encrypted_value text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint app_secrets_app_id_key_key UNIQUE (app_id, key),
  constraint app_secrets_pkey PRIMARY KEY (id)
);
create table public.app_test_cases (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  name text default 'Untitled test'::text not null,
  input text default ''::text not null,
  rules jsonb default '[]'::jsonb not null,
  context jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now(),
  constraint app_test_cases_pkey PRIMARY KEY (id)
);
create table public.app_tools (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  name text not null,
  description text not null,
  type text not null,
  config jsonb default '{}'::jsonb not null,
  input_schema jsonb default '{"type": "object", "required": [], "properties": {}}'::jsonb not null,
  created_at timestamp with time zone default now(),
  constraint app_tools_pkey PRIMARY KEY (id)
);
create table public.app_versions (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid,
  version_data jsonb not null,
  created_at timestamp with time zone default now(),
  semver text,
  changelog text,
  constraint app_versions_pkey PRIMARY KEY (id)
);
create table public.apps (
  id uuid default gen_random_uuid() not null,
  domain_id uuid,
  name text not null,
  description text,
  emoji text,
  color text,
  tags text[],
  system_prompt text,
  input_placeholder text,
  ai_provider text default 'claude'::text,
  ai_model text default 'claude-sonnet-4-6'::text,
  workflow_order integer default 0,
  next_app_id uuid,
  is_published boolean default false,
  total_runs integer default 0,
  created_at timestamp with time zone default now(),
  created_by uuid,
  is_verified boolean default false,
  is_trending boolean default false,
  is_top_rated boolean default false,
  is_new boolean default false,
  required_context text[] default '{}'::text[],
  compose_hint text,
  app_type text default 'prompt'::text,
  form_schema jsonb default '[]'::jsonb,
  output_type text default 'markdown'::text,
  visibility text default 'public'::text,
  is_paid boolean default false,
  price_per_run numeric default 0,
  pages jsonb default '[]'::jsonb,
  webhook_url text,
  has_memory boolean default false,
  custom_model_url text,
  custom_model_name text,
  status text default 'approved'::text,
  review_notes text,
  is_featured boolean default false,
  sample_input text,
  max_runs_per_day integer,
  version integer default 1,
  has_draft_changes boolean default false,
  embed_allowed_domains text[] default '{}'::text[] not null,
  embed_public boolean default false not null,
  workspace_id uuid,
  constraint apps_creator_name_unique UNIQUE (created_by, name),
  constraint apps_pkey PRIMARY KEY (id),
  constraint apps_embed_public_free_only CHECK ((NOT (embed_public AND COALESCE(is_paid, false))))
);
create table public.batch_job_rows (
  job_id uuid not null,
  idx integer not null,
  input text not null,
  status text default 'pending'::text not null,
  output text,
  data jsonb,
  error text,
  input_tokens integer,
  output_tokens integer,
  updated_at timestamp with time zone default now() not null,
  constraint batch_job_rows_pkey PRIMARY KEY (job_id, idx),
  constraint batch_job_rows_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text])))
);
create table public.batch_jobs (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  status text default 'queued'::text not null,
  total integer default 0 not null,
  completed integer default 0 not null,
  failed integer default 0 not null,
  stop_reason text,
  webhook_url text,
  created_at timestamp with time zone default now() not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  heartbeat_at timestamp with time zone,
  workspace_id uuid,
  constraint batch_jobs_pkey PRIMARY KEY (id),
  constraint batch_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'completed_with_errors'::text, 'stopped'::text, 'cancelled'::text, 'failed'::text])))
);
create table public.blueprint_test_results (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  label text not null,
  input text,
  expected_checks jsonb default '[]'::jsonb,
  last_status text,
  last_output text,
  last_errors jsonb default '[]'::jsonb,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  constraint blueprint_test_results_app_id_label_key UNIQUE (app_id, label),
  constraint blueprint_test_results_pkey PRIMARY KEY (id)
);
create table public.conversation_threads (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  title text,
  created_at timestamp with time zone default now(),
  constraint conversation_threads_pkey PRIMARY KEY (id)
);
create table public.developer_api_keys (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  is_active boolean default true,
  last_used_at timestamp with time zone,
  total_calls integer default 0,
  created_at timestamp with time zone default now(),
  key_hash text,
  key_prefix text,
  app_ids uuid[],
  workspace_id uuid,
  constraint developer_api_keys_pkey PRIMARY KEY (id)
);
create table public.developer_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  display_name text,
  bio text,
  website text,
  stripe_account_id text,
  total_earnings numeric default 0,
  is_verified boolean default false,
  created_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint developer_profiles_user_id_key UNIQUE (user_id),
  constraint developer_profiles_pkey PRIMARY KEY (id)
);
create table public.developer_settings (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  settings jsonb default '{}'::jsonb,
  constraint developer_settings_user_id_key UNIQUE (user_id),
  constraint developer_settings_pkey PRIMARY KEY (id)
);
create table public.domains (
  id uuid default gen_random_uuid() not null,
  slug text not null,
  name text not null,
  description text,
  emoji text,
  color text,
  is_free boolean default true,
  order_index integer default 0,
  created_at timestamp with time zone default now(),
  constraint domains_slug_key UNIQUE (slug),
  constraint domains_pkey PRIMARY KEY (id)
);
create table public.favorites (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  created_at timestamp with time zone default now(),
  app_id uuid not null,
  constraint favorites_user_app_unique UNIQUE (user_id, app_id),
  constraint favorites_pkey PRIMARY KEY (id)
);
create table public.flow_members (
  id uuid default gen_random_uuid() not null,
  flow_id uuid not null,
  invited_email text not null,
  user_id uuid,
  role text default 'viewer'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint flow_members_flow_id_invited_email_key UNIQUE (flow_id, invited_email),
  constraint flow_members_pkey PRIMARY KEY (id),
  constraint flow_members_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'editor'::text])))
);
create table public.flow_schedules (
  id uuid default gen_random_uuid() not null,
  flow_id uuid not null,
  user_id uuid not null,
  frequency text default 'daily'::text not null,
  hour_utc integer default 9 not null,
  day_of_week integer,
  seed_input text default ''::text not null,
  enabled boolean default true not null,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  constraint flow_schedules_pkey PRIMARY KEY (id),
  constraint flow_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6))),
  constraint flow_schedules_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text]))),
  constraint flow_schedules_hour_utc_check CHECK (((hour_utc >= 0) AND (hour_utc <= 23)))
);
create table public.flows (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  name text not null,
  description text,
  emoji text default '⚡'::text,
  steps jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now(),
  is_published boolean default false,
  install_count integer default 0,
  memory jsonb default '{}'::jsonb,
  gpt_name text,
  gpt_instructions text,
  gpt_provider text default 'claude'::text,
  integration_webhook_url text,
  memory_provenance jsonb default '{}'::jsonb,
  default_provider text default 'auto'::text,
  webhook_token uuid,
  use_knowledge_vault boolean default false,
  workspace_id uuid,
  constraint flows_user_name_unique UNIQUE (user_id, name),
  constraint flows_pkey PRIMARY KEY (id)
);
create table public.knowledge_vault (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  title text not null,
  content text not null,
  type text default 'doc'::text not null,
  source_url text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  workspace_id uuid,
  constraint knowledge_vault_pkey PRIMARY KEY (id)
);
create table public.marketplace_listings (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  title text not null,
  tagline text,
  description text,
  category text,
  tags text[],
  status text default 'draft'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint marketplace_listings_app_id_key UNIQUE (app_id),
  constraint marketplace_listings_pkey PRIMARY KEY (id)
);
create table public.notifications (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  type text not null,
  title text not null,
  message text,
  link_view text,
  is_read boolean default false,
  created_at timestamp with time zone default now(),
  constraint notifications_pkey PRIMARY KEY (id)
);
create table public.purchases (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  buyer_id uuid,
  dev_id uuid,
  plan text not null,
  gross_amount numeric(10,6) default 0 not null,
  platform_fee numeric(10,6) default 0 not null,
  dev_share numeric(10,6) default 0 not null,
  stripe_customer_id text,
  stripe_sub_id text,
  payout_status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint purchases_pkey PRIMARY KEY (id)
);
create table public.run_events (
  id bigint generated always as identity not null,
  user_id uuid not null,
  app_id uuid,
  source text default 'app'::text not null,
  created_at timestamp with time zone default now() not null,
  workspace_id uuid,
  constraint run_events_pkey PRIMARY KEY (id)
);
create table public.run_history (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  app_name text not null,
  input text not null,
  created_at timestamp with time zone default now(),
  app_id uuid,
  flow_id uuid,
  flow_name text,
  input_tokens integer,
  output_tokens integer,
  output text,
  rating_type text,
  rating_value integer,
  feedback_text text,
  workspace_id uuid,
  constraint run_history_pkey PRIMARY KEY (id)
);
create table public.scheduled_events (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  app_id uuid not null,
  app_name text,
  app_emoji text,
  input_template text not null,
  schedule_type text not null,
  schedule_time text not null,
  schedule_day integer,
  is_active boolean default true,
  last_run_at timestamp with time zone,
  next_run_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint scheduled_events_pkey PRIMARY KEY (id)
);
create table public.thread_messages (
  id uuid default gen_random_uuid() not null,
  thread_id uuid,
  role text not null,
  content text not null,
  created_at timestamp with time zone default now(),
  rating smallint,
  constraint thread_messages_pkey PRIMARY KEY (id)
);
create table public.user_alerts (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  type text not null,
  condition jsonb not null,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  constraint user_alerts_pkey PRIMARY KEY (id)
);
create table public.user_api_keys (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  provider text not null,
  encrypted_key text not null,
  label text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  constraint user_api_keys_user_id_provider_key UNIQUE (user_id, provider),
  constraint user_api_keys_pkey PRIMARY KEY (id)
);
create table public.user_business_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_name text,
  website text,
  industry text,
  products text,
  company_description text,
  brand_voice text,
  target_audience text,
  brand_colors text,
  contact_info text,
  updated_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint user_business_profiles_user_id_key UNIQUE (user_id),
  constraint user_business_profiles_pkey PRIMARY KEY (id)
);
create table public.user_career_profiles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  full_name text,
  job_title text,
  experience_years text,
  skills text,
  education text,
  location text,
  preferred_locations text,
  salary_range text,
  resume_text text,
  linkedin_url text,
  bio text,
  updated_at timestamp with time zone default now(),
  constraint user_career_profiles_user_id_key UNIQUE (user_id),
  constraint user_career_profiles_pkey PRIMARY KEY (id)
);
create table public.user_data_sources (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  content text not null,
  type text default 'text'::text,
  source_url text,
  created_at timestamp with time zone default now(),
  workspace_id uuid,
  constraint user_data_sources_pkey PRIMARY KEY (id)
);
create table public.user_goals (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  name text not null,
  target_runs integer not null,
  period text not null,
  app_id uuid,
  app_name text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  constraint user_goals_pkey PRIMARY KEY (id)
);
create table public.user_memory (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  key text not null,
  value text not null,
  updated_at timestamp with time zone default now(),
  constraint user_memory_user_id_key_key UNIQUE (user_id, key),
  constraint user_memory_pkey PRIMARY KEY (id)
);
create table public.user_roles (
  user_id uuid not null,
  role text not null,
  granted_at timestamp with time zone default now(),
  constraint user_roles_pkey PRIMARY KEY (user_id),
  constraint user_roles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'moderator'::text])))
);
create table public.workspace_invites (
  id uuid default gen_random_uuid() not null,
  workspace_id uuid not null,
  email text not null,
  role text default 'member'::text not null,
  token uuid default gen_random_uuid() not null,
  invited_by uuid,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  accepted_at timestamp with time zone,
  constraint workspace_invites_token_key UNIQUE (token),
  constraint workspace_invites_pkey PRIMARY KEY (id),
  constraint workspace_invites_email_check CHECK ((email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text)),
  constraint workspace_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'developer'::text, 'member'::text, 'billing'::text])))
);
create table public.workspace_members (
  workspace_id uuid not null,
  user_id uuid not null,
  role text default 'member'::text not null,
  invited_by uuid,
  created_at timestamp with time zone default now() not null,
  constraint workspace_members_pkey PRIMARY KEY (workspace_id, user_id),
  constraint workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'developer'::text, 'member'::text, 'billing'::text])))
);
create table public.workspaces (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  is_personal boolean default false not null,
  personal_owner_id uuid,
  plan text default 'free'::text not null,
  billing_email text,
  stripe_customer_id text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint workspaces_personal_owner_id_key UNIQUE (personal_owner_id),
  constraint workspaces_slug_key UNIQUE (slug),
  constraint workspaces_pkey PRIMARY KEY (id),
  constraint workspaces_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 80))),
  constraint workspaces_personal_owner CHECK ((is_personal = (personal_owner_id IS NOT NULL))),
  constraint workspaces_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'pro'::text, 'team'::text, 'enterprise'::text]))),
  constraint workspaces_slug_check CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'::text))
);

-- Foreign keys
alter table app_blueprints add constraint app_blueprints_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_blueprints add constraint app_blueprints_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_entitlements add constraint app_entitlements_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_entitlements add constraint app_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_entitlements add constraint app_entitlements_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table app_files add constraint app_files_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_files add constraint app_files_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_knowledge add constraint app_knowledge_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_members add constraint app_members_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_members add constraint app_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_payments add constraint app_payments_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_payments add constraint app_payments_run_id_fkey FOREIGN KEY (run_id) REFERENCES run_history(id) ON DELETE SET NULL;
alter table app_payments add constraint app_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_records add constraint app_records_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_records add constraint app_records_run_id_fkey FOREIGN KEY (run_id) REFERENCES run_history(id) ON DELETE SET NULL;
alter table app_records add constraint app_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_records add constraint app_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table app_reviews add constraint app_reviews_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_reviews add constraint app_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_secrets add constraint app_secrets_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_secrets add constraint app_secrets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_test_cases add constraint app_test_cases_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_test_cases add constraint app_test_cases_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table app_tools add constraint app_tools_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_versions add constraint app_versions_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table app_versions add constraint app_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table apps add constraint apps_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table apps add constraint apps_domain_id_fkey FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL;
alter table apps add constraint apps_next_app_id_fkey FOREIGN KEY (next_app_id) REFERENCES apps(id) ON DELETE SET NULL;
alter table apps add constraint apps_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table batch_job_rows add constraint batch_job_rows_job_id_fkey FOREIGN KEY (job_id) REFERENCES batch_jobs(id) ON DELETE CASCADE;
alter table batch_jobs add constraint batch_jobs_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table batch_jobs add constraint batch_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table batch_jobs add constraint batch_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table blueprint_test_results add constraint blueprint_test_results_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table blueprint_test_results add constraint blueprint_test_results_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table conversation_threads add constraint conversation_threads_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table conversation_threads add constraint conversation_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table developer_api_keys add constraint developer_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table developer_api_keys add constraint developer_api_keys_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table developer_profiles add constraint developer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table developer_profiles add constraint developer_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table developer_settings add constraint developer_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table favorites add constraint favorites_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table favorites add constraint favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table flow_members add constraint flow_members_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE;
alter table flow_members add constraint flow_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table flow_schedules add constraint flow_schedules_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE;
alter table flow_schedules add constraint flow_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table flows add constraint flows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table flows add constraint flows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table knowledge_vault add constraint knowledge_vault_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table knowledge_vault add constraint knowledge_vault_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table marketplace_listings add constraint marketplace_listings_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table marketplace_listings add constraint marketplace_listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table purchases add constraint purchases_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table purchases add constraint purchases_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table purchases add constraint purchases_dev_id_fkey FOREIGN KEY (dev_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table purchases add constraint purchases_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table run_events add constraint run_events_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE SET NULL;
alter table run_events add constraint run_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table run_events add constraint run_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table run_history add constraint run_history_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE SET NULL;
alter table run_history add constraint run_history_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE SET NULL;
alter table run_history add constraint run_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table run_history add constraint run_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table scheduled_events add constraint scheduled_events_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table scheduled_events add constraint scheduled_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table scheduled_events add constraint scheduled_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table thread_messages add constraint thread_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE;
alter table user_alerts add constraint user_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_api_keys add constraint user_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_business_profiles add constraint user_business_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_business_profiles add constraint user_business_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table user_career_profiles add constraint user_career_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_data_sources add constraint user_data_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_data_sources add constraint user_data_sources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
alter table user_goals add constraint user_goals_app_id_fkey FOREIGN KEY (app_id) REFERENCES apps(id) ON DELETE CASCADE;
alter table user_goals add constraint user_goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_memory add constraint user_memory_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table user_roles add constraint user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table workspace_invites add constraint workspace_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table workspace_invites add constraint workspace_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table workspace_members add constraint workspace_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table workspace_members add constraint workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table workspace_members add constraint workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table workspaces add constraint workspaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table workspaces add constraint workspaces_personal_owner_id_fkey FOREIGN KEY (personal_owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX app_blueprints_user_id_idx ON public.app_blueprints USING btree (user_id);
CREATE INDEX app_entitlements_app_user_idx ON public.app_entitlements USING btree (app_id, user_id);
CREATE INDEX app_entitlements_user_id_idx ON public.app_entitlements USING btree (user_id);
CREATE INDEX app_entitlements_workspace_id_idx ON public.app_entitlements USING btree (workspace_id);
CREATE INDEX app_files_app_id_idx ON public.app_files USING btree (app_id);
CREATE INDEX app_files_expires_at_idx ON public.app_files USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX app_files_owner_id_idx ON public.app_files USING btree (owner_id);
CREATE INDEX app_files_run_id_idx ON public.app_files USING btree (run_id);
CREATE INDEX app_knowledge_app_id_idx ON public.app_knowledge USING btree (app_id);
CREATE INDEX app_members_app_id_idx ON public.app_members USING btree (app_id);
CREATE INDEX app_members_invited_email_idx ON public.app_members USING btree (invited_email);
CREATE INDEX app_members_user_id_idx ON public.app_members USING btree (user_id);
CREATE INDEX app_payments_app_id_idx ON public.app_payments USING btree (app_id);
CREATE INDEX app_payments_run_id_idx ON public.app_payments USING btree (run_id);
CREATE INDEX app_payments_user_id_idx ON public.app_payments USING btree (user_id);
CREATE INDEX app_records_app_id_idx ON public.app_records USING btree (app_id);
CREATE INDEX app_records_run_id_idx ON public.app_records USING btree (run_id);
CREATE INDEX app_records_user_time_idx ON public.app_records USING btree (user_id, created_at DESC);
CREATE INDEX app_records_workspace_id_idx ON public.app_records USING btree (workspace_id);
CREATE INDEX app_reviews_app_id_idx ON public.app_reviews USING btree (app_id);
CREATE INDEX app_reviews_user_id_idx ON public.app_reviews USING btree (user_id);
CREATE INDEX app_secrets_app_user_idx ON public.app_secrets USING btree (app_id, user_id);
CREATE INDEX app_test_cases_app_id_idx ON public.app_test_cases USING btree (app_id);
CREATE INDEX app_tools_app_id_idx ON public.app_tools USING btree (app_id);
CREATE INDEX app_versions_app_time_idx ON public.app_versions USING btree (app_id, created_at DESC);
CREATE INDEX apps_domain_id_idx ON public.apps USING btree (domain_id);
CREATE INDEX apps_is_featured_idx ON public.apps USING btree (is_featured) WHERE (is_featured = true);
CREATE INDEX apps_is_paid_idx ON public.apps USING btree (is_paid) WHERE (is_paid = true);
CREATE INDEX apps_published_idx ON public.apps USING btree (created_at DESC) WHERE is_published;
CREATE INDEX apps_workspace_id_idx ON public.apps USING btree (workspace_id);
CREATE INDEX batch_job_rows_status_idx ON public.batch_job_rows USING btree (job_id, status);
CREATE INDEX batch_jobs_app_id_idx ON public.batch_jobs USING btree (app_id);
CREATE INDEX batch_jobs_status_idx ON public.batch_jobs USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));
CREATE INDEX batch_jobs_user_idx ON public.batch_jobs USING btree (user_id, created_at DESC);
CREATE INDEX batch_jobs_workspace_id_idx ON public.batch_jobs USING btree (workspace_id);
CREATE INDEX conversation_threads_app_idx ON public.conversation_threads USING btree (app_id);
CREATE INDEX conversation_threads_user_idx ON public.conversation_threads USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX developer_api_keys_key_hash_idx ON public.developer_api_keys USING btree (key_hash);
CREATE INDEX developer_api_keys_user_id_idx ON public.developer_api_keys USING btree (user_id);
CREATE INDEX developer_api_keys_workspace_id_idx ON public.developer_api_keys USING btree (workspace_id);
CREATE INDEX developer_profiles_workspace_id_idx ON public.developer_profiles USING btree (workspace_id);
CREATE INDEX favorites_app_id_idx ON public.favorites USING btree (app_id);
CREATE INDEX flow_members_user_id_idx ON public.flow_members USING btree (user_id);
CREATE INDEX flow_schedules_due_idx ON public.flow_schedules USING btree (enabled, next_run_at);
CREATE INDEX flow_schedules_flow_id_idx ON public.flow_schedules USING btree (flow_id);
CREATE INDEX flow_schedules_user_id_idx ON public.flow_schedules USING btree (user_id);
CREATE UNIQUE INDEX flows_webhook_token_idx ON public.flows USING btree (webhook_token) WHERE (webhook_token IS NOT NULL);
CREATE INDEX flows_workspace_id_idx ON public.flows USING btree (workspace_id);
CREATE INDEX idx_purchases_app_id ON public.purchases USING btree (app_id);
CREATE INDEX idx_purchases_dev_id ON public.purchases USING btree (dev_id, created_at DESC);
CREATE INDEX idx_run_history_rating_value_user ON public.run_history USING btree (user_id, created_at DESC) WHERE (rating_value IS NOT NULL);
CREATE INDEX knowledge_vault_user_id_idx ON public.knowledge_vault USING btree (user_id);
CREATE INDEX knowledge_vault_workspace_id_idx ON public.knowledge_vault USING btree (workspace_id);
CREATE INDEX marketplace_listings_user_idx ON public.marketplace_listings USING btree (user_id);
CREATE INDEX notifications_user_time_idx ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX purchases_buyer_id_idx ON public.purchases USING btree (buyer_id);
CREATE INDEX purchases_workspace_id_idx ON public.purchases USING btree (workspace_id);
CREATE INDEX run_events_user_time_idx ON public.run_events USING btree (user_id, created_at DESC);
CREATE INDEX run_events_workspace_id_idx ON public.run_events USING btree (workspace_id);
CREATE INDEX run_history_app_time_idx ON public.run_history USING btree (app_id, created_at DESC);
CREATE INDEX run_history_flow_id_idx ON public.run_history USING btree (flow_id);
CREATE INDEX run_history_user_time_idx ON public.run_history USING btree (user_id, created_at DESC);
CREATE INDEX run_history_workspace_id_idx ON public.run_history USING btree (workspace_id);
CREATE INDEX scheduled_events_app_id_idx ON public.scheduled_events USING btree (app_id);
CREATE INDEX scheduled_events_user_id_idx ON public.scheduled_events USING btree (user_id);
CREATE INDEX scheduled_events_workspace_id_idx ON public.scheduled_events USING btree (workspace_id);
CREATE INDEX thread_messages_thread_time_idx ON public.thread_messages USING btree (thread_id, created_at);
CREATE INDEX user_alerts_user_id_idx ON public.user_alerts USING btree (user_id);
CREATE INDEX user_business_profiles_workspace_id_idx ON public.user_business_profiles USING btree (workspace_id);
CREATE INDEX user_data_sources_user_id_idx ON public.user_data_sources USING btree (user_id);
CREATE INDEX user_data_sources_workspace_id_idx ON public.user_data_sources USING btree (workspace_id);
CREATE INDEX user_goals_user_id_idx ON public.user_goals USING btree (user_id);
CREATE UNIQUE INDEX workspace_invites_open_email_idx ON public.workspace_invites USING btree (workspace_id, lower(email)) WHERE (accepted_at IS NULL);
CREATE INDEX workspace_invites_workspace_idx ON public.workspace_invites USING btree (workspace_id);
CREATE INDEX workspace_members_user_idx ON public.workspace_members USING btree (user_id);

-- Functions
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(p_token uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv workspace_invites%rowtype;
begin
  select * into v_inv from workspace_invites where token = p_token for update;
  if not found then raise exception 'Invite not found'; end if;
  if v_inv.accepted_at is not null then raise exception 'Invite already used'; end if;
  if v_inv.expires_at < now() then raise exception 'Invite expired'; end if;
  if lower(v_inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'This invite was sent to a different email address';
  end if;
  insert into workspace_members (workspace_id, user_id, role, invited_by)
  values (v_inv.workspace_id, auth.uid(), v_inv.role, v_inv.invited_by)
  on conflict (workspace_id, user_id) do nothing;
  update workspace_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.workspace_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.can_edit_app(p_app_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from apps a
     where a.id = p_app_id
       and (a.created_by = auth.uid()
            or (a.workspace_id is not null and is_workspace_member(a.workspace_id, array['owner', 'admin', 'developer']))
            or is_app_member(a.id, array['editor', 'owner'])
            or is_staff())
  )
$function$
;

CREATE OR REPLACE FUNCTION public.consume_entitlement_run(p_entitlement_id uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update app_entitlements
     set runs_this_period = runs_this_period + 1
   where id = p_entitlement_id
  returning runs_this_period;
$function$
;

CREATE OR REPLACE FUNCTION public.default_workspace_from_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.ensure_personal_workspace(p_user_id uuid, p_email text DEFAULT NULL::text, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ws uuid;
begin
  select id into v_ws from workspaces where personal_owner_id = p_user_id;
  if v_ws is null then
    insert into workspaces (name, slug, is_personal, personal_owner_id, created_by, billing_email)
    values (
      left(coalesce(nullif(trim(p_name), ''), nullif(split_part(coalesce(p_email, ''), '@', 1), ''), 'Personal'), 80),
      'u-' || left(replace(p_user_id::text, '-', ''), 16),
      true, p_user_id, p_user_id, p_email)
    on conflict (personal_owner_id) do nothing
    returning id into v_ws;
    if v_ws is null then
      select id into v_ws from workspaces where personal_owner_id = p_user_id;
    end if;
  end if;
  insert into workspace_members (workspace_id, user_id, role)
  values (v_ws, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return v_ws;
end $function$
;

CREATE OR REPLACE FUNCTION public.handle_new_team_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not new.is_personal and new.created_by is not null then
    insert into workspace_members (workspace_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform ensure_personal_workspace(new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  exception when others then
    raise warning 'personal workspace for % not created: %', new.id, sqlerrm;
  end;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.increment_app_runs(p_app_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE apps SET total_runs = COALESCE(total_runs, 0) + 1 WHERE id = p_app_id;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from user_roles
    where user_id = auth.uid() and role = 'admin'
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_app_member(target_app_id uuid, allowed_roles text[] DEFAULT NULL::text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from app_members
    where app_id = target_app_id
      and (user_id = auth.uid() or invited_email = auth.jwt() ->> 'email')
      and (allowed_roles is null or role = any(allowed_roles))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_app_owner(target_app_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from apps a
     where a.id = target_app_id
       and (a.created_by = auth.uid()
            or (a.workspace_id is not null and is_workspace_member(a.workspace_id, array['owner', 'admin'])))
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_flow_editor(p_flow_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM flow_members
    WHERE flow_id = p_flow_id AND role = 'editor'
      AND (user_id = auth.uid() OR lower(invited_email) = lower(auth.jwt() ->> 'email'))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_flow_member(p_flow_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM flow_members
    WHERE flow_id = p_flow_id
      AND (user_id = auth.uid() OR lower(invited_email) = lower(auth.jwt() ->> 'email'))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_flow_owner(target_flow_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from flows where id = target_flow_id and user_id = auth.uid()
  )
$function$
;

CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from user_roles where user_id = auth.uid() and role in ('admin', 'moderator'))
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid, p_roles text[] DEFAULT NULL::text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from workspace_members
     where workspace_id = p_workspace_id and user_id = auth.uid()
       and (p_roles is null or role = any(p_roles))
  )
$function$
;

CREATE OR REPLACE FUNCTION public.keep_a_workspace_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and exists (select 1 from workspaces w where w.id = old.workspace_id and not w.is_personal)
     and not exists (select 1 from workspace_members m
                      where m.workspace_id = old.workspace_id and m.role = 'owner' and m.user_id <> old.user_id) then
    raise exception 'A team workspace must keep at least one owner';
  end if;
  return coalesce(new, old);
end $function$
;

CREATE OR REPLACE FUNCTION public.personal_workspace_id(p_user_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from workspaces where personal_owner_id = p_user_id
$function$
;

CREATE OR REPLACE FUNCTION public.protect_app_admin_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
      if new.workspace_id is distinct from old.workspace_id then
        if not ((old.workspace_id is null and old.created_by = auth.uid())
                or is_workspace_member(old.workspace_id, array['owner', 'admin'])) then
          raise exception 'Only an owner or admin of the current workspace can move this app';
        end if;
        if new.workspace_id is not null
           and not is_workspace_member(new.workspace_id, array['owner', 'admin', 'developer']) then
          raise exception 'You can only move an app into a workspace where you can build apps';
        end if;
      end if;
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.protect_developer_profile_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_flow_invites()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE flow_members fm
  SET user_id = u.id
  FROM auth.users u
  WHERE fm.user_id IS NULL AND lower(fm.invited_email) = lower(u.email);
$function$
;

CREATE OR REPLACE FUNCTION public.set_app_published_with_gate(p_app_id uuid, p_publish boolean)
 RETURNS TABLE(ok boolean, errors text[], is_published boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_validation record;
begin
  if not can_edit_app(p_app_id) then
    return query select false, array['Only people who can edit this app can change publishing']::text[], false;
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
end $function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_app_badges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.validate_app_publish_ready(p_app_id uuid)
 RETURNS TABLE(ok boolean, errors text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_app record;
  v_blueprint jsonb;
  v_errors text[] := array[]::text[];
  v_format text;
  v_input_fields jsonb;
  v_output_fields jsonb;
  v_format_rules jsonb;
  v_permissions jsonb;
begin
  select * into v_app from apps where id = p_app_id;
  if not found then
    return query select false, array['App not found']::text[];
    return;
  end if;

  if not can_edit_app(p_app_id) then
    return query select false, array['Only people who can edit this app can publish it']::text[];
    return;
  end if;

  select blueprint into v_blueprint from app_blueprints where app_id = p_app_id;

  if length(coalesce(trim(v_app.system_prompt), '')) <= 200 then
    v_errors := array_append(v_errors, 'Design readiness requires a system prompt longer than 200 characters');
  end if;
  if coalesce(trim(v_app.description), '') = '' then
    v_errors := array_append(v_errors, 'Description is required');
  end if;
  if coalesce(trim(v_app.ai_model), '') = '' then
    v_errors := array_append(v_errors, 'AI model is required');
  end if;
  if v_app.is_paid is true and v_app.price_per_run is null then
    v_errors := array_append(v_errors, 'Paid apps require price_per_run');
  end if;

  if v_blueprint is null then
    v_errors := array_append(v_errors, 'Blueprint is required before publishing');
  else
    v_input_fields := coalesce(v_blueprint #> '{input_schema,fields}', '[]'::jsonb);
    v_output_fields := coalesce(v_blueprint #> '{output_schema,fields}', v_blueprint #> '{output_contract,fields}', '[]'::jsonb);
    v_format := coalesce(v_blueprint #>> '{output_contract,format}', '');
    v_format_rules := coalesce(v_blueprint #> '{output_contract,format_rules}', '{}'::jsonb);
    v_permissions := v_blueprint #> '{permissions}';

    if coalesce(trim(v_blueprint #>> '{business_problem}'), '') = '' then
      v_errors := array_append(v_errors, 'Design readiness requires a business problem');
    end if;
    if coalesce(trim(v_blueprint #>> '{audience}'), '') = '' then
      v_errors := array_append(v_errors, 'Design readiness requires an audience');
    end if;
    if jsonb_typeof(v_input_fields) <> 'array' or jsonb_array_length(v_input_fields) = 0 then
      v_errors := array_append(v_errors, 'At least one input schema field is required');
    end if;
    if coalesce(v_format, '') = '' then
      v_errors := array_append(v_errors, 'Design readiness requires an output format');
    elsif v_format = 'json' and (jsonb_typeof(v_output_fields) <> 'array' or jsonb_array_length(v_output_fields) = 0) then
      v_errors := array_append(v_errors, 'JSON output apps require output_schema.fields');
    elsif v_format <> 'json' and (jsonb_typeof(v_format_rules) <> 'object' or v_format_rules = '{}'::jsonb) then
      v_errors := array_append(v_errors, 'Design readiness requires output contract rules');
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(v_input_fields, '[]'::jsonb)) f
       where coalesce(f->>'field', '') = '' or coalesce(f->>'type', '') = ''
          or not (f->>'field' ~ '^[a-z][a-z0-9_]*$')
    ) then
      v_errors := array_append(v_errors, 'Every input schema field needs a valid field and type');
    end if;
    if v_format = 'json' and exists (
      select 1 from jsonb_array_elements(coalesce(v_output_fields, '[]'::jsonb)) f
       where coalesce(f->>'field', '') = '' or coalesce(f->>'type', '') = ''
          or not (f->>'field' ~ '^[a-z][a-z0-9_]*$')
    ) then
      v_errors := array_append(v_errors, 'Every output schema field needs a valid field and type');
    end if;
    if v_permissions is null or jsonb_typeof(v_permissions) <> 'object' then
      v_errors := array_append(v_errors, 'Design readiness requires permissions to be reviewed');
    end if;
  end if;

  return query select cardinality(v_errors) = 0, v_errors;
end $function$
;

CREATE OR REPLACE FUNCTION public.workspace_member_list(p_workspace_id uuid)
 RETURNS TABLE(user_id uuid, email text, full_name text, role text, joined_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.user_id, u.email::text, (u.raw_user_meta_data ->> 'full_name')::text, m.role, m.created_at
    from workspace_members m
    join auth.users u on u.id = m.user_id
   where m.workspace_id = p_workspace_id
     and is_workspace_member(p_workspace_id)
   order by m.created_at
$function$
;

-- Function permissions
revoke all on function public.accept_workspace_invite(uuid) from public, anon, authenticated;
grant execute on function public.accept_workspace_invite(uuid) to authenticated;
grant execute on function public.accept_workspace_invite(uuid) to service_role;
revoke all on function public.can_edit_app(uuid) from public, anon, authenticated;
grant execute on function public.can_edit_app(uuid) to public;
grant execute on function public.can_edit_app(uuid) to anon;
grant execute on function public.can_edit_app(uuid) to authenticated;
grant execute on function public.can_edit_app(uuid) to service_role;
revoke all on function public.consume_entitlement_run(uuid) from public, anon, authenticated;
grant execute on function public.consume_entitlement_run(uuid) to service_role;
revoke all on function public.default_workspace_from_owner() from public, anon, authenticated;
grant execute on function public.default_workspace_from_owner() to public;
grant execute on function public.default_workspace_from_owner() to anon;
grant execute on function public.default_workspace_from_owner() to authenticated;
grant execute on function public.default_workspace_from_owner() to service_role;
revoke all on function public.ensure_personal_workspace(uuid,text,text) from public, anon, authenticated;
grant execute on function public.ensure_personal_workspace(uuid,text,text) to service_role;
revoke all on function public.handle_new_team_workspace() from public, anon, authenticated;
grant execute on function public.handle_new_team_workspace() to service_role;
revoke all on function public.handle_new_user_workspace() from public, anon, authenticated;
grant execute on function public.handle_new_user_workspace() to service_role;
revoke all on function public.increment_app_runs(uuid) from public, anon, authenticated;
grant execute on function public.increment_app_runs(uuid) to authenticated;
grant execute on function public.increment_app_runs(uuid) to service_role;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to public;
grant execute on function public.is_admin() to anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_admin() to service_role;
revoke all on function public.is_app_member(uuid,text[]) from public, anon, authenticated;
grant execute on function public.is_app_member(uuid,text[]) to public;
grant execute on function public.is_app_member(uuid,text[]) to anon;
grant execute on function public.is_app_member(uuid,text[]) to authenticated;
grant execute on function public.is_app_member(uuid,text[]) to service_role;
revoke all on function public.is_app_owner(uuid) from public, anon, authenticated;
grant execute on function public.is_app_owner(uuid) to public;
grant execute on function public.is_app_owner(uuid) to anon;
grant execute on function public.is_app_owner(uuid) to authenticated;
grant execute on function public.is_app_owner(uuid) to service_role;
revoke all on function public.is_flow_editor(uuid) from public, anon, authenticated;
grant execute on function public.is_flow_editor(uuid) to public;
grant execute on function public.is_flow_editor(uuid) to anon;
grant execute on function public.is_flow_editor(uuid) to authenticated;
grant execute on function public.is_flow_editor(uuid) to service_role;
revoke all on function public.is_flow_member(uuid) from public, anon, authenticated;
grant execute on function public.is_flow_member(uuid) to public;
grant execute on function public.is_flow_member(uuid) to anon;
grant execute on function public.is_flow_member(uuid) to authenticated;
grant execute on function public.is_flow_member(uuid) to service_role;
revoke all on function public.is_flow_owner(uuid) from public, anon, authenticated;
grant execute on function public.is_flow_owner(uuid) to public;
grant execute on function public.is_flow_owner(uuid) to anon;
grant execute on function public.is_flow_owner(uuid) to authenticated;
grant execute on function public.is_flow_owner(uuid) to service_role;
revoke all on function public.is_staff() from public, anon, authenticated;
grant execute on function public.is_staff() to public;
grant execute on function public.is_staff() to anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_staff() to service_role;
revoke all on function public.is_workspace_member(uuid,text[]) from public, anon, authenticated;
grant execute on function public.is_workspace_member(uuid,text[]) to public;
grant execute on function public.is_workspace_member(uuid,text[]) to anon;
grant execute on function public.is_workspace_member(uuid,text[]) to authenticated;
grant execute on function public.is_workspace_member(uuid,text[]) to service_role;
revoke all on function public.keep_a_workspace_owner() from public, anon, authenticated;
grant execute on function public.keep_a_workspace_owner() to public;
grant execute on function public.keep_a_workspace_owner() to anon;
grant execute on function public.keep_a_workspace_owner() to authenticated;
grant execute on function public.keep_a_workspace_owner() to service_role;
revoke all on function public.personal_workspace_id(uuid) from public, anon, authenticated;
grant execute on function public.personal_workspace_id(uuid) to public;
grant execute on function public.personal_workspace_id(uuid) to anon;
grant execute on function public.personal_workspace_id(uuid) to authenticated;
grant execute on function public.personal_workspace_id(uuid) to service_role;
revoke all on function public.protect_app_admin_columns() from public, anon, authenticated;
grant execute on function public.protect_app_admin_columns() to public;
grant execute on function public.protect_app_admin_columns() to anon;
grant execute on function public.protect_app_admin_columns() to authenticated;
grant execute on function public.protect_app_admin_columns() to service_role;
revoke all on function public.protect_developer_profile_columns() from public, anon, authenticated;
grant execute on function public.protect_developer_profile_columns() to public;
grant execute on function public.protect_developer_profile_columns() to anon;
grant execute on function public.protect_developer_profile_columns() to authenticated;
grant execute on function public.protect_developer_profile_columns() to service_role;
revoke all on function public.resolve_flow_invites() from public, anon, authenticated;
grant execute on function public.resolve_flow_invites() to authenticated;
grant execute on function public.resolve_flow_invites() to service_role;
revoke all on function public.set_app_published_with_gate(uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_app_published_with_gate(uuid,boolean) to public;
grant execute on function public.set_app_published_with_gate(uuid,boolean) to anon;
grant execute on function public.set_app_published_with_gate(uuid,boolean) to authenticated;
grant execute on function public.set_app_published_with_gate(uuid,boolean) to service_role;
revoke all on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.touch_updated_at() to public;
grant execute on function public.touch_updated_at() to anon;
grant execute on function public.touch_updated_at() to authenticated;
grant execute on function public.touch_updated_at() to service_role;
revoke all on function public.update_app_badges() from public, anon, authenticated;
grant execute on function public.update_app_badges() to authenticated;
grant execute on function public.update_app_badges() to service_role;
revoke all on function public.validate_app_publish_ready(uuid) from public, anon, authenticated;
grant execute on function public.validate_app_publish_ready(uuid) to public;
grant execute on function public.validate_app_publish_ready(uuid) to anon;
grant execute on function public.validate_app_publish_ready(uuid) to authenticated;
grant execute on function public.validate_app_publish_ready(uuid) to service_role;
revoke all on function public.workspace_member_list(uuid) from public, anon, authenticated;
grant execute on function public.workspace_member_list(uuid) to authenticated;
grant execute on function public.workspace_member_list(uuid) to service_role;

-- Triggers
CREATE TRIGGER app_entitlements_default_workspace BEFORE INSERT ON public.app_entitlements FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER app_records_default_workspace BEFORE INSERT ON public.app_records FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER apps_default_workspace BEFORE INSERT ON public.apps FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('created_by');
CREATE TRIGGER apps_protect_admin_columns BEFORE INSERT OR UPDATE ON public.apps FOR EACH ROW EXECUTE FUNCTION protect_app_admin_columns();
CREATE TRIGGER batch_jobs_default_workspace BEFORE INSERT ON public.batch_jobs FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER developer_api_keys_default_workspace BEFORE INSERT ON public.developer_api_keys FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER developer_profiles_default_workspace BEFORE INSERT ON public.developer_profiles FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER developer_profiles_protect_columns BEFORE INSERT OR UPDATE ON public.developer_profiles FOR EACH ROW EXECUTE FUNCTION protect_developer_profile_columns();
CREATE TRIGGER flows_default_workspace BEFORE INSERT ON public.flows FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER knowledge_vault_default_workspace BEFORE INSERT ON public.knowledge_vault FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER purchases_default_workspace BEFORE INSERT ON public.purchases FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('buyer_id');
CREATE TRIGGER run_events_default_workspace BEFORE INSERT ON public.run_events FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER run_history_default_workspace BEFORE INSERT ON public.run_history FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER scheduled_events_default_workspace BEFORE INSERT ON public.scheduled_events FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER user_business_profiles_default_workspace BEFORE INSERT ON public.user_business_profiles FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER user_data_sources_default_workspace BEFORE INSERT ON public.user_data_sources FOR EACH ROW EXECUTE FUNCTION default_workspace_from_owner('user_id');
CREATE TRIGGER on_auth_user_created_workspace AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user_workspace();
CREATE TRIGGER workspace_members_keep_owner BEFORE DELETE OR UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION keep_a_workspace_owner();
CREATE TRIGGER workspaces_add_owner AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION handle_new_team_workspace();
CREATE TRIGGER workspaces_touch BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Row level security
alter table public.app_blueprints enable row level security;
alter table public.app_entitlements enable row level security;
alter table public.app_files enable row level security;
alter table public.app_knowledge enable row level security;
alter table public.app_members enable row level security;
alter table public.app_payments enable row level security;
alter table public.app_records enable row level security;
alter table public.app_reviews enable row level security;
alter table public.app_secrets enable row level security;
alter table public.app_test_cases enable row level security;
alter table public.app_tools enable row level security;
alter table public.app_versions enable row level security;
alter table public.apps enable row level security;
alter table public.batch_job_rows enable row level security;
alter table public.batch_jobs enable row level security;
alter table public.blueprint_test_results enable row level security;
alter table public.conversation_threads enable row level security;
alter table public.developer_api_keys enable row level security;
alter table public.developer_profiles enable row level security;
alter table public.developer_settings enable row level security;
alter table public.domains enable row level security;
alter table public.favorites enable row level security;
alter table public.flow_members enable row level security;
alter table public.flow_schedules enable row level security;
alter table public.flows enable row level security;
alter table public.knowledge_vault enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.notifications enable row level security;
alter table public.purchases enable row level security;
alter table public.run_events enable row level security;
alter table public.run_history enable row level security;
alter table public.scheduled_events enable row level security;
alter table public.thread_messages enable row level security;
alter table public.user_alerts enable row level security;
alter table public.user_api_keys enable row level security;
alter table public.user_business_profiles enable row level security;
alter table public.user_career_profiles enable row level security;
alter table public.user_data_sources enable row level security;
alter table public.user_goals enable row level security;
alter table public.user_memory enable row level security;
alter table public.user_roles enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspaces enable row level security;
create policy app_blueprints_delete on public.app_blueprints as permissive for delete to authenticated
  using (can_edit_app(app_id));
create policy app_blueprints_insert on public.app_blueprints as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND can_edit_app(app_id)));
create policy app_blueprints_select on public.app_blueprints as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR can_edit_app(app_id)));
create policy app_blueprints_update on public.app_blueprints as permissive for update to authenticated
  using (can_edit_app(app_id))
  with check (can_edit_app(app_id));
create policy app_entitlements_select on public.app_entitlements as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)) OR is_app_owner(app_id)));
create policy app_files_delete on public.app_files as permissive for delete to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR can_edit_app(app_id)));
create policy app_files_insert on public.app_files as permissive for insert to authenticated
  with check ((owner_id = ( SELECT auth.uid() AS uid)));
create policy app_files_select on public.app_files as permissive for select to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR can_edit_app(app_id)));
create policy app_knowledge_owner on public.app_knowledge as permissive for all to authenticated
  using (can_edit_app(app_id))
  with check (can_edit_app(app_id));
create policy app_members_delete on public.app_members as permissive for delete to authenticated
  using (is_app_owner(app_id));
create policy app_members_insert on public.app_members as permissive for insert to authenticated
  with check (is_app_owner(app_id));
create policy app_members_select on public.app_members as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (invited_email = ( SELECT (auth.jwt() ->> 'email'::text))) OR is_app_owner(app_id)));
create policy app_members_update on public.app_members as permissive for update to authenticated
  using (is_app_owner(app_id))
  with check (is_app_owner(app_id));
create policy app_payments_insert on public.app_payments as permissive for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_payments_select on public.app_payments as permissive for select to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_records_admin_read on public.app_records as permissive for select to authenticated
  using (((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text])));
create policy app_records_own on public.app_records as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_reviews_delete on public.app_reviews as permissive for delete to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_reviews_insert on public.app_reviews as permissive for insert to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_reviews_select on public.app_reviews as permissive for select to anon, authenticated
  using ((EXISTS ( SELECT 1
   FROM marketplace_listings m
  WHERE ((m.app_id = app_reviews.app_id) AND (m.status = 'live'::text)))));
create policy app_reviews_update on public.app_reviews as permissive for update to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy app_test_cases_own on public.app_test_cases as permissive for all to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR can_edit_app(app_id)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND can_edit_app(app_id)));
create policy app_tools_owner on public.app_tools as permissive for all to authenticated
  using (can_edit_app(app_id))
  with check (can_edit_app(app_id));
create policy app_versions_insert on public.app_versions as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND can_edit_app(app_id)));
create policy app_versions_select on public.app_versions as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR can_edit_app(app_id)));
create policy apps_delete on public.apps as permissive for delete to authenticated
  using ((is_app_owner(id) OR is_staff()));
create policy apps_insert on public.apps as permissive for insert to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND ((workspace_id IS NULL) OR is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text, 'developer'::text]))));
create policy apps_select on public.apps as permissive for select to anon, authenticated
  using ((is_published OR (created_by = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id)) OR is_app_member(id) OR is_staff() OR (EXISTS ( SELECT 1
   FROM marketplace_listings m
  WHERE ((m.app_id = apps.id) AND (m.status = 'live'::text))))));
create policy apps_update on public.apps as permissive for update to authenticated
  using (can_edit_app(id))
  with check ((can_edit_app(id) OR is_staff()));
create policy batch_job_rows_select on public.batch_job_rows as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM batch_jobs j
  WHERE ((j.id = batch_job_rows.job_id) AND ((j.user_id = ( SELECT auth.uid() AS uid)) OR ((j.workspace_id IS NOT NULL) AND is_workspace_member(j.workspace_id, ARRAY['owner'::text, 'admin'::text])))))));
create policy batch_jobs_select on public.batch_jobs as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))));
create policy blueprint_test_results_own on public.blueprint_test_results as permissive for all to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR can_edit_app(app_id)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND can_edit_app(app_id)));
create policy conversation_threads_own on public.conversation_threads as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy developer_api_keys_delete on public.developer_api_keys as permissive for delete to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))));
create policy developer_api_keys_select on public.developer_api_keys as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text, 'developer'::text]))));
create policy developer_api_keys_update on public.developer_api_keys as permissive for update to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))))
  with check (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))));
create policy developer_profiles_own on public.developer_profiles as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy developer_settings_own on public.developer_settings as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy domains_read on public.domains as permissive for select to anon, authenticated
  using (true);
create policy favorites_own on public.favorites as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy flow_members_delete on public.flow_members as permissive for delete to authenticated
  using ((is_flow_owner(flow_id) OR (user_id = ( SELECT auth.uid() AS uid)) OR (lower(invited_email) = lower(( SELECT (auth.jwt() ->> 'email'::text))))));
create policy flow_members_insert on public.flow_members as permissive for insert to authenticated
  with check (is_flow_owner(flow_id));
create policy flow_members_select on public.flow_members as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (lower(invited_email) = lower(( SELECT (auth.jwt() ->> 'email'::text)))) OR is_flow_owner(flow_id)));
create policy flow_schedules_own on public.flow_schedules as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy flows_delete on public.flows as permissive for delete to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))));
create policy flows_insert on public.flows as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((workspace_id IS NULL) OR is_workspace_member(workspace_id))));
create policy flows_select on public.flows as permissive for select to anon, authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR is_published OR is_flow_member(id) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
create policy flows_update on public.flows as permissive for update to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR is_flow_editor(id) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text, 'developer'::text]))))
  with check (((workspace_id IS NULL) OR is_workspace_member(workspace_id) OR is_flow_editor(id)));
create policy knowledge_vault_delete on public.knowledge_vault as permissive for delete to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))));
create policy knowledge_vault_insert on public.knowledge_vault as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((workspace_id IS NULL) OR is_workspace_member(workspace_id))));
create policy knowledge_vault_select on public.knowledge_vault as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
create policy knowledge_vault_update on public.knowledge_vault as permissive for update to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))))
  with check (((workspace_id IS NULL) OR is_workspace_member(workspace_id)));
create policy marketplace_listings_own on public.marketplace_listings as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy marketplace_listings_read_live on public.marketplace_listings as permissive for select to anon, authenticated
  using ((status = 'live'::text));
create policy notifications_own on public.notifications as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy purchases_select on public.purchases as permissive for select to authenticated
  using (((buyer_id = ( SELECT auth.uid() AS uid)) OR (dev_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text, 'billing'::text])) OR is_app_owner(app_id)));
create policy run_history_admin_read on public.run_history as permissive for select to authenticated
  using (((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text])));
create policy run_history_own on public.run_history as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy scheduled_events_admin_read on public.scheduled_events as permissive for select to authenticated
  using (((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text])));
create policy scheduled_events_own on public.scheduled_events as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy thread_messages_own on public.thread_messages as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM conversation_threads t
  WHERE ((t.id = thread_messages.thread_id) AND (t.user_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM conversation_threads t
  WHERE ((t.id = thread_messages.thread_id) AND (t.user_id = ( SELECT auth.uid() AS uid))))));
create policy user_alerts_own on public.user_alerts as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_api_keys_own on public.user_api_keys as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_business_profiles_own on public.user_business_profiles as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_career_profiles_own on public.user_career_profiles as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_data_sources_delete on public.user_data_sources as permissive for delete to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))));
create policy user_data_sources_insert on public.user_data_sources as permissive for insert to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND ((workspace_id IS NULL) OR is_workspace_member(workspace_id))));
create policy user_data_sources_select on public.user_data_sources as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id))));
create policy user_data_sources_update on public.user_data_sources as permissive for update to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ((workspace_id IS NOT NULL) AND is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]))))
  with check (((workspace_id IS NULL) OR is_workspace_member(workspace_id)));
create policy user_goals_own on public.user_goals as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_memory_own on public.user_memory as permissive for all to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy user_roles_delete on public.user_roles as permissive for delete to authenticated
  using (is_admin());
create policy user_roles_insert on public.user_roles as permissive for insert to authenticated
  with check (is_admin());
create policy user_roles_select on public.user_roles as permissive for select to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR is_admin()));
create policy user_roles_update on public.user_roles as permissive for update to authenticated
  using (is_admin())
  with check (is_admin());
create policy workspace_invites_delete on public.workspace_invites as permissive for delete to authenticated
  using (is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]));
create policy workspace_invites_insert on public.workspace_invites as permissive for insert to authenticated
  with check ((is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]) AND (invited_by = ( SELECT auth.uid() AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_invites.workspace_id) AND w.is_personal))))));
create policy workspace_invites_select on public.workspace_invites as permissive for select to authenticated
  using ((is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]) OR (lower(email) = lower(( SELECT (auth.jwt() ->> 'email'::text))))));
create policy workspace_members_delete on public.workspace_members as permissive for delete to authenticated
  using (((NOT (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND w.is_personal)))) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]) AND (role <> 'owner'::text)) OR is_workspace_member(workspace_id, ARRAY['owner'::text]))));
create policy workspace_members_insert on public.workspace_members as permissive for insert to authenticated
  with check ((is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]) AND ((role <> 'owner'::text) OR is_workspace_member(workspace_id, ARRAY['owner'::text])) AND (NOT (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND w.is_personal))))));
create policy workspace_members_select on public.workspace_members as permissive for select to authenticated
  using (is_workspace_member(workspace_id));
create policy workspace_members_update on public.workspace_members as permissive for update to authenticated
  using ((is_workspace_member(workspace_id, ARRAY['owner'::text, 'admin'::text]) AND (NOT (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND w.is_personal))))))
  with check (((role <> 'owner'::text) OR is_workspace_member(workspace_id, ARRAY['owner'::text])));
create policy workspaces_delete on public.workspaces as permissive for delete to authenticated
  using (((NOT is_personal) AND is_workspace_member(id, ARRAY['owner'::text])));
create policy workspaces_insert on public.workspaces as permissive for insert to authenticated
  with check (((NOT is_personal) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy workspaces_select on public.workspaces as permissive for select to authenticated
  using ((is_workspace_member(id) OR (created_by = ( SELECT auth.uid() AS uid))));
create policy workspaces_update on public.workspaces as permissive for update to authenticated
  using (is_workspace_member(id, ARRAY['owner'::text, 'admin'::text]))
  with check (is_workspace_member(id, ARRAY['owner'::text, 'admin'::text]));
create policy aistrix_files_delete_own on storage.objects as permissive for delete to authenticated
  using (((bucket_id = ANY (ARRAY['aistrix-input-files'::text, 'aistrix-output-files'::text])) AND ((storage.foldername(name))[4] = (auth.uid())::text)));
create policy aistrix_files_insert_own on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = ANY (ARRAY['aistrix-input-files'::text, 'aistrix-output-files'::text])) AND ((storage.foldername(name))[1] = 'apps'::text) AND ((storage.foldername(name))[3] = 'users'::text) AND ((storage.foldername(name))[4] = (auth.uid())::text)));
create policy aistrix_files_select_own on storage.objects as permissive for select to authenticated
  using (((bucket_id = ANY (ARRAY['aistrix-input-files'::text, 'aistrix-output-files'::text])) AND ((storage.foldername(name))[4] = (auth.uid())::text)));

-- Storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aistrix-input-files', 'aistrix-input-files', false, 10485760, null)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('aistrix-output-files', 'aistrix-output-files', false, 52428800, null)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
