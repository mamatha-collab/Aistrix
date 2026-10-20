-- Improve: comparison history. Each side-by-side run (baseline vs candidate
-- on the same input) is kept so editors can look back at what was compared,
-- re-run it, or turn its input into a regression test. Only the app's
-- current editors can read or add entries (prompts are editor-only data).
create table if not exists public.app_comparisons (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  input text not null check (char_length(input) <= 8000),
  baseline jsonb not null,            -- { label, version_num, prompt, provider, model }
  candidate jsonb not null,
  baseline_output text check (char_length(baseline_output) <= 20000),
  candidate_output text check (char_length(candidate_output) <= 20000),
  created_at timestamptz not null default now()
);
create index if not exists app_comparisons_app_idx on public.app_comparisons (app_id, created_at desc);

alter table public.app_comparisons enable row level security;
revoke all on table public.app_comparisons from anon;
drop policy if exists app_comparisons_editors_read on public.app_comparisons;
drop policy if exists app_comparisons_editors_insert on public.app_comparisons;
drop policy if exists app_comparisons_editors_delete on public.app_comparisons;
create policy app_comparisons_editors_read on public.app_comparisons for select to authenticated
  using (can_edit_app(app_id));
create policy app_comparisons_editors_insert on public.app_comparisons for insert to authenticated
  with check (user_id = (select auth.uid()) and can_edit_app(app_id));
create policy app_comparisons_editors_delete on public.app_comparisons for delete to authenticated
  using (can_edit_app(app_id));
