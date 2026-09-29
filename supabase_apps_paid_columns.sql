-- Add missing columns to apps table
-- is_paid / price_per_run are required for the marketplace paid-app flow.
-- is_featured is required by AdminPage stats query (400 otherwise).

alter table apps
  add column if not exists is_paid        boolean not null default false,
  add column if not exists price_per_run  numeric(10,4),
  add column if not exists is_featured    boolean not null default false;

-- Index to quickly find paid/featured apps
create index if not exists apps_is_paid_idx     on apps(is_paid)     where is_paid = true;
create index if not exists apps_is_featured_idx on apps(is_featured) where is_featured = true;
