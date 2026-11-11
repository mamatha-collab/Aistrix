# Evaluations Studio

The Developer capability chooser now opens an Evaluation Studio for immutable Platform Application pipeline releases. Existing AI App quality tools remain available through the separate application quality action.

## Implemented behavior

- Select an application, exact release, and pipeline workload. Inspect its release ID and content hash.
- Create named Eval Suite versions with editable JSON inputs and equals, contains, not-empty, numeric tolerance, or JSON Schema checks. Multiple cases, shared checks, a pinned dataset reference, and simulated approval/rejection are supported.
- Require test replacements for external write steps reported by the compiler. The backend independently refuses unmocked writes. Model calls still use the owner's configured provider keys and may incur provider charges.
- Validate suites through the existing spec endpoint and publish immutable releases. Load a released suite, edit it, and release a new version. An edited suite cannot run until released; changing content under an existing version remains a server-side conflict.
- Run a released suite, inspect persisted result history and individual case failures, and open the associated run output, error, step state, and events.
- Keep a result as a comparison baseline, including across selected application releases. Compare pass rate, model cost, and case count. Equivalent cases, checks, model settings, and thresholds remain necessary for meaningful comparisons.
- Show required production evaluations using the same latest-result rule as actual promotion. No required suites is shown explicitly rather than presented as an evaluation pass. Adding requirements requires a new application release with pinned tests references.
- Protect unsaved suite edits during navigation; prevent repeat clicks and guarded navigation during release/run requests. Reads can be refreshed. A lost execution response instructs the user to inspect history before rerunning.

## API and compatibility

An additive authenticated `GET /v1/platform/releases/{release_id}` returns public release metadata, the pinned spec, external-step requirements by workload, and the evaluation gate report. The endpoint checks ownership before reading the report; other owners receive 404. Production promotion and the readout share `Registry.gate_report` so they cannot apply separate eligibility rules.

Existing validation, release, evaluation, per-release result, run, and event endpoints perform the mutations and execution. No database migrations or destructive data changes are required. No promotion is performed by the UI. Application creation and the existing quality workflows remain available.

## Verification

Local checks on October 27, 2026:

- Backend: `venv/Scripts/python -m pytest tests/test_platform_registry.py tests/test_platform_spec.py -q` — 42 passed. Includes latest-result gate behavior and unrelated suite results failing to satisfy a required suite.
- API/SDK/CLI: `venv/Scripts/python tests/checks/check_platform_api.py` — 64 checks passed. Includes pinned spec readout, external-step discovery, gate agreement, authentication, ownership, immutable releases, model execution, and promotion. External providers and storage are fakes in this harness; engine and API code paths are real.
- Frontend: `npm test -- --maxWorkers=1 --reporter=dot` — 46 files, 394 tests passed. TEMP and TMP pointed at the workspace Node cache to avoid sandbox temporary-file failures.
- Production webpack build passed with synthetic local service settings. Targeted oxlint checks passed; the existing DevStudioPage user dependency warning remains.
- Browser: `npx playwright test --config playwright.next.config.js --grep 'evaluation authoring|evaluation resource failures|developer workspace starts|AI Apps contains|platform resources'` — 10 passed across desktop and mobile. Exercises authoring, missing external replacements, failures, passing reruns, case inspection, comparison, immutable-version edits, unsaved navigation, read failure/retry, empty state, and workspace regressions. Browser services are synthetic. Desktop/mobile screenshots were visually inspected.

## Deployment and current limits

This change has not been deployed and no live provider calls or production promotion were performed for verification. Deploy the backend and frontend together so Studio can read pinned release definitions and gate reports. Configured Platform storage and an existing pipeline release are prerequisites; real model evaluations require the owner's provider keys. Hosted UI acceptance remains to be run after deployment.

The current evaluation endpoint is a synchronous suite controller over persisted individual case runs. A lost client connection does not provide a resumable suite job identity; inspect saved history before retrying. Durable suite-level job scheduling, cancellation, continuous evaluation, arbitrary resource-kind targets, human grading, and statistical benchmarking are outside this increment. This is not a claim that the broader safety platform or AEX architecture milestone is complete.
