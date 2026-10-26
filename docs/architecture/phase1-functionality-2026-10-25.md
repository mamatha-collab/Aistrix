# Phase 1 functionality, 2026-10-24/25

Local implementation of the gap-analysis items that don't need hosting:
tool contracts, workflow compilation, spending limits, private-only
workflows, retries and review, outbound security, and three reference
workflows. Nothing here was deployed, and no migration was applied to any
hosted database. Third-party providers (Stripe, email) are still not set up.

## What was added

| Area | Where | What it does |
| --- | --- | --- |
| Tool contracts | `aistrix-backend/tool_contracts.py` | Releases store a versioned contract: input/output fields, timeout, secrets, side effects (none / external_read / external_write), data class, model route. Older releases derive one on read. Publishing refuses invalid fields and declarations that understate side effects. |
| Workflow compiler | `aistrix-backend/flow_plan.py` | Each new run is compiled first: duplicate ids, forward/missing references, unknown conversions or comparisons, incompatible types, unconnected required inputs, unsupported format versions, API addresses whose server comes from earlier output. Published steps are pinned to the live release; each run records a stable plan id. `POST /v1/flows/{id}/validate`. |
| Spending limits | `spend_guard.py`, migration `20261025010000` | Every provider run holds its worst-case cost before the call and settles to reported usage. Optional per-key-owner and per-workspace caps (`/v1/spend`, `PUT /v1/spend/caps/key`, `PUT /v1/workspaces/{id}/spend-cap`) and a platform cap (`PLATFORM_SPEND_CAP_USD`), checked atomically per scope. Capped runs on unpriced models are refused. Unknown outcomes stay counted as uncertain. |
| Private-only workflows | `flows.privacy`, `flow_plan.private_step_problems` | Steps must use an operator-approved private model (`PRIVATE_MODEL_HOSTS`) with no outside tools, API steps, AI-filled inputs or webhooks. Checked at compile and again before each step sends anything; never falls back to a provider. |
| Retries and review | migration `20261025020000` | Temporary failures of harmless steps retry up to 3 times with capped, jittered backoff. Writing steps that may have reached a service are never repeated; the run is flagged `needs_review` (as are interrupted runs). `POST …/runs/{run}/continue` resumes from the stopped step (re-running a possible write needs `confirm_repeat`, recorded with the run); `POST …/review`; `GET …/runs?needs_review=true`. |
| Outbound security | `aistrix-backend/outbound.py` | DNS pinned per hop (no rebinding; TLS verifies the real host), operator allow/block lists, per-tool `allowed_hosts`, redirects drop credentials across sites and refuse cross-site bodies and https→http. Signed webhooks don't follow redirects. |
| Reference workflows | `reference_workflows.py`, migration `20261025030000` | Invoice processing, support email and sales-data sync install as draft apps plus a wired developer workflow (`/v1/reference-workflows`). Each developer has test destinations that capture deliveries and a sample dataset (`/v1/test-destinations`, `/v1/test-deliveries`). API steps can build JSON bodies from wiring (`api_body_map`). |

## Verification (local)

- Backend: 29 isolated check suites pass, including new `check_contracts`,
  `check_spend`, `check_outbound_egress` and `check_reference_workflows`.
- Database: 6 PGlite files, 115 tests, with every migration applied in order.
- A live HTTPS request confirmed DNS pinning keeps certificate verification
  (valid certificate accepted for the real hostname, expired one refused).

## Not done here

- No UI for any of the above; endpoints only.
- Migrations `20261024010000`–`20261025030000` are additive and unapplied.
  Spending limits stay off until `20261025010000` is applied, then fail closed.
- Hosted acceptance (sign-in, payments, tenant isolation, deployment) and the
  later phases (Go AEX, sandboxed workers, scaling) remain as in
  `implementation-plan.md`.
