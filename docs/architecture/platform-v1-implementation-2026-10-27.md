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

## Not done or not verified

- The migration has not been applied to staging or production Supabase, and its SQL has not been executed anywhere: there is no local Postgres. The Supabase store is tested against a fake query builder only.
- No real model, ERP or code-worker call has been made. Hosted `code.python` needs `CODE_APPS_ENABLED=1` and running workers.
- No Studio UI for platform resources; that waits for your design.
- Not built yet: Workflow kind on AEX and the legacy adapters (phase 2), TypeScript SDK, agents, knowledge bases, MCP hosting, app hosting, model operations.
- Concurrency, load, tenant isolation on hosted infrastructure and backup/restore are untested.
- Durable orchestration is the platform's own engine. The Temporal comparison (decision record 002) hasn't been done.
- Correction to the proposal: `outbound.fetch_safely` already connects to the checked IP address, so connection-time DNS rebinding is handled. WP-09 is done, not open.
