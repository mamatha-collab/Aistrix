# Database changes (Supabase CLI)

All schema changes are migrations in `supabase/migrations/`, applied with the
Supabase CLI. Don't paste SQL into the dashboard's SQL Editor for schema
changes any more — the CLI can't see those, and environments drift apart.

The CLI is a pinned dev dependency (`npm install` at the repo root). No Docker
needed for this workflow.

## One-time setup per machine

```bash
npm install
npx supabase login                    # opens the browser
npx supabase link --project-ref <ref> # asks for the database password
```

`<ref>` is the ID in your Supabase URL: `https://<ref>.supabase.co`.

## Making a change

```bash
npm run db:new -- add_cost_tracking   # creates supabase/migrations/<timestamp>_add_cost_tracking.sql
# write the SQL in that file
npm run db:push:dry                   # shows what would run
npm run db:push                       # applies pending migrations to the linked project
npm run db:list                       # local vs remote: which migrations have run
```

Rules:

- **One change per migration, never edit a migration after it has run** — add a
  new one instead.
- Write migrations to be re-runnable where possible (`if not exists`,
  `drop policy if exists` before `create policy`, `create or replace function`).
- Push to **staging first**, then production (link to each project in turn,
  or use `--db-url`).
- Commit the migration file in the same PR as the code that needs it.

## Baseline

`*_baseline.sql` is a snapshot of the production schema taken when this
workflow started. It is marked as already applied on production (see below),
so it only actually runs on new environments such as staging.

After linking production the first time, record it as applied without running it:

```bash
npx supabase migration repair --status applied <baseline_timestamp>
```

## Folders

- `migrations/` — the source of truth.
- `archive/` — the old hand-applied SQL files. **Never run them.**
- `config.toml` — local CLI settings (only used if you ever run `supabase start` with Docker).
