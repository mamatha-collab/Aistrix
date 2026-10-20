# Build readiness verification

This is an evidence checklist, not a calculated readiness percentage. Local browser
tests exercise real React components with fake persistence and API responses;
backend checks exercise real API handlers with fake database/model services.
Neither replaces staging verification of database policies, migrations and providers.

## Latest local results — October 14, 2026

| Check | Result |
| --- | --- |
| Frontend unit/regression tests | 120 passed across 14 files |
| Backend API/security check suites | 10 passed |
| Desktop/mobile browser journeys with fake services | 24 passed, including preview recovery/offline regressions |
| Production frontend build | Passed |
| Lint | Completed; existing warnings remain |
| Real integration at localhost | Core lifecycle passed; hosted staging remains pending |

Hardening from this pass includes atomic stale-save rejection, phase-move conflict
retries, blocking publication when version history cannot be saved, correct draft
status after rollback, stopping repeated provider refusals, and narrow-screen
toolbar wrapping. This automated pass did not publish real apps or apply database migrations.

## Real integration session — October 14, 2026

The user supplied `http://localhost:5173/developer`. The browser was already signed
in; the frontend configuration points to `http://localhost:8000`. This verifies
the local application with its configured database and provider, not a hosted
staging deployment. No passwords or API keys were copied from the browser.

A new **private** app, **QA Build Verification 2026-10-14**, was used throughout.
Its app ID is `5ba82182-e0ed-4b2c-9d61-3cbb591b5a82`. Existing apps were not edited.

| Real check | Observed result |
| --- | --- |
| Create private app | Saved and opened in Design |
| Save complete blueprint | 100/100 design readiness; server design checks passed |
| Unsaved stage navigation | Cancel retained the edits; the user dismissed the native dialog |
| Provider-backed testing | All 4 required gate categories passed on both draft revisions |
| First publication | v1 recorded with 4/4 passing checks |
| Draft/live separation | v1 remained live while the changed draft was marked unpublished |
| Concurrent editors | Older editor's save was rejected; reloading recovered the newer saved value |
| Test invalidation | Changed draft showed all required categories as untested |
| Promotion | Review showed the AI-behavior change; v2 recorded and became live |
| Rollback | v1 became live again; newer draft retained and marked changed |
| Cleanup | QA app unpublished; v1/v2 history retained; private access unchanged |

The preview initially showed an invalid/expired-session message even after a
later request succeeded. Release checks recovered. The stale preview message was
fixed by clearing errors after success, ignoring obsolete responses, and refreshing
the preview when publication state/version changes. Dedicated desktop/mobile
regressions cover recovery and offline captions. The underlying transient auth
response was not diagnosed in this session.

Evidence: [rollback](verification/build-real-rollback.jpg),
[final offline state](verification/build-real-offline.jpg).

Not exercised with real accounts: a separate non-editor/end-user session,
two different workspace memberships, forced expired credentials, network outages,
all app types, and hosted HTTPS/CORS/deployment behavior. Those remain sign-off gates.

## Local checks

From `aistrix-frontend`:

```sh
npm test
npm run build
npm run lint
npm run test:e2e:local
```

Local browser tests use installed Chrome by default. For a machine without Chrome:

```sh
npx playwright install chromium
# Set E2E_BROWSER_CHANNEL=chromium, then run npm run test:e2e:local.
```

From `aistrix-backend`, using the project virtual environment:

```sh
python -m pytest tests/test_checks.py -q
```

Windows sandbox restrictions can prevent asyncio's local socket setup. Run these
checks in a permitted local environment; the test harness blanks outbound keys
and replaces external services. Do not diagnose the socket hang as an app failure.

## Covered critical behavior

- Creating an app through the real creation form and opening its Design editor.
- Loading a saved blueprint, handling load failure, and retrying without writing defaults.
- Keeping unsaved edits after failed saves and allowing a successful retry.
- Warning before discarding unsaved edits on stage changes, app switches and reload.
- Atomically rejecting stale design saves, including simultaneous first saves.
- Retrying phase moves against a concurrently updated design without restoring old data.
- Keeping phase state unchanged after a database failure.
- Design → Test → Deploy → Publish through the actual screens.
- Stopping the test suite on provider refusal without unlocking Deploy.
- Review and confirmation before promoting a draft, preserving the live snapshot until promotion.
- Blocking promotion review when pages/tools/blueprint data cannot be loaded.
- Rolling back a live version while preserving the draft.
- Keeping publication blocked when the recoverable version cannot be saved.
- Developer-only API permission checks for workspace roles and app collaborators.
- Denying cross-workspace keys and non-editors access to tests, release, preview and rollback.
- Desktop and narrow mobile layouts, with screenshots captured after publication.

