-- App Blueprint table — stores the full Aistrix blueprint JSONB per app.
-- One row per app; upsert on app_id.

create table if not exists app_blueprints (
  id               uuid primary key default gen_random_uuid(),
  app_id           uuid not null references apps(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  blueprint        jsonb not null default '{}',
  readiness_score  integer,
  status           text not null default 'draft',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (app_id)
);

create index if not exists app_blueprints_app_id_idx  on app_blueprints(app_id);
create index if not exists app_blueprints_user_id_idx on app_blueprints(user_id);

alter table app_blueprints enable row level security;

create policy "blueprints_owner_all" on app_blueprints
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
