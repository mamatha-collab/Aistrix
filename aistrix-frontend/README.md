# Aistrix frontend

The frontend now uses one Next.js App Router application for Marketplace,
public developer profiles, authentication, Business, Dev Studio, workflows,
app runners/docs, visitor embeds, invitations and administration. Public content
renders on the server. Interactive workspaces use client components inside a
persistent layout. Supabase browser/server clients share cookie sessions through
a refresh and authorization proxy. The source migration is complete locally;
hosted acceptance and production cutover remain separate release gates.

## Run and build

From this directory, install the locked dependencies with `npm ci`, then:

- `npm run dev` — Next.js development using staging settings, on port 3000.
- `npm run dev:production` — development server using production settings.
- `npm run build:staging` — build specifically for staging.
- `npm run build` — build specifically for production.
- `npm start` — serve the last Next.js build on port 3000.
- The existing `dev:next`, `build:next` and `start:next` aliases remain available.
- `npm run build:next:test` — build against synthetic services for browser tests.
- `npm run test:e2e:next` — check that test build on desktop/mobile.

Do not point a development session at production unless that is intentional.
The launcher accepts existing VITE_* public settings or their NEXT_PUBLIC_*
equivalents. Explicit NEXT_PUBLIC_* values take precedence, including empty values.
It does not edit existing environment files. Only the keys in
`config/public-env.mjs` are mapped; service-role/provider/payment secret keys stay
in the backend. Optional demo credentials are mapped only for local development.
Browser settings are compiled into each build, so build separately per environment.
The start command does not change the environment of an already-built browser bundle.

Routes use standard `src/app/**/page.jsx`, `layout.jsx`, `route.js`, metadata
routes and `src/proxy.js`. Reusable screen components live under `src/screens`,
not the reserved Pages Router directory. There is no production catch-all app
mount. Old bookmark aliases use Next's configured redirects; unknown pages return
404. Native navigation and links use Next.js; React Router is a development-only
dependency imported exclusively by `legacy-navigation.jsx` for rollback/tests.
A unit check walks the production import graph to prevent that boundary regressing.

Private requests verify the user with Supabase `getUser()` before rendering;
administration/moderation also check the user's role. Redirects preserve internal
return paths and query values. Visitor embeds retain their own authorization.
Workspace selection, developer guards, modals and the app/workflow layers live
in the persistent layout. Apps and Workflows stay mounted when switching between
them so running work survives. Public catalog/profile reads use anonymous clients
and explicitly projected public fields; they never use service-role credentials
or another user's session. Robots and the dynamic sitemap expose public discovery
pages while excluding private/unpublished tools and private workspace pages.

The cookie migration preserves existing local sessions where possible. It copies
only the selected project's session through Supabase Auth and leaves local drafts
alone. Explicit sign-out removes stale legacy sessions to prevent re-sign-in.
Before enabling Google/email confirmation/recovery in a hosted environment,
register that site's `/auth/callback` URL in Supabase Auth's redirect allowlist and
verify the complete provider/email flow there. Native `/login?next=/developer`
returns to the requested internal page; external return URLs are rejected.

The additive migration `20261024010000_developer_profile_public_fields.sql` adds
optional profile fields and a public-only display view. It has not been applied
remotely in this migration task. Baseline schema reads remain compatible; public
developer names/links require that view, and saving nonempty optional fields on an
older schema reports that an update is needed rather than dropping those fields.
The original profile table retains owner-only RLS for its billing data.

Do not use the synthetic test artifact with real accounts. After browser tests,
build explicitly for staging or production before running `start:next`.

## Local staging API

Operate, Manage, billing and execution also need the Python backend. In a second
terminal, run from `D:\Projects\aistrix\aistrix-backend`:

```powershell
.\venv\Scripts\python.exe scripts/run_local.py
```

This selects `.env.staging` explicitly, checks its Supabase project against the
frontend staging file, listens on `http://localhost:8001`, and allows the Next.js
origin `http://localhost:3000`. It prevents missing staging secrets being filled
from the default `.env`. Automatic batch, schedule and recovery sweeps are disabled
in this development launcher; API routes still enforce real authorization.

Set `NEXT_PUBLIC_API_URL=http://localhost:8001` in the frontend `.env.staging`.
Restart `npm run dev:next` after changing environment settings. The launcher
prints the selected API origin. Port 8000 is left available for an existing API
session. No production environment file or deployment is changed by this setup.

## Regression tests and the archived React build

The earlier React (Vite + React Router) frontend is no longer in this tree. It is
kept in git as the tag `archive/react-vite`. `npm test` runs Vitest/PGlite;
`npm run test:e2e:local` runs existing component journeys with in-memory service
fixtures, served by Vite only as a test harness. These fixture checks do not call production
services. The hosted suite (`npm run test:e2e`) separately requires a dedicated
staging test account and defaults to localhost:3000; it excludes fixture suites.

See [migration scope](../docs/architecture/nextjs-migration.md) and
[delivery evidence](../docs/architecture/nextjs-foundation-2026-10-24.md).
The native public/auth increment is documented in
[native routes and sessions](../docs/architecture/nextjs-native-routes-2026-10-24.md).
The subsequent private routing boundary is documented in
[workspace routing](../docs/architecture/nextjs-workspace-routing-2026-10-24.md).
Settings, Shared Profiles and Run History now render from explicit native pages
through the persistent shell; see
[workspace pages](../docs/architecture/nextjs-workspace-pages-2026-10-24.md).

The completed local source migration and remaining launch gates are recorded in
[Next.js migration completion](../docs/architecture/nextjs-completion-2026-10-24.md).
