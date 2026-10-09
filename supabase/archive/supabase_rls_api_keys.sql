-- RLS: user_api_keys + developer_api_keys
-- Both tables contain sensitive keys — strictly owner-only.

-- ── user_api_keys ─────────────────────────────────────────────────────────────
-- Stores encrypted AI provider keys (Anthropic, OpenAI, etc.).
-- The backend fetches these via get_supabase_for_user(user_jwt), which runs
-- as the user's own JWT — so the user's RLS SELECT policy covers backend reads.
alter table user_api_keys enable row level security;

create policy "user_api_keys_select_own" on user_api_keys
  for select using (auth.uid() = user_id);

create policy "user_api_keys_insert_own" on user_api_keys
  for insert with check (auth.uid() = user_id);

create policy "user_api_keys_update_own" on user_api_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_api_keys_delete_own" on user_api_keys
  for delete using (auth.uid() = user_id);


-- ── developer_api_keys ────────────────────────────────────────────────────────
-- Stores developer-issued API keys (ak_live_...) for external integrations.
-- The raw key is shown once on creation; subsequent reads return it too —
-- this is by design (owner can re-copy their own keys).
alter table developer_api_keys enable row level security;

create policy "developer_api_keys_select_own" on developer_api_keys
  for select using (auth.uid() = user_id);

create policy "developer_api_keys_insert_own" on developer_api_keys
  for insert with check (auth.uid() = user_id);

create policy "developer_api_keys_update_own" on developer_api_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "developer_api_keys_delete_own" on developer_api_keys
  for delete using (auth.uid() = user_id);
