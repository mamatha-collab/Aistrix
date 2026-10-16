-- Developer platform: hashed + app-scoped API keys, server-side batch jobs.
-- Run once in the Supabase SQL editor (after supabase_prod_readiness.sql).
-- Safe to re-run.

create extension if not exists pgcrypto with schema extensions;

-- ── Developer API keys: store only a SHA-256 hash ───────────────────────────
alter table developer_api_keys add column if not exists key_hash text;
alter table developer_api_keys add column if not exists key_prefix text;
alter table developer_api_keys add column if not exists app_ids uuid[];   -- null/empty = all of the owner's access
alter table developer_api_keys alter column api_key drop not null;

-- Hash existing plaintext keys, keep a display prefix, then drop the plaintext.
update developer_api_keys
   set key_hash   = encode(extensions.digest(api_key, 'sha256'), 'hex'),
       key_prefix = left(api_key, 14)
 where api_key is not null and key_hash is null;
update developer_api_keys set api_key = null where key_hash is not null;

create unique index if not exists developer_api_keys_key_hash_idx on developer_api_keys(key_hash);

-- Keys are created only by the backend (POST /v1/keys), which generates the
-- secret and stores its hash. Owners can still list, revoke and delete.
drop policy if exists "developer_api_keys_insert_own" on developer_api_keys;

-- ── Batch jobs ──────────────────────────────────────────────────────────────
create table if not exists batch_jobs (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid not null references apps(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'queued'
                check (status in ('queued','running','completed','completed_with_errors','stopped','cancelled','failed')),
  total         int  not null default 0,
  completed     int  not null default 0,
  failed        int  not null default 0,
  stop_reason   text,
  webhook_url   text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  heartbeat_at  timestamptz
);

create index if not exists batch_jobs_user_idx   on batch_jobs(user_id, created_at desc);
create index if not exists batch_jobs_status_idx on batch_jobs(status) where status in ('queued', 'running');

create table if not exists batch_job_rows (
  job_id        uuid not null references batch_jobs(id) on delete cascade,
  idx           int  not null,
  input         text not null,
  status        text not null default 'pending' check (status in ('pending','running','done','error')),
  output        text,
  data          jsonb,
  error         text,
  input_tokens  int,
  output_tokens int,
  updated_at    timestamptz not null default now(),
  primary key (job_id, idx)
);

create index if not exists batch_job_rows_status_idx on batch_job_rows(job_id, status);

-- Owners can read their jobs; all writes go through the backend (service role).
alter table batch_jobs enable row level security;
alter table batch_job_rows enable row level security;

drop policy if exists "batch_jobs_select_own" on batch_jobs;
create policy "batch_jobs_select_own" on batch_jobs for select using (user_id = auth.uid());

drop policy if exists "batch_job_rows_select_own" on batch_job_rows;
create policy "batch_job_rows_select_own" on batch_job_rows for select
  using (exists (select 1 from batch_jobs j where j.id = batch_job_rows.job_id and j.user_id = auth.uid()));
