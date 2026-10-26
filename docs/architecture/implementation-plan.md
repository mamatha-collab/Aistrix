# Four-phase implementation roadmap

Updated 2026-10-24 to follow the user's direction. This replaces the original
Python-AEX proposal. These are planned deliverables, not completion claims.

## Phase 1 — Production marketplace

Target: Next.js, Supabase, existing Python tools, authentication, developer
onboarding and billing.

Scope decision: migrate the entire frontend to one Next.js App Router application,
including marketplace, public profiles, Dev Studio, Business, workflows, billing,
settings and administration. The public-site-only split discussed as an option
is not the selected architecture. Vite is a temporary migration/rollback target,
not a second permanent frontend. See `nextjs-migration.md` for sequencing.

The local frontend source now uses native Next.js routes for the full app,
including authenticated workspaces and app execution surfaces. See
`nextjs-completion-2026-10-24.md`. Hosted auth, billing, tenant-isolation and
cutover acceptance remain pending. Preserve existing components, release gates
and the Vite rollback tooling until hosted parity and rollback are verified. Keep server secrets out of browser bundles and client configuration.
Retain FastAPI and working Python integrations.

Add versioned tool manifests for schemas, auth, execution mode, timeout, side
effects and privacy declarations. Verify existing workspace authorization and RLS,
onboarding, moderation, purchases, entitlements, refunds and usage limits.
Baseline tenant isolation, quotas and secret handling gate this phase; Phase 3
adds sandboxed execution rather than postponing basic marketplace security.

Files: `aistrix-frontend/package.json`, `src/main.jsx`, `src/App.jsx`,
`src/supabase.js`, existing pages/runners and planned Next.js routes;
`aistrix-backend/main.py`, planned `tool_contracts.py` and `outbound.py`;
additive Supabase migrations, CI and staging E2E workflows.

Exit evidence: real staging sign-in/onboarding/publish/purchase/run/refund journeys;
cross-tenant and revoked-member denial; no secret exposure; concurrent quota and
payment reconciliation tests; frontend parity and tested rollback.

## Phase 2 — Proprietary AEX

Target: Go execution engine, deterministic routing, caching, AI provider selection,
workflow state and cost measurement.

Create `aistrix-aex/go.mod`, `cmd/aex/`, and internal modules for contracts,
compiler, rules, router, policy, cache, providers, state and metering. Define a
versioned internal API and Python adapter: existing tools do not need rewriting
in Go. Extend CI, images and additive execution-plan/policy/decision/ledger tables.

Compile immutable plans with pinned versions and validated references/types.
Prefer allowlisted deterministic operations when sufficient. Return strategy,
target, policy version, estimated cost, reasons, quality basis and fallback policy.
Enforce privacy before dispatch. Scope authorized caches by tenant, inputs,
tool/model/policy versions and freshness. Never silently fall back externally
for private-only work.

Use PostgreSQL as durable state; evaluate database claims before adding a queue
service. Persist work before acknowledgement, fence ownership and bound retries.
Introduce atomic cost reservations before calls/retries, settlement and uncertain
charge reconciliation. Distinguish estimates, actual usage and unknown prices.
Keep one engine owner per run: retain Python snapshots while migrating new runs
through an explicit engine-version boundary.

Exit evidence: deterministic work makes no model calls; private-only and provider
policies deny forbidden dispatch; cache isolation; restart-persistent state;
concurrent reservations prevent overspending; reproducible plan and cost records.

## Phase 3 — Secure developer execution

Target: sandboxed tool workers, execution quotas, tenant isolation, automated
deployments and failure recovery.

Add isolated worker entry points/images, versioned worker contracts, deployment
workflows, queue/lease migrations and security/recovery integration suites.
Run Python tools behind the Go execution contract; never execute arbitrary
developer code in the API process.

Enforce CPU/memory/time/concurrency limits, restricted filesystems, network egress,
scoped short-lived credentials and tenant boundaries. Select sandbox technology
against a threat model; a default container alone does not establish hostile-code
isolation. Automate staging promotion, worker health checks and rollback.

Exit evidence: resource/egress/escape and cross-tenant tests; termination and
competing-claim recovery; cancellation, bounded backoff with jitter and dead
letters; persisted approvals; reconciliation of uncertain external effects.
Do not promise exactly-once third-party delivery or automatically replay unsafe
side effects.

## Phase 4 — Scale and optimization

Target: horizontal worker scaling, model evaluation, adaptive routing, capacity
testing and production reliability improvements.

Add `aistrix-aex/benchmarks/` and evaluation fixtures; extend existing load-test,
staging/readiness scripts, monitoring interfaces and recovery runbooks.
Compare baseline and AEX on identical non-customer datasets: quality, cost per
successful run, latency and confidence intervals where appropriate. Feed measured
outcomes into versioned routing with rollback. Evaluate private inference against
approved workload, license, privacy and total compute economics before deployment.

Measure registered accounts, daily actives, sessions, concurrent/queued runs,
steps, tokens, payloads and bursts separately. Exercise horizontal claim safety,
backpressure, database and provider limits. Publish throughput, p50/p95 latency,
queue depth, failures, resource use and workload-based monthly cost projections.
Set SLOs from measurements. Perform backup/secret restoration and rollback drills.

The $1,000/month target is a metered design envelope, not an unlimited guarantee.
Track hosting, inference, storage, payment fees, labor and payouts separately.
No GPU or Kubernetes is justified by registration count alone.

## Current delivery and immediate next increment

The local audit and mixed public/private DNS validation correction are complete.
See `current-state.md`, `gap-analysis.md` and `verification-2026-10-24.md`.
No phase is production complete. Existing uncommitted application changes remain.

The Next.js foundation build and compatibility boundary are now implemented and
locally tested; see `nextjs-foundation-2026-10-24.md` for evidence and limits.
Native public/auth routes, server-rendered discovery and cookie-session integration
are now implemented locally; see `nextjs-native-routes-2026-10-24.md` for evidence,
the pending additive profile migration and hosted acceptance gates.
Next: native authenticated workspace layouts/navigation and Phase 1 tool
contracts/authorization acceptance coverage.
Use additive migrations; preserve existing data and deployed configuration.

This roadmap update changes documentation only. No remote deployment, migration,
paid service or Go/Next.js implementation is included. Recurring infrastructure
cost delta for this update and the prior DNS correction is zero; later phase costs
require measured sizing. Prior verification remains historical: 23 backend suites
and 299 frontend tests passed; implementation phases require their own evidence.
