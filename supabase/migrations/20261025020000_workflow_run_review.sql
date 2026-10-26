-- Workflow runs that need a person: interrupted runs and runs whose last step
-- may have reached an outside service without confirming it. They are never
-- repeated automatically; someone reviews them, then continues or dismisses.
alter table public.flow_runs add column if not exists needs_review boolean not null default false;
alter table public.flow_runs add column if not exists review_note text;
alter table public.flow_runs add column if not exists reviewed_by uuid;
alter table public.flow_runs add column if not exists reviewed_at timestamptz;
create index if not exists flow_runs_needs_review on public.flow_runs(flow_id, started_at desc) where needs_review;

create or replace function public.recover_interrupted_flow_runs()
returns integer language plpgsql security definer set search_path = public as $$
declare recovered integer;
begin
  update flow_runs set status = 'failed', finished_at = clock_timestamp(), lease_token = null, needs_review = true,
    error = 'Execution was interrupted or its worker lost ownership. An external action may have completed. Review step results and the destination before continuing the run.'
  where status = 'running' and coalesce(lease_expires_at, started_at + interval '120 seconds') <= clock_timestamp();
  get diagnostics recovered = row_count;
  return recovered;
end $$;

revoke all on function public.recover_interrupted_flow_runs() from public, anon, authenticated;
grant execute on function public.recover_interrupted_flow_runs() to service_role;

notify pgrst, 'reload schema';
