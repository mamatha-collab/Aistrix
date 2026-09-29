-- RLS: flows, flow_schedules, flow_members

-- ── Helper (avoids RLS recursion in flow_members policies) ────────────────────
create or replace function is_flow_owner(target_flow_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from flows where id = target_flow_id and user_id = auth.uid()
  )
$$;


-- ── flows ──────────────────────────────────────────────────────────────────────
alter table flows enable row level security;

-- Owner full access
create policy "flows_select_own"  on flows for select using (auth.uid() = user_id);
create policy "flows_insert_own"  on flows for insert with check (auth.uid() = user_id);
create policy "flows_update_own"  on flows for update using (auth.uid() = user_id);
create policy "flows_delete_own"  on flows for delete using (auth.uid() = user_id);

-- Published flows are publicly browsable (FlowsPage template gallery)
create policy "flows_select_published" on flows
  for select using (is_published = true);

-- Members can read flows they belong to
create policy "flows_select_member" on flows
  for select using (
    exists (
      select 1 from flow_members
      where flow_id = flows.id
        and (user_id = auth.uid() or invited_email = auth.jwt() ->> 'email')
    )
  );


-- ── flow_schedules ────────────────────────────────────────────────────────────
alter table flow_schedules enable row level security;

-- Owner full CRUD; backend (service-role) reads all for execution
create policy "flow_schedules_own" on flow_schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ── flow_members ──────────────────────────────────────────────────────────────
alter table flow_members enable row level security;

-- Members see their own row; flow owner sees all members
create policy "flow_members_select" on flow_members
  for select using (
    user_id = auth.uid()
    or invited_email = auth.jwt() ->> 'email'
    or is_flow_owner(flow_id)
  );

-- Only the flow owner can invite members
create policy "flow_members_insert" on flow_members
  for insert with check (is_flow_owner(flow_id));

-- Owner can remove members; member can remove themselves
create policy "flow_members_delete" on flow_members
  for delete using (
    is_flow_owner(flow_id)
    or user_id = auth.uid()
    or invited_email = auth.jwt() ->> 'email'
  );
