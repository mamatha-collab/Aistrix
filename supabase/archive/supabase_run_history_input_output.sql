-- Add input and output text columns to run_history
-- Run once in Supabase SQL editor.
-- Note: runners previously wrote to a "result" column; this renames it to "output"
-- and ensures "input" also exists.

alter table run_history add column if not exists input  text;
alter table run_history add column if not exists output text;

-- If you have an existing "result" column, migrate its data and drop it:
-- (uncomment if needed)
-- update run_history set output = result where output is null and result is not null;
-- alter table run_history drop column if exists result;
