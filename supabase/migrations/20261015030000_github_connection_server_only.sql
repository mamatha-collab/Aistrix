-- GitHub connections move out of developer_settings (which the developer's
-- browser can read) into a table only the server can use. The token is
-- stored encrypted by the backend; browsers get connected/login/repo through
-- the API, never the token.
create table if not exists public.developer_github (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_encrypted text not null,
  login text,
  repo text,
  connected_at timestamptz not null default now()
);
alter table public.developer_github enable row level security;
revoke all on table public.developer_github from anon, authenticated;

-- Tokens saved the old way were readable in the browser: drop them (the
-- developer reconnects once). Unused integration keys from the removed
-- Monitor/Evaluate/Version/Revenue cards go too.
update public.developer_settings
   set settings = settings - 'github' - 'langfuse' - 'sentry' - 'promptfoo' - 'deepeval'
                  - 'ragas' - 'unleash' - 'flagsmith' - 'posthog_flags' - 'stripe'
 where settings ?| array['github', 'langfuse', 'sentry', 'promptfoo', 'deepeval',
                         'ragas', 'unleash', 'flagsmith', 'posthog_flags', 'stripe'];
