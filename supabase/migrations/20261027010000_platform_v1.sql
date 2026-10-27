-- Platform v1: resource registry, immutable releases, environments, AEX runs
-- and eval results. Additive only: no existing table is altered. All rows are
-- server-only (the backend's service role); the API scopes every read and
-- write to the caller's own owner_id.

create table public.platform_resources (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z]+/[a-z][a-z0-9-]{0,62}/[a-z][a-z0-9-]{0,62}$'),
  workspace_id uuid,
  kind text not null,
  namespace text not null,
  name text not null,
  draft jsonb not null,
  draft_hash text not null,
  latest_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

create table public.platform_releases (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid,
  resource_key text not null,
  kind text not null,
  version text not null,
  spec jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  plans jsonb not null default '{}'::jsonb,
  surfaces jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, resource_key, version)
);
create index platform_releases_resource on public.platform_releases(owner_id, resource_key, created_at desc);

-- Releases never change once written.
create function public.platform_releases_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Releases are immutable; release a new version instead';
end $$;
create trigger platform_releases_immutable before update on public.platform_releases
for each row execute function public.platform_releases_immutable();
revoke all on function public.platform_releases_immutable() from public, anon, authenticated;

create table public.platform_environments (
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_key text not null,
  stage text not null check (stage in ('dev','staging','production')),
  release_id uuid not null references public.platform_releases(id),
  version text not null,
  history jsonb not null default '[]'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (owner_id, resource_key, stage)
);

create table public.platform_runs (
  id uuid primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  workspace_id uuid,
  resource_key text not null,
  workload text not null,
  release_id uuid references public.platform_releases(id),
  environment text,
  trigger text not null,
  status text not null check (status in ('queued','running','waiting_approval','succeeded','failed','cancelled','rejected','needs_review')),
  record jsonb not null,
  version integer not null default 1,
  -- Never null, so one conditional update claims a free or expired lease.
  lease_owner text,
  lease_expires_at timestamptz not null default 'epoch',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index platform_runs_owner on public.platform_runs(owner_id, created_at desc);
create index platform_runs_resource on public.platform_runs(owner_id, resource_key, created_at desc);
create index platform_runs_resumable on public.platform_runs(lease_expires_at) where status in ('queued','running');

create table public.platform_run_events (
  seq bigint generated always as identity primary key,
  run_id uuid not null references public.platform_runs(id) on delete cascade,
  event jsonb not null,
  created_at timestamptz not null default now()
);
create index platform_run_events_run on public.platform_run_events(run_id, seq);

create table public.platform_eval_results (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  release_id uuid not null references public.platform_releases(id) on delete cascade,
  suite text not null,
  suite_release_id uuid references public.platform_releases(id),
  passed boolean not null,
  pass_rate double precision not null,
  required double precision not null,
  cases jsonb not null,
  cost_usd double precision not null default 0,
  created_at timestamptz not null default now()
);
create index platform_eval_results_release on public.platform_eval_results(release_id, created_at desc);

-- Secrets a resource declares in policies.secrets, encrypted by the backend
-- (the same Fernet key as app_secrets). Values never leave the server.
create table public.platform_secrets (
  owner_id uuid not null references auth.users(id) on delete cascade,
  resource_key text not null,
  key text not null check (key ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  encrypted_value text not null,
  last4 text,
  updated_at timestamptz not null default now(),
  primary key (owner_id, resource_key, key)
);
alter table public.platform_secrets enable row level security;
revoke all on public.platform_secrets from public, anon, authenticated;
grant all on public.platform_secrets to service_role;

alter table public.platform_resources enable row level security;
alter table public.platform_releases enable row level security;
alter table public.platform_environments enable row level security;
alter table public.platform_runs enable row level security;
alter table public.platform_run_events enable row level security;
alter table public.platform_eval_results enable row level security;
revoke all on public.platform_resources, public.platform_releases, public.platform_environments,
  public.platform_runs, public.platform_run_events, public.platform_eval_results from public, anon, authenticated;
grant all on public.platform_resources, public.platform_releases, public.platform_environments,
  public.platform_runs, public.platform_run_events, public.platform_eval_results to service_role;
