# Shared visitor limits and Market completion — October 20, 2026

Scope: free/verified developer tiers remain unchanged. Coming-soon app types remain coming soon. Notification delivery is deferred, as requested.

## Delivered

### Anonymous/embed limits

- Replaced process-local counters with a service-only Postgres sliding-hour RPC. Row locking makes each consumed slot atomic across API workers/instances sharing the same database and configuration.
- Separate anonymous and per-app embed scopes. The same embed bucket covers run, file and URL-reading paths.
- Keys are HMACs of the scope and visitor IP; raw IP addresses are not stored in the bucket table. A bounded cleanup removes expired buckets. Hit arrays only retain admitted requests in the last hour.
- Exhausted limit returns the existing 429 behavior. Storage/migration failure or timeout refuses visitor access with a generic 503, rather than resetting a local counter or silently bypassing the limit.
- Dedicated HTTP client timeout 3 seconds and asynchronous deadline 4 seconds prevent a long shared-database timeout on this gate.

### Market

- Atomic server-only listing status transition locks the app and listing while validating the released app, listing requirements and paid price. Stale editor revisions are refused.
- Explicit confirmed unlist action, cancellation and retry-visible failure. Unlisting removes discovery; it does not unpublish the app or revoke existing access.
- Saved listing preview, visible requirements, retryable loading errors, and Go live for eligible non-live historical statuses.
- Public discovery only includes explicitly live listings attached to published apps, with stable 24-item pages, category filters and literal title search across the catalog.
- Customer errors do not masquerade as an empty catalog. Customer detail/access loads reset on navigation and ignore obsolete replies.
- Marketplace launches the shared `/app/:id` runtime instead of a separate text-only runner, preserving native forms, data/file, batch, tools and conversation behavior in their established runners. Checkout success returns to that app runtime. Actual model/checkout behavior remains subject to its existing access gates.
- Customer access display checks remaining pay-per-run quota; refresh access is explicit and read failures are visible.
- Public storefronts show listed apps only, without an unlisted-published fallback. The profile reads public fields explicitly. Former listing creators lose editor-only draft access after revocation.

## Database rollout (manual, matching the user's earlier preference)

Apply these files to the intended project, after existing migrations through `20261020040000` (developer tiers):

1. `supabase/migrations/20261020050000_shared_visitor_limits.sql`
2. `supabase/migrations/20261020060000_market_completion.sql`

Then deploy/restart the matching backend and frontend. No hosted database migration was applied by this task. Until the first migration is applied, anonymous/embed requests deliberately return 503; until the second is applied, listing go-live/unlist fails visibly. Do not deploy the backend first and treat those refusals as ready operation.

Every API instance must use the same database, visitor-limit settings and HMAC key. Set `RATE_LIMIT_HASH_KEY` to the same secret on all instances if using it; otherwise the service-role key is used. A change resets the visitor bucket identity. Configure trusted proxy forwarding only where clients cannot bypass/forge the trusted proxy, so limits use the correct client address. Never expose the HMAC or service-role key to frontend VITE variables.

Unlisting and unpublishing are different: unlisting hides the sales page while existing direct app access remains; unpublishing stops app availability and hides the listing through database policy.

## Verification and remaining external evidence

- Real Postgres engine applies all migrations: atomic budget counts, scope isolation/expiry/cleanup, browser denial, stale listing rejection, unpublished release refusal, unlist preserving publication, and revoked creator access.
- Shared-limiter API checks cover hashed/stable keys, scopes, denial and fail-closed storage errors. Existing run/file/URL limit checks continue to test the call sites with synthetic storage.
- Market browser tests cover listing publication/refusal, teammate conflicts, pricing, confirmed unlisting with failed-write recovery, loading recovery, catalog pages/search/unpublished exclusion, shared-runtime navigation, customer read outages and pay-per-run access refresh.
- No provider payments, real purchases, account billing changes or notification work were performed.
- Production sign-off still requires applying migrations to the target environment and verifying the hosted buyer/Stripe flow and concurrent requests across actual API replicas. Code tests and local Postgres checks are not provider reconciliation or hosted capacity evidence.

Final validation: **259 frontend/database tests passed across 23 files; all 20 backend suites passed across the full run and targeted rechecks (the two outdated limiter fixtures were corrected); 12 Market browser journeys passed (9 desktop and 3 mobile), with six desktop-only editor cases intentionally skipped on mobile. Production build and lint passed; existing unrelated lint warnings remain.** Desktop and mobile discovery screenshots were visually inspected. No remote SQL or provider transactions were performed.
