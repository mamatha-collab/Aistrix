# Stack migration and production readiness — November 10, 2026

## Verdict

The frontend framework migration is complete in source. Aistrix is a functioning development/staging MVP, with production release engineering and hosted acceptance still incomplete. Passing a production-mode build is not evidence that the application has been deployed to production.

This review inspected current source and deployment workflows, ran read-only staging checks and targeted tests, and preserved infrastructure configuration. No production migration, deployment, payment, email, model invocation or sandbox execution was performed.

## Current stack

| Layer | Current implementation | Migration status |
| --- | --- | --- |
| Frontend | Next.js 16 App Router, React 19, Tailwind 4; Node 24 toolchain | Full route surface migrated. Vite remains fixture/build tooling, not a second production frontend. Public SSR, native navigation and cookie-session integration exist. |
| Frontend language | Incremental strict TypeScript migration | A subsequent [TypeScript increment](typescript-migration-2026-11-10.md) added 70 typed source files covering routes, auth, core API boundaries and workspace UI, plus a CI typecheck. Another 178 legacy runtime JS/JSX modules remain; this is not a completed full conversion. |
| API | Python 3.14, FastAPI, Uvicorn | Working and container definition exists. It has not been rewritten in Go. |
| AEX | Python compiler, model gateway, registry, orchestration and adapters | Pipelines/releases/approvals/events/evals implemented; legacy/native app adapters remain flag-controlled. Staging config leaves AEX migration flags off/unset by default. |
| Persistence/auth | Supabase PostgreSQL, Auth and storage | Staging schema checks pass. Production project history/configuration still needs explicit verification. |
| Customer Python execution | E2B pinned Python 3.12 template; separate Python queue coordinator | Managed guest execution works historically; current worker heartbeats are healthy. Windows sign-in supervision exists for development. Production requires an always-on hosted coordinator. |
| Recovery | PostgreSQL job leases and a SQLite telemetry outbox | Code exists; host-level persistent storage, recovery/restore and operational acceptance remain release gates. |
| Developer clients | Python SDK/CLI 0.3.0 and browser Studio | Local functionality exists. Distribution/versioning and hosted acceptance need verification if promised at launch. |

The adopted October 27 architecture retains Python/FastAPI and Supabase and requires justification before introducing Go or Kubernetes. Older Go-focused roadmap notes are historical and need reconciliation. Missing Go code is not a blocker under the adopted revision.

## Fresh operational evidence

- Local API `/health`: HTTP 200. `/health/ready`: HTTP 503 with `not_ready`.
- Readiness requires production settings. Local staging lacks `RESEND_API_KEY`, `EMAIL_FROM`, `OPS_HEALTH_TOKEN`, public site origins, and an enabled scheduling/cron path. Its development launcher explicitly disables lifespan/background processing. This is expected for the local helper and means it cannot serve as the production startup configuration.
- Read-only staging operations preflight passed all reported schema, server-only access, RLS, telemetry, feedback, workflow-recovery and notification-queue checks. This does not prove every RLS policy or a production project's configuration.
- E2B had one fresh build/run worker pair (approximately one-second-old heartbeats at inspection), plus stale historical registrations. No active E2B sandboxes were listed. Earlier reports saying the coordinator was stopped are superseded by the November 10 restart/supervisor commits.
- Current commits include worker diagnostic logs, brief-outage tolerance and a Windows sign-in/restart supervisor. A real sign-in after reboot remains untested in its runbook; a laptop/signed-in Windows session is not the production runtime.
- Local default environment has secret encryption configured. Missing email/ops/webhook settings in local files do not establish what a future host secret manager contains; hosted configuration remains unverified. No secret values were printed.
- Recent workspace/navigation changes and shared provider controls remain modified/untracked in the working tree. They must be reviewed and included in the exact release artifact.

## Concrete CI gap

`.github/workflows/ci.yml` runs both legacy local-browser fixtures and Next.js browser tests. The newer Next.js paths pass, but some local fixtures/tests still assume the old `+ App` button and duplicate type picker.

Fresh reproduction:

