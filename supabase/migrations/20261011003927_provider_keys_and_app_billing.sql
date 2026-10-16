-- Developers' own AI provider keys, and who pays for an app's runs.

-- Keys are now checked and encrypted by the backend (PUT /v1/provider-keys)
-- and stored with their last 4 characters for display. Browsers may still
-- list and delete their own rows (RLS policy user_api_keys_own), but can no
-- longer write keys directly — that is how plaintext keys were being saved.
alter table public.user_api_keys add column if not exists last4 text;
revoke insert, update on public.user_api_keys from anon, authenticated;

-- Who pays when end users run an app:
--   free — the developer's own key for the app's provider pays, up to
--          free_runs_per_user_day runs per user (null = server default);
--          without a developer key, the user's own key or the platform's.
--   byok — end users must add their own key for the app's provider.
alter table public.apps add column if not exists billing_mode text not null default 'free';
alter table public.apps add column if not exists free_runs_per_user_day integer;

alter table public.apps drop constraint if exists apps_billing_mode;
alter table public.apps add constraint apps_billing_mode
  check (billing_mode in ('free', 'byok'));

alter table public.apps drop constraint if exists apps_free_runs_per_user_day;
alter table public.apps add constraint apps_free_runs_per_user_day
  check (free_runs_per_user_day is null or free_runs_per_user_day between 0 and 10000);
