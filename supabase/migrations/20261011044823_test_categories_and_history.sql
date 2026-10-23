-- Test categories are explicit (not guessed from a test's name), and a test
-- only counts toward a publish requirement if it has a real check.
-- Chatbot tests can include earlier conversation turns.

alter table public.app_test_runs add column if not exists category text;
alter table public.app_test_runs add column if not exists substantive_checks integer default 0 not null;

alter table public.app_test_cases add column if not exists category text;
alter table public.app_test_cases add column if not exists history jsonb default '[]'::jsonb not null;

alter table public.app_test_cases drop constraint if exists app_test_cases_category;
alter table public.app_test_cases add constraint app_test_cases_category
  check (category is null or category in ('functional', 'edge', 'safety', 'contract', 'app_specific'));
