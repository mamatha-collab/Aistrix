# Native public routes and cookie sessions — 2026-10-24

## Implemented locally

| Route | Behavior |
| --- | --- |
| `/marketplace` | Anonymous server-rendered published/public app catalog with the existing search/filter/save interactions |
| `/marketplace/[id]` | Server-rendered public details, canonical metadata, retained purchase/review/open-app interactions, and true 404 for unavailable/private/unpublished IDs |
| `/dev/[userId]` | Server-rendered public developer display data and public apps; invalid/unavailable IDs return 404 |
| `/privacy`, `/terms` | Native public server-rendered legal pages; consent interaction remains client-only |
| `/login` | Existing sign-in/signup UI on a native route, with a validated internal return path |
| `/auth/callback` | PKCE code exchange, cookie propagation, no-store/no-referrer responses and safe relative redirects |
| `/reset-password` | Server-verified session required before showing the new password form |

The public routes reuse existing React views through a temporary navigation
adapter. Initial catalog/app/profile data is present without JavaScript. Card
animation values are deterministic to avoid hydration differences. Existing
Dev Studio, Business, execution, billing and admin workspaces remain in the
browser compatibility boundary; their FastAPI/RLS authorization stays in place.
This increment does not claim native protected layouts for the whole application.

## Session and data boundaries

`@supabase/ssr` provides browser/server cookie clients. `proxy.next.js` verifies
claims and refreshes session cookies before render, forwards renewed cookies to
both request and response, and prevents shared caching of session responses.
It skips the code-exchange route so two handlers do not compete to refresh a
session. Server password recovery uses `getUser`, not unverified cookie data.

Legacy localStorage sessions are transferred through Auth before removing their
old key. Existing cookie sessions take precedence. Failed transfers preserve the
legacy copy, and explicit sign-out clears it so it cannot resurrect on reload.
Local drafts remain unaffected except for the existing intentional-sign-out rule.

Public catalog queries use a separate anonymous client with `cache: no-store`.
They never inherit authenticated cookies or a service-role key. Public-field
projections exclude prompts, snapshots, credentials, draft listing relations and
developer billing fields. React's `cache()` only deduplicates the metadata/page
reads within a render request; no shared catalog output cache was introduced.
Unpublishing/private changes therefore do not wait for a configured ISR interval.

Implementation follows the official [Supabase SSR client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
and [Next.js proxy convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).

## Schema discovery and additive migration

The read-only real staging check found that the original profile UI references
`github`, `twitter`, `avatar_url` and `updated_at` although the repository baseline
does not define them. The first native catalog attempt returned 500 on that query.
A targeted compatibility path now retries only missing optional columns against
the baseline public fields. Network/authorization failures remain visible errors.

The baseline also keeps profile rows owner-only because they contain Stripe and
earnings information. Migration `20261024010000_developer_profile_public_fields.sql`
adds the optional display columns and a `security_barrier` public view containing
only display fields for creators with published public apps. It does not add a
public policy to the financial table, change payment fields or delete any rows.
The view hides the profile again when its last public app is unpublished/private.

The migration is prepared and tested locally, **not applied remotely**. Until
rollout, the client falls back to the original RLS-protected table. An anonymous
visitor may see a generic developer name rather than private row data. Basic
owner profile edits can save on the baseline; requested nonempty optional fields
produce an actionable error and remain unsaved instead of being silently dropped.

## Verification and limits

Final verification:

- 38 unit/database test files, 335 tests passed.
- 14 native-route browser checks passed across desktop and mobile, including
  JavaScript-disabled public content, private/unpublished 404s, callback origin
  preservation, password reset gating and no-store session responses.
- 21 existing desktop developer-account, marketplace, shared-workflow and editor
  lifecycle journeys passed. The three affected customer/paid-access journeys
  were rerun successfully after the final profile compatibility adjustment.
- Next.js production/test builds, the Vite rollback build and lint passed.
  Generic React refresh/export lint warnings remain on Next.js metadata exports
  and existing shared components. The final staging build also passed after
  the synthetic browser tests; its API origin is localhost:8001.

Test artifacts use a
synthetic local Supabase service, including missing-view/optional-column responses
matching the staging rollout state. Browser requests to external services are
blocked. Unit tests cover claims verification, refresh-cookie/cache propagation,
PKCE callback success/failure, redirect restrictions, session transfer/sign-out,
public projections and schema compatibility. Database tests apply the additive
migration twice, preserve identity/payment values, deny financial columns through
the public view, reject writes despite inherited schema default grants, and check
publication filtering under the anonymous role.

Actual staging-configured anonymous checks returned HTTP 200 for `/marketplace`,
`/privacy` and `/login`; marketplace content was present in initial HTML after
the schema compatibility correction. No customer rows were printed, remote schema
changed, email sent, payment initiated or OAuth provider setting changed.

Before hosted release: register the intended site's `/auth/callback` redirect URL
in Supabase, apply/verify the migration in the selected staging environment through
the normal migration process, and exercise real email/Google callbacks, recovery,
refresh/revocation, two-account/workspace isolation and sign-out across tabs.
Mocked Auth tests do not replace those hosted acceptance gates.

## Next increment and operation

Move authenticated workspace layouts/pages and navigation from the compatibility
boundary to native routes, preserving unsaved-edit guards, workspace selection,
streaming, approvals, payment returns and the Operate/Manage fixes. Then address
tool contracts and production marketplace acceptance gates in the Phase 1 roadmap.

Restart `npm run dev:next` once after updating the dependency/configuration to
load the native callback setup, then check `/marketplace` and `/login`. The local
staging API remains on port 8001. Production/staging runtime artifacts must be
built separately; `build:next:test` is synthetic and is not a deployable customer
artifact. No hosting or production cutover was performed. No new hosted services
were purchased; SSR database traffic and hosting costs still need measurement.
