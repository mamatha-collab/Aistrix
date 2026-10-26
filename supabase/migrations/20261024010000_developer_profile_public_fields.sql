-- Align the existing public profile editor with its stored schema. These are
-- optional display fields; no existing rows, ownership or payment data change.
alter table public.developer_profiles
  add column if not exists avatar_url text,
  add column if not exists github text,
  add column if not exists twitter text,
  add column if not exists updated_at timestamptz not null default now();

-- Profiles also contain owner-only Stripe/earnings data. Expose a column-limited
-- view, not a public SELECT policy on the financial row. The migration owner
-- reads the underlying tables; only published public-app creators are projected.
create or replace view public.public_developer_profiles
with (security_barrier = true) as
select d.user_id, d.display_name, d.bio, d.website, d.github, d.twitter, d.avatar_url
from public.developer_profiles d
where exists (
  select 1 from public.apps a
  where a.created_by = d.user_id and a.is_published and a.visibility = 'public'
);

-- Override Supabase schema default grants: even an automatically updatable
-- projection must remain read-only to API callers.
revoke all on public.public_developer_profiles from public, anon, authenticated, service_role;
grant select on public.public_developer_profiles to anon, authenticated, service_role;

notify pgrst, 'reload schema';
