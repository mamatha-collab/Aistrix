"""Workflow compiler: checks a workflow definition before anything runs and
gives each runnable definition a stable plan id. Pure functions, no I/O.

The caller resolves each app step's release first (main.py) and passes its
contract here. A step whose release can't be resolved is compiled without
type checks; the run reports the release problem at that step, as before.
"""
import hashlib
import json
from typing import Any, Optional

FLOW_SCHEMA_VERSION = 1
SUPPORTED_SCHEMA_VERSIONS = (1,)
STEP_TYPES = ("app", "api_call", "human_approval")
MAX_STEPS = 50
TRANSFORMS = ("to_text", "to_number", "to_boolean", "json")
CONDITION_OPS = ("equals", "not_equals", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty")
PRIVACY_MODES = ("standard", "private_only")

# Field types grouped by the kind of value they carry at run time.
_KIND = {"string": "text", "enum": "text", "date": "text", "number": "number", "boolean": "boolean",
         "string_array": "list", "number_array": "list", "array": "list", "object": "object"}
_TRANSFORM_KIND = {"to_text": "text", "to_number": "number", "to_boolean": "boolean", "json": None}


def step_type(step: dict) -> str:
    return step.get("step_type") or "app"


def _field_name(field: dict) -> Optional[str]:
    return field.get("field") or field.get("name")


def _source_kind(ref: str, steps_before: dict, trigger_fields: dict) -> Optional[str]:
    """The kind of value a wire reads, when the definition says; else None."""
    head, _, rest = ref.partition(".")
    path = [p for p in rest.split(".") if p]
    if path == ["text"]:
        return "text"
    if len(path) != 1:
        return None                         # nested paths aren't typed by the schema
    if head == "trigger":
        return _KIND.get(trigger_fields.get(path[0]) or "")
    contract = steps_before.get(head)
    if not contract or not contract.get("output", {}).get("structured"):
        return None
    for field in contract["output"].get("fields") or []:
        if _field_name(field) == path[0]:
            return _KIND.get(field.get("type") or "string")
    return None


def _undeclared_output(ref: str, steps_before: dict) -> bool:
    """A wire to a structured step's output field that the release doesn't have."""
    head, _, rest = ref.partition(".")
    path = [p for p in rest.split(".") if p]
    contract = steps_before.get(head)
    if not path or path[0] == "text" or not contract or not contract.get("output", {}).get("structured"):
        return False
    return path[0] not in {_field_name(f) for f in contract["output"].get("fields") or []}


def _reference_problem(ref: Any, idx: int, ids: list, label: str) -> Optional[str]:
    if not isinstance(ref, str) or "." not in ref:
        return f"{label} must name a source like trigger.field or <step id>.field"
    head = ref.partition(".")[0]
    if head == "trigger":
        return None
    if head in ids[:idx]:
        return None
    if head in ids[idx:]:
        return f"{label} reads from a later step ({head}); steps can only use earlier results"
    return f"{label} reads from a step that doesn't exist ({head})"


def compile_flow(flow: dict, contracts: dict[int, Optional[dict]]) -> tuple[Optional[dict], list[dict]]:
    """(plan, problems). problems: [{"step": index | None, "text": ...}].
    A plan is returned only when there are no problems."""
    problems: list[dict] = []

    def problem(step: Optional[int], text: str) -> None:
        problems.append({"step": step, "text": text})

    version = flow.get("schema_version", FLOW_SCHEMA_VERSION)
    if version not in SUPPORTED_SCHEMA_VERSIONS:
        problem(None, f"uses workflow format version {version}, which this server can't run")
        return None, problems
    if (flow.get("privacy") or "standard") not in PRIVACY_MODES:
        problem(None, f"has an unknown privacy setting: {flow.get('privacy')}")
    steps = flow.get("steps")
    if not isinstance(steps, list) or not steps:
        problem(None, "has no steps")
        return None, problems
    if len(steps) > MAX_STEPS:
        problem(None, f"has more than {MAX_STEPS} steps")
        return None, problems
    if any(not isinstance(s, dict) for s in steps):
        problem(None, "has a step that isn't a step definition")
        return None, problems

    ids = [s.get("id") for s in steps]
    seen: set = set()
    for i, sid in enumerate(ids):
        if sid is None:
            continue
        if not isinstance(sid, str) or not sid or sid == "trigger" or "." in sid:
            problem(i, "has an invalid step id")
        elif sid in seen:
            problem(i, f'reuses the step id "{sid}"')
        seen.add(sid)

    trigger = flow.get("trigger") if isinstance(flow.get("trigger"), dict) else {}
    trigger_fields = {_field_name(f): f.get("type") or "string" for f in trigger.get("fields") or []
                      if isinstance(f, dict) and _field_name(f)}
    steps_before: dict[str, Optional[dict]] = {}
    for i, step in enumerate(steps):
        kind = step_type(step)
        if kind not in STEP_TYPES:
            problem(i, f"has an unknown step type: {kind}")
        elif kind == "app" and not step.get("app_id"):
            problem(i, "needs an app")
        cond = step.get("run_if")
        if isinstance(cond, dict) and cond.get("from"):
            ref_problem = _reference_problem(cond["from"], i, ids, 'Its "run only if" check')
            if ref_problem:
                problem(i, ref_problem)
            if (cond.get("op") or "equals") not in CONDITION_OPS:
                problem(i, f'uses an unknown "run only if" comparison: {cond.get("op")}')
        input_map = step.get("input_map")
        if input_map is not None and not isinstance(input_map, dict):
            problem(i, "has wiring that isn't a field map")
            input_map = {}
        contract = contracts.get(i)
        input_fields = {(_field_name(f)): f for f in (contract or {}).get("input", {}).get("fields") or []
                        if isinstance(f, dict) and _field_name(f)}
        for target, spec in (input_map or {}).items():
            label = f'Input "{target}"'
            if not isinstance(spec, dict):
                problem(i, f"{label} has wiring that isn't valid")
                continue
            transform = spec.get("transform")
            if transform and transform not in TRANSFORMS:
                problem(i, f"{label} uses an unknown conversion: {transform}")
                continue
            if "value" in spec:
                continue
            ref_problem = _reference_problem(spec.get("from"), i, ids, label)
            if ref_problem:
                problem(i, ref_problem)
                continue
            if _undeclared_output(spec["from"], steps_before):
                problem(i, f"{label} reads {spec['from']}, which that step's release doesn't produce")
                continue
            target_field = input_fields.get(target)
            if not target_field:
                continue
            have = _TRANSFORM_KIND[transform] if transform else _source_kind(spec["from"], steps_before, trigger_fields)
            want = _KIND.get(target_field.get("type") or "string")
            if have and want and have != want:
                problem(i, f"{label} expects {target_field.get('type') or 'string'} but gets {have}; add a conversion")
        # An empty map means the step takes the previous output as text.
        if contract and input_map and not step.get("ai_fill"):
            for name, field in input_fields.items():
                if field.get("required") is not False and name not in (input_map or {}):
                    problem(i, f'Input "{name}" is required but isn\'t connected')
        if step.get("id"):
            steps_before[step["id"]] = contract

    if problems:
        return None, problems
    return build_plan(flow, contracts), []


def build_plan(flow: dict, contracts: dict[int, Optional[dict]]) -> dict:
    """The executable plan. Its id depends only on what runs: the steps'
    configuration, the releases they're pinned to and those releases'
    contracts — not names, timestamps or who saved it."""
    from tool_contracts import contract_hash
    executable = {
        "schema_version": flow.get("schema_version", FLOW_SCHEMA_VERSION),
        "kind": flow.get("kind"),
        "privacy": flow.get("privacy") or "standard",
        "trigger": flow.get("trigger"),
        "steps": [{k: v for k, v in step.items() if k not in ("app_name", "app_emoji", "name", "label")}
                  for step in flow.get("steps") or []],
        "contracts": {str(i): contract_hash(c) for i, c in sorted(contracts.items()) if c},
    }
    digest = hashlib.sha256(json.dumps(executable, sort_keys=True, default=str).encode()).hexdigest()
    return {"id": f"plan_{digest[:24]}", "schema_version": executable["schema_version"],
            "contracts": executable["contracts"]}