```powershell
cd aistrix-frontend
npx playwright test --config playwright.local.config.js --project=desktop --grep 'manual creation stays in the workspace' --timeout=15000
```

Result: one failed test, waiting for `getByRole('button', { name: '+ App', exact: true })` in `e2e/local/inline-creation.e2e.js`. The current UI intentionally uses Create → Workspace → capability. Update the fixture callbacks and assertions to exercise that flow; do not simply delete creation/unsaved-change coverage. Then run the exact full CI workflow, including the default build path and Linux backend environment, on the final commit.

## Required before an initial production launch

1. **Freeze and verify the release.** Review/commit outstanding changes, reconcile architecture docs, update stale browser fixtures, and obtain a green full CI result for the actual release commit. Build and exercise the backend container on Linux; Docker is not available in this local environment.
2. **Deploy an actual hosted staging topology.** Use a Next-compatible Node host, FastAPI container service, Supabase project and always-on E2B coordinator service. Configure persistent telemetry storage, TLS/public domains, CORS, callback URLs, trusted proxies and secret injection. The coordinator currently reads a selected dotenv file; provide a secret-file mount or add an environment-based production entry point. Do not bake credentials into images. Do not use the local API launcher with `lifespan='off'` in production.
3. **Meet readiness and migration gates.** Verify the target database's complete migration history and grants, deploy the matching frontend/API/worker versions, and require `/health/ready` to succeed before routing traffic. Enable and test the intended recovery/scheduler services. Choose AEX rollout flags deliberately; opt-in historical tests do not establish a global cutover.
4. **Verify real hosted journeys.** Use independent accounts for sign-up/login/recovery, onboarding, app creation/test/deploy/invocation, workflow approval, Python build/preview/deploy/run, API-key rotation/revocation and workspace membership changes. Verify cross-tenant denial for source, secrets, runs, traces and files. Repeat streaming/uploads and authentication at the real public origin.
5. **Configure and exercise external services.** Verify Supabase Auth SMTP separately from application email delivery, operational alerts and supported provider keys. If payments/Marketplace are in the launch scope, complete Stripe test-mode checkout, webhook retries/signature handling, entitlements, cancellation/refund/dispute/payout and reconciliation before enabling live payments. Otherwise explicitly gate these features off. Verify legal/privacy/refund content for the offered launch scope.
6. **Prove failure handling and recovery.** Exercise API/coordinator restart, worker death, database/provider outages, timeouts, cancellation, stale leases, sandbox cleanup and uncertain external writes. Restore a database backup and the correct secret-encryption key, and rehearse application/database-compatible rollback. Verify the outbox survives host restarts and logs are redacted/retained appropriately.
7. **Measure the launch envelope.** Run representative load/concurrency tests against hosted staging, inspect queue latency and error rates, validate spend reservations and reconciliation, and configure useful alerts. The E2B 3,600-second admission allowance is not an account-level dollar cap. No production capacity or monthly operating-cost guarantee has been established.

## Full architecture work beyond the MVP launch

Standalone stateful Agent and Model resources, reusable Node/Tool authoring, authenticated MCP hosting, indexed Knowledge Bases, managed dataset ingestion/lineage, general source web/API/worker hosting and the full IDE remain incomplete. The resource schema currently implements Application pipeline workloads, EvalSuite, Dataset, SecretRef and Environment. These broader capabilities need their own implementation and acceptance; they do not all have to ship in a deliberately limited first release, but must remain disabled or clearly planned.

## Verification references

- Earlier review: full backend suite passed 170 tests before the newer worker supervision work.
- Fresh targeted worker/runtime/Studio backend check: 40 passed.
- Recent frontend checks: 268 source unit tests and 56 Next.js desktop/mobile checks passed; a subsequent ribbon/alignment change passed production compilation and 12 targeted checks. The final Models ordering change only reorders catalog/sidebar entries.
- Fresh legacy local-browser check: one confirmed failure described above. Therefore the entire release pipeline cannot currently be called green.
- Staging schema preflight passed; hosted auth/payment/email/restore/load acceptance remains unproven. No paid model or sandbox work was issued by this review.
