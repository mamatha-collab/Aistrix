-- The OpenAI/Anthropic-compatible model gateway (/v1/gateway): one row per
-- call, metadata only. Prompts, answers and tool arguments are never stored.
-- Written and read by the backend (service role) only, like platform tables.
create table public.gateway_calls (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  surface text not null check (surface in ('openai', 'anthropic')),
  trace text check (trace ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  model_ref text,
  provider text,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6),
  tool_calls integer not null default 0,
  stream boolean not null default false,
  status text not null check (status in ('ok', 'error')),
  error_code text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index gateway_calls_owner_created on public.gateway_calls (owner_id, created_at desc);
create index gateway_calls_owner_trace on public.gateway_calls (owner_id, trace) where trace is not null;

alter table public.gateway_calls enable row level security;
revoke all on public.gateway_calls from public, anon, authenticated;
grant all on public.gateway_calls to service_role;
