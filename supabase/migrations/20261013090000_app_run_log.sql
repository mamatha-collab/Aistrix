-- Every completed run of an app, written by the backend: signed-in users,
-- API calls, inbound triggers and anonymous website visitors (user_id null).
-- Deploy → Run history counts from here; run_history only has signed-in
-- users' runs. Developers' own draft runs and test runs aren't logged.
create table if not exists public.app_runs (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  source text not null,   -- app | embed | api | trigger
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists app_runs_app_time_idx on public.app_runs (app_id, created_at desc);
alter table public.app_runs enable row level security;
-- No policies: only the backend reads or writes it.
