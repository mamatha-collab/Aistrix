# E2B development execution

Staging now uses E2B for private Python jobs. The API controls source, queues and deployments; a Windows-compatible coordinator uploads source and runs it in a short-lived remote sandbox. Submitted Python never executes on the API or coordinator host. The dedicated Linux worker path remains supported through `CODE_EXECUTION_PROVIDER=dedicated`.

## Configuration

Keep credentials only in the backend environment, never frontend variables or Git. Staging uses `aistrix-backend/.env.staging`:

```dotenv
CODE_EXECUTION_PROVIDER=e2b
CODE_APPS_ENABLED=1
E2B_API_KEY=<secret>
E2B_TEMPLATE=<template-id>:<immutable-build-uuid>
E2B_DAILY_RUNTIME_SECONDS=3600
```

A private `aistrix-python-dev` template was created from Python 3.12 with 1 CPU and 512 MiB RAM. Its exact build reference is saved locally. Shared base-template tag lookup returned HTTP 403, so setup uses the owned template instead. Template construction happens during setup, not on every source build.

From the backend directory, verify credentials without creating a sandbox:

```powershell
venv/Scripts/python e2b_worker.py --env-file .env.staging --check
```

Start the coordinator in a separate terminal when restarting development:

```powershell
venv/Scripts/python e2b_worker.py --env-file .env.staging
```

The rollout started it as a hidden background process. It is not installed as an automatic Windows service. Restart it after a reboot. The local staging API uses `scripts/run_local.py --env-file .env.staging --port 8001`.

### Restart on November 10, 2026

The coordinator had been down since November 2:
- Its last stored heartbeat was 14:17 UTC, about 90 minutes after the last of 14 "Queue storage unavailable" lines in `.data/e2b-staging.stdout.log`.
- stderr was empty, and the worker never removed its registration.

That points to the process being stopped from outside (sleep, shutdown or reboot), not a Python crash. The storage errors themselves can't be diagnosed: the coordinator logged no cause.

Changes made with the restart (`e2b_worker.py`, tests in `tests/test_e2b_worker.py`):
- **Logged causes.** Log lines carry a UTC timestamp, and storage and heartbeat failures state the error type and a short message with token-like text redacted.
- **Brief outages tolerated.** A failed heartbeat write no longer cancels a running job at once. The job is stopped only when the server refuses its heartbeat, or after 60 seconds of failures, inside the 90-second lease. Previously any single network error cancelled the job.

Restarted from `aistrix-backend` with output appended to the same log files:

```bash
PYTHONUNBUFFERED=1 venv/Scripts/python e2b_worker.py --env-file .env.staging >> .data/e2b-staging.stdout.log 2>> .data/e2b-staging.stderr.log
```

The preflight passed (template resolves, no sandbox created). Staging then showed both E2B worker types with a heartbeat 10 seconds old, and no queued or running jobs. The process still stops when this machine sleeps or restarts; starting it automatically at sign-in (Task Scheduler) is not set up.

## Execution contract and limits

This first managed runtime supports Python standard-library projects only; nonempty dependency requirements are rejected before queuing a build. A build checks Python syntax in the sandbox, then records the pinned runtime plus canonical source hash. It does not produce an OCI image. Managed artifacts use `e2b://<template>:<build-uuid>@sha256:<source-hash>`. Each invocation creates a fresh sandbox with those exact source files and runtime. Preview does not deploy; private deployment still requires an explicit action and uses existing comparison checks.

Sandboxes disable internet access and public ingress, have a bounded provider TTL, and are killed in `finally` on success or failure. Provider TTL remains a fallback when termination fails. The trusted guest harness imposes process memory/CPU/file/PID limits, enables no-new-privileges, drops to UID/GID 65534, and clears the environment before importing customer modules. No provider, Supabase or model credentials enter the sandbox.

The VM has 512 MiB total memory; the default Python process limit is 256 MiB. These are distinct limits. Runs retain the manifest timeout (maximum 120 seconds); builds allow 60 seconds. Reservations include startup/cleanup time: 90 seconds per build and manifest timeout plus 30 seconds per run. Existing per-owner quotas remain 5 builds, 100 runs per day, and 2 active jobs. One coordinator executes one task at a time.

The 3,600-second allowance is a shared UTC-day admission limit, not an E2B account dollar cap. Reservations survive failures, cancellation, app deletion and task cleanup through a service-only ledger. Direct provider operations, template creation, other users of the E2B account, and account pricing are outside this queue limit. Do not automatically retry interrupted jobs.

Migrations `20261028020000_e2b_execution.sql` and `20261028030000_e2b_runtime_ledger.sql` were applied to the linked staging Supabase project. Production configuration and database were not changed.

## Verification on October 27, 2026

- 35 backend Studio, existing worker and managed-adapter tests passed.
- Frontend production compilation passed, along with 5 Studio/platform client tests and 4 desktop/mobile Studio browser regressions. Installed Python dependencies passed `pip check`.
- 15 database tests passed across managed execution, Studio and legacy code jobs. Managed tests verify atomic admission rollback, executor-specific claiming, artifact/source matching, previews without deployment, retained cancellation reservations and browser-role denial.
- A real remote Python build and invocation returned `total=5` under UID 65534. Outbound HTTPS failed with networking disabled. A TCP handshake alone can complete at E2B's proxy, so that is not a sufficient network-isolation test.
- A temporary synthetic app completed build → preview → private deploy → deployed run through the real staging queue and background coordinator. The preview left deployment empty; both runs returned `total=5`. The app was removed after verification, preserving runtime reservations. This exercised service-role queue integration, not a real browser sign-in.
- Staging API health returned HTTP 200, both E2B worker types registered, and the E2B account listed zero active sandboxes after verification.

This establishes the initial development runtime. Custom dependency templates, web-server hosting, automatic service startup, load testing and production rollout remain separate work.
