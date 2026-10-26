-- Workflow runs (one engine for scheduled, webhook and interactive runs).
-- One row per run: each step's status, the app version it used and its
-- output, so a run paused at an approval step can be resumed and the
-- builder can show what each step produced. Server only: read through
-- GET /v1/flows/{id}/runs/{run_id}.
create table if not exists public.flow_runs (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  trigger text not null check (trigger in ('interactive', 'schedule', 'webhook')),
  status text not null default 'running' check (status in ('running', 'waiting_approval', 'done', 'failed')),
  seed_input text,
  current_step int not null default 0,
  steps jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists flow_runs_flow_started on public.flow_runs (flow_id, started_at desc);
alter table public.flow_runs enable row level security;
revoke all on public.flow_runs from anon, authenticated;
