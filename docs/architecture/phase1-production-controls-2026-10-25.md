# Phase 1 production controls

## Where to find them

- **Settings → Spending controls** (Business and Developer): current usage plus reservations, remaining budget, daily/monthly key and workspace caps. The key cap covers this person's keys across workspaces, including customer runs of their apps. Workspace caps appear only when the backend authorizes billing management. Blank removes a cap; zero prevents new spending. Periods use UTC. These are estimated execution costs, not provider invoices.
- **Developer → Workflows → Design**: Standard/Private only selection, per-step model/tool access metadata, and **Validate workflow**. Validation saves the current draft and calls the existing server compiler without executing steps. Server problems appear on their step cards, the selected step's settings and the problem list. Changing a draft makes its last validation stale. Save/clone preserves privacy.
- **Workflows → Runs**, in Developer or Business: **Needs review only**, failed-step details, bounded attempt counts, **Continue run**, and review notes. Marking reviewed never reruns the workflow. Continuation preserves completed steps and the immutable original definition. An ordinary conflict cannot open the repeat-action dialog; only the server's explicit `confirm_repeat` response can. The person must acknowledge checking the destination before sending `confirm_repeat: true`.

Private execution uses the existing backend policy: operator-approved private models, no external tool access, no external API steps, no external AI field filling, no result webhooks, and no public-provider fallback. Human approval is allowed. The UI explains these rules; the server enforces them before a run and again before each dispatch. Workflow editing retains its existing desktop scope. Spending and run recovery are available on phones.

## API integration

The UI uses `GET /v1/spend`, the existing key/workspace cap PUTs, workflow `/validate`, run `/continue` and `/review`, and the `needs_review` run-list filter. Structured errors retain status, code and compiler problems so the UI can handle specific server decisions without interpreting message text.

Run responses add an allowlisted `display_steps` projection of their original definition and a `can_continue` flag. Full definitions, model prompts, API headers/bodies and leases are excluded. Run lists now include the review flag even when no review filter is selected. Polling ignores obsolete requests when a run or workflow changes.

Spending responses must have valid finite totals and caps; malformed or unavailable data never becomes a zero balance. Existing verified totals stay visible on refresh failure, with editing disabled. Saves remain subject to server authorization and are serialized with refreshes. API Keys stays above spending controls to preserve its existing focus/scroll destination.

## Rollout and verification

No remote migrations, deployments, provider calls or billing operations were performed. This requires the existing spending/privacy and run-review migrations (`20261025010000`, `20261025020000`) and the current backend. Revision-based workflow saves continue to use `20261025040000` when installed. Restart a backend without automatic reload to load the response metadata changes.

Local verification:

- 377 frontend unit/database checks passed; final targeted API/error/clone checks also passed.
- Four backend check suites passed (workflow, contracts, spending, reference workflows); final workflow suite passed 105 assertions including private execution, safe continuation and metadata secrecy.
- 38 native Next desktop/mobile browser checks passed.
- Targeted UI journeys cover private validation, stale validation, step-local errors, explicit repeat confirmation, ordinary conflict handling, review without replay, zero/unlimited caps, permission loss and malformed spending data. Existing account/Keys and shared workflow journeys were also checked; a missing fixture response was corrected and its failing account check rerun successfully.
- Final staging production build passed. Lint completed with existing warnings; whitespace check passed.

These local fixtures do not replace dedicated staging acceptance for authentication, tenant isolation, billing, email, restore and capacity behavior.
