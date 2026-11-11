# TypeScript migration — first production-boundary increment

This is an incremental migration, not completion of a full JavaScript-to-TypeScript rewrite. The frontend now has 70 TypeScript source files: 66 converted modules and four new shared type/helper/contract-check modules. Another 178 legacy runtime JavaScript/JSX modules remain explicitly inventoried in `aistrix-frontend/config/legacy-javascript.json`.

## Delivered scope

- Every `src/app` module: App Router pages/layouts, metadata routes, sign-in/recovery, OAuth callback, application wrappers and Next navigation.
- `src/proxy.ts` and every `src/server` module: authenticated route/session boundaries and anonymous public catalog loading/projection.
- Browser Supabase setup, auth path/session utilities, workspace routes/context and shared navigation.
- Authenticated management requests, Platform API helpers, provider catalog/selection/key requests, and Python Studio signature/fixture helpers.
- Developer capability metadata, the workspace UI, ribbon breadcrumb and shared provider connection controls.
- Shared JSON, Python manifest, provider/model, project-summary, navigation and route-prop contracts. Existing legacy views have typed JSDoc boundary props where they are called by converted routes.

The Python backend and SDK remain Python. Tooling and test fixtures may remain JavaScript. Large legacy React editors/runners are intentionally still JavaScript during this increment; `allowJs: true` and `checkJs: false` keep them compatible while TypeScript modules are checked strictly.

## Enforcement

`tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, isolated modules, consistent path casing and Next's TypeScript plugin. Dependency declarations use `skipLibCheck`; application diagnostics are not ignored. Production source contains no blanket `@ts-nocheck`, `@ts-ignore`, or `as any` migration escape hatch.

`npm run typecheck` now:

1. Rejects new runtime JS/JSX outside the explicit legacy inventory and stale inventory entries after conversion.
2. Generates Next route types using `next typegen`.
3. Runs `tsc --noEmit`, including compile-only negative contract assertions.

CI runs this after frontend lint. Next's production build also performs type validation. Import-graph and route-coverage tests now traverse `.ts`/`.tsx` rather than silently missing converted modules.

## Boundary behavior

Required public Supabase values are narrowed through a runtime configuration helper instead of non-null assertions. Nullable sessions and route values are handled explicitly. Auth redirects, cookies, publication filters and anonymous projections retain their existing security boundaries.

Management responses are `unknown` records until decoded; a decoder overload provides typed validated results. Provider models and public catalog serialization reject malformed connection/display values. Browser tests use synthetic services and credentials; no real provider key was changed.

## Remaining conversion

The remaining source inventory includes the main application shell, large Design/Test/Deploy editors, app runners, workflow editors, business screens and other legacy hooks/utilities. Convert those in feature-sized increments with concrete app/run/release/workflow models, remove each migrated path from the legacy inventory, and retain strict checking. Database-generated types are a separate improvement; this increment does not claim full schema-generated Supabase query typing.

The previously identified legacy local-browser fixture failure expecting `+ App` remains a release-pipeline issue outside this conversion. Updating the typed Next import graph does not fix obsolete UI fixtures.

## Verification

- `npm run typecheck`: passed, including generated Next route checks and negative type assertions.
- Frontend source tests: 39 files, 270 tests passed, including malformed provider/public-projection checks.
- Next.js browser suite: all 58 desktop/mobile checks passed against the TypeScript webpack build.
- Next production webpack build: passed, including Next's TypeScript validation.
- The exact CI build command, `npm run build:next:test`, also passed with the default Turbopack compiler and TypeScript validation.
- Lint and whitespace checks: passed; existing repository lint warnings remain.

Installing the compiler added TypeScript 5.9.3 and Node 24 declarations. The dependency audit reported five advisories in existing dependency families: `dompurify`, `jspdf`, `monaco-editor`, `posthog-js`, and `vite` (four critical and one high in the observed audit). No automatic dependency upgrades were applied; triage and compatible security updates remain production-readiness work.
