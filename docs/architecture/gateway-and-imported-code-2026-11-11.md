# Model gateway API and imported working code (November 11, 2026)

This note covers three backend pieces that let code built with existing SDKs and frameworks run on Aistrix:
- an OpenAI- and Anthropic-compatible model gateway
- importing code from GitHub
- dependencies, outbound hosts and model access for code jobs

No UI was added; the endpoints below are ready for screens.

## 1. OpenAI/Anthropic-compatible gateway

Code that uses the official SDKs, or a framework built on them (LangGraph, CrewAI, the OpenAI Agents SDK, LlamaIndex and others), changes only its base URL and key:

```python
from openai import OpenAI
client = OpenAI(base_url="https://<aistrix-api>/v1/gateway/openai", api_key="ak_live_…")

from anthropic import Anthropic
client = Anthropic(base_url="https://<aistrix-api>/v1/gateway/anthropic", api_key="ak_live_…")
```

| Endpoint | Purpose |
|---|---|
| `POST /v1/gateway/openai/chat/completions` | Chat Completions: text, tools and tool results, streaming (`stream_options.include_usage` supported) |
| `GET /v1/gateway/openai/models` | Models and policies the gateway offers |
| `POST /v1/gateway/anthropic/v1/messages` | Messages API: text, `tool_use` / `tool_result`, streaming events |
| `GET /v1/gateway/calls?trace=…` | The caller's call log and its total cost |

**Models.** Accepted forms:
- `claude/…`, `openai/…`, `gemini/…`
- `policy:fast`, `policy:balanced`, `policy:best`
- a bare id whose provider is clear from its name, such as `gpt-4o` or `claude-sonnet-5-5`

**Keys and spend.** Calls use the developer's stored provider keys, so no provider key is in their code. Each call goes through the same reservation and settlement as AEX runs, so workspace and key spending caps apply.

**Errors** come back in each SDK's own error types:
- invalid key: authentication error
- app-restricted key: permission error
- spending limit: rate-limit error
- missing provider key, unknown model or non-text content: bad request

**Call log** (`gateway_calls`, migration `20261111010000_gateway_calls.sql`):
- **Recorded:** surface, provider, model, tokens, cost, tool-call count, streaming flag, status, error code and latency.
- **Never recorded:** prompts, answers or tool arguments.
- **Traces:** an optional `X-Aistrix-Trace` header groups the calls of one agent run.

**Not supported:** images and other non-text input, `n > 1`, and logprobs. Text streams token by token; tool calls arrive whole at the end of a stream, which the SDKs accept.

The same streaming path now also streams native Agent text as `node.token` events.

## 2. Importing working code from GitHub

`POST /v1/apps/{app_id}/code/import`, body `{repo, ref?, path?}`.
- `repo` may be `owner/repo`, a `github.com` link, or a `/tree/<branch>/<folder>` link.
- Only the code app's owner can import.
- Public repositories need nothing. Private ones use the owner's existing GitHub connection, whose token stays on the server.

What gets imported:
- The archive is fetched through the outbound rules (`api.github.com`, `codeload.github.com` only) and is never executed by the API.
- Accepted source files (`.py .txt .json .toml .md`) are kept. Tooling folders and hidden files are dropped. Every other file is listed under `import.skipped` with the reason.
- `aistrix.json` in the imported folder sets the manifest, such as the entrypoint `module:function` (default `main:run`).
- The code must fit the runtime contract: 32 files and 512 KiB. Larger repositories are asked to import the folder that holds the job.
- The result is a new source version. Nothing builds or runs until the developer builds it.

The response includes the commit (from GitHub's archive folder name), the imported files, the skipped files, the manifest and the requirements.

ZIP upload (`PUT …/code/source` with `application/zip`) already existed and is unchanged.

## 3. Dependencies, outbound hosts and model calls

Code jobs (E2B runtime) gain three settings. Existing sources keep their exact hashes.

| In the source | Server switch | What happens |
|---|---|---|
| Pinned `requirements.txt` (`name==version --hash=sha256:…`, already required by the contract) | `E2B_DEPENDENCY_TEMPLATES=1` | On the first build, an E2B template is built from the base template with `pip install --only-binary=:all: --require-hashes`. It is named after the exact requirement set and reused by every later build with the same set. The build artifact pins that template. |
| `"network": {"allow": ["api.example.com", "*.example.org"]}` in `aistrix.json` | `E2B_EGRESS=1` | Runs get outbound access to those hostnames only (`allow_out`, everything else denied). IP addresses are refused. Builds never get network access. The sandbox must confirm the allow-list or the job is refused. |
| `"models": true` | `GATEWAY_PUBLIC_URL` (https) plus `SECRET_ENCRYPTION_KEY` | See below. |

How `"models": true` works:
- The job gets `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and the matching `*_API_KEY`, set to a **run token** (`ak_run_…`). The gateway host is added to its allow-list.
- The token acts for the job's owner and logs under `code-task:<task id>`.
- It stops at a $0.50 model budget per run and expires with the sandbox.
- It cannot read the call log.
- The variables are set after the privilege drop, inside the job process only; the sandbox's own environment stays empty.

The dedicated Docker worker refuses sources that ask for network or models: these capabilities exist on E2B only.

A LangGraph or CrewAI job therefore deploys as a code app with:
- its pinned requirements
- `"models": true`
- the API hosts its tools call

It then runs with Aistrix keys, budgets and a call trace, with no code changes beyond reading the standard environment variables.

## Verification

All of the following use fakes; no real provider, GitHub or E2B calls were made.

- **`tests/checks/check_model_gateway.py`, 33 checks.** These drive the app with the **real `openai` (2.44) and `anthropic` (0.111) Python SDKs**, faking only the upstream providers, Supabase and spend controls. They cover:
  - text, tools and tool results, streaming in both formats, and model routing
  - each refusal, in each SDK's error types
  - the call log contents, ownership and privacy
  - run tokens: owner and trace, budget stop, expiry, forged tokens, no log access
- **`tests/test_code_import.py`, 24 tests.** Link parsing, file selection, skipped-file reasons, limits, the manifest and entrypoint hint, the public and private access paths, GitHub errors, ownership, and that nothing is queued on import.
- **`tests/test_e2b_capabilities.py`, 16 tests.** Capability gates; dependency templates built once and reused, with no network during builds; failures reported without provider output; allow-lists confirmed; the gateway environment and token; https only.
- **Source hashes** were checked to be identical to the previous contract for existing manifests.

**Not yet verified for real:**
- A real E2B dependency-template build and an egress-limited run. These cost E2B build time on your account.
- Model calls from a sandbox. The gateway must be reachable from E2B over HTTPS, and the backend isn't hosted yet, so this needs a deployed API or a tunnel.

Production configuration and databases were not changed. Migration `20261111010000_gateway_calls.sql` is not applied to staging yet.
