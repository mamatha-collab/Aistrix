# Next.js workspace routing — 2026-10-24

Private workspace requests now pass through a dynamic App Router page that calls
Supabase `getUser()` on the server. Missing, invalid or rejected sessions redirect
to native `/login`, preserving the original path and repeated query values.
Authorization to individual workspaces, tools and records remains enforced by
existing database policies and backend checks. This route check does not grant
membership or administrator privileges. Embeds retain visitor authorization.

The catch-all lives in a workspace route group with a persistent layout. Its
client shell stays mounted between private routes, retaining workspace selection,
shared app/flow layers and existing builder navigation guards. Public catalog,
legal, login and recovery pages keep their separate native routes. Workspace
navigation to Marketplace now actually enters the native public route rather
than updating only browser history inside the old shell.

Both workspace and catalog screens use one Next navigation adapter for their
remaining React Router hooks. Next owns URL changes and server transitions;
browser back/forward and query/hash values remain available to the old hooks.
The Vite rollback entry continues using BrowserRouter. OAuth/payment URL cleanup
preserves Next's history state rather than overwriting it with an empty object.

This completes the routing boundary, not the full screen migration. Workspace
screens still use the existing client App component, page switch and state.
Native per-screen components and server data loading remain follow-up work.
Existing guards apply to their existing in-app navigation paths; this increment
does not add universal interception of browser back or arbitrary anchor links.

Validation uses only local synthetic services: unit checks reject failed user
verification even when user data is present and cover repeated callback queries.
Desktop/mobile browser checks cover pre-JavaScript redirects for anonymous and
forged-cookie requests, authenticated private transitions, browser back and shell
identity, and leaving the shell for the native Marketplace route. The synthetic
Auth service accepts only its deliberately unsigned local fixture token; hosted
Supabase does not accept that token. These checks do not replace hosted session
revocation, OAuth/email, workspace isolation, or paid marketplace acceptance.

No hosted migration, deployment or provider setting was changed. The profile
migration from the preceding increment remains pending. The local staging API
continues using port 8001. Rebuild for the intended environment after running
synthetic builds, before using `start:next` with real accounts.

Verification: 39 unit/database files (340 tests) and 18 Next browser checks passed.
The synthetic and staging Next builds, Vite rollback build and lint/whitespace checks passed. Browser checks
ran against the isolated production artifact, with external requests blocked.
