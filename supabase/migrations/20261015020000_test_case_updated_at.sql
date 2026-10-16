-- Saved tests record when they were last edited. The release gate only
-- accepts a test result recorded after the test's latest edit, so changing
-- a saved test's input or rules means running it again before publishing.
alter table public.app_test_cases add column if not exists updated_at timestamptz;
update public.app_test_cases set updated_at = coalesce(created_at, now()) where updated_at is null;
alter table public.app_test_cases alter column updated_at set default now();
alter table public.app_test_cases alter column updated_at set not null;

drop trigger if exists app_test_cases_touch on public.app_test_cases;
create trigger app_test_cases_touch before update on public.app_test_cases
  for each row execute function public.touch_updated_at();
