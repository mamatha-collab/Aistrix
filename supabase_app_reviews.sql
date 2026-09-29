-- App reviews table
-- One review per user per app; rating 1–5, optional text.

create table if not exists app_reviews (
  id           uuid primary key default gen_random_uuid(),
  app_id       uuid not null references apps(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  rating       smallint not null check (rating between 1 and 5),
  review_text  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (app_id, user_id)
);

create index if not exists app_reviews_app_id_idx on app_reviews(app_id);

alter table app_reviews enable row level security;

-- Anyone can read reviews for published apps
create policy "app_reviews_public_read" on app_reviews
  for select using (
    exists (
      select 1 from marketplace_listings
      where marketplace_listings.app_id = app_reviews.app_id
        and marketplace_listings.status = 'live'
    )
  );

-- Users can write/update/delete their own review
create policy "app_reviews_insert_own" on app_reviews
  for insert with check (auth.uid() = user_id);

create policy "app_reviews_update_own" on app_reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "app_reviews_delete_own" on app_reviews
  for delete using (auth.uid() = user_id);
