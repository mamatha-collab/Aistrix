# Prompt to code Studio Python slice

The requested early Prompt-to-Code Studio builds on the existing private Python code-application runtime. It moves a small source-development experience ahead of the full browser IDE roadmap. Reusable Node registration and previews for other resource kinds remain future work.

## Developer experience

Start at Developer → Nodes → Create Python resource with AI. Name the project, then use Prompt, Code, and Live preview panels. Desktop panels resize; smaller screens use tabs. Existing Code Application projects also open this Studio when the migration is available. The previous editor remains a fallback on older servers.

Each generation request contains the current files, file hashes, manifest, and developer instruction. The model returns structured per-file replacements with expected hashes. Unrelated files are preserved. Manual edits after requesting a proposal make it stale; acceptance cannot overwrite them. Server revision checks also reject concurrent changes before/after generation and during saves.

Accepted proposals and manual saves create draft revisions pointing at immutable source bundles. Developers can discard proposals, revert the last accepted change, and restore history as a new revision. Files remain authoritative. Conversation messages and unaccepted proposals currently last only for the browser session.

The initial contract uses main.py with run(payload), schemas.json with input/output JSON Schemas, and tests.json with named input/expected-output fixtures. Static validation parses Python syntax without importing or executing it, validates fixtures and schemas, and denies external schema references. Fixtures describe expected results; execution establishes actual behavior.

## Generation and execution

Generation uses the existing AEX model gateway, balanced model policy, owner provider keys, rate limits, spending reservation/settlement, a call budget, and a deadline. The UI offers Claude and OpenAI. It generates one proposal per request; it is not an autonomous shell agent. It never builds, executes, or deploys source. Failed generation leaves source unchanged and preserves the instruction for manual retry.

Historical job outputs and errors are not automatically forwarded to providers. Automatic approval review rejected adding that payload because it might disclose sensitive run data. Requests are limited to the instruction and current project files, including authored tests. The developer can deliberately describe a failure in their next instruction. Provider keys never enter the guest runtime.

Staging now uses the [E2B development runtime](e2b-development-runtime.md), with a pinned Python template and source hash. The dedicated Linux path uses the existing isolated build worker and immutable image digests. A preview queues a successful build without changing deployment. The existing execution worker requires rootless Docker/gVisor, no network or credentials, read-only root filesystem, fixed CPU/PID limits, bounded memory, and deadlines. No customer Python executes in FastAPI. An explicit source flag opts Studio-authored projects into output-schema enforcement; legacy jobs retain their behavior.

Preview controls derive from simple input-schema properties, with JSON input also available. The UI shows persisted status, returned output, private logs, and errors. For unchanged selected fixture input, it compares actual output with expected JSON. Output retains its source/build identity and is labeled as older if source changes. Unavailable workers disable execution; expected fixture values are never substituted for runtime output.

Successful builds are reused for matching saved source IDs. Manual edits, validation, builds, fixture assertions, and previews do not call an LLM. Private deployment is explicit and retains the existing deployment CAS; deployed invocations pin the displayed build. General web hosting and Marketplace publication are not added.

## API and migration

- GET /v1/apps/{app_id}/code/studio: current draft and recent revision history.
- PUT /v1/apps/{app_id}/code/studio/draft: source save with expected revision.
- POST /v1/apps/{app_id}/code/studio/proposals: reviewable candidate against current hashes/revision.
- POST /v1/apps/{app_id}/code/preview: isolated run of a specific successful build, with input-schema validation.

These require the signed-in code-app owner; API keys cannot manage source. Bodies and source sizes are bounded. SQL independently enforces ownership, revision fencing, role restrictions, worker health, active-job limits, and existing quotas. Existing source/build/deploy/run APIs remain available.

Migration: supabase/migrations/20261028010000_code_studio.sql adds draft pointers/history, an opt-in source contract flag, and guarded save/preview RPCs. It was tested locally and then applied to the linked staging project during rollout troubleshooting. Production was not changed.

## Evidence

Verified locally on October 27, 2026:

- venv/Scripts/python -m pytest tests/test_code_studio.py tests/test_code_jobs.py -q: 31 passed. Covers exact-base proposals, manual files, static parsing without execution, owner/key checks, bounded requests, revision conflicts, previews without deployment, schemas, and legacy worker compatibility. Providers, storage, and container processes are fakes in these tests.
- npm test -- --maxWorkers=1 --reporter=dot: 48 files, 400 tests passed, using workspace TEMP/TMP.
- After adding the source contract flag, npx vitest run db/codeStudio.test.js db/codeJobs.test.js --maxWorkers=1: 12 passed. Uses real Postgres semantics through PGlite with migrations, including CAS, history, deduplication, owner/role checks, and preview/deployment separation.
- Production webpack build passed with local fixture service settings. Targeted oxlint passed; the existing DevStudioPage user dependency warning remains.
- npx playwright test --config playwright.next.config.js --grep 'prompt-to-code|unavailable workers and concurrent|AI Apps contains|developer workspace starts': 8 passed on desktop/mobile. Covers creation, stale proposals, acceptance, builds, preview forms/assertions, explicit deployment, pinned deployed invocation, undo, restoration, conflict preservation, disabled workers, and navigation. Browser model/worker responses are synthetic. Layout screenshots were inspected.

## Rollout and limits

Deploy the additive migration, API, worker, and frontend together. Generation needs a configured owner provider key. Actual previews need healthy isolated Linux workers and CODE_APPS_ENABLED=1. Roll back binaries/UI while retaining new tables and history; no destructive down migration is required.

The Studio migration has been applied to staging. No live model call, real sandbox run, or production deployment was performed here. Hosted acceptance must still generate a calculator, apply successive changes, preserve manual code, execute real fixtures, inspect failures, restore a revision, and explicitly deploy. Isolation statements above describe the worker contract, not measured hosted acceptance.

Further work includes reusable Node resources, durable conversation/proposal jobs, resumable streamed generation, broader test semantics, and previews for Agents, Workflows, MCP Servers, Models, Knowledge Bases, Datasets, Evaluations, Prompts, and web applications. This slice is not a full IDE, multi-user editor, or general application host.

## Staging rollout follow up

The frontend uses the local staging API on port 8001. That API was an older process launched by scripts/run_local.py, so its OpenAPI definition did not include the Studio routes. The linked staging project was missing exactly 20261028010000_code_studio.sql. A CLI dry run confirmed that this was the only pending migration; it was then applied to staging. Both Studio tables were verified through read-only database queries.

The verified local API process was restarted with the same staging launcher, environment, port, and disabled background sweeps. Its health endpoint returned ok, all four Studio routes appeared in OpenAPI, and an unauthenticated Studio request returned 401. The API Dockerfile was also corrected to copy code_studio.py so future container builds include the module imported by code_apps.py.

Execution remains disabled: the staging CODE_APPS_ENABLED setting is off and the database reports no healthy workers. Docker is not installed on this workstation, WSL has no installed runtime, no worker host connection was configured, and the user confirmed they do not have an execution host or provider account. No sandbox safeguards were bypassed and no artificial worker heartbeat was registered. A managed sandbox provider account and provider integration, or configured dedicated Linux infrastructure, remain necessary for real builds/previews.
