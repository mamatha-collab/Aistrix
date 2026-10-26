# Archived SQL — do not run

These are the hand-applied SQL files from before the database moved to Supabase
CLI migrations (`supabase/migrations/`). They are kept for history only.

**Never run any of them again.** Several older files recreate access rules that
were later replaced (for example `supabase_fix_apps_rls_and_perf.sql` and
`supabase_marketplace_public_read.sql` would bring back the old overlapping
policies), and `supabase_db_cleanup_2_drop.sql` deletes tables and columns.

Everything they did is captured in the baseline migration
(`supabase/migrations/*_baseline.sql`), which is the source of truth.

## Order they were applied (production, 2026-10)

Earlier files (`supabase_app_*`, `supabase_fix_*`, `supabase_rls_*`,
`supabase_run_history_*`, `frontend_*` …) were applied over time in an
unrecorded order. The most recent ones, in order:

1. `supabase_prod_readiness.sql`
2. `supabase_developer_platform.sql`
3. `supabase_app_runtime_files.sql`
4. `supabase_db_cleanup_1_safe.sql`
5. `supabase_db_cleanup_2_drop.sql` (then `blueprint_prod` was re-added by hand)
6. `supabase_workspaces_step1.sql`
7. `supabase_workspaces_step2.sql`
8. `supabase_workspaces_step2b.sql`
