-- Workflow runs can be stopped from Dev Studio (Runs → Stop).
alter table public.flow_runs drop constraint if exists flow_runs_status_check;
alter table public.flow_runs add constraint flow_runs_status_check
  check (status in ('running', 'waiting_approval', 'done', 'failed', 'cancelled'));

-- One schedule per developer workflow (Deploy → Schedule); Business flows
-- keep their own schedules as before.
create index if not exists flow_schedules_flow on public.flow_schedules (flow_id);
