-- RLS: app_knowledge, app_tools, notifications

-- ── app_knowledge ─────────────────────────────────────────────────────────────
-- Backend reads knowledge via get_anon_client() (no user JWT) during /run.
-- This means the anon role must be able to read knowledge for published apps.
-- Private apps (not in marketplace) are readable only by their owner.
alter table app_knowledge enable row level security;

-- App owner can read/write their knowledge base
create policy "app_knowledge_owner" on app_knowledge
  for all using (
    app_id in (select id from apps where created_by = auth.uid())
  )
  with check (
    app_id in (select id from apps where created_by = auth.uid())
  );

-- Anon + authenticated users can read knowledge for published apps
-- (backend uses anon client for /run; knowledge is surfaced to users anyway)
create policy "app_knowledge_published_read" on app_knowledge
  for select using (
    exists (
      select 1 from marketplace_listings
      where marketplace_listings.app_id = app_knowledge.app_id
        and marketplace_listings.status = 'live'
    )
  );


-- ── app_tools ─────────────────────────────────────────────────────────────────
-- Same read pattern as app_knowledge — backend fetches via anon client during /run.
alter table app_tools enable row level security;

create policy "app_tools_owner" on app_tools
  for all using (
    app_id in (select id from apps where created_by = auth.uid())
  )
  with check (
    app_id in (select id from apps where created_by = auth.uid())
  );

create policy "app_tools_published_read" on app_tools
  for select using (
    exists (
      select 1 from marketplace_listings
      where marketplace_listings.app_id = app_tools.app_id
        and marketplace_listings.status = 'live'
    )
  );


-- ── notifications ─────────────────────────────────────────────────────────────
-- In-app notifications for the current user.
-- INSERT is restricted to own user_id — prevents spamming other users.
-- Cross-user notifications (e.g. purchase confirmations) must go through the
-- backend via service-role, which bypasses RLS entirely.
alter table notifications enable row level security;

create policy "notifications_select_own" on notifications
  for select using (auth.uid() = user_id);

create policy "notifications_insert_own" on notifications
  for insert with check (auth.uid() = user_id);

-- Allow marking as read (is_read flag update) — own rows only
create policy "notifications_update_own" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notifications_delete_own" on notifications
  for delete using (auth.uid() = user_id);
