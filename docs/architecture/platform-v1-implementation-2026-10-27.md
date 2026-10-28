# Platform v1, first vertical slice — 2026-10-27

Branch `feat/platform-v1`. Backup of the previous state: tag and branch
`backup/pre-platform-v1-2026-10-27` (commit 9c75059).

This implements phase 1 of the Aistrix Platform Proposal: an AI pipeline
defined as a spec, compiled, released, tested by an eval suite, promoted
through environments, invoked over REST, the Python SDK and the CLI, run
durably, and rolled back. Nothing existing was rewritten; the old app and
workflow run paths are untouched.

## What exists now

| Piece | Where | Notes |
| --- | --- | --- |
| Resource spec v1alpha1 | `aistrix-backend/aistrix_platform/spec.py` | One envelope, JSON Schema 2020-12 per kind. Implemented kinds: Application (pipeline workloads), EvalSuite, Dataset, SecretRef, Environment. Other kinds are refused with a reason. YAML or strict JSON; canonical JSON + sha256. |
| Node catalog | `node_types.py` | parse.document, llm.chat, llm.structured, code.python, http, human.approve, data.template |
| Compiler | `compiler.py` | Config, edges, cycles, typed edges, templates, secret placement, outbound hosts, idempotency keys on writes, provider restrictions, surface grants, stable plan id |
| Model gateway | `gateway.py` | Policy tiers (fast/balanced/best) pinned to model versions, run budget check before each call, spend reserve/settle hooks, failure classification |
| Node runtimes | `nodes.py` | Structured output with one repair try; HTTP writes carry an Idempotency-Key |
| AEX orchestrator | `orchestrator.py` | Saved step state, leases with heartbeat, at-least-once with idempotency, approvals with expiry, retries with backoff only when safe, cancel, resume |
| Registry | `registry.py` | Immutable releases, dev/staging/production pointers with history, rollback, production gate on passing evals |
| Evals | `evals.py` | Runs real releases with every outside write mocked; equals, contains, not_empty, number_close, json_schema checks |
| Storage | `store.py` (memory), `supabase_store.py` | Conditional updates for run versions and leases |
| Migration | `supabase/migrations/20261027010000_platform_v1.sql` | New server-only tables; release rows can't be updated |
| API | `api.py`, wired at the end of `main.py` | `/v1/platform/...`; resume supervisor in the app lifespan (`PLATFORM_RESUME_SECONDS`, default 30, 0 turns it off) |
| SDK and CLI | `aistrix-sdk` 0.3.0 | `aistrix spec validate/plan`, `release`, `promote`, `rollback`, `eval`, `invoke`, `runs ...`, `secrets ...`, `nodes` |
| Local runner | `python -m aistrix_platform.local` | Same compiler and orchestrator; own keys, env secrets, local entry files |
| Example | `examples/invoice-pipeline/` | Application spec and its eval suite |

## Try it

```bash
cd aistrix-backend
venv/Scripts/python -m aistrix_platform.local ../examples/invoice-pipeline/aistrix.yaml \
  --input '{"invoice_id":"1","file":{"name":"a.txt","content_base64":"SW52b2ljZSBmcm9tIEFDTUUgR21iSC4gVG90YWw6IDEyMC4wMCBFVVIu"}}' \
  --approve --mock 'post={"status":201,"body":{}}'
```

Needs `ANTHROPIC_API_KEY` in the environment; the mock keeps it from calling the example ERP.

## Evidence

Recorded on this machine, 2026-10-27:

- Platform unit tests (`tests/test_platform_*.py`): 64 passed.
- `tests/checks/check_platform_api.py` (API, SupabaseStore code paths on a fake postgrest, SDK and CLI): 57 passed.
- Full backend suite (`pytest tests`, every existing check script plus the new ones): 122 passed in 304 s.
- The frontend was not changed, so its tests weren't rerun.

### Staging, 2026-10-27

`npx supabase db push` on the linked staging project (`qhfxnpsvdolaftaljvdp`) applied
`20261026010000_code_app_jobs.sql` and `20261027010000_platform_v1.sql`. Production
was not touched.

`venv/Scripts/python scripts/verify_platform_staging.py --email <staging user>` runs
in-process on `.env.staging` as that user, with their own saved Claude key:
**15 passed, 0 failed**, on two runs.

