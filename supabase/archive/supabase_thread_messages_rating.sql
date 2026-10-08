-- Add per-run feedback (useful / not useful) to conversation replies
-- Run this in the Supabase SQL editor

alter table thread_messages
  add column if not exists rating smallint;
