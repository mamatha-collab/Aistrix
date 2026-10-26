-- App quality & version history features
-- Run this in the Supabase SQL editor

-- Sample input field on apps (used for quality score + default test input)
alter table apps
  add column if not exists sample_input text;

-- Version history table (if not already created)
create table if not exists app_versions (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid not null references apps(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  version_data jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists app_versions_app_id_idx on app_versions(app_id);
create index if not exists app_versions_created_at_idx on app_versions(created_at desc);

-- Enable RLS on app_versions
alter table app_versions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'app_versions' and policyname = 'Users can read own app versions') then
    create policy "Users can read own app versions"
      on app_versions for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'app_versions' and policyname = 'Users can insert own app versions') then
    create policy "Users can insert own app versions"
      on app_versions for insert with check (auth.uid() = user_id);
  end if;
end $$;