- Release and eval suite stored with the content hash; an `UPDATE` on `platform_releases` is refused by the trigger.
- Production refused the release before evals ran.
- Eval suite on real Claude Haiku: 2 of 2 cases passed, $0.00009, 7.5 s. Production was promoted after that.
- A production run succeeded ($0.00004). The ERP write went to the owner's test destination: one row in `test_deliveries`, without the secret header. 10 run events stored in order.
- A large invoice waited for approval and finished once approved.
- A run with no worker appeared in the resume sweep and finished when resumed.
- A staging rollback returned the previous release.

Records from these runs live under the `verify` namespace on staging.

## Phase 2: existing app types and workflows on AEX (behind flags)

Both flags default to off; production behaviour is unchanged until they're set.

| Flag | Values | What moves |
| --- | --- | --- |
| `AEX_WORKFLOWS` | `off` (default), `on` | `main._execute_flow` hands the step loop to the AEX orchestrator (`aistrix_platform/workflow_adapter.py`). Each step is a `workflow.step` node calling the existing `run_flow_step`; `FlowRunStore` reads and writes `flow_runs` in the legacy shape, so the approve, continue, review and cancel endpoints, leases, recovery and the UI are untouched. |
| `AEX_APP_TYPES` | empty (default), `all`, or a list such as `prompt,native` | `main.execute_run` runs listed app types as an AEX run with one `legacy.app` node (`aistrix_platform/app_adapter.py`). The legacy pipeline streams through unchanged; refusals pass through; finished runs are recorded in `platform_runs` best-effort. |

The orchestrator gained what the adapters needed: nodes can skip themselves or pause for approval, errors can say whether an attempt is safe to repeat, and backoff and node runtimes are pluggable.

Parity evidence:

- `pytest tests` runs every check script twice: flags off, and `[aex]` with `AEX_WORKFLOWS=on` and `AEX_APP_TYPES=all`. Every existing assertion (outputs, errors, run logs, spending, access, approvals, retries, disconnects) must hold on both engines. `AISTRIX_SKIP_AEX_PARITY=1` skips the second pass.
- `check_platform_app_parity.py`: 16 app types × run, provider failure, access refusal and (for JSON types) contract failure, legacy vs AEX: status, body, provider requests and written rows identical; every streamed run recorded once with its outcome. Report: [app-type-parity-report.md](app-type-parity-report.md).
- Found and fixed on the way: the adapter first read the legacy stream ahead of the caller, so a caller that disconnected early was logged as a success instead of "cancelled". It now advances the legacy stream only when the caller reads (lockstep), which `check_deploy` verifies.

### Phase 2 on staging, 2026-10-27

`venv/Scripts/python scripts/verify_aex_flags_staging.py --email <staging user>` runs the backend in-process on
`.env.staging` with `AEX_WORKFLOWS=on` and `AEX_APP_TYPES=all`, through the real HTTP endpoints, as that user with
their saved Claude key. Sign-in is replaced by a local test token, and the key is read by user id instead of under
the user's session; everything after that is the real path. Only apps without tools or webhooks and workflows
without API steps were run. **15 passed, 0 failed.**

| What ran | Path | Result |
| --- | --- | --- |
| Support Reply Drafter (prompt) | `/v1/apps/{id}/run`, `stream: false` | 200, drafted reply; recorded `succeeded` |
| Invoice Extractor (structured) | same | 200, JSON with vendor, number, date, total 144.00 GBP; recorded |
| Sales CSV Analyst (data) | same | 200, correct regional analysis; recorded |
| Lead Qualifier (form) | `/run`, streamed | 200, 77 chunks; recorded |
| Bella - Bakery Helper (chatbot) | `/run`, streamed | 200, 20 chunks; recorded |
| Support Reply Drafter, flags off | `/v1/apps/{id}/run` | 200 on the legacy path, no `platform_runs` record |
| QA Workflow Check | `/v1/flows/{id}/runs`, then approve | waited at approval; approving ran Lead Qualifier; `flow_runs` kept the legacy shape |

Found by this run and fixed: on the API path (`stream: false`) callers stop reading at the "done" event, and the
adapter recorded those runs as "cancelled". It now treats done or error as the end of the run; a new case in
`check_platform_app_parity.py` fails without the fix. The run-log comparison in this script compared empty logs
(the owner's own runs aren't logged on either path), so it proves nothing; the local suites cover run logs.

