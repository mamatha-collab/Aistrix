# Operate & Grow

The primary path is Monitor → Evaluate → Improve → Build (Design → Test → Deploy) → Monitor. Marketplace follows these tabs as an optional distribution step.

## Implemented

- A shared app selector and run selection carry the same issue across Monitor, Evaluate, and Improve.
- Monitor shows negative-feedback runs, sample counts, rated usefulness, and a manual refresh with visible errors. Queries load the latest 500 accessible runs across the current apps. Database access rules remain unchanged.
- Evaluate shows the original input, observed answer, and written feedback. The developer reviews the input and defines a must-contain or must-not-contain check. A bad answer is never copied into the expected answer automatically.
- Regression cases use the existing `app_test_cases` schema and Test suite. A deterministic UUID scopes one case to app/run/developer; retries and concurrent browser saves preserve the existing case and its edits. Coverage reads fail closed, and insert failures leave the form recoverable.
- Improve opens a draft in Design with a change note containing the originating run and regression case IDs. The existing deployed-app confirmation is retained. The live snapshot and published flag are untouched by this handoff.
- Build → Test identifies saved feedback regressions, includes them in Run tests, and lets developers review them in Customize tests. The existing backend grading and release gates remain authoritative.
- Published apps in Deploy link back to Monitor for the same app. Re-entering Evaluate reloads the saved regression case.
- Existing Improve AI suggestion and version-comparison calls use the authenticated streaming client, surface HTTP/stream errors, and abort on app changes. Suggestions include actual input/answer/feedback rather than only an app name.
- Feedback satisfaction is displayed as feedback, not a synthetic quality score. Optional integration settings are labeled configured rather than connected; storing a key does not imply a verified integration or an executed evaluation.

No database migration, cloud write, publication, or external integration connection is required for these changes. Browser checks use synthetic data and in-memory storage.

## Phone workspace

Below 768px, Developer opens a monitoring workspace with four destinations: Monitor, Apps, Feedback, and Manage. The desktop toolbar, lifecycle ribbon, app creation, regression authoring, and configuration editors are not shown. Apps are grouped into Live apps and In Build; draft status is read-only. Feedback contents and release history expand on demand. Existing release rollback remains available behind its confirmation and server permissions. Manage groups Revenue, Versions, and Secrets behind a compact selector. Revenue reads authenticated recorded purchases, developer earnings, pending payouts, per-app breakdowns, and expandable recent purchases; these are account-wide USD records, not estimates based on app runs. Secrets show only names and dates; updates use the existing authenticated API and replacing an existing name requires confirmation. AI keys, run history, user settings, theme, and sign-out live in the account menu.

At 768px and above, the full Build and Operate workspace remains available. Phone layouts use a single compact header, a scrollable body, and one bottom navigation with touch-sized controls. Account/workspace loading reserves the same phone frame; refreshing activity keeps existing content visible.

## Limits and recommended next work

1. Done: every real run (customers, API, triggers, website visitors; failures included) is logged in `app_runs` with status, error kind, response time, model, cost and the published version that answered. `GET /v1/apps/{id}/monitor` and `GET /v1/monitor` return aggregates only (never inputs or answers); Monitor shows them per app and across apps, with a per-version comparison. Draft and test runs are not counted.
2. Done: customer feedback reaches developers through `app_feedback` (server only). A rating's comment is shared; the customer's question and the answer only when they tick "Include my question and the answer". Who gave the feedback is never returned.
3. Done: the server release gate has a "Your saved tests" requirement. Every test the developer saved (including regressions from feedback) must have passed on the current draft, recorded after the test's last edit (`app_test_cases.updated_at`).
4. Done: each feedback item has a status (new, investigating, fixed, verified, dismissed), a note and the regression test it led to. Saving a regression moves it to investigating, never to fixed; the developer marks it verified once the fix is live and Monitor looks healthy.
5. Done: alerts with minimum samples — ≥10% failed in 24h (≥20 runs, critical), ≥5% failed in the period (≥50 runs), slowest 5% ≥30s, <70% useful in 7 days (≥10 ratings), a release failing ≥5 points more than the previous one (≥20 runs each), and no runs in 7 days for a published app. Shown in Monitor (desktop and phone); no email yet.
6. Done for now: the unwired integration cards (Langfuse, Sentry, Promptfoo, DeepEval, Ragas, Unleash, Flagsmith, PostHog flags, Stripe keys) were removed; the GitHub tracker runs through the server and never exposes its token. Any future integration must be verified against its API before showing "connected". Keep Marketplace listing optional until the app is published, useful to its audience, and documented.

## Verification

Unit coverage exercises rating denominators, deterministic ownership scoping, explicit expectations, retry preservation, concurrent saves, invalid input, and read/write failures. Isolated desktop journeys exercise a failed-save retry, regression creation, app isolation, history refresh recovery, live-safe draft creation with a source note, inclusion in Build tests, and the Deploy → Monitor handoff. Phone journeys cover narrow layouts, app grouping, feedback isolation and expansion, refresh recovery, tablet access to Build, and confirmed release maintenance that preserves the draft.
