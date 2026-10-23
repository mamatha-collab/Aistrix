# Design: typed connections between apps (step 1)

Status: phases 1–2 and the designer built (2026-10-22). Adapter step (phase 3) not built yet.

Built so far:
- One engine (`run_flow`, `run_flow_step` in main.py) for schedules, webhooks and Dev Studio tests. It covers published vs draft steps, field wiring (`input_map`) and approval pause/resume.
- `flow_runs` keeps one row per run, with each step's record inside it, rather than a row per step.
- Endpoints: `POST /v1/flows/{id}/runs`, `GET /v1/flows/{id}/runs/{run_id}`, `POST …/resume` and `GET /v1/apps/{id}/schema?version=`.
- Developer workflows are `flows` rows with `kind = 'developer'` and a `trigger` column (migration 20261022010000).
- Dev Studio → Workflows has Design (step cards, settings panel, input mapping), Test (sample input, step results, approve/reject) and Deploy (release checks, webhook link).
- The compatibility check runs in the browser (`src/workflows/workflowModel.js`); the server checks every step's input again at run time.

## 1. Problem

Apps chained in a workflow often can't use each other's output. App A returns free text or JSON with its own field names, and App B expects different fields. Today the mismatch goes unnoticed until a run produces poor results.

**Goal:** a builder can see before running whether two apps fit. They can wire fields together, let an AI step reshape data when no direct wiring exists, and trust that every step receives input in the shape it declared.

**Out of scope:** the visual node canvas (step 4), branching and loops, new external connectors and agent upgrades (step 3). This design is their foundation; it doesn't build them.

## 2. What exists today (from the code)

| Piece | Where | Relevance |
|---|---|---|
| Input/output schemas on apps | blueprint `input_schema.fields` / `output_schema.fields` (or `output_contract.fields`), read by `_schema_fields` (main.py ~1828) | The types we connect. Fields carry `field`, `type`, `required`, `enum_values`, `nested_fields`, `description`. |
| Schema validator | `_validate_schema_value` (~1839) | Reused for wiring checks and adapter output. |
| Structured output with one repair retry | `execute_run` (~2328) | The adapter uses the same pattern. |
| Field-based input | `_validated_fields_input` (~2581), API apps' `fields` | How a step receives mapped fields. |
| Flow definition | `flows.steps` jsonb: `{app_id, app_name, step_fields?}`, `step_type: 'api_call'`, `step_type: 'human_approval'` | Gets new optional keys (§4). |
| Interactive runner | `FlowRunner.jsx`, runs in the browser step by step, including approval/edit | Must apply the same mapping. |
| Scheduled runner | `run_scheduled_workspace` (~3901), server side, passes `current_input = full` text | Must apply the same mapping. |
| Agent "app" tool | `execute_tool` `tool_type == "app"` (~1237) | Same contract problem when an agent calls an app. |

### Existing defects this work should fix along the way

1. **Scheduled runs crash on API and approval steps.** `run_scheduled_workspace` reads `step["app_id"]` for every step. API-call and approval steps have no `app_id`, so a scheduled flow containing one fails.
2. **The two runners behave differently.** The scheduled runner calls `run_text` with the app's raw system prompt. It skips tools, knowledge, output contracts and the published (live) version that `execute_run` applies. The same flow gives different results on a schedule than by hand.
3. **The agent "app" tool** also uses the raw (draft) `system_prompt` and ignores the target's output contract. It only passes the caller's key when both apps use the same provider. The fallback when the providers differ needs checking against the BYOK rule.

## 3. Decisions needed from you before building

