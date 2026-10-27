# Developer Build experience — October 25, 2026

## Implemented locally

- One Build checklist uses the same readiness rules as the completion score. It explains Design → Test → Deploy and saves successfully before handing off to Test. Design completion does not claim tests or publication have passed.
- The starter library installs backend reference workflows, opens their sample input in Test, exposes test destinations and datasets, and displays captured deliveries. Unsaved edits require an explicit discard before installation or navigation.
- Blueprint execution settings expose data classification, side effects and timeout. Saved contract information shows required secret names and declared access. These declarations do not provision custom code hosting or guarantee private execution.
- Design and Deploy share the customer runner. Editors can select the saved draft or published release; the backend enforces editor access, selects canonical saved settings, and rejects stale fingerprints before calling a provider. Preview is real execution: provider costs and declared external actions still apply.
- Lifecycle navigation uses Design, Test and Deploy; workflow badges distinguish drafts, webhook activation and enabled schedules. Owners can delete offline apps from Developer after typing the app name. Backend guards reject published/pending apps, workflow dependencies and active customer access.

## Verification and limits

Local browser fixtures cover saved execution declarations, draft/live preview requests, typed-name deletion and starter installation/sample execution/delivery inspection. Backend checks cover preview access, canonical version selection, stale-version rejection and deletion guards. These checks use synthetic users and services; they do not prove hosted isolation, payment settlement or real email delivery.

The final local run passed 38 native Next.js browser checks and 19 targeted Build/workflow/spending browser checks. Eleven desktop-only cases were skipped in the mobile project. All 378 frontend unit/database assertions passed across the full run and an isolated rerun of the nine database checks whose startup initially timed out during a concurrent build. The final staging-mode Next.js production build compiled successfully; this builds locally and does not deploy staging.

The backend regression run passed all 29 pytest cases, including the isolated deployment/preview/deletion, execution-contract, workflow, spending, billing, release and access-control check scripts.

The app has **not been hosted**. No deployment or database migration was performed as part of this work.

## Hosted acceptance after deployment

Use a dedicated staging account. Configure `E2E_BASE_URL`, `E2E_API_URL`, `E2E_EMAIL`, `E2E_PASSWORD` and `E2E_ENVIRONMENT=staging` in the local process environment or CI secrets. Both URLs must use HTTPS. Never put the password in chat or source control.

From `aistrix-frontend`, run `npm run verify:hosted`. Missing settings produce a failing exit code and a `not_run` report in `.test-tmp/hosted-acceptance.json`; they are never counted as acceptance passes. Configured checks exercise public discovery, authentication gates, session persistence, sign-out and authenticated Build navigation. CI supports the same command through the manual E2E workflow.

The following remain separate launch exercises even when the browser checks pass:

1. Two-account tenant isolation and key authorization against hosted Supabase/API policies.
2. Stripe test-mode purchase, webhook delivery/replay, refund and payout reconciliation.
3. Auth and transactional email delivery, link destinations and expiration.
4. Backup restoration and interrupted-run recovery on the actual hosting platform.
5. Hosted capacity testing, observability and incident response.

Inspect unapplied migrations and the deployment environment before running these exercises. Code readiness and a successful local build do not establish production readiness.
