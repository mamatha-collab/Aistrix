-- Launch readiness.

-- Sales records outlive their app: deleting an app (or an account) used to
-- delete its purchases too, erasing earnings history and the accounting CSV.
alter table public.purchases alter column app_id drop not null;
alter table public.purchases drop constraint if exists purchases_app_id_fkey;
alter table public.purchases add constraint purchases_app_id_fkey
  foreign key (app_id) references public.apps(id) on delete set null;

-- Developer notification emails (refunds, chargebacks, failed payouts, new
-- feedback, Monitor alerts) are recorded once per event, so a retried webhook
-- or several servers never send the same email twice. Server only.
create table if not exists public.developer_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (char_length(kind) <= 40),
  ref text not null check (char_length(ref) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
alter table public.developer_notifications enable row level security;
revoke all on public.developer_notifications from anon, authenticated;

-- A developer can turn those emails off (their own profile row).
alter table public.developer_profiles add column if not exists email_alerts boolean not null default true;

-- One-time markers shared by every server (e.g. a GitHub sign-in link can be
-- used once, whichever server receives it). Server only; old rows can go.
create table if not exists public.server_once (
  key text primary key check (char_length(key) <= 300),
  created_at timestamptz not null default now()
);
alter table public.server_once enable row level security;
revoke all on public.server_once from anon, authenticated;