| # | Question | Options | My recommendation |
|---|---|---|---|
| D1 | Where do workflows live? | **Decided (2026-10-20):** building workflows is a Developer feature. Business only uses (runs) workflows that developers built. | The builder, wiring and checks are developer screens. Business gets the run view only, when Business is built. The engine is shared. |
| D2 | Which screens show connections and mapping, and where? | **Decided (2026-10-20):** a **Workflows** tab in Dev Studio after Deploy (Design → Test → Deploy → Workflows). | Layout inside the tab is still yours. |
| D6 | Which version of an app does a step use? | **Decided (2026-10-20):** each step picks one: **Published · vN** (uses that fixed release) or **Draft · unpublished changes** (uses the editable configuration, for authorized testing only). | See §4a for the rules. |
| D3 | Can an app with no declared schema join a typed flow? | a) Yes, as "text" (works like today) · b) No | **a.** Old flows keep working. |
| D4 | Adapter model and key | a) Flow owner's key, small model of the same provider · b) Developer chooses | **a, with an override.** It follows BYOK. |
| D5 | When an adapter can't produce valid data after one retry | a) Stop the run · b) Pause for a human edit (reuse the approval/edit step) | **b when a person is running it; a for scheduled runs.** |

## 4. Data model

No new tables for connections; `flows.steps` items gain optional keys, so old flows stay valid.

```jsonc
{
  "id": "s2",                         // stable step id (new); old flows get ids on load
  "app_id": "…",
  "app_name": "Invoice reader",
  "version": "published",            // "published" | "draft"  (D6)
  "pinned_version": 7,                // the release a published step uses; wiring is checked against it
  "input_map": {                      // target field → where its value comes from
    "email":    { "from": "s1.customer.email" },
    "amount":   { "from": "s1.total", "transform": "to_number" },
    "currency": { "value": "USD" },
    "notes":    { "from": "trigger.text" }
  },
  "on_mismatch": "adapter"            // "adapter" | "stop" | "ask"  (D5)
}
```

- **Sources:** `trigger.*` (the flow's start input: seed input, webhook body, form), `<stepId>.<path>` (an earlier step's output), or `value` (a constant).
- **Transforms (fixed list, no code):** `to_text`, `to_number`, `to_boolean`, `to_date`, `join_lines`, `first_item`, `json`. Arbitrary code is not allowed.
- **Adapter step:** a new `step_type: "adapter"` with `{ "target_step": "s3", "instructions": "optional hint" }`. The builder inserts it, but it's a normal step the developer can see and delete.
- **Text steps:** steps with no `input_map` behave exactly as today (the previous output is passed as text).
- **One small migration:** `flow_runs` stores structured step outputs so later steps and the run view can read fields: `{flow_id, run_id, step_id, output_json, output_text, status, error}`. Today only `run_history` text is kept.

## 4a. Published vs draft steps (D6)

| | Published · vN | Draft · unpublished changes |
|---|---|---|
| Runs | That fixed release (`app_versions` snapshot). It doesn't change when the app's draft is edited. | The app's current editable configuration |
| Who can run it | Anyone allowed to run the workflow | Only people who can edit that app (owner or staff), i.e. authorized testing |
| Wiring checked against | The pinned release's schemas | The draft's schemas, rechecked on every run |
| Scheduled, webhook, API and Business runs | Allowed | Refused: draft steps never run unattended or for other users |
| Publishing the workflow | Allowed | Blocked until every step uses a published release |
| New release of the app | The step stays on vN. The builder offers "move to vN+1", and the wiring is rechecked first. | Not applicable |

The run log records which version each step used.

## 5. Compatibility check (design time)

A pure function in a shared module, with the same rules in the backend (Python) and frontend (JS). Both sides are tested against one fixture file.

`check_connection(source_fields, target_fields, input_map)` returns, per target field:

| Result | Meaning |
|---|---|
| `ok` | Mapped, same type |
| `coerced` | Mapped, safe conversion (number → text, enum → text) |
| `lossy` | Mapped, may fail at run time (text → number, text → date); shown as a warning |
| `missing` | Required and not mapped. Blocks saving unless `on_mismatch` is `adapter` or `ask` |
| `unknown` | Source app has no schema (text). Allowed (D3) and flagged |

**Auto-mapping suggestion:** exact name match first, then case- and underscore-insensitive match plus a type check. Nothing is auto-saved; the developer confirms.

**Schema drift:** when a referenced app publishes a new version whose schema breaks the saved wiring, the flow is flagged ("needs review") rather than failing silently. The check runs on publish of the source app (it finds flows that pin the app) and on flow open.

