-- Add semver and changelog columns to app_versions
-- Run once in Supabase SQL editor

alter table app_versions add column if not exists semver    text;
alter table app_versions add column if not exists changelog text;
