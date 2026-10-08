-- Add token usage columns to run_history
-- Run this in the Supabase SQL editor

alter table run_history
  add column if not exists input_tokens  integer,
  add column if not exists output_tokens integer;
