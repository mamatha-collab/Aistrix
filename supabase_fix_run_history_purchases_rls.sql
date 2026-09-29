-- Fix: run_history and purchases RLS baseline
-- These tables were created without visible RLS policies in the migration files.
-- run_history contains all user inputs/outputs; purchases contains payment records.

-- ── run_history ──────────────────────────────────────────────────────────────
alter table run_history enable row level security;

-- Users can only read their own run history
create policy "run_history_select_own" on run_history
  for select using (auth.uid() = user_id);

-- App owners can read run history for their apps (for analytics)
create policy "run_history_select_app_owner" on run_history
  for select using (
    app_id in (select id from apps where created_by = auth.uid())
  );

-- Block direct inserts/updates/deletes — backend (service-role) only
create policy "run_history_no_insert" on run_history
  for insert with check (false);

create policy "run_history_no_update" on run_history
  for update using (false);

create policy "run_history_no_delete" on run_history
  for delete using (false);

-- ── purchases ────────────────────────────────────────────────────────────────
alter table purchases enable row level security;

-- Buyers see their own purchases; app owners see purchases for their apps
create policy "purchases_select" on purchases
  for select using (
    user_id = auth.uid()
    or app_id in (select id from apps where created_by = auth.uid())
  );

-- Block all direct writes — backend (service-role) only
create policy "purchases_no_insert" on purchases
  for insert with check (false);

create policy "purchases_no_update" on purchases
  for update using (false);

create policy "purchases_no_delete" on purchases
  for delete using (false);