## 6. Run time (one engine)

A single server function, `run_flow_step(flow, step, context)`, used by both the scheduled runner and a new `POST /v1/flows/{id}/runs` endpoint. FlowRunner calls that endpoint step by step, so approval/edit pauses still happen in the browser.

For each step:

1. **Build the input.** Resolve `input_map` against the trigger and earlier outputs, apply transforms, validate with `_validate_schema_value` against the step's `input_schema`. Text steps get the previous output as today.
2. **Run the app through `execute_run`'s path** (live version, tools, knowledge, output contract, BYOK, limits, run log), not `run_text`. This fixes defects 1 and 2.
3. **Store the output** as JSON when the app has an output contract, and as text otherwise.
4. **Handle a validation failure** according to `on_mismatch`: the adapter, a pause for a human edit, or a stop with a clear message naming the step and field.

**Adapter step:**
- A small model of the flow owner's provider gets the source output and the target's `input_schema`, described with `_describe_fields`, under an `<output_contract>`.
- Validation and one repair retry use the existing pattern.
- Output tokens are capped, and the adapter is logged in the run like any step, with its cost.
- It never sees secrets and has no tools.

**Agent "app" tool (defect 3):** route it through the same function, so an agent calling an app gets the live version and contract checks. If the target declares an `input_schema`, the tool definition shown to the agent exposes those fields instead of a single `input` string.

## 7. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/flows/{id}/check` | Compatibility report for the saved or unsaved steps (no AI cost) |
| POST | `/v1/flows/{id}/runs` | Start a run (or run the next step when interactive); returns `run_id` |
| GET | `/v1/flows/{id}/runs/{run_id}` | Step statuses and outputs |
| POST | `/v1/flows/{id}/runs/{run_id}/steps/{step_id}/resume` | Continue after a human edit or approval |

Auth, ownership checks and fault isolation follow the existing patterns. Errors use codes such as `FLOW_WIRING_INVALID` and `ADAPTER_FAILED`.

## 8. Screens (content only; placement is yours, see D2)

What a builder needs to see, without prescribing layout:
- Per connection: the status from §5 (ok / warning / missing).
- For a selected step: its input fields, the source of each, and transform options.
- An "add adapter" action where fields are missing.
- A "needs review" state after schema drift.
- In a run view: each step's input and output, as fields when structured.

I'll ask you for a layout before writing any of this UI.

## 9. Tests

- **Backend:** a `check_connections.py` suite covering:
  - the compatibility matrix
  - transforms
  - mapping resolution
  - adapter success, repair and failure
  - a scheduled flow with API and approval steps (defect 1)
  - parity between the scheduled and interactive paths (defect 2)
  - the app tool using the live version and contract (defect 3)
  - BYOK on adapters
- **Frontend:** unit tests for the shared check function (same fixtures as the backend) and the FlowRunner mapping. Add one e2e test of a two-app flow wired by fields, once D2 is decided.
- **Published vs draft:** a published step ignores later draft edits; a draft step is refused for non-editors, schedules, webhooks and API; a workflow with a draft step can't be published.
- **Old flows:** existing flows load, run and save unchanged.

## 10. Rollout and effort

| Phase | Content | Effort |
|---|---|---|
| 1 | One engine: `run_flow_step`, scheduled runner on `execute_run`, fixes for defects 1–3, `flow_runs` migration | ~1 week |
| 2 | `input_map`, transforms, compatibility check and `/check` endpoint, schema drift flag | ~1 week |
| 3 | Adapter step and `on_mismatch` handling | ~3–4 days |
| 4 | Screens per your layout, e2e | ~1 week after the layout is decided |

**Running cost:** none beyond adapter calls, which run on the flow owner's own key, plus one small table.

**Risks:**
- Phase 1 changes how scheduled flows run (they now use tools, knowledge and the live version), so outputs may differ from before. This is intended, but it should be noted in release notes.
- Adapter quality on large nested outputs. This is mitigated by validation and the human-edit fallback.
