# Operate, Grow and Manage: production MVP requirements

Reviewed October 19, 2026 against the current repository. This is a requirements and readiness review, not a deployment approval. No application functionality has been removed by this review.

## Baseline and scoring

Keep this MVP baseline fixed for subsequent comparisons. Report new scope separately; do not reduce the score merely by adding optional features. Percentages are engineering estimates of work completed toward the baseline, rounded to five points (rough uncertainty ±5 points), not measured availability or a probability that a business will succeed.

Weights per area: core functionality 50, reliability/data integrity 20, security/permissions 20, verification and deployment evidence 10. A critical unresolved defect can block launch regardless of the total. Passing synthetic tests is evidence of implementation, not proof that migrations, credentials, policies and provider configuration are deployed correctly.

| Area | Functionality /50 | Reliability /20 | Security /20 | Evidence /10 | Reviewed estimate |
|---|---:|---:|---:|---:|---:|
| Monitor | 45 | 18 | 18 | 4 | 85% |
| Eval | 44 | 17 | 19 | 5 | 85% |
| Improve | 42 | 16 | 18 | 4 | 80% |
| Market | 42 | 16 | 18 | 4 | 80% |
| Version | 47 | 19 | 19 | 5 | 90% |
| Revenue | 44 | 14 | 18 | 4 | 80% |
| Secrets | 47 | 19 | 19 | 5 | 90% |

These are provisional production-MVP completion estimates. Hosted launch sign-off remains unverified in this review. Earlier feature-only estimates are not directly comparable to this combined baseline.

## Responsibilities and requirements

### Monitor — is the live app healthy?

Owns live operational observations: runs, failures/error categories, p50/p95 latency, recorded cost and its coverage, users/sources, rated usefulness with sample counts, version health and threshold alerts. App and period filters, refresh, visible freshness, empty/error/retry states and truncated-data notices must make the scope clear. Draft/test traffic must not count as production traffic. Return aggregate customer telemetry without disclosing raw questions or answers.

Already present: server production run log, aggregate endpoints, period/app filters, in-product alerts with minimum samples, version breakdown, privacy separation and phone maintenance view.

Remaining acceptance: reconcile known runs across authenticated UI/API/trigger/visitor paths on a matching hosted deployment, including failures and cancellations; verify behavior beyond row limits and incomplete cost data; demonstrate freshness and recovery under a provider/storage outage. Current UI refreshes on selection/period/manual refresh, not continuously.

Does not own feedback editing, test authoring, revenue totals or rollback controls. Links lead to Eval for quality investigation and Version for release maintenance. Email alerts and streaming updates are separate enhancements, not required for this MVP.

### Eval — what is wrong, and how will we prove it?

Owns the customer feedback inbox, app/status filtering, consent-based evidence, triage note/status, a reviewed reproduction input and explicit expected behavior, and a durable link to a saved regression. Creating a regression must be retry-safe and preserve existing edits. Not shared must remain distinguishable from empty content. Tests execute in Build → Test; their results and current-draft validity should be linked here rather than creating a second test runner.

Already present: private server feedback feed, consent-aware question/answer sharing, persisted statuses, deterministic regression creation and a server gate requiring saved tests on the current draft after their last edit.

Remaining acceptance: expose the existing backend note capability in the triage workflow; make long feedback queues navigable (the current component displays the first 20 loaded items); keep one feedback/regression editor; verify consent and revoked access with two hosted users.

Does not own prompt editing, publication or automatic claims that a customer problem is solved. A verified item should have linked release/test evidence and human confirmation; autonomous verification is not required.

### Improve — what change should we make?

Owns a fix proposal tied to the evaluated issue, optional AI suggestions, candidate/baseline output comparison, an explicit developer decision and a draft handoff carrying the issue/regression reference. GitHub is an optional tracker shortcut. All model/provider errors must be visible; changing apps cancels outstanding work and clears the previous app's result. The live snapshot stays untouched.

Already present: feedback-to-draft handoff, AI suggestions from real evidence, version prompt comparison runs and server-mediated GitHub integration.

Remaining acceptance: show the selected issue and regression as a compact context card instead of repeating Eval's whole editor; persist the accepted proposal/change reference and associate its eventual release; repair and verify version-comparison browser coverage. Validate the complete feedback → test → fix → release → verification journey on hosted staging.

Build → Design owns the actual configuration edits; Build → Test owns execution; Deploy owns promotion. Improve must not add a second save/publish workflow.

### Market — how do customers discover and acquire the app?

Owns listing title/tagline/description/category/tags, developer storefront identity, free/paid pricing configuration, readiness validation, listing preview, list/unlist state and customer acquisition links. Only a published app with a complete listing can go live, enforced on the server and database. Listing must not override underlying access permissions. An unpublished app must stop being usable through the marketplace.

Already present: listing editing, pricing, developer profile and a server/database listing gate with refusal feedback.

Remaining acceptance: remove the static setup-only payment banner and Stripe registration stub in favor of live status and a link to Revenue's payout setup; remove sales projections from this tab; verify actual buyer discovery → checkout → access and unpublish/unlist behavior on the hosted system. Check concurrent listing edits and team-editor behavior (the browser listing query currently filters by listing user_id).

Market is optional: deploying an app does not automatically list it. Do not promise team/enterprise licensing unless that complete flow exists and has been verified. Storefront metadata and pricing belong here; money reporting does not.

### Version — what is live, and how do we recover?

