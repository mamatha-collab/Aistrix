# Developer module review — October 22, 2026

Scope: current working tree, including uncommitted developer workflow changes. Read-only source review plus local regression/build checks; no hosted deployment or provider/payment actions.

Follow-up: critical/high code fixes and the outstanding hosted gates are tracked in [developer-production-fixes-2026-10-22.md](developer-production-fixes-2026-10-22.md). Findings below describe the reviewed state before those fixes.

## Assessment

- Current supported functionality: approximately 90% implemented.
- Production readiness: approximately 75% (engineering estimate, ±10 percentage points).
- Production sign-off remains pending. These percentages are judgment calls, not measured service reliability or a count of completed requirements.

The core lifecycle is present: Design, Test, Deploy, Monitor, Eval, Improve, Market, Version, Revenue, Secrets and account/workspace controls. Developer workflows add typed wiring, pinned app releases, conditional steps, AI-filled inputs, human approval, run history, cancellation, webhooks and schedules. New workflow code expands the scope and still needs reliability work.

## Findings and implementation priorities

1. **High: durable workflow execution and recovery.** `main.py:_run_flow_now_or_later` starts an in-process asyncio task. `_save_flow_run` suppresses persistence errors, allowing execution even when its audit/recovery state was not saved. Add durable job claims/leases, restart reconciliation, required initial persistence, bounded retries and idempotent handling of steps with external effects. Verify termination during each step and approval/resume across replicas. Saved progress alone does not provide recovery.
2. **High: reliable developer notifications.** `main.py:notify_developer` inserts the unique notification record before email lookup/send. A missing email or failed delivery leaves the record; later attempts are treated as duplicates. Add an outbox with pending/sent/failed states, retry timing, worker claims and delivery acknowledgement. Cover refund, dispute, payout, Monitor and workflow approval emails.
3. **Medium: workflow concurrent editing.** `workflowApi.js:saveWorkflow` updates by ID without checking the previously read revision. Two builders can overwrite each other. Add a revision or updated-at condition and a conflict/reload interface. Ordinary app release conflict checks already exist.
4. **Product scope: catalog completeness.** Translation and Code Gen/Review remain preview offerings; finish their promised specialized behavior and acceptance tests only if needed for launch. Vision/Image and Voice/Audio are now marked ready, so the previous review's coming-soon assessment is stale. Labels alone do not prove hosted acceptance. `_ai_fill_fields` also now exists; a separately configurable adapter step is a different extension.
5. **Conditional: paid developer plans.** Existing Free/Verified tiers are not paid developer subscriptions. If charging developers is part of launch, implement plan checkout, subscription state, upgrade/downgrade/cancellation, invoices and enforced entitlements. Buyer app subscriptions already exist.

## Production acceptance still needed

- Confirm migrations on the intended hosted database, including shared visitor limits, workflow runs, developer workflow columns and cancellation support. Do not rely on stale migration cutoffs in older checklists.
- Exercise hosted owner/editor/customer isolation, revoked membership, expired sessions, draft/live access, secrets and release/rollback.
- Verify actual Stripe test-mode checkout, renewal/failure, refund/dispute, payout crash/retry and reconciliation against Stripe records.
- Verify real provider calls, key rotation, email delivery, webhook/scheduled workflows and approval handling.
- Build and run the backend container on the chosen host; test load, replica concurrency, restart and durable telemetry storage.
- Perform backup/restore and encryption-key recovery; set retention/deletion policy, support ownership and recovery targets.
- Decide whether per-client monetary ceilings are required; run limits and BYOK alone do not establish dollar-budget enforcement.

## Corrections to the October 20 review

- Anonymous/embed rate limits now use shared Postgres RPC buckets and fail closed on storage failure (`main.py:consume_visitor_limit`, migration `20261020050000_shared_visitor_limits.sql`). They are no longer process-local.
- Launch documentation now records explicit live-listing-only marketplace discovery rather than an unlisted fallback. Hosted access/discovery acceptance remains necessary.
- Workflow AI field filling and conditional execution exist in current source; older design notes are not a complete inventory of implemented functionality.

## Fresh verification

- Frontend/database: 282 tests across 27 files passed. Initial sandbox temporary-file errors were resolved by using a workspace-local TEMP/TMP directory.
- Production frontend build passed.
- Lint exited successfully with warnings, including hook dependencies and component-export warnings.
- Backend isolated suite was invoked with the repository virtual environment but did not return a result during this review; no fresh backend pass is claimed.
- No fresh browser, hosted isolation, real payment/provider, restore or load acceptance was performed.
