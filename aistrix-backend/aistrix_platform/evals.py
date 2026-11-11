"""Eval suites: run an Application release on test cases and score the
outputs. Eval runs are real runs (real models, so real cost) with every
outside effect replaced by the suite's mocks; a suite that leaves a write
unmocked is refused before anything runs."""
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from . import spec
from .errors import InputError
from .orchestrator import Engine
from .registry import Registry


class EvalRefused(ValueError):
    pass


def _get(value: Any, path: Optional[str]) -> Any:
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def check(output: Any, rule: dict) -> Optional[str]:
    """None when the rule holds, else what went wrong."""
    value = _get(output, rule.get("path"))
    where = rule.get("path") or "output"
    kind = rule["type"]
    if kind == "equals":
        return None if value == rule["value"] else f"{where} is {value!r}, expected {rule['value']!r}"
    if kind == "contains":
        if isinstance(value, str) and isinstance(rule["value"], str) and rule["value"].lower() in value.lower():
            return None
        if isinstance(value, list) and rule["value"] in value:
            return None
        return f"{where} doesn't contain {rule['value']!r}"
    if kind == "not_empty":
        return None if value not in (None, "", [], {}) else f"{where} is empty"
    if kind == "number_close":
        if isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value - rule["value"]) <= rule["tolerance"]:
            return None
        return f"{where} is {value!r}, expected {rule['value']} ± {rule['tolerance']}"
    if kind == "json_schema":
        problems = spec.validate_value(rule["schema"], value)
        return None if not problems else f"{where}: {problems[0].message}"
    return f"Unknown check {kind}"


async def run_suite(engine: Engine, registry: Registry, suite_release: dict, *, owner_id: str,
                    workspace_id: Optional[str]) -> dict:
    suite = suite_release["spec"]
    target = spec.parse_ref(suite["spec"]["target"]["ref"])
    app = await registry.store.find_release(target.key, target.version, owner_id)
    if not app:
        raise EvalRefused(f"{target} isn't released")
    workload = suite["spec"]["target"]["workload"]
    plan = (app.get("plans") or {}).get(workload)
    if not plan:
        raise EvalRefused(f"{target} has no workload named {workload!r}")
    mocks = suite["spec"].get("mocks") or {}
    unmocked = [nid for nid, n in plan["nodes"].items() if n["sideEffect"] and nid not in mocks]
    # An agent's write tools are mocked by tool name.
    unmocked += [name for name in plan.get("writeTools") or [] if name not in mocks]
    if unmocked:
        raise EvalRefused("Eval runs can't reach outside services. Add mocks for: " + ", ".join(unmocked))
    cases = list(suite["spec"].get("cases") or [])
    if suite["spec"].get("dataset"):
        ds = spec.parse_ref(suite["spec"]["dataset"])
        dataset = await registry.store.find_release(ds.key, ds.version, owner_id)
        if not dataset:
            raise EvalRefused(f"{ds} isn't released")
        for i, row in enumerate(dataset["spec"]["spec"]["rows"]):
            if not isinstance(row, dict) or "input" not in row:
                raise EvalRefused(f"Dataset row {i} needs an input field to be used as an eval case")
            cases.append({"name": row.get("name") or f"row {i + 1}", "input": row["input"], "expect": row.get("expect") or []})
    shared = suite["spec"].get("checks") or []
    results, cost = [], 0.0
    for case in cases:
        rules = (case.get("expect") or []) + shared
        try:
            started = await engine.start(plan, case["input"], owner_id=owner_id, workspace_id=workspace_id,
                                         release_id=app["id"], environment=None, trigger="eval", mocks=mocks,
                                         auto_approval=suite["spec"].get("approvals", "approve"))
        except InputError as e:
            results.append({"name": case["name"], "passed": False, "failures": [f"Input refused: {e}"], "run_id": None})
            continue
        finished = await engine.execute(started["id"])
        cost += finished["cost_usd"]
        if finished["status"] != "succeeded":
            failures = [f"Run {finished['status']}: {finished['error']}"]
        else:
            failures = [f for f in (check(finished["output"], r) for r in rules) if f]
        results.append({"name": case["name"], "passed": not failures, "failures": failures,
                        "run_id": finished["id"], "cost_usd": finished["cost_usd"]})
    passed = sum(r["passed"] for r in results)
    rate = passed / len(results) if results else 0.0
    required = suite["spec"].get("requiredPassRate", 1.0)
    row = {"id": str(uuid.uuid4()), "owner_id": owner_id, "release_id": app["id"],
           "suite": f"{suite_release['resource_key']}@{suite_release['version']}", "suite_release_id": suite_release["id"],
           "passed": bool(results) and rate >= required, "pass_rate": rate, "required": required,
           "cases": results, "cost_usd": round(cost, 6),
           "created_at": datetime.fromtimestamp(time.time(), timezone.utc).isoformat()}
    return await registry.store.put_eval_result(row)