The local browser suite runs in its own Vite configuration with a fake Supabase
module and blocks requests to non-local hosts. It never signs in to real accounts,
publishes real apps or spends provider credits. Its test files are excluded from
the staging suite. CI runs frontend checks, backend checks and local browser journeys.

## Remaining staging sign-off

Configure `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, and optionally `E2E_APP_NAME`
for a dedicated staging account. Do not commit credentials. The named app must
already be in Deploy. Run `npm run test:e2e` or the manual E2E workflow.
This smoke test signs in and reads Design/Test/Deploy; it does not publish or run AI tests.

Before production sign-off, use disposable apps in staging to verify:

1. Real app creation, blueprint save, model execution and grading, then initial publication.
2. Live user execution during draft editing, retesting and promotion.
3. Two independent sessions editing the same design, including a phase move during save.
4. Expired session, provider refusal, interrupted connection and retry recovery.
5. Two workspaces with different members against the deployed database RLS policies.
6. Version history and rollback of prompt, model, form, blueprint and tools.
7. Migrations, HTTPS/CORS configuration, monitoring and rollback procedures on the deployed build.

Do not call the module 95% production ready until these staging checks have
recorded passing results. Local mocked checks establish regression protection,
not proof of deployed infrastructure behavior.

## Production release order

Publishing now refuses to go live if it cannot record the version history
(`app_versions.version_num`), so the database must be migrated **before** the new
backend serves traffic:

1. Apply the migrations `20261013030000` through `20261019020000` to production
   (`supabase db push` against the production project). Production already has
   everything through `20261014030000`; the new ones are
   `20261015010000_purchase_payment_ref`, `20261015020000_test_case_updated_at`,
   `20261015030000_github_connection_server_only`,
   `20261015040000_pay_per_run_credits`, `20261019010000_run_telemetry` and
   `20261019020000_app_feedback`.
2. Deploy the backend.
3. Deploy the frontend.
4. Smoke-check: open Dev Studio, publish or promote a test app, confirm a new
   version appears under Deploy → Published versions.

If step 2 goes out before step 1, every publish and promote fails with
"Could not save the release version. The live app was not changed."

**Private app columns (`20261014030000`) and the frontend must ship together.**
After this migration browsers can no longer `select('*')` from `apps`, so an
older frontend cannot load apps; the new frontend reads `pages_public`, which
older databases don't have. Apply the migration, then deploy the frontend
straight away (the backend can go first — it uses the service role).

**Payments (before taking real money).** The backend refuses Stripe webhooks
unless `STRIPE_WEBHOOK_SECRET` is set (only `ENVIRONMENT=development`/`test`
accepts unsigned ones). In the Stripe dashboard, point the webhook at
`/stripe/webhook` and send these events: `checkout.session.completed`,
`payment_intent.succeeded`, `invoice.paid`, `customer.subscription.created`,
`customer.subscription.updated` and `customer.subscription.deleted`.
Revenue is recorded from `invoice.paid` (subscriptions, including renewals)
and from one-time payments, once per Stripe payment.

**Pay-per-run = one run per purchase.** Each one-time payment adds one run to
the buyer's access (`run_quota`), in the same transaction that records the
payment (`record_purchase`). The app confirms card payments through
`/payments/confirm` so the run can start before the webhook arrives; both
report the same payment, so it is granted once. A run is reserved just before
the model is called (`reserve_entitlement_run`, atomic) and given back if the
run fails. Subscribers can't buy single runs. Existing pay-per-run buyers from
before this change keep one more run.

**GitHub feedback tracker.** The GitHub token is stored only on the server
(`developer_github`, encrypted with `SECRET_ENCRYPTION_KEY`). Set
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `GITHUB_REDIRECT_URI`
(`https://<api host>/auth/github/callback`, the same URL as in the GitHub OAuth
app). Migration `20261015030000` drops tokens saved the old way, so developers
who connected before reconnect once.
