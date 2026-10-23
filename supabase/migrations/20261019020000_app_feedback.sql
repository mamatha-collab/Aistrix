-- Customer feedback the app's developers can act on. A customer's run stays
-- private (run_history is readable by its owner only); when they rate it,
-- the rating and comment are shared with the developers, and their question
-- and the answer only if they choose to include them. No customer identity
-- is exposed. Developers triage each item: new → investigating → fixed →
-- verified (or dismissed).
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  run_id uuid not null unique references public.run_history(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  comment text check (char_length(comment) <= 1000),
  shared_input text,
  shared_output text,
  status text not null default 'new' check (status in ('new', 'investigating', 'fixed', 'verified', 'dismissed')),
  note text check (char_length(note) <= 1000),
  test_case_id uuid references public.app_test_cases(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists app_feedback_app_idx on public.app_feedback (app_id, created_at desc);

-- Server only: the API checks the caller can edit the app and never returns
-- who gave the feedback.
alter table public.app_feedback enable row level security;
revoke all on table public.app_feedback from anon, authenticated;

drop trigger if exists app_feedback_touch on public.app_feedback;
create trigger app_feedback_touch before update on public.app_feedback
  for each row execute function public.touch_updated_at();
