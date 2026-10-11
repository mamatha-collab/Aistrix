-- Dev Studio test results. Tests run on the backend (POST
-- /v1/apps/{id}/tests/run) against the app's draft and are stored with a
-- hash of that draft, so publishing can require passing tests for the
-- current version. Only the backend writes rows; people who can edit the app
-- can read them.

create table if not exists public.app_test_runs (
  id uuid default gen_random_uuid() not null,
  app_id uuid not null,
  user_id uuid not null,
  draft_hash text not null,
  source text not null,
  case_ref text not null,
  label text,
  persona text,
  input text,
  output text,
  passed boolean not null,
  errors jsonb default '[]'::jsonb not null,
  latency_ms integer,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6),
  judged_checks integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint app_test_runs_pkey primary key (id),
  constraint app_test_runs_app_id_fkey foreign key (app_id) references public.apps(id) on delete cascade,
  constraint app_test_runs_source check (source in ('blueprint', 'suite', 'persona', 'profile'))
);

create index if not exists app_test_runs_app_draft_idx
  on public.app_test_runs (app_id, draft_hash, created_at desc);

alter table public.app_test_runs enable row level security;

drop policy if exists app_test_runs_editors_read on public.app_test_runs;
create policy app_test_runs_editors_read on public.app_test_runs
  as permissive for select to authenticated
  using (can_edit_app(app_id));

revoke insert, update, delete on public.app_test_runs from anon, authenticated;
