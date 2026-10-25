# Next.js foundation delivery — 2026-10-24

## Implemented locally

- Installed and pinned Next.js 16.4.3 and Tailwind PostCSS 4.3.1, with a locked
  dependency graph. No backend dependency or database schema changes.
- Added App Router root layout, metadata, styles, loading/error behavior and a
  catch-all route that runs the existing browser app. The explicit `.next.jsx`
  route suffix prevents `src/pages` component files becoming accidental endpoints.
- Extracted shared browser initialization and providers from the Vite DOM entry
  point. Existing theme, workspace headers, consent UI, error boundaries and
  optional Sentry setup are retained in the Next.js browser boundary.
- Converted application configuration references to explicit NEXT_PUBLIC_* names.
  The allowlisted launcher accepts legacy VITE_* settings without editing actual
  environment files. Explicit new values win, including empty values. Private
  service/provider/payment keys are not mapped. Local demo credentials remain
  development-only. The Vite regression build uses the same public settings.
- Added explicit staging/production Next.js commands, desktop/mobile local build
  checks and CI build/browser steps. Existing default Vite commands remain until
  native routing/authentication parity and cutover verification are complete.
- Corrected two issues in an existing, previously uncommitted browser journey:
  its mock database lacked `.gte()` and its workflow-name locator was ambiguous.
  No production workflow execution logic was changed by those corrections.

## Verification

- Next.js production build: passed, including the final source changes.
- Vite rollback production build: passed, including the final source changes.
- Next.js production browser suite: four passed across desktop and mobile.
  Direct links tested: `/`, `/developer`, `/flows`, `/app/test-app` and
  `/dev/test-developer`. Signed-out pages reached the existing sign-in gate with
  no uncaught browser errors. Privacy/terms remained public with global styling.
  The suite aborts non-local network requests; this is not hosted auth acceptance.
- Full unit/database suite: 32 files, 304 tests passed in the final run.
- Focused configuration/auth/analytics suite: 13 passed after the final allowlist
  change, including exclusion of private/arbitrary keys and development-only demos.
- Existing Build readiness and UI error-isolation browser suites: 22 desktop tests
  passed. The shared workflow journey passed separately after fixture corrections,
  for 23 existing desktop journeys verified. The selected existing suites skip
  mobile by design; no mobile equivalence is inferred from those skipped cases.
- Lint: passed with warnings. Existing component/export/hook warnings remain;
  the Next.js metadata export also triggers the generic React refresh rule.
- Whitespace validation: passed.

Initial full unit run encountered a database setup timeout under concurrent
dependency-install load; a two-worker rerun passed all 303 tests before the final
additional development-configuration test. Windows sandbox DNS/Node stalls
required installation and runtime tests outside that sandbox. No automatic
approval rejection occurred. Package install retries were consolidated into one
installer before completing the dependency graph.

## Route inventory and remaining migration

All existing routes currently enter the compatibility boundary, not completed
native page implementations:

| Surface | Current paths to preserve | Next work |
| --- | --- | --- |
| Public discovery | `/marketplace`, listing links, `/dev/:userId` | Server-render published fields; define canonical URLs, pagination and invalidation; remove unintended sign-in gates for public discovery |
| Authentication | Existing Auth states and callback/return behavior | Supabase server/browser session boundary, refresh/callback/logout and membership tests |
| Business | `/apps`, `/dashboard`, `/profiles`, `/flows`, `/history`, goals/events/data/integrations/knowledge routes | Native layouts/pages, client editor boundaries, workspace/deep-link parity |
| Developer | `/developer`, `/dev-studio`, `/api`, developer views | Native routing with saved-edit guards and existing release/approval behavior |
| Tool execution | `/app/:id`, `/app/:id/docs`, `/embed/:id` | Retain streaming/files/payment handling, public embed rules and backend authorization |
| Account/operations | Settings, billing/reports, alerts, analytics, admin/moderator and `/invite/:token` | Role-specific authorization, purchase/return routes and invitation parity |
| Legal | `/privacy`, `/terms` | Native public server-rendered pages with client-only consent interaction |
| Aliases | Maps in `src/App.jsx`, including `/workflows`, `/run-history` and `/usage` | Explicit redirects with query/fragment behavior verified before removal |

Next.js hosts the entire current app in this increment. React Router and browser
Supabase sessions are still inside it; public content does not yet gain server
rendering/SEO from the compatibility mount. Unknown catch-all paths retain the
old application's behavior rather than native per-resource 404 handling. These
are migration tasks, not final architectural choices.

Next increment: native routing and the Supabase session boundary, followed by
public catalog/profile pages and authenticated workspace migration. Completion
still requires the full acceptance list in `nextjs-migration.md`.

## Run, deployment and cost

Use `npm run dev:next` from `aistrix-frontend` for the staging-configured local
Next.js server. Build deliberately for staging or production, then use
`npm run start:next` to serve that build. See the frontend README for commands.
No deployment, production domain change, callback change or migration was applied.
Existing uncommitted work is preserved. CI changes have local equivalents tested;
the remote CI run itself has not been observed.

Recurring cost delta for this local increment: no new hosted services. Next.js
runtime hosting costs require selection and measured sizing before cutover.
Do not treat a successful shell build as completion of Phase 1 or the full migration.

## Operate & Grow editor cleanup follow-up

A user reported a Monaco stack during passive unmount in the development build.
Inspection of installed `@monaco-editor/react` confirmed that its DiffEditor
cleanup disposes the original/modified models before disposing the diff widget.
The same lifecycle issue is tracked upstream:
https://github.com/suren-atoyan/monaco-react/issues/647

The comparison now uses `PromptDiffEditor.jsx`, which owns anonymous models and
the widget together, detaches the widget, disposes it, then releases its models.
It cancels asynchronous initialization on unmount, handles partial initialization,
and updates existing models in place on candidate changes. No global error filter,
retained-model workaround or Strict Mode disablement was added.

Verification: three focused lifecycle unit tests, eight desktop browser tests
(including five repeated Improve/Monitor round-trips under Strict Mode), targeted
lint and the Next.js production build passed. The lifecycle regression injects a
Monaco-compatible mock that rejects attached-model disposal and checks that model
and widget counts return to zero. Existing Improve tests cover draft recovery,
conflict handling, feedback links and saved comparisons. The user's authenticated
development session was not controlled or used as a test fixture.

## Local API connection follow-up

The frontend staging file had no API override, so it inherited localhost:8000
from the default configuration. The existing API there rejected the Next.js
origin. That process was left unchanged. A local-only staging launcher now runs
on localhost:8001 with explicit localhost:3000/127.0.0.1:3000 CORS origins, checks
frontend/backend Supabase project agreement and blocks default-file secret fallback.
Automatic lifespan job sweeps are disabled for this development session.

Only the frontend local `.env.staging` API URL was updated; restarting the Next.js
development command is required because its public configuration is compiled.
No deployed configuration or database migration was changed. Local health and
authenticated-header preflight checks returned HTTP 200; two configuration tests
passed. Account-authenticated Operate/Manage requests still need the user's retry
after the frontend restart. The local service PID is recorded in the ignored
backend `.data/next-local-api.pid` file for shutdown when no longer needed.
