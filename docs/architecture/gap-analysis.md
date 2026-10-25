# Specification gap analysis

Based on inspected local code as of 2026-10-24. Partial means reusable source
exists, not that production acceptance has passed. The user's updated four-phase
[roadmap](implementation-plan.md) governs future work: Next.js in Phase 1,
Go AEX in Phase 2, sandboxed workers in Phase 3, and scaling in Phase 4.

| Requirement | Assessment | Next acceptance gate |
| --- | --- | --- |
| Marketplace/developer/admin journeys | Partial: existing screens, release/review endpoints, billing and access controls | Real staging customer/developer/admin journeys, revoked-member and cross-tenant checks |
| Versioned tool contract | Partial: blueprint input/output fields, published snapshots, schema endpoint | Explicit contract version, execution/auth/timeout/side-effect/privacy fields; reject invalid definitions without breaking old releases |
| Workflow compiler | Partial: wiring, conversions and conditions exist | Reject duplicate IDs, forward/missing references, incompatible types and unsupported schema versions before execution; stable immutable plan IDs |
| Durable queue/workers | Partial: snapshots, checkpoints, leases and failure recovery | Durable enqueue/claim, bounded backoff, dead letters, concurrency fencing; restart without repeating uncertain side effects |
| Next.js frontend | Full local native route migration complete: public SSR, cookie sessions, all workspaces/runners, Next navigation, standard app structure and default scripts | Hosted auth/isolation/billing parity, profile migration rollout, staging cutover and rollback; see nextjs-completion-2026-10-24.md |
| Go AEX engine and decision contract | Missing as a separate inspected implementation | Versioned API, deterministic routing, policy/state/cost tests and Python-tool integration |
| Sandboxed developer workers | Hostile-code isolation unverified | Resource/egress controls, tenant denial and recovery tests |
| Privacy guard | Missing enforceable per-workflow routing policy | Private-only forbids external model, developer API and fallback routes before payload transmission |
| Cost enforcement | Partial: usage counters, credits and cost estimates | Atomic reservations across concurrent runs/retries, settlement, global/tenant hard caps, unknown-price rejection |
| External inference/BYOK | Existing adapters and encrypted-key write paths | Provider-policy integration, token/time/context/retry limits, rotation/revocation and plaintext-key cleanup |
| Private inference | Custom-model URL path exists; no benchmarked private serving proven | Explicitly approved destination and model/license, quality dataset, metering and measured economics; no automatic GPU provisioning |
| Caching/optimization/evaluation | App quality checks exist; AEX savings benchmark and tenant-scoped optimizer unproven | Identical dataset baseline, quality, cost per successful run, latency and policy-isolated cache tests |
| Outbound endpoint security | Public-address validation and redirect checks; mixed DNS bypass fixed in initial increment | DNS rebinding protection, destination allowlists, credential-safe redirects and host egress tests |
| Observability/audit | Run history, cost estimates, outbox and monitoring exist | Workflow/step/decision/provider tracing, minimized payload retention, policy/version attribution |
| Production operations | CI, image and operational documentation exist | Apply/verify pending migrations in selected staging; container/restart/load/restore/rollback evidence |
| Three reference workflows | Some reusable building blocks; all three deployed cases unverified | Invoice, support email and business-data integration complete with real test destinations and approvals |

Keep `workspaces` as the initial tenant boundary rather than introducing a
parallel organization system without a migration design. Reuse React components,
existing runners and release gates during the planned Next.js migration; keep
the Vite build until parity and rollback are verified. Retain Python tools behind
the planned Go engine contract. Do not add Kubernetes or select a GPU based on
registration count.

Capacity and cost remain unmeasured. Treat 1,000–5,000 registered users separately
from daily activity, concurrent sessions, concurrent runs and model requests.
The $1,000/month figure is a design target, not a verified price or unlimited
usage promise. Record hosting, database/storage, workers, inference, monitoring,
payment fees and developer payouts separately. BYOK usage still needs attribution.
The ambiguous “500” does not block this review or initial security correction.
