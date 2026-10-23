# Monitor and Eval: production hardening

Target confirmed by the user: local website/backend, Supabase project `aistrix-staging`. This document supersedes the remaining code gaps in the earlier Monitor/Eval delivery notes. It is not a claim that the website is hosted or production approved.

## Implemented

- Monitor reads runs and ratings in stable, timestamp-bounded pages with exact counts. It respects the database's actual response size instead of assuming `limit(20000)` overrides the 1,000-row API cap. The intentional 20,000-row per-app sample still shows an incomplete-data notice when exceeded. Overview database work is limited to four concurrent apps.
- Feedback status counts are aggregated by Postgres in a service-role-only function. The full queue retains twenty-item pages; counts no longer stop at 1,000 or 5,000 reports.
- Every production run is committed to a local SQLite WAL queue before model execution. Completion/failure is committed before reporting completion. Database delivery uses an event UUID and `ON CONFLICT DO NOTHING`, so lost acknowledgements and restart replay cannot duplicate a run.
- A worker retries with bounded batches/backoff. An in-flight run left by a crash is eventually recorded as interrupted, with unknown latency rather than invented timing. Client disconnects record cancellation. If recovery storage cannot accept a run, it is refused before model execution.
- The outbox stores telemetry metadata only, never customer prompts, outputs, provider keys or raw exception messages. Acknowledged rows are removed. Queues are retained during database outages, including migration-related write failures.
- Monitor and Eval display scoped queue/backlog or storage-health warnings. Health describes the responding server; it is not a fleet-wide queue total.
- Removed editors can no longer read their own authored regression inputs after losing app access.
- A service-role-only schema preflight verifies columns, enabled triggers, RLS, private-table/function restrictions, test-read policy and unique delivery IDs.

## Apply to aistrix-staging

The user requested SQL for manual application. No remote migration was applied by the agent. A subsequent read-only check against the staging environment passed all nine schema/security checks and all three column probes; the required migration is now present in `aistrix-staging`.

1. In the staging project's SQL Editor, run the entire `supabase/migrations/20261019050000_operations_delivery.sql` file. It depends on the repository's existing run-log, telemetry, feedback and test-history migrations.
2. Run `select public.operations_schema_status();`. All returned values must be true.
3. Restart the local backend if automatic reload has not already loaded the new code/environment. The backend `.env.staging` now selects `D:/Projects/aistrix/aistrix-backend/.data/aistrix-staging/run-outbox.sqlite3`; this directory is ignored by Git. Default and staging environment files point to different Supabase projects: select staging explicitly for both services. Queues are bound to their database project and refuse cross-project replay.
4. From the repository root, run:

```powershell
aistrix-backend/venv/Scripts/python.exe aistrix-backend/scripts/check_operations_readiness.py --env-file aistrix-backend/.env.staging --output docs/verification/operations-schema-preflight.json
```

The script is read-only. It probes zero-row column availability and the privileged schema-check function, and never prints credentials. A successful schema preflight does not assert that hosted infrastructure or customer journeys have been verified. The current report confirms `qhfxnpsvdolaftaljvdp.supabase.co` and records database status `passed`.

Start the services against staging explicitly (stop their existing development instances first if those ports are in use):

```powershell
aistrix-backend/venv/Scripts/python.exe -m uvicorn main:app --app-dir aistrix-backend --env-file aistrix-backend/.env.staging --reload --port 8000
npm run dev:staging --prefix aistrix-frontend
```

The backend `/health` response includes the public database project hostname and whether recovery storage is explicitly configured, so the running process can be checked without exposing credentials or the filesystem path.

## Verification completed locally

- 236 frontend/database tests passed across 21 files. The real Postgres engine (PGlite) applies every repository migration and tests exact counts for 6,005 reports, duplicate delivery, triggers, browser access denial and revoked-editor access, including editor-authored cases.
- 17 isolated backend suites passed. The telemetry/deploy suites were rerun after the final concurrency/cancellation/storage-failure checks and both passed.
- 17 desktop/mobile browser journeys passed; 17 viewport-specific cases were intentionally skipped. Delayed telemetry warnings and recovery are exercised in both Monitor and Eval.
- Frontend production build and lint passed; existing unrelated lint warnings remain.

## Still requiring environment evidence

- The staging SQL schema/security preflight has passed. The local staging backend was restarted and an orphaned worker from the original development server was removed. The active `/health` now confirms the staging project and `telemetry_recovery_configured: true`; its identity/configuration is recorded in `verification/operations-local-backend.json`. Monitor and Eval were then checked in the signed-in local browser without migration/setup errors (`verification/operations-hardened-live.png`).
- Independent owner/editor/customer sessions, consent withdrawal, revoked access and the complete feedback → regression → draft → tests → release v2 → customer confirmation flow have now passed against the real local API/staging database using Anthropic. Actual local restart recovery and bounded read-load tests also passed. See `operations-independent-verification-2026-10-19.md` for measured results and the separate OpenAI credit blocker. These tests do not claim live traffic from every production integration or hosted-app scaling.
- When hosting, mount a persistent local volume per backend replica and configure an absolute `TELEMETRY_OUTBOX_PATH`. Preserve it across redeploys; do not use ephemeral storage or shared NFS. Keep unfinished queues through scale-down and drain them before retiring a replica. Set volume permissions for the server account and monitor free disk space. Do not copy the Windows development path to a container deployment.
- Perform a real deployment restart/outage/soak check under expected traffic. Local concurrent-write/replay tests prove implementation behavior, not hosted capacity or disk persistence.

No email alerts, configurable thresholds or streaming updates were added.
