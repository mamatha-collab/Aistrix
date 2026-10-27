"""AEX orchestrator, model gateway and node runtimes with fake providers,
fake HTTP and the in-memory store. No network, no database, no models."""
import asyncio
import base64
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aistrix_platform import compiler, spec
from aistrix_platform.errors import Conflict, InputError, LeaseHeld
from aistrix_platform.gateway import ModelGateway
from aistrix_platform.nodes import HttpResponse, Services
from aistrix_platform.orchestrator import Engine
from aistrix_platform.store import MemoryStore

EXAMPLE = Path(__file__).resolve().parents[2] / "examples" / "invoice-pipeline" / "aistrix.yaml"
PRICES = {"claude-haiku-5-5": (0.10, 0.50)}


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


class FakeModel:
    """Answers in order; records what it was asked."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []

    async def stream(self, *, provider, model, api_key, system, prompt, max_tokens, temperature, usage):
        self.calls.append({"provider": provider, "model": model, "system": system, "prompt": prompt, "key": api_key})
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        for i in range(0, len(answer), 7):
            yield answer[i:i + 7]
        usage.update(input_tokens=1000, output_tokens=200)


class FakeErp:
    """An API that dedupes writes by Idempotency-Key, like Stripe does."""

    def __init__(self, *, fail_with=(), crash_after_send=False):
        self.requests = []
        self.writes = {}
        self.fail_with = list(fail_with)
        self.crash_after_send = crash_after_send

    async def __call__(self, method, url, headers, body, allowed_hosts, timeout, owner_id=None):
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body, "hosts": allowed_hosts})
        key = headers.get("Idempotency-Key")
        if key not in self.writes:
            self.writes[key] = body
        if self.crash_after_send:
            self.crash_after_send = False
            raise asyncio.CancelledError()          # the worker dies after the request left
        if self.fail_with:
            return HttpResponse(self.fail_with.pop(0), {"error": "busy"})
        return HttpResponse(201, {"id": "erp-1"})


def answer(**over):
    data = {"vendor": "ACME", "total": 120, "currency": "EUR", "needs_review": False, **over}
    return json.dumps(data)


def plan_for(doc=None):
    doc = doc or spec.parse_text(EXAMPLE.read_text(encoding="utf-8"))
    plan, problems = compiler.compile_workload(doc)
    assert not problems, problems
    return plan


def invoice_input(text="Invoice from ACME. Total 120 EUR."):
    return {"invoice_id": "inv-7", "file": {"name": "invoice.txt", "mime": "text/plain",
                                            "content_base64": base64.b64encode(text.encode()).decode()}}


def engine(model, erp, *, store=None, clock=None, worker="w1", sleeps=None):
    clock = clock or Clock()
    store = store or MemoryStore(clock=clock)
    reservations = []

    async def key_for(ctx, provider):
        return "sk-ant-owner-key"

    async def reserve(ctx, provider, model_name, amount):
        reservations.append(("reserve", model_name, amount))
        return f"r{len(reservations)}", None

    async def settle(rid, actual, outcome):
        reservations.append(("settle", rid, actual, outcome))

    async def secrets(owner, resource_key, names):
        assert resource_key == "Application/acme/invoice-extractor"
        return {"ERP_API_KEY": "erp-secret-123"} if "ERP_API_KEY" in names else {}

    async def sleep(seconds):
        (sleeps if sleeps is not None else []).append(seconds)

    gateway = ModelGateway(model, prices=PRICES, key_for=key_for, reserve=reserve, settle=settle)
    services = Services(http=erp, secrets=secrets, sleep=sleep)
    e = Engine(store, gateway, services, worker_id=worker, lease_seconds=60, clock=clock)
    e.reservations = reservations
    return e


def run(coro):
    return asyncio.run(coro)


def test_happy_path_extracts_posts_once_and_records_cost():
    model, erp = FakeModel(answer()), FakeErp()
    e = engine(model, erp)
    events = []

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        async def sink(ev):
            events.append(ev)
        return await e.execute(r["id"], on_event=sink)

    r = run(go())
    assert r["status"] == "succeeded", r["error"]
    assert r["output"] == {"vendor": "ACME", "total": 120, "currency": "EUR", "needs_review": False}
    assert r["steps"]["review"]["status"] == "succeeded" and "not needed" in r["steps"]["review"]["note"]
    assert len(erp.requests) == 1
    req = erp.requests[0]
    assert req["headers"]["Authorization"] == "Bearer erp-secret-123"
    assert len(req["headers"]["Idempotency-Key"]) == 40
    assert req["body"]["invoice_id"] == "inv-7" and req["body"]["fields"]["vendor"] == "ACME"
    assert req["hosts"] == ["api.example-erp.com"]
    assert "Invoice from ACME" in model.calls[0]["prompt"]
    assert model.calls[0]["model"] == "claude-haiku-5-5" and model.calls[0]["key"] == "sk-ant-owner-key"
    # 1000 in at $0.10/M + 200 out at $0.50/M
    assert r["cost_usd"] == pytest.approx(0.0002)
    assert [x[0] for x in e.reservations] == ["reserve", "settle"]
    assert e.reservations[1][3] == "settled"
    kinds = [ev["type"] for ev in events]
    assert kinds[0] == "run.started" and kinds[-1] == "run.finished" and "node.token" in kinds
    stored = run(e.store.events(r["id"]))
    assert "node.token" not in [ev["type"] for ev in stored]       # tokens stream, they aren't stored


def test_review_waits_for_approval_then_posts():
    model, erp = FakeModel(answer(total=50000, needs_review=True)), FakeErp()
    e = engine(model, erp)

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        r = await e.execute(r["id"])
        assert r["status"] == "waiting_approval" and not erp.requests
        assert r["steps"]["review"]["pending"]["total"] == 50000
        with pytest.raises(Conflict):
            await e.approve(r["id"], "fields", approved=True, by="u2")
        await e.approve(r["id"], "review", approved=True, by="u2")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "succeeded"
    assert r["steps"]["review"]["decidedBy"] == "u2"
    assert len(erp.requests) == 1 and len(model.calls) == 1        # the model wasn't asked again


def test_rejection_stops_before_the_write():
    model, erp = FakeModel(answer(needs_review=True)), FakeErp()
    e = engine(model, erp)

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        r = await e.execute(r["id"])
        await e.approve(r["id"], "review", approved=False, by="u2", note="Wrong vendor")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "rejected" and r["error"] == "Wrong vendor" and not erp.requests


def test_approvals_expire():
    clock = Clock()
    model, erp = FakeModel(answer(needs_review=True)), FakeErp()
    e = engine(model, erp, clock=clock)

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        r = await e.execute(r["id"])
        clock.t += 73 * 3600
        await e.approve(r["id"], "review", approved=True, by="u2")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "rejected" and "expired" in r["error"] and not erp.requests


def test_a_worker_crash_after_sending_resumes_with_the_same_key_and_one_write():
    clock = Clock()
    store = MemoryStore(clock=clock)
    erp = FakeErp(crash_after_send=True)
    first = engine(FakeModel(answer()), erp, store=store, clock=clock, worker="w1")

    async def go():
        r = await first.start(plan_for(), invoice_input(), owner_id="u1")
        with pytest.raises(asyncio.CancelledError):
            await first.execute(r["id"])
        stuck = await store.get_run(r["id"])
        assert stuck["steps"]["post"]["status"] == "dispatched"
        assert stuck["steps"]["fields"]["status"] == "succeeded"
        second = engine(FakeModel(), erp, store=store, clock=clock, worker="w2")
        # The first worker's lease was released when its task was cancelled.
        return await second.execute(r["id"])

    r = run(go())
    assert r["status"] == "succeeded", r["error"]
    keys = {req["headers"]["Idempotency-Key"] for req in erp.requests}
    assert len(erp.requests) == 2 and len(keys) == 1 and len(erp.writes) == 1
    assert r["steps"]["post"]["attempts"] == 2


def test_a_dispatched_write_without_a_key_stops_for_review():
    clock = Clock()
    store = MemoryStore(clock=clock)
    erp = FakeErp(crash_after_send=True)
    plan = plan_for()
    del plan["nodes"]["post"]["config"]["idempotencyKey"]         # bypassing the compiler on purpose
    first = engine(FakeModel(answer()), erp, store=store, clock=clock)

    async def go():
        r = await first.start(plan, invoice_input(), owner_id="u1")
        with pytest.raises(asyncio.CancelledError):
            await first.execute(r["id"])
        return await engine(FakeModel(), erp, store=store, clock=clock, worker="w2").execute(r["id"])

    r = run(go())
    assert r["status"] == "needs_review" and "may have run" in r["error"]
    assert len(erp.requests) == 1


def test_a_live_lease_blocks_a_second_worker():
    clock = Clock()
    store = MemoryStore(clock=clock)
    e1 = engine(FakeModel(answer()), FakeErp(), store=store, clock=clock, worker="w1")
    e2 = engine(FakeModel(answer()), FakeErp(), store=store, clock=clock, worker="w2")

    async def go():
        r = await e1.start(plan_for(), invoice_input(), owner_id="u1")
        assert await store.claim(r["id"], "w1", 60)
        with pytest.raises(LeaseHeld):
            await e2.execute(r["id"])
        clock.t += 61                                         # w1 went silent; its lease expired
        return await e2.execute(r["id"])

    assert run(go())["status"] == "succeeded"


def test_transient_failures_retry_with_backoff():
    sleeps = []
    erp = FakeErp(fail_with=[503, 429])
    e = engine(FakeModel(answer()), erp, sleeps=sleeps)

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "succeeded" and r["steps"]["post"]["attempts"] == 3
    assert sleeps == [0.5, 1.0]
    assert len({q["headers"]["Idempotency-Key"] for q in erp.requests}) == 1


def test_permanent_failures_and_exhausted_retries_fail_the_run():
    e = engine(FakeModel(answer()), FakeErp(fail_with=[400]))

    async def go(eng):
        r = await eng.start(plan_for(), invoice_input(), owner_id="u1")
        return await eng.execute(r["id"])

    r = run(go(e))
    assert r["status"] == "failed" and "400" in r["error"] and r["steps"]["post"]["attempts"] == 1
    r = run(go(engine(FakeModel(answer()), FakeErp(fail_with=[503, 503, 503]))))
    assert r["status"] == "failed" and "tried 3 times" in r["error"]


def test_a_bad_json_answer_gets_one_repair_try():
    model = FakeModel("Sure! Here it is: {vendor}", "```json\n" + answer() + "\n```")
    e = engine(model, FakeErp())

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "succeeded"
    assert "previous answer was rejected" in model.calls[1]["prompt"]
    assert r["steps"]["fields"]["detail"]["attempts"] == 2
    assert r["cost_usd"] == pytest.approx(0.0004)


def test_schema_mismatch_after_repair_fails():
    model = FakeModel(answer(total="lots"), answer(total="lots"))
    e = engine(model, FakeErp())

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "failed" and "didn't match the schema" in r["error"]


def test_the_run_budget_stops_calls_that_could_exceed_it():
    doc = spec.parse_text(EXAMPLE.read_text(encoding="utf-8"))
    doc["policies"]["budget"]["perRunUsd"] = 0.0001
    model = FakeModel(answer())
    e = engine(model, FakeErp())

    async def go():
        r = await e.start(plan_for(doc), invoice_input(), owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "failed" and "budget" in r["error"] and not model.calls


def test_unknown_prices_cant_pass_a_budget_check():
    doc = spec.parse_text(EXAMPLE.read_text(encoding="utf-8"))
    doc["spec"]["workloads"][0]["nodes"][1]["model"] = "claude/claude-mystery-1"
    model = FakeModel(answer())
    e = engine(model, FakeErp())

    async def go():
        r = await e.start(plan_for(doc), invoice_input(), owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "failed" and "no listed price" in r["error"] and not model.calls


def test_inputs_are_checked_before_a_run_starts():
    e = engine(FakeModel(), FakeErp())
    with pytest.raises(InputError) as err:
        run(e.start(plan_for(), {"invoice_id": "x"}, owner_id="u1"))
    assert "file" in str(err.value)


def test_cancel_while_waiting():
    model, erp = FakeModel(answer(needs_review=True)), FakeErp()
    e = engine(model, erp)

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        r = await e.execute(r["id"])
        await e.cancel(r["id"])
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "cancelled" and not erp.requests


def test_finished_runs_are_not_repeated():
    model, erp = FakeModel(answer()), FakeErp()
    e = engine(model, erp)

    async def go():
        r = await e.start(plan_for(), invoice_input(), owner_id="u1")
        await e.execute(r["id"])
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "succeeded" and len(erp.requests) == 1 and len(model.calls) == 1


def test_provider_failures_are_classified():
    class RateLimitError(Exception):
        status_code = 429

    model = FakeModel(RateLimitError("slow down"), answer())
    sleeps = []
    doc = spec.parse_text(EXAMPLE.read_text(encoding="utf-8"))
    doc["spec"]["workloads"][0]["nodes"][1]["retry"] = {"attempts": 2}
    e = engine(model, FakeErp(), sleeps=sleeps)

    async def go():
        r = await e.start(plan_for(doc), invoice_input(), owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "succeeded" and r["steps"]["fields"]["attempts"] == 2 and sleeps == [0.5]
    # The failed call may have been charged: its hold is kept at the estimate
    # (settled as uncertain), not released.
    reserved = e.reservations[0][2]
    assert ("settle", "r1", reserved, "uncertain") in e.reservations


def _custom_plan(n=2):
    order = [f"n{i}" for i in range(n)]
    nodes = {nid: {"use": "custom.step", "config": {"i": i}, "when": None, "retry": 3, "timeoutSeconds": 30,
                   "sources": [{"from": "input", "node": None, "path": []}], "sideEffect": False, "ancestors": []}
             for i, nid in enumerate(order)}
    return {"planId": "p", "resource": "Workflow/flows/x@1", "workload": "steps", "input": {}, "output": {},
            "order": order, "nodes": nodes, "outputSource": {"from": "input", "node": None, "path": []},
            "policies": {"secrets": [], "outboundHosts": [], "providers": None, "budgetUsd": None}}


def test_adapter_runtimes_can_skip_wait_and_decide_repeat_safety():
    from aistrix_platform.errors import NodeError
    from aistrix_platform.nodes import NodeOutcome
    calls, waits = [], []

    async def step(ctx):
        i = ctx.node["config"]["i"]
        calls.append(i)
        if i == 0 and calls.count(0) == 1:
            raise NodeError("busy", transient=True, repeat_safe=True, detail={"sent": True})
        if i == 0:
            return NodeOutcome(None, skipped="not today")
        return NodeOutcome("please check", wait=True)

    store = MemoryStore()
    e = Engine(store, None, runtimes={"custom.step": step}, backoff=lambda a: 7.0)
    async def sleep(s):
        waits.append(s)
    e._sleep = sleep

    async def go():
        r = await e.start(_custom_plan(), "seed", owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["steps"]["n0"]["status"] == "skipped" and r["steps"]["n0"]["reason"] == "not today"
    assert r["status"] == "waiting_approval" and r["steps"]["n1"]["pending"] == "please check"
    assert calls == [0, 0, 1] and waits == [7.0]


def test_an_unsafe_attempt_is_not_retried_even_when_transient():
    from aistrix_platform.errors import NodeError

    async def step(ctx):
        raise NodeError("reset", transient=True, uncertain=True, repeat_safe=False, detail={"sent": True})

    e = Engine(MemoryStore(), None, runtimes={"custom.step": step})

    async def go():
        r = await e.start(_custom_plan(1), "seed", owner_id="u1")
        return await e.execute(r["id"])

    r = run(go())
    assert r["status"] == "needs_review" and r["steps"]["n0"]["attempts"] == 1
    assert r["steps"]["n0"]["detail"] == {"sent": True}
