-- Add workspace context columns to run_history
-- Run this in the Supabase SQL editor

alter table run_history
  add column if not exists flow_id  uuid references flows(id) on delete set null,
  add column if not exists flow_name text;

-- Optional index for filtering history by workspace
create index if not exists run_history_flow_id_idx on run_history(flow_id);
