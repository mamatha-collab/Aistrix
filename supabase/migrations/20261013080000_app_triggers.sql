-- Inbound trigger links for apps (Deploy → Share links): POST /webhooks/{token}
-- runs the app's live version. Kept out of `apps`, whose rows end users can
-- read, because the token is the credential. Only the backend reads or
-- writes it; developers manage it through /v1/apps/{id}/trigger.
create table if not exists public.app_triggers (
  app_id uuid primary key references public.apps(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.app_triggers enable row level security;
