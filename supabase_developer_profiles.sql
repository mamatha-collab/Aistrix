-- Developer public profiles — one row per user who wants a public presence.
-- Run once in Supabase SQL editor.

create table developer_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  bio          text,
  website      text,
  avatar_url   text,
  twitter      text,
  github       text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table developer_profiles enable row level security;

-- Owner can read/write their own profile
create policy "owner" on developer_profiles
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Anyone can read any profile
create policy "public_read" on developer_profiles
  for select using (true);
