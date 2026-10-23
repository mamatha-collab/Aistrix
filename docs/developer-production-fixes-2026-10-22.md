# Developer production fixes — October 22, 2026

## Implemented

- Workflow execution requires a durable initial record and checkpoints before each step and after its result. Failed persistence stops execution before another external effect.
- Each active run has an ownership token, a 120-second database lease and a 20-second heartbeat. Checkpoints fence off cancelled, superseded and expired workers. Heartbeat failure cancels execution.
- A worker sweeps expired runs every 15 seconds and records an explicit failed/interrupted result. **An uncertain step is never automatically replayed.** Check the destination before starting a replacement run; an external service may have completed an action before the connection was lost.
- Runs retain their starting workflow definition. Approval resumes that snapshot, and internal snapshots/lease credentials are excluded from API responses.
- Developer emails use a durable pending/sending/sent/suppressed/failed queue with exclusive claims, expired-claim recovery, exponential retry delays and opt-out checks at delivery. Recipient, sender and content are frozen before sending; provider retries reuse a project-scoped idempotency key. A successful acknowledgement clears the content payload.
- Retries stop after 12 attempts or 20 hours and require review. This stays within [Resend's 24-hour idempotency window](https://resend.com/changelog/idempotency-keys); an ambiguous old send is not blindly repeated after its key expires.
- `/health/ready` fails closed for missing production configuration, unavailable recovery storage/database, or incomplete developer recovery schema. The container health check uses this route. `/health` remains liveness.
- The read-only staging preflight now checks workflow and notification recovery columns/functions rather than approving the older schema alone.

## Deployment order

1. Back up the intended database and record its project reference. Apply repository migrations through `20261023020000_durable_developer_jobs.sql` to that explicitly selected environment before deploying the API. This review did **not** apply remote migrations.
2. Supply public origins/URLs, provider credentials, encryption key, `RESEND_API_KEY`, `EMAIL_FROM`, `OPS_HEALTH_TOKEN` and `TELEMETRY_OUTBOX_PATH`. Keep the encryption key in managed secret storage and retain a separately controlled recovery copy. Mount the telemetry path on persistent storage; each replica retains its own local outbox.
3. Build/run the backend image on the selected host, then use `/health/ready` for routing readiness. A public liveness response is insufficient.
4. Run `python scripts/check_operations_readiness.py --env-file .env.staging --output ../docs/verification/developer-schema-preflight.json` against the deliberately selected environment. The script reads schema only; it never claims payment, restore or hosted acceptance from schema success.
5. Before broad launch, complete the hosted acceptance gates below and retain their evidence.

## Required hosted evidence

| Gate | Acceptance |
|---|---|
| Workflow restart | Terminate a worker during an external step. Within lease expiry plus sweep delay, the run becomes failed with a recovery message; no later step executes and no external action is automatically repeated. Paused approvals survive a restart and resume once against the stored definition. |
| Email recovery | Force send failure, lost acknowledgement and worker termination after claim. Another worker retries the same payload/key, successful email is not duplicated, opt-out suppresses pending delivery, exhausted sends are visible to operators. |
| Client isolation | Two workspaces; owner/editor/customer and revoked-member sessions. Verify drafts/live releases, workflow approval, secret rotation, account deletion, release and rollback. |
| Stripe test mode | Checkout and access, renewals and failed renewal, duplicate/out-of-order webhooks, partial/full refunds, disputes, payout lost response and competing claims. Reconcile application totals and transfer IDs with Stripe records. Never use live charges for this drill. |
| Recovery | Restore a backup into an isolated database. Restore the encryption key from its recovery copy; decrypt a controlled test secret and run its tool. Restore telemetry SQLite using SQLite's online backup API or a consistent volume snapshot (include WAL; do not copy only a live `.sqlite3` file). Prove queued outcomes replay once into the same project. |
| Host/load | Build and run the image, verify persistent volumes across replacement, exercise multiple replicas, restart under expected load and verify error/latency targets. |
| Auth/delivery | Real signup/reset email through configured SMTP; actual developer alert delivery and ops webhook reception. |

Monitor failed notification rows with a service-role/operator connection:

```sql
select status, count(*), min(created_at) as oldest
from public.developer_notifications
where status in ('pending', 'sending', 'failed')
group by status;
```

Inspect failed sends against provider records before any manual requeue. Do not erase deduplication records or create a fresh idempotency key for an uncertain send. Set operator ownership, support/recovery targets and retention policy before launch.

## Verification and remaining constraints

Verification: 22 isolated backend suites passed; final focused runs passed 57 workflow checks and 35 notification/launch checks. All 286 frontend/database tests passed; the recovery migration's four database tests also passed after the final schema-preflight addition. The production frontend build and whitespace checks passed.

The [read-only staging evidence](verification/developer-schema-preflight-2026-10-22.json) confirms that the new workflow lease and notification queue columns/functions are **not installed** there yet. Docker is unavailable on this machine, so no container build or hosted restart/load proof is claimed. No live email, Stripe transaction, production deployment or database restore was performed.

The critical/high implementation fixes are ready for review; deployment and external acceptance gates remain open. Existing uncommitted application changes were preserved.
