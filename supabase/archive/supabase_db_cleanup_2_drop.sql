-- ════════════════════════════════════════════════════════════════════════════
-- Aistrix database cleanup — PART 2 (removes dead tables/columns)
-- Run AFTER part 1 AND after deploying the code from the same change (the old
-- code still reads run_history.result / rating). Back up first if unsure:
-- Supabase → Database → Backups.
-- Every table/column below was verified unused by the code; the tables are empty.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- Tables nothing reads or writes (0 rows):
drop table if exists app_access;      -- replaced by app_members
drop table if exists app_revenue;     -- never used; revenue comes from purchases
drop table if exists subscriptions;   -- never used; access comes from app_entitlements

-- Columns superseded by another column:
alter table run_history drop column if exists result;   -- → output (copied in part 1)
alter table run_history drop column if exists rating;   -- → rating_value (copied in part 1)
alter table apps drop column if exists developer_id;    -- never set; created_by is the owner
alter table apps drop column if exists is_free;         -- inverse of is_paid (2 apps disagreed)
alter table apps drop column if exists webhook_secret;  -- never used
alter table developer_api_keys drop column if exists api_key;      -- keys are stored hashed

-- The schema-report helper used for this review:
drop function if exists aistrix_schema_report();

commit;
