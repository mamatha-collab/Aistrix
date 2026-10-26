# Full frontend source migration to Next.js

Local delivery dated 2026-10-24. The frontend source migration is complete; this
does not mark Phase 1 production acceptance or hosted cutover complete.

## Delivered application

One Next.js App Router application owns the full route surface. Public catalog,
listing and developer-profile content is present in initial HTML with canonical
metadata. Legal pages, native sign-in, PKCE callback and password recovery are
implemented. Robots and a dynamic sitemap expose public discovery pages, with
private/unpublished tools excluded through anonymous, uncached catalog reads.

All business pages, Dev Studio, app execution/docs, gallery, visitor embeds,
invites and staff screens have explicit standard Next pages. There is no catch-all
application mount. Old bookmark aliases use configured Next redirects and retain
query values. The root redirects to Marketplace; unknown paths return 404.

| Surface | Routes |
| --- | --- |
| Public | `/marketplace`, `/marketplace/[id]`, `/dev/[userId]`, `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml` |
| Authentication | `/login`, `/auth/callback`, `/reset-password` |
| Business | `/dashboard`, `/apps`, `/flows`, `/profiles`, `/history`, `/goals`, `/events`, `/analytics`, `/reports`, `/settings`, `/alerts`, `/data-sources`, `/integrations`, `/knowledge-vault` |
| Developer/staff | `/developer`, `/admin`, `/moderator` |
| Execution and sharing | `/app/[id]`, `/app/[id]/docs`, `/embed/[id]`, `/gallery`, `/invite/[token]` |

Reusable UI lives in `aistrix-frontend/src/screens`, outside Next's reserved
Pages Router directory. Routes use `page.jsx`, `layout.jsx`, `route.js`, metadata
routes and `src/proxy.js`; temporary migration filename suffixes were removed.
The application navigation context delegates to Next router hooks, route params
and Next Link. React Router is now a development-only dependency imported only
by the Vite rollback/test adapter. An import-graph regression check ensures that
no production entry can reach it or the legacy adapter.

The persistent workspace layout retains workspace selection, modals, build
state and existing editor guards. App and workflow layers remain mounted between
their tabs so ongoing work is not discarded. Native screen content receives the
current user and required shell callbacks through context, not session tokens.
Existing runners, streaming, approvals and release/payment logic are reused.

## Authentication and authorization

The request proxy verifies private requests through Supabase `getUser()` before
the shell renders. Staff routes also verify the user's role and deny failed role
reads. Server page checks remain in place. Database RLS and backend authorization
continue enforcing access to individual workspaces/records; routing does not
grant membership or replace those checks.

Cookie refreshes/deletions are preserved through responses and sign-in redirects.
Session-bearing responses are private/no-store. Native return paths are limited
to internal destinations, preserve queries and take precedence over obsolete
return paths stored by the old app. Loopback-IP redirects retain their host/port
to avoid moving the browser away from its cookie origin. Public UI follows Auth
state changes and cleans up its subscription. Existing project-specific session
transfer and explicit sign-out behavior are retained.

Public discovery uses anonymous clients with explicit field projections; it does
not inherit a signed-in user's broader permissions or use service-role keys.
Visitor embeds retain their existing visitor and host authorization.

## Commands and rollback

From `D:\Projects\aistrix\aistrix-frontend`:

```powershell
npm run dev             # Next, staging configuration, port 3000
npm run build:staging   # Staging artifact
npm run build           # Production artifact
npm start               # Serve the last built artifact
```

The previous `dev:next`, `build:next[:staging]` and `start:next` aliases remain.
Use `dev:vite`, `build:vite[:staging]` and `preview:vite` only for rollback checks.
Vite is not a separate production frontend. The local staging Python API remains
on port 8001. No backend execution engine was replaced during this migration.

Synthetic Next builds use isolated services and must not be used with real
accounts. A staging build replaces that artifact before handoff. CI builds Next
and checks native desktop/mobile routes alongside the existing local journeys;
hosted-account tests remain a separate manually invoked workflow. Test output
directories are separated so parallel suites cannot delete each other's traces.

## Release gates still pending

- Apply/verify the prepared additive developer-profile migration through the
  selected environment's normal migration process. It has not been applied remotely.
- Register and verify hosted Supabase callback URLs, Google/email sign-in and
  recovery, refreshed/revoked sessions and cross-tab sign-out.
- Run dedicated staging journeys for onboarding, review/publish, purchases,
  entitlement enforcement, refunds and reconciliation. Fixture payments are not
  evidence of real Stripe acceptance.
- Verify two-account/workspace isolation and revoked-member denial against the
  actual RLS/backend configuration.
- Deploy the selected Next artifact to staging, set API/CORS/site origins, and
  verify real streaming/uploads, observability and rollback before production.

No hosted database changes, payments, email, provider setting changes or deployment
were performed. The framework migration does not implement the later Go AEX,
sandbox execution or capacity/economics phases of the roadmap.

## Final verification

- 41 unit/database files passed: 354 tests, including public projections, profile
  migration grants, cookie/session boundaries, role checks and the production
  import-graph/native-route checks.
- 32 native Next desktop/mobile browser scenarios passed: all business/developer
  screens, public initial HTML without JavaScript, deep-link authorization,
  redirects/404s, navigation/back and shared-shell identity, profile submissions,
  workspace-scoped history, app checkout returns, docs, gallery, embeds, invites,
  sitemap and robots.
- 110 applicable existing component journeys passed; 82 platform-specific cases
  were intentionally skipped. The full run initially passed 107 and found three
  obsolete accessible-name selectors. Those selectors were corrected to the
  existing Marketplace/My apps labels, and all affected desktop/mobile journeys
  passed focused reruns. This includes draft preservation, creation, conflict
  handling, publishing/review, rollback, Operate/Manage, workflows, marketplace
  access, error isolation and mobile behavior. No remaining failure was left open.
- Synthetic, production and staging Next builds passed, as did the Vite rollback
  build, lint and whitespace checks. The final `.next` artifact uses staging
  settings with the local API on port 8001.
- The running local development server returned 200 for Marketplace/robots and
  307 for anonymous Settings/Dev Studio. The existing staging API health returned
  200. Real account, payment and hosted-release gates above remain unverified.