### First native app type: prompt (AEX_NATIVE_TYPES=prompt)

For a qualifying prompt app, the model call in `_execute_run_legacy`'s standard streaming branch is made by AEX itself (`aistrix_platform/native_prompt.py`):

1. The app's configuration becomes an Application spec with one `llm.chat` node.
2. The platform compiler compiles it.
3. The orchestrator runs it, through the model gateway.

The gateway's provider adapter makes the call with exactly the legacy arguments, writes usage and stop reasons into the legacy usage dict, and re-raises the provider's own exception, so legacy error handling answers as before. Tokens flow in lockstep with the caller. Access, limits, key choice, the spend reservation, knowledge and logging stay in the legacy pipeline.

Qualifying: `app_type` prompt, no tools, no output contract, no images, not custom or private, provider Claude, OpenAI or Gemini, temperature at most 1, system prompt within 20,000 characters. Anything else keeps the legacy call. `AEX_NATIVE_TYPES` combines with `AEX_APP_TYPES`: with both on, a run has an outer `legacy.app` record and an inner native `chat` record.

Parity: `check_platform_native_prompt.py`, 14 cases, legacy vs native, with status, body, provider call, written rows (run log included) and a native run record per eligible case. Report: [native-prompt-parity-report.md](native-prompt-parity-report.md). Changing the system prompt by one space makes 10 checks fail. In 23 runs of the check, one run had a single failure that didn't recur and wasn't captured.

On staging, 2026-10-28: `venv/Scripts/python scripts/verify_native_prompt_staging.py --email <staging user>` ran three real prompt apps with only `AEX_NATIVE_TYPES=prompt` on, with the user's own Claude key. Setup is the same as the phase 2 staging check (in-process endpoints, local sign-in stand-in). **8 passed, 0 failed.**

| App | Model | Result |
| --- | --- | --- |
| Support Reply Drafter | claude-haiku-5-5 | Streamed reply. One native run, `llm.chat` succeeded on that model. Public API (`stream: false`) also native and succeeded. |
| Meeting Notes Summarizer | claude-sonnet-5-5 | Streamed summary; native run succeeded on that model |
| QA Build Verification | claude-haiku-4-5-20251001 | Streamed QA summary; native run succeeded on that model |
| Support Reply Drafter, flag off | claude-haiku-5-5 | Legacy call, no native record. Same event kinds and same final provider/model metadata as native. |

Found by this run and fixed: AEX run records always stored `workload = "run"` in the database column. Native runs said "chat" only inside the record, so they couldn't be told apart by query. The native parity check now checks the column too.

Found while building it:
- The app parity check had run as the app owner, whose runs aren't logged, so it never compared the run log. It now runs as an end user and requires the log on the legacy side.
- That revealed a real adapter bug: a contract failure was logged as "cancelled", because the legacy pipeline sends `contract_error` before logging. Fixed.
- The comparison itself was flaky, because the test client ran each request on a throwaway event loop that dropped background log deliveries. Both checks now use one persistent client and match rows to each run by app id.

Still legacy in phase 2: the step logic itself (`run_flow_step`, `_execute_run_legacy`). Moving app types to native nodes (llm.chat, llm.structured) is the next step per type, each with its own parity report.

## Not done or not verified

- Production Supabase has neither migration.
- The HTTP layer on staging (JWT or API-key auth, SSE through a deployed server) was exercised only in the local check script; the staging script calls the engine in-process.
- No real outside ERP or code-worker call has been made. Hosted `code.python` needs `CODE_APPS_ENABLED=1` and running workers.
- No Studio UI for platform resources; that waits for your design.
- Not built yet: Workflow kind on AEX and the legacy adapters (phase 2), TypeScript SDK, agents, knowledge bases, MCP hosting, app hosting, model operations.
- Concurrency, load, tenant isolation on hosted infrastructure and backup/restore are untested.
- Durable orchestration is the platform's own engine. The Temporal comparison (decision record 002) hasn't been done.
- Correction to the proposal: `outbound.fetch_safely` already connects to the checked IP address, so connection-time DNS rebinding is handled. WP-09 is done, not open.
