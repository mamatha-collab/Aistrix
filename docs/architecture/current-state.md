# Current state: repository review, 2026-10-24

Scope: inspected local source, migrations, tests, CI and deployment files against
the supplied Aistrix implementation specification v1.0. This is not a hosted
security audit or confirmation that local migrations are deployed. Existing
uncommitted backend/frontend workflow changes were present and preserved.

Subsequent user direction sets Next.js as the Phase 1 target and Go as the
Phase 2 AEX engine while preserving Python tools. This inventory describes
existing code; see `implementation-plan.md` for the updated four-phase roadmap.

## Reusable implementation

| Area | Evidence and current behavior |
| --- | --- |
| Frontend | `aistrix-frontend/package.json`: Next.js App Router, React 19, Supabase client. The earlier Vite + React Router app is archived as the git tag `archive/react-vite`. |
| Marketplace and execution | `src/pages/MarketplacePage.jsx`, `AppPage.jsx`, `components/AppRunner.jsx`, `ApiAppRunner.jsx`, `DataAppRunner.jsx`, `ConversationThread.jsx`: discovery and distinct app runners. Historical ToolRunner/ToolRenderer names and smart-email-rewriter were not found in the source search. Do not assume the historical five-mode renderer exists. |
| Developer lifecycle | `src/pages/DevStudioPage.jsx`, `pages/devstudio/*`; backend publish, promote, review, version, rollback and schema endpoints in `main.py`. Existing release gates should be extended. |
| Workflows | `src/workflows/WorkflowDesigner.jsx`, `workflowModel.js`, `workflowApi.js`; backend `resolve_input_map`, `flow_condition_met`, `run_flow_step`, `run_flow`, `/v1/flows/*`: typed field wiring, fixed conversions, conditional skipping, API/app/approval steps, schedules, history and cancellation. |
| Persistence and recovery | `20261021010000_flow_runs.sql` through `20261023020000_durable_developer_jobs.sql`: persisted run state, snapshots, lease heartbeats and recovery functions. Expired running workflows fail for operator review; this is not a queue that resumes arbitrary work after restart. |
| Tenant/access foundation | Baseline workspaces, workspace_members, app_members, flow_members and RLS; backend verified JWT/developer-key resolution and app/flow/workspace checks. Service-role queries require explicit server authorization. Hosted cross-tenant acceptance remains necessary. |
| Secrets/providers | `main.py`: Fernet encryption, app secrets, provider-key endpoints, provider adapters, secret reference resolution, redaction. Legacy plaintext provider-key compatibility remains in `_open_key`; migration/rotation evidence is needed before claiming all stored credentials are encrypted. |
| Metering | Backend quotas, entitlements, model cost estimates and `telemetry.py` SQLite outbox with delivery to PostgreSQL. Local persistent volumes are required. Run-count limits and estimated costs do not constitute an atomic dollar-spend reservation ledger. |
| Operations | Backend Dockerfile and health/readiness routes; `.github/workflows/ci.yml` and staging E2E workflow; Supabase migration discipline; readiness, load-test and staging-verification scripts. No hosting contract, live deployment, restore drill or measured capacity was verified in this review. |
| Tests | Isolated Python check scripts through `tests/test_checks.py`; Vitest, PGlite database tests and Playwright local/staging journeys. Most checks use fakes; passing them does not prove deployed acceptance. |
| SDK | `aistrix-sdk/aistrix/client.py`, `cli.py`: existing Python client and CLI to retain. |

## Initial safe increment

`main.py:assert_public_url` previously allowed a DNS answer set containing both
public and private addresses. Require every returned address to be public.
`tests/checks/check_outbound_urls.py` covers public IPv4/IPv6, empty/failing DNS,
mixed answers including metadata/loopback/private addresses, and redirect
validation before another HTTP request. No live requests, schema changes,
credentials or deployment are required.

This closes a mixed-answer validation bypass. It does not pin the connection
to the validated DNS result: DNS rebinding, destination allowlists and egress
enforcement remain separate work. Existing `fetch_safely` revalidates redirects,
but cross-origin forwarding of caller-supplied sensitive headers also needs review.

See [gap analysis](gap-analysis.md) and [sequenced implementation](implementation-plan.md).
