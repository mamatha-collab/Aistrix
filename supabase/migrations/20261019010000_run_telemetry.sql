-- Production telemetry for Operate (Monitor / Eval / Version): every real
-- run of an app, failures included, with how it went, how long it took,
-- what it cost and which published version answered (null = draft).
alter table public.app_runs add column if not exists status text not null default 'ok';   -- ok | error
alter table public.app_runs add column if not exists error_kind text;                      -- timeout, provider_error, refusal…
alter table public.app_runs add column if not exists latency_ms integer;
alter table public.app_runs add column if not exists live_version integer;
alter table public.app_runs add column if not exists model text;
alter table public.app_runs add column if not exists cost_usd numeric(12,6);
