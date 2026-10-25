# Native workspace pages — 2026-10-24

Settings (`/settings`), Shared Profiles (`/profiles`) and Run History (`/history`)
now have explicit App Router pages with their own titles and session checks.
Their existing UI components render through a route outlet inside the persistent
workspace shell. The route receives the signed-in user and existing navigation
callback from a small React context; session tokens are not passed through it.

The layout passes Next's route children through the browser entry into the shell.
Only the three migrated paths use this outlet. Other private screens continue
through the compatibility page switch, and the Vite rollback still uses the
original views. Existing database policies, API authorization and form behavior
continue to apply; no server role or privileged database client was added.

Testing exposed that a browser-only shell can defer a nested Server Component's
redirect. Private authorization therefore also runs in the Next request proxy,
before rendering: requests without session cookies redirect immediately; requests
with cookies require a successful Supabase `getUser()` response. Public routes and
visitor embeds remain accessible without a session. Public session-bearing
requests retain cookie refresh and private/no-store cache behavior.

Proxy sign-in redirects require an absolute Location. The redirect keeps the
incoming Host, including loopback IP and port, so Next's localhost normalization
does not move the browser away from its cookie origin. The destination path is
validated, query values are preserved, and Auth cookie deletions/cache headers
are carried into rejected-session redirects. Native pages retain the shared
server-side session helper as a second check.

Verification covers desktop/mobile route content and metadata, private redirects
without JavaScript for missing/forged cookies, shared shell identity across routes
and browser Back, profile form submission using the authenticated user's ID, and
run-history queries/headers following a real UI workspace switch. All browser
services and tokens are synthetic and external requests are blocked. These are
local regression checks, not hosted tenant-isolation or billing acceptance.

Results: all 39 unit/database files passed (344 tests), all 20 Next browser checks
passed across desktop/mobile, and the synthetic Next build, Vite rollback build,
lint and whitespace checks passed. The test artifact is rebuilt for staging
before handoff so it does not retain synthetic service settings.

The next screen migrations are the remaining business pages and Dev Studio. App
execution, workflows, streaming and editor state should move in separate bounded
increments. The developer-profile schema migration remains prepared but unapplied
remotely. No deployment, email, payment or hosted schema change was performed.
