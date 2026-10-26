# Phase 1: full Next.js frontend migration

Decision date: 2026-10-24. The user selected the full frontend migration rather
than maintaining a public Next.js site alongside a permanent Vite application.
This records scope and acceptance requirements. The initial implementation and
its historical limits are tracked in `nextjs-foundation-2026-10-24.md`. The full
local source migration is delivered in `nextjs-completion-2026-10-24.md`; hosted
cutover and the launch acceptance gates below have not been completed.

## Final architecture

One Next.js App Router frontend serves public pages and authenticated workspaces.
Public catalog/profile content renders on the server with metadata and canonical
URLs. Interactive editors, runners and browser integrations use client components.
Authenticated data is authorized per request and never shared through public caches.

Supabase remains the identity/database provider with existing workspace ownership,
RLS and server-side authorization. FastAPI retains working Python execution,
payments and integrations. Next.js does not duplicate billing business logic or
move provider secrets into the browser. Go AEX remains Phase 2.

React/Vite and Next.js are both established approaches. The reason for this
choice is a unified frontend with server rendering for discovery pages, not an
assertion that the current framework cannot support production use.

## Migration sequence

1. **Baseline and route inventory.** Map `src/App.jsx` routes, VIEW_PATH_MAP,
   aliases, query parameters, app/developer IDs, invites and embed paths. Record
   public/authenticated behavior and expected redirects. Current App gates most
   pages behind Auth; explicitly separate public discovery from authenticated
   execution. Preserve uncommitted work and establish staging regression results.
2. **Application foundation.** Add Next.js App Router layouts, global styles,
   client providers, error/not-found/loading boundaries and build configuration.
   Convert VITE environment references to explicit public/server settings;
   whitelist browser configuration, never expose service-role or provider keys.
   Move theme, Sentry, workspace request setup and browser-only initialization
   out of the current DOM mounting entry point. Keep tooling for regression tests.
3. **Authentication and workspace boundaries.** Implement supported Supabase
   browser/server clients, session refresh and callback/logout flows. Preserve
   tenant authorization in FastAPI and RLS; layout redirects alone do not authorize
   data access. Test expired/revoked sessions, workspace changes, deep links,
   password recovery and OAuth before migrating protected pages.
4. **Public routes.** Move marketplace, listing details, developer profiles and
   legal pages into native routes. Use explicitly public fields and published
   listing gates, proper status codes, metadata, sitemap and canonical URLs.
   Define unpublish/suspend cache invalidation. Preserve purchase/run destinations.
5. **Authenticated routes.** Move Business, Dev Studio, workflow editor/history,
   app runners/docs, billing/settings, admin/moderator, invitations and embeds.
   Replace React Router navigation/hooks with native Next.js routing route by
   route. Preserve streaming, file uploads, Stripe returns, approval/cancellation,
   workspace context, unsaved-edit guards and mobile behavior.
6. **Deployment and cutover.** Add Next.js CI build and desktop/mobile browser
   journeys, preview/staging deployment and origin/callback configuration. Verify
   all links and redirects against the selected host. Cut over only after parity
   and recovery tests pass. Then remove Vite production entry/config/dependencies
   and the React Router compatibility layer; retain the old release as rollback.

A temporary client-only compatibility mount may be used during migration, as
described in the official Next.js Vite migration guide. It is not the completion
criterion: public routes need server rendering and final routing must be native.
https://nextjs.org/docs/app/guides/migrating/from-vite

## Completion criteria

- One frontend build/deployment with native App Router routes for the entire app.
- Existing customer/developer/admin journeys and desktop/mobile regressions pass.
- Public page content is present in initial HTML; unpublished/private data stays
  hidden, including after cache changes and concurrent authenticated requests.
- Authentication, callbacks, session refresh and server authorization work across
  direct navigation, reloads, sign-out and workspace membership changes.
- Billing events remain verified/idempotent in the backend; purchases, refunds,
  entitlements and return URLs pass staging tests.
- No hydration failures, missing styles, broken deep links, lost workspace headers
  or credentials in browser assets/logs.
- Monitoring, deployment rollback and existing Python API compatibility are tested.

## Effort and delivery

This is a substantial migration because routing, auth, environment handling and
browser initialization are coupled to the current shell. Component count alone
does not determine duration. Estimate after the route/auth inventory and first
verified migration slice; do not promise a completion date from the current audit.

Incremental delivery preserves working functionality while pursuing the full
architecture. No paid hosting, database migration or production cutover is part
of this scope document. Infrastructure cost and operational sizing remain to be
measured. Phase 1 also retains marketplace security and billing acceptance gates;
the framework migration alone does not complete the phase.
