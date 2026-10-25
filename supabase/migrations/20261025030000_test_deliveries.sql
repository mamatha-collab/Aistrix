-- Test destinations: what a developer's workflow would have sent to an outside
-- system (accounting, CRM, an outbox), captured so it can be checked without
-- third-party accounts. Each developer has private destination URLs; reads go
-- through the API. Captures older than 14 days are removed when new ones arrive.
create table if not exists public.test_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  destination text not null check (destination ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  method text not null check (method in ('POST', 'PUT', 'PATCH', 'DELETE')),
  content_type text,
  body text check (length(body) <= 65536),
  created_at timestamptz not null default now()
);
create index if not exists test_deliveries_user on public.test_deliveries(user_id, created_at desc);

alter table public.test_deliveries enable row level security;
revoke all on public.test_deliveries from public, anon, authenticated;
grant select, insert, delete on public.test_deliveries to service_role;

notify pgrst, 'reload schema';
