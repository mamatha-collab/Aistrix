"""Registry, releases, environments, eval suites and the production gate,
on the in-memory store with a fake model. No network, no database."""
import asyncio
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aistrix_platform import evals, spec
from aistrix_platform.errors import Conflict
from aistrix_platform.registry import GateRefused, Registry
from aistrix_platform.spec import SpecError

from test_platform_runtime import FakeErp, FakeModel, engine

EXAMPLES = Path(__file__).resolve().parents[2] / "examples" / "invoice-pipeline"
OWNER = "00000000-0000-0000-0000-00000000a001"


def load(name):
    return spec.parse_text((EXAMPLES / name).read_text(encoding="utf-8"))


def answers_for_suite():
    small = {"vendor": "ACME GmbH", "total": 120.0, "currency": "EUR", "needs_review": False}
    large = {"vendor": "Bolt Ltd", "total": 54000.0, "currency": "GBP", "needs_review": True}
    return json.dumps(small), json.dumps(large)


def setup(model=None, erp=None):
    e = engine(model or FakeModel(*answers_for_suite()), erp or FakeErp())
    return e, Registry(e.store)


def run(coro):
    return asyncio.run(coro)


def test_release_snapshots_spec_and_plan_and_cant_change():
    e, reg = setup()

    async def go():
        rel = await reg.release(load("aistrix.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        assert rel["version"] == "1.0.0" and rel["plans"]["extract"]["order"][0] == "read"
        assert rel["content_hash"] == spec.content_hash(load("aistrix.yaml"))
        again = await reg.release(load("aistrix.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        assert again["id"] == rel["id"]                     # same content: same release
        changed = load("aistrix.yaml")
        changed["metadata"]["description"] = "edited"
        with pytest.raises(Conflict):
            await reg.release(changed, owner_id=OWNER, workspace_id=None, by=OWNER)
        resource = await e.store.get_resource("Application/acme/invoice-extractor", OWNER)
        assert resource["latest_version"] == "1.0.0"

    run(go())


def test_invalid_specs_and_missing_dependencies_are_refused():
    _, reg = setup()
    doc = load("aistrix.yaml")
    doc["spec"]["workloads"][0]["edges"].append(["post", "fields"])
    with pytest.raises(SpecError) as err:
        run(reg.release(doc, owner_id=OWNER, workspace_id=None, by=OWNER))
    assert "cycle" in str(err.value)
    doc = load("aistrix.yaml")
    doc["dependencies"] = ["Dataset/acme/missing@1"]
    with pytest.raises(SpecError) as err:
        run(reg.release(doc, owner_id=OWNER, workspace_id=None, by=OWNER))
    assert "isn't released yet" in str(err.value)


def test_production_needs_a_passing_eval_on_that_release_then_rollback_works():
    e, reg = setup()

    async def go():
        app = await reg.release(load("aistrix.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        suite = await reg.release(load("eval-suite.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        await reg.promote(app["resource_key"], "1.0.0", "staging", owner_id=OWNER, by=OWNER)
        with pytest.raises(GateRefused) as gate:
            await reg.promote(app["resource_key"], "1.0.0", "production", owner_id=OWNER, by=OWNER)
        assert "hasn't been run" in str(gate.value)
        result = await evals.run_suite(e, reg, suite, owner_id=OWNER, workspace_id=None)
        assert result["passed"], result["cases"]
        assert result["pass_rate"] == 1.0 and len(result["cases"]) == 2
        prod = await reg.promote(app["resource_key"], "1.0.0", "production", owner_id=OWNER, by=OWNER)
        assert prod["release_id"] == app["id"]

        v2 = load("aistrix.yaml")
        v2["metadata"]["version"] = "1.1.0"
        v2["tests"] = []
        app2 = await reg.release(v2, owner_id=OWNER, workspace_id=None, by=OWNER)
        moved = await reg.promote(app["resource_key"], "1.1.0", "production", owner_id=OWNER, by=OWNER)
        assert moved["release_id"] == app2["id"] and moved["history"][0]["version"] == "1.0.0"
        back = await reg.rollback(app["resource_key"], "production", owner_id=OWNER, by=OWNER)
        assert back["release_id"] == app["id"] and back["history"] == []
        assert (await reg.resolve(app["resource_key"], "production", owner_id=OWNER))["version"] == "1.0.0"
        with pytest.raises(Conflict):
            await reg.rollback(app["resource_key"], "production", owner_id=OWNER, by=OWNER)

    run(go())


def test_eval_runs_never_reach_outside_services():
    erp = FakeErp()
    e, reg = setup(erp=erp)

    async def go():
        await reg.release(load("aistrix.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        suite = await reg.release(load("eval-suite.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        await evals.run_suite(e, reg, suite, owner_id=OWNER, workspace_id=None)
        assert erp.requests == []                          # the ERP was mocked
        unsafe = load("eval-suite.yaml")
        unsafe["metadata"]["version"] = "1.0.1"
        del unsafe["spec"]["mocks"]
        unsafe_rel = await reg.release(unsafe, owner_id=OWNER, workspace_id=None, by=OWNER)
        with pytest.raises(evals.EvalRefused) as err:
            await evals.run_suite(e, reg, unsafe_rel, owner_id=OWNER, workspace_id=None)
        assert "post" in str(err.value)

    run(go())


def test_a_failing_case_fails_the_suite_and_blocks_production():
    wrong = json.dumps({"vendor": "Someone else", "total": 1.0, "currency": "EUR", "needs_review": False})
    e, reg = setup(model=FakeModel(wrong, answers_for_suite()[1]))

    async def go():
        app = await reg.release(load("aistrix.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        suite = await reg.release(load("eval-suite.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        result = await evals.run_suite(e, reg, suite, owner_id=OWNER, workspace_id=None)
        assert not result["passed"] and result["pass_rate"] == 0.5
        failures = result["cases"][0]["failures"]
        assert any("vendor" in f for f in failures) and any("total" in f for f in failures)
        with pytest.raises(GateRefused) as gate:
            await reg.promote(app["resource_key"], "1.0.0", "production", owner_id=OWNER, by=OWNER)
        assert "50% passed" in str(gate.value)

    run(go())


@pytest.mark.parametrize("rule, output, ok", [
    ({"type": "equals", "path": "a", "value": 1}, {"a": 1}, True),
    ({"type": "equals", "path": "a", "value": 1}, {"a": 2}, False),
    ({"type": "contains", "path": "t", "value": "acme"}, {"t": "From ACME"}, True),
    ({"type": "contains", "path": "l", "value": "x"}, {"l": ["x", "y"]}, True),
    ({"type": "not_empty", "path": "a.b"}, {"a": {"b": ""}}, False),
    ({"type": "number_close", "path": "n", "value": 10, "tolerance": 0.5}, {"n": 10.4}, True),
    ({"type": "number_close", "path": "n", "value": 10, "tolerance": 0.5}, {"n": True}, False),
    ({"type": "json_schema", "schema": {"type": "object", "required": ["a"]}}, {"b": 1}, False),
])
def test_checks(rule, output, ok):
    assert (evals.check(output, rule) is None) == ok


def test_gate_report_uses_latest_result_for_exact_suite_and_target_release():
    e, reg = setup()

    async def go():
        app = await reg.release(load("aistrix.yaml"), owner_id=OWNER, workspace_id=None, by=OWNER)
        ref = app["spec"]["tests"][0]
        assert (await reg.gate_report(app))["checks"][0]["status"] == "missing"
        for key, passed, stamp in [("older", True, "2026-01-01"), ("latest", False, "2026-01-02")]:
            await e.store.put_eval_result({"id": key, "release_id": app["id"], "suite": ref, "passed": passed,
                                           "pass_rate": 1.0 if passed else 0.5, "required": 1.0, "created_at": stamp})
        report = await reg.gate_report(app)
        assert not report["eligible"] and report["checks"][0]["result_id"] == "latest"
        with pytest.raises(GateRefused):
            await reg._check_gate(app)
        # Passing another suite or another release cannot satisfy this gate.
        await e.store.put_eval_result({"id": "unrelated", "release_id": app["id"], "suite": ref + "1", "passed": True,
                                       "pass_rate": 1.0, "required": 1.0, "created_at": "2026-01-03"})
        assert not (await reg.gate_report(app))["eligible"]
        app["spec"]["tests"] = []
        assert await reg.gate_report(app) == {"release_id": app["id"], "eligible": True, "checks": []}
    run(go())
