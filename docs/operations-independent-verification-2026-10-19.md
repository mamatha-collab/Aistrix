# Independent operations verification — 19 October 2026

Scope confirmed by the user: no hosted website/API exists yet. Tests use the actual local API and hosted `aistrix-staging` Supabase project. These results do not claim hosted-app load capacity, a production SLA, or a long-duration soak test.

## Completed

- Separate confirmed Auth users for owner, editor and customer, each with independent login/session tokens. Only synthetic data was created; no invitation emails were sent. Generated apps, users and related fixtures were deleted afterward.
- Real customer feedback, consented evidence, consent withdrawal and separation from raw private run history.
- Editor triage notes, persisted regression links, verified-status evidence checks and immediate access denial after revocation, including an editor's own authored regression.
- Monitor reconciled more than 2,500 known run rows and more than 1,200 customer ratings. Eval returned exact status counts and the final feedback page beyond the database API's 1,000-row cap.
- Actual local backend termination/restart: an event durably queued while the server was stopped was delivered exactly once after startup. Requeueing that same event remained duplicate-free. See `verification/operations-independent-staging.json`.
- Complete real-model lifecycle using Anthropic: feedback → editor's saved regression → draft-only prompt change → functional/edge/safety/app-specific/performance tests → valid current-draft checklist → actual publish gate → live v2 → independent customer response → feedback verification. All 28 acceptance checks passed. See `verification/operations-complete-lifecycle.json`.
- Monitor's top-level menu now opens on All apps, including refresh/re-entry. Intentional links from Deploy still open the named app. Eval retains the relevant selected app. Seven targeted browser tests and the production build passed.

## Measured API load

| Probe | Requests | Concurrency | Successful | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| Monitor/Eval, populated staging fixture | 24 | 4 | 24 | 1.163s | 1.624s | 1.687s |
| After restart, separate Anthropic fixture | 8 | 2 | 8 | 0.728s | 0.853s | 0.853s |
| Full lifecycle fixture | 8 | 2 | 8 | 0.777s | 0.873s | 0.873s |

These are bounded concurrent monitoring/feedback reads against the local API and remote staging database. This workload does not stress model generation or demonstrate hosted scaling. The first report has overall status failed because its separate OpenAI model run failed, not because load/restart/access checks failed.

## Provider blocker found

OpenAI returned HTTP 429. A minimal direct provider diagnostic confirmed error code `credit_balance_exhausted`, type `insufficient_quota` (`verification/operations-openai-provider.json`). Its failed run was recorded in telemetry. No billing settings were changed and no credits were purchased. OpenAI-backed runs require account credit availability or a usable developer/user key before their release check can pass. Anthropic-backed real customer runs and the full release lifecycle passed.

## Repeating the independent test

`aistrix-backend/scripts/verify_operations_staging.py` refuses an unexpected project, requires an explicit staging-write flag, generates its own synthetic identities and cleans up their resources. Credentials remain in memory/environment and never appear in reports.

```powershell
aistrix-backend/venv/Scripts/python.exe aistrix-backend/scripts/verify_operations_staging.py --env-file aistrix-backend/.env.staging --api-url http://127.0.0.1:8000 --expected-project-ref qhfxnpsvdolaftaljvdp --confirm-staging-writes --exercise-lifecycle --model-provider claude --output docs/verification/operations-complete-lifecycle.json
```

Lifecycle/model options execute a small real model workload and use the configured provider account. The load phase itself performs no model calls. To repeat the controlled restart, add `--restart-marker` with a local file path; the runner announces when to stop and restart the already-identified staging backend. It never runs an arbitrary restart command.

When a hosted app/API exists, repeat independent-account checks, restart recovery, expected-traffic load and a longer soak on that deployment, with persistent storage configured per replica. This deployment evidence remains outstanding; there is no hosted endpoint to test today.