Owns immutable release history, the current live pointer, changelog/test evidence, draft versus live distinction, links to per-version health and a confirmed rollback. Rollback must be authorized, preserve the current editable draft and give an explicit outcome if another release changes concurrently. Full prompt/output comparisons belong in Improve, with a link from Version.

Already present: shared release-history component, server list/rollback APIs, confirmation, draft preservation, test counts and 30-day per-version usage/regression warnings.

Remaining acceptance: prove release/rollback behavior from an independent hosted end-user session; test concurrent release/rollback and permission revocation; verify the required migrations and consistent live-pointer refresh across sessions. Deploy can retain a compact current-release card and link here; avoid maintaining two separate history implementations.

Canary releases, traffic splitting and feature flags are out of this MVP baseline.

### Revenue — what was actually earned, refunded and paid?

Owns the purchase ledger, net sales, developer share/platform fees, refunds/disputes, app/period breakdown, complete CSV export, entitlement/payment status, Connect onboarding/status, owed transfers and safe retries. Clearly distinguish a transfer to a Stripe connected account from a bank payout. Estimates must not be presented as earnings.

Already present: shared desktop/phone ledger component, periods/export, refunds/disputes, payout status, onboarding and owed-transfer retry endpoints; backend tests cover isolated ledgers and payment scenarios.

Release blockers/gaps:

1. `_pay_out` first searches transfers by group, then uses an idempotency key containing the current hour. Two concurrent attempts across an hour boundary can use different keys after both see no existing transfer. The code does not by itself establish the UI's absolute promise that nothing can be paid twice. Require a durable, purchase-scoped payout operation and concurrency/crash tests, including long-delayed retries and refunds racing a payout.
2. `_dev_purchases` limits results to 10,000 without pagination or a truncation flag. All-time totals and the CSV claiming every purchase can silently omit records. Use server aggregation/pagination or make incompleteness explicit before accounting sign-off.
3. Owed-transfer handling must cover the endpoint's 500-row batch and explain any remaining work.
4. Verify checkout, failed/duplicate/out-of-order webhook events, entitlement grants/revocation, partial/full refunds, disputes and transfer reversals against Stripe test mode on hosted staging. Reconcile figures with provider records. Synthetic tests and a zero-balance screen do not provide this evidence.

Consolidate payout onboarding here. Replace Market's Stripe stub with a link. Remove price × run forecasts from Market; keep optional cost/price estimates in a clearly secondary planning section, separate from the ledger.

### Secrets — can the app securely use its credentials?

Owns app-scoped encrypted secrets, metadata-only reads, editor permissions, confirmed replace/delete, tool dependency references and missing-secret blockers. Values must never appear in client reads, logs, exports, errors or release snapshots. Runtime injection is server-only. Distinguish tool secrets here from the developer's personal model-provider keys under the account menu.

Already present: app-shared encrypted storage, permission checks including revoked editors, names/dates/dependencies, missing-secret shortcuts and publish blocking, shared desktop/phone UI, failure-visible writes.

Remaining acceptance: verify the hosted encryption configuration and key backup/recovery process, replacement reaching subsequent runs, multi-editor access/revocation, and disposable-secret masking through runtime failures and logs. Secret deletion must leave dependent apps visibly blocked or failing explicitly, never silently substituting an empty credential. Managed automatic rotation/history are later enhancements; manual replacement is part of this MVP.

## One process, one owner per action

Build Design → Test → Deploy creates the first release.

Monitor detects a symptom → Eval records evidence and a regression → Improve proposes a fix → Design edits the draft → Test validates all saved/current tests → Deploy promotes → Version records the release → Monitor observes → Eval records verification.

Optional commercial path: Deploy → Market lists the app → buyer checkout/access → Revenue records money/refunds/transfers. Secrets supports build/runtime throughout.

Consolidation rules:

- One selected-app context across tabs, with intentional all-app views only in Monitor/Revenue.
- One feedback editor in Eval. Improve gets a linked summary and its fix actions.
- One listing/pricing editor in Market; one recorded ledger and payout setup in Revenue.
- One release-history component in Version, reusable by Deploy/mobile; one comparison tool in Improve.
- One Secrets component reused by desktop/mobile; missing-secret warnings elsewhere link to it.
- Personal account/settings and model keys remain in the account menu. Do not restore redundant sidebar settings.
- Remove obsolete setup/coming-soon promises only after checking live capability; do not hide an infrastructure failure by calling it an empty state.

## Evidence from this review

- 227 frontend/database tests passed across 20 test files. The first attempt hit the Windows sandbox temp-cache path; rerunning with a workspace-local temp directory passed.
- 16 isolated backend check suites passed, including monitoring, feedback, payments, releases, permissions and secrets.
- 17 targeted browser journeys passed; 11 viewport-specific cases were intentionally skipped.
- Important coverage limitation: the Operations browser fixture emitted `supabase...not is not a function` from `useVersions.js` while assertions still passed. Improve's version-comparison path is therefore not fully verified by that run. Fix the fixture and assert the comparison path and absence of page errors before counting this as clean end-to-end evidence.
- These checks used synthetic services/data. No live payments, payouts, secret changes, publication or migrations were performed in this assessment.

Before production approval, record that the matching frontend/backend and all required migrations are deployed, verify roles with separate hosted users, execute the provider-backed purchase/refund/retry journey, and exercise recovery with a separate app consumer. Do not label every area production approved merely because its estimated completion is near 90%.
