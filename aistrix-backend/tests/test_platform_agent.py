"""Agents on AEX: the Agent spec and compiler, the agent.loop runtime
(tools, approvals, limits, structured answers, crash recovery, trace),
releases, the production gate and eval suites. Fake models, fake HTTP and
the in-memory store: no network, no database, no real model calls."""
import asyncio
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aistrix_platform import compiler, evals, spec
from aistrix_platform.errors import InputError
from aistrix_platform.gateway import ModelGateway, claude_messages, openai_messages, parse_arguments
from aistrix_platform.nodes import HttpResponse, Services
from aistrix_platform.orchestrator import Engine
from aistrix_platform.registry import GateRefused, Registry
from aistrix_platform.store import MemoryStore

OWNER = "00000000-0000-0000-0000-00000000a001"
PRICES = {"claude-sonnet-5-5": (3.0, 15.0)}


def run(coro):
    return asyncio.run(coro)


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


def say(text):
    return {"text": text, "tool_calls": [], "stop": "end_turn"}


def use(name, arguments, call_id=None, text=""):
    return {"text": text, "tool_calls": [{"id": call_id or f"tu_{name}", "name": name, "arguments": arguments}],
            "stop": "tool_use"}


class FakeChat:
    """Scripted tool-calling model. Records each turn's conversation."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.turns = []

    async def stream(self, **kw):       # agents never stream
        raise AssertionError("agents use chat, not stream")
        yield ""

    async def chat(self, *, provider, model, api_key, system, messages, tools, max_tokens, temperature, usage,
                   on_text=None):
        self.turns.append({"system": system, "messages": copy.deepcopy(messages), "tools": tools, "model": model})
        reply = self.replies.pop(0)
        if isinstance(reply, BaseException):
            raise reply
        if on_text and reply.get("text"):
            await on_text(reply["text"])
        usage.update(input_tokens=1000, output_tokens=100)
        return reply


class FakeApi:
    """Orders API that dedupes writes by Idempotency-Key."""

    def __init__(self, *, crash_after_send=False, statuses=()):
        self.requests = []
        self.writes = {}
        self.crash_after_send = crash_after_send
        self.statuses = list(statuses)

    async def __call__(self, method, url, headers, body, allowed_hosts, timeout, owner_id=None):
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body, "hosts": allowed_hosts})
        if method != "GET":
            self.writes.setdefault(headers.get("Idempotency-Key"), body)
        if self.crash_after_send:
            self.crash_after_send = False
            raise asyncio.CancelledError()          # the worker dies after the request left
        if self.statuses:
            return HttpResponse(self.statuses.pop(0), {"error": "busy"})
        if method == "GET":
            return HttpResponse(200, {"order": url.rsplit("/", 1)[-1], "status": "shipped"})
        return HttpResponse(201, {"refund": "rf-1", "amount": (body or {}).get("amount")})


def engine(model, api=None, *, store=None, clock=None, worker="w1", sleeps=None):
    clock = clock or Clock()
    store = store or MemoryStore(clock=clock)
    spend = []

    async def key_for(ctx, provider):
        return "sk-owner"

    async def reserve(ctx, provider, model_name, amount):
        spend.append(("reserve", model_name, amount))
        return f"r{len(spend)}", None

    async def settle(rid, actual, outcome):
        spend.append(("settle", rid, actual, outcome))

    async def secrets(owner, resource_key, names):
        assert resource_key == "Agent/acme/support"
        return {"ORDERS_TOKEN": "tok-123"} if "ORDERS_TOKEN" in names else {}

    async def sleep(seconds):
        (sleeps if sleeps is not None else []).append(seconds)

    gateway = ModelGateway(model, prices=PRICES, key_for=key_for, reserve=reserve, settle=settle)
    e = Engine(store, gateway, Services(http=api or FakeApi(), secrets=secrets, sleep=sleep), worker_id=worker, clock=clock)
    e.spend = spend
    return e


def agent_doc(**over):
    doc = {
        "apiVersion": "aistrix.ai/v1alpha1",
        "kind": "Agent",
        "metadata": {"namespace": "acme", "name": "support", "version": "1.0.0"},
        "spec": {
            "model": "claude/claude-sonnet-5-5",
            "instructions": "You help customers with orders. Look orders up before answering.",
            "tools": [
                {"name": "get_order", "description": "Look up an order by id.",
                 "parameters": {"type": "object", "required": ["id"], "additionalProperties": False,
                                "properties": {"id": {"type": "string", "pattern": "^[A-Z0-9-]{1,20}$"}}},
                 "http": {"method": "GET", "url": "https://api.orders.example/v1/orders/{{args.id}}",
                          "headers": {"Authorization": "Bearer {{secrets.ORDERS_TOKEN}}"}}},
                {"name": "refund", "description": "Refund an order.",
                 "parameters": {"type": "object", "required": ["id", "amount"],
                                "properties": {"id": {"type": "string"}, "amount": {"type": "number", "exclusiveMinimum": 0}}},
                 "http": {"method": "POST", "url": "https://api.orders.example/v1/refunds",
                          "headers": {"Authorization": "Bearer {{secrets.ORDERS_TOKEN}}"}}},
            ],
            "limits": {"maxSteps": 6},
        },
        "policies": {"secrets": ["ORDERS_TOKEN"], "outboundHosts": ["api.orders.example"]},
    }
    for path, value in over.items():
        target = doc
        *head, last = path.split(".")
        for part in head:
            target = target[part]
        target[last] = value
    return doc


def plan_of(doc=None):
    plan, problems = compiler.compile_workload(doc or agent_doc())
    assert not problems, problems
    return plan


async def start_and_run(e, message="Where is order A-1?", plan=None, **kw):
    started = await e.start(plan or plan_of(), {"message": message}, owner_id=OWNER, **kw)
    return await e.execute(started["id"])


async def events(e, run_id):
    return [ev["type"] for ev in await e.store.events(run_id)]


# ── Spec and compiler ─────────────────────────────────────────────────────────

def test_agent_spec_validates_and_compiles_to_one_agent_step():
    plan = plan_of()
    assert plan["kind"] == "Agent" and plan["workload"] == "agent" and plan["order"] == ["agent"]
    assert plan["tools"] == ["get_order", "refund"] and plan["writeTools"] == ["refund"]
    assert plan["input"] == spec.DEFAULT_AGENT_INPUT and plan["output"] == {"type": "string"}
    assert plan["policies"]["budgetUsd"] == compiler.DEFAULT_RUN_BUDGET_USD
    node = plan["nodes"]["agent"]
    assert node["use"] == "agent.loop" and node["retry"] == 3 and node["timeoutSeconds"] == 300
    # The same spec always compiles to the same plan.
    assert plan_of()["planId"] == plan["planId"]


@pytest.mark.parametrize("path,value,expect", [
    ("spec.tools", [{"name": "a", "description": "x", "parameters": {"type": "object"}, "http": {"method": "GET", "url": "https://api.orders.example/a"}},
                    {"name": "a", "description": "y", "parameters": {"type": "object"}, "http": {"method": "GET", "url": "https://api.orders.example/b"}}],
     "used twice"),
    ("spec.tools", [{"name": "a", "description": "x", "parameters": {"type": "string"}, "http": {"method": "GET", "url": "https://api.orders.example/a"}}],
     "must be an object schema"),
    ("spec.tools", [{"name": "a", "description": "x", "parameters": {"type": "object"}}], ""),
    ("spec.model", "mistral/large", ""),
    ("spec.limits", {"maxSteps": 0}, ""),
])
def test_invalid_agent_specs_are_refused(path, value, expect):
    problems = spec.validate(agent_doc(**{path: value}))
    assert problems
    assert expect in " ".join(p.message for p in problems)


@pytest.mark.parametrize("tool,expect", [
    ({"http": {"method": "GET", "url": "https://evil.example/x"}}, "isn't in policies.outboundHosts"),
    ({"http": {"method": "GET", "url": "https://{{args.id}}.orders.example/x"}}, "must be written out"),
    ({"http": {"method": "GET", "url": "https://api.orders.example/{{args.nope}}"}}, "isn't one of the tool's parameters"),
    ({"http": {"method": "POST", "url": "https://api.orders.example/x", "body": {"t": "{{secrets.ORDERS_TOKEN}}"}}},
     "Secrets go only in the URL or headers"),
    ({"http": {"method": "GET", "url": "https://api.orders.example/x", "headers": {"A": "{{secrets.OTHER}}"}}},
     "isn't declared in policies.secrets"),
    ({"http": {"method": "GET", "url": "https://api.orders.example/{{input.id}}"}}, "tools read only args"),
])
def test_compiler_checks_tool_hosts_templates_and_secrets(tool, expect):
    t = {"name": "t", "description": "d", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}}, **tool}
    _, problems = compiler.compile_workload(agent_doc(**{"spec.tools": [t]}))
    assert expect in " ".join(p.message for p in problems)


def test_provider_policy_applies_to_the_agent_model():
    _, problems = compiler.compile_workload(agent_doc(**{"policies.providers": ["openai"]}))
    assert "isn't allowed by policies.providers" in problems[0].message


# ── Running ───────────────────────────────────────────────────────────────────

def test_an_agent_answers_without_tools_and_records_cost_and_trace():
    model = FakeChat(say("Hello! How can I help?"))
    e = engine(model)

    async def go():
        done = await start_and_run(e, "hi")
        assert done["status"] == "succeeded" and done["output"] == "Hello! How can I help?"
        step = done["steps"]["agent"]
        assert step["detail"]["turns"] == 1 and step["detail"]["toolCalls"] == 0
        # Cost: 1000 in, 100 out at (3, 15) per million.
        assert done["cost_usd"] == pytest.approx(0.0045) and step["cost_usd"] == pytest.approx(0.0045)
        assert step["state"]["messages"][0] == {"role": "user", "content": "hi"}
        assert "agent.turn" in await events(e, done["id"])
        # Each turn was reserved and settled with its real cost.
        assert e.spend[0][0] == "reserve" and e.spend[1][2:] == (0.0045, "settled")
        assert [t["name"] for t in model.turns[0]["tools"]] == ["get_order", "refund"]
    run(go())


def test_tools_fill_arguments_and_secrets_and_their_results_reach_the_model():
    model = FakeChat(use("get_order", {"id": "A-1"}), say("Order A-1 has shipped."))
    api = FakeApi()
    e = engine(model, api)

    async def go():
        done = await start_and_run(e)
        assert done["status"] == "succeeded" and done["output"] == "Order A-1 has shipped."
        req = api.requests[0]
        assert req["url"] == "https://api.orders.example/v1/orders/A-1"
        assert req["headers"]["Authorization"] == "Bearer tok-123" and "Idempotency-Key" not in req["headers"]
        assert req["hosts"] == ["api.orders.example"]
        result = model.turns[1]["messages"][-1]
        assert result["role"] == "tool" and json.loads(result["results"][0]["content"])["body"]["status"] == "shipped"
        # The trace has the turn, the tool call and the final turn; secrets aren't in it.
        evs = await e.store.events(done["id"])
        tool_ev = next(ev for ev in evs if ev["type"] == "agent.tool")
        assert tool_ev["data"]["tool"] == "get_order" and tool_ev["data"]["status"] == "done"
        assert "tok-123" not in json.dumps(evs) and "tok-123" not in json.dumps(done["steps"]["agent"]["state"])
    run(go())


def test_a_write_waits_for_approval_then_runs_once_with_an_idempotency_key():
    model = FakeChat(use("refund", {"id": "A-1", "amount": 20}), say("Refunded 20."))
    api = FakeApi()
    e = engine(model, api)

    async def go():
        waiting = await start_and_run(e, "Refund A-1")
        assert waiting["status"] == "waiting_approval" and api.requests == []
        pending = waiting["steps"]["agent"]["pending"]
        assert pending["tool"] == "refund" and pending["arguments"] == {"id": "A-1", "amount": 20} and pending["writes"]
        await e.approve(waiting["id"], "agent", approved=True, by=OWNER, note="ok")
        done = await e.execute(waiting["id"])
        assert done["status"] == "succeeded" and done["output"] == "Refunded 20."
        assert len(api.requests) == 1 and api.requests[0]["body"] == {"id": "A-1", "amount": 20}
        assert api.requests[0]["headers"]["Idempotency-Key"]
        assert len(model.turns) == 2                      # the paid first turn wasn't repeated
        assert "decision" not in done["steps"]["agent"]
    run(go())


def test_a_rejected_call_is_reported_to_the_agent_which_continues():
    model = FakeChat(use("refund", {"id": "A-1", "amount": 500}), say("I can't refund that; a reviewer declined."))
    api = FakeApi()
    e = engine(model, api)

    async def go():
        waiting = await start_and_run(e, "Refund A-1 fully")
        await e.approve(waiting["id"], "agent", approved=False, by=OWNER, note="Too large")
        done = await e.execute(waiting["id"])
        assert done["status"] == "succeeded" and api.requests == []
        told = model.turns[1]["messages"][-1]["results"][0]
        assert told["is_error"] and "rejected" in told["content"] and "Too large" in told["content"]
    run(go())


def test_approval_never_runs_writes_unattended_and_always_pauses_reads():
    doc = agent_doc()
    doc["spec"]["tools"][1]["approval"] = "never"
    doc["spec"]["tools"][0]["approval"] = "always"
    model = FakeChat(use("refund", {"id": "A-1", "amount": 5}), use("get_order", {"id": "A-1"}), say("done"))
    api = FakeApi()
    e = engine(model, api)

    async def go():
        waiting = await start_and_run(e, plan=plan_of(doc))
        assert waiting["status"] == "waiting_approval" and waiting["steps"]["agent"]["pending"]["tool"] == "get_order"
        assert [r["method"] for r in api.requests] == ["POST"]
    run(go())


def test_a_worker_crash_mid_write_resumes_without_repeating_the_turn_or_the_write():
    doc = agent_doc()
    doc["spec"]["tools"][1]["approval"] = "never"
    model = FakeChat(use("refund", {"id": "A-1", "amount": 20}), say("Refunded."))
    api = FakeApi(crash_after_send=True)
    clock = Clock()
    store = MemoryStore(clock=clock)
    first = engine(model, api, store=store, clock=clock, worker="w1")

    async def go():
        started = await first.start(plan_of(doc), {"message": "Refund A-1"}, owner_id=OWNER)
        with pytest.raises(asyncio.CancelledError):
            await first.execute(started["id"])
        clock.t += 120                                    # the dead worker's lease expires
        second = engine(model, api, store=store, clock=clock, worker="w2")
        done = await second.execute(started["id"])
        assert done["status"] == "succeeded" and done["output"] == "Refunded."
        assert len(model.turns) == 2                      # turn 1 was saved, not paid for again
        keys = [r["headers"]["Idempotency-Key"] for r in api.requests]
        assert len(keys) == 2 and keys[0] == keys[1]      # resent with the same key
        assert len(api.writes) == 1                       # so the API applied it once
    run(go())


def test_unknown_tools_and_bad_arguments_go_back_to_the_model():
    model = FakeChat(use("delete_everything", {}), use("get_order", {"id": "lower case!"}), say("Sorry."))
    api = FakeApi()
    e = engine(model, api)

    async def go():
        done = await start_and_run(e)
        assert done["status"] == "succeeded" and api.requests == []
        assert "no tool named" in model.turns[1]["messages"][-1]["results"][0]["content"]
        assert "Invalid arguments" in model.turns[2]["messages"][-1]["results"][0]["content"]
    run(go())


def test_api_errors_are_results_and_outages_retry_the_step_from_its_progress():
    model = FakeChat(use("get_order", {"id": "A-1"}), say("It shipped."))
    api = FakeApi(statuses=[503])
    sleeps = []
    e = engine(model, api, sleeps=sleeps)

    async def go():
        done = await start_and_run(e)
        assert done["status"] == "succeeded" and len(api.requests) == 2 and sleeps
        assert len(model.turns) == 2 and done["steps"]["agent"]["attempts"] == 2
    run(go())


def test_the_step_limit_ends_a_looping_agent_with_a_clear_error():
    model = FakeChat(*[use("get_order", {"id": "A-1"}, call_id=f"c{i}") for i in range(3)])
    e = engine(model)

    async def go():
        done = await start_and_run(e, plan=plan_of(agent_doc(**{"spec.limits": {"maxSteps": 2}})))
        assert done["status"] == "failed" and "didn't finish within 2 model turns" in done["error"]
        assert done["steps"]["agent"]["detail"]["turns"] == 2
    run(go())


def test_the_tool_call_limit_is_enforced():
    model = FakeChat(*[use("get_order", {"id": "A-1"}, call_id=f"c{i}") for i in range(3)])
    e = engine(model)

    async def go():
        done = await start_and_run(e, plan=plan_of(agent_doc(**{"spec.limits": {"maxToolCalls": 2}})))
        assert done["status"] == "failed" and "more than 2 tool calls" in done["error"]
    run(go())


def test_structured_answers_are_checked_and_repaired_once():
    schema = {"type": "object", "required": ["status"], "properties": {"status": {"enum": ["shipped", "pending"]}}}
    model = FakeChat(say("It has shipped."), say('```json\n{"status": "shipped"}\n```'))
    e = engine(model)

    async def go():
        done = await start_and_run(e, plan=plan_of(agent_doc(**{"spec.output": schema})))
        assert done["status"] == "succeeded" and done["output"] == {"status": "shipped"}
        assert "JSON Schema" in model.turns[0]["system"]
        assert "rejected" in model.turns[1]["messages"][-1]["content"]
    run(go())


def test_the_run_budget_stops_an_agent_before_an_unaffordable_turn():
    model = FakeChat(say("never"))
    e = engine(model)

    async def go():
        done = await start_and_run(e, plan=plan_of(agent_doc(**{"policies.budget": {"perRunUsd": 0.0001}})))
        assert done["status"] == "failed" and "budget" in done["error"] and model.turns == []
    run(go())


def test_custom_input_is_given_to_the_agent_as_json():
    schema = {"type": "object", "required": ["order"], "properties": {"order": {"type": "string"}}}
    model = FakeChat(say("ok"))
    e = engine(model)

    async def go():
        with pytest.raises(InputError):
            await e.start(plan_of(agent_doc(**{"spec.input": schema})), {"message": "x"}, owner_id=OWNER)
        started = await e.start(plan_of(agent_doc(**{"spec.input": schema})), {"order": "A-1"}, owner_id=OWNER)
        await e.execute(started["id"])
        assert json.loads(model.turns[0]["messages"][0]["content"]) == {"order": "A-1"}
    run(go())


# ── Provider formats ──────────────────────────────────────────────────────────

CONVERSATION = [
    {"role": "user", "content": "Where is A-1?"},
    {"role": "assistant", "text": "Checking.", "tool_calls": [{"id": "t1", "name": "get_order", "arguments": {"id": "A-1"}}]},
    {"role": "tool", "results": [{"id": "t1", "name": "get_order", "content": "shipped", "is_error": False}]},
]


def test_claude_message_format():
    out = claude_messages(CONVERSATION)
    assert out[1] == {"role": "assistant", "content": [{"type": "text", "text": "Checking."},
                                                       {"type": "tool_use", "id": "t1", "name": "get_order", "input": {"id": "A-1"}}]}
    assert out[2] == {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "shipped", "is_error": False}]}


def test_openai_message_format():
    out = openai_messages("sys", CONVERSATION)
    assert out[0] == {"role": "system", "content": "sys"}
    assert out[2]["tool_calls"][0] == {"id": "t1", "type": "function", "function": {"name": "get_order", "arguments": '{"id": "A-1"}'}}
    assert out[3] == {"role": "tool", "tool_call_id": "t1", "content": "shipped"}
    assert parse_arguments('{"a": 1}') == {"a": 1} and parse_arguments("not json") == {} and parse_arguments("[1]") == {}


# ── Releases, gate and evals ──────────────────────────────────────────────────

def suite_doc(**over):
    doc = {
        "apiVersion": "aistrix.ai/v1alpha1", "kind": "EvalSuite",
        "metadata": {"namespace": "acme", "name": "support-evals", "version": "1.0.0"},
        "spec": {"target": {"ref": "Agent/acme/support@1.0.0", "workload": "agent"},
                 "mocks": {"refund": {"status": 201, "body": {"refund": "mock"}}},
                 "cases": [{"name": "refund", "input": {"message": "Refund A-1"},
                            "expect": [{"type": "contains", "value": "refunded"}]}]},
    }
    doc["spec"].update(over)
    return doc


def test_agents_release_and_need_passing_evals_for_production():
    model = FakeChat(use("refund", {"id": "A-1", "amount": 20}), say("I refunded it."))
    api = FakeApi()
    e = engine(model, api)
    reg = Registry(e.store)

    async def go():
        doc = agent_doc()
        doc["tests"] = ["EvalSuite/acme/support-evals@1.0.0"]
        rel = await reg.release(doc, owner_id=OWNER, workspace_id=None, by=OWNER)
        assert rel["kind"] == "Agent" and list(rel["plans"]) == ["agent"]
        await reg.promote("Agent/acme/support", "1.0.0", "staging", owner_id=OWNER, by=OWNER)
        with pytest.raises(GateRefused):
            await reg.promote("Agent/acme/support", "1.0.0", "production", owner_id=OWNER, by=OWNER)
        suite = await reg.release(suite_doc(), owner_id=OWNER, workspace_id=None, by=OWNER)
        result = await evals.run_suite(e, reg, suite, owner_id=OWNER, workspace_id=None)
        assert result["passed"], result["cases"]
        assert api.requests == []                         # the write tool was mocked
        env = await reg.promote("Agent/acme/support", "1.0.0", "production", owner_id=OWNER, by=OWNER)
        assert env["version"] == "1.0.0"
    run(go())


def test_evals_refuse_an_agent_whose_write_tools_arent_mocked():
    e = engine(FakeChat())
    reg = Registry(e.store)

    async def go():
        await reg.release(agent_doc(), owner_id=OWNER, workspace_id=None, by=OWNER)
        suite = await reg.release(suite_doc(mocks={}), owner_id=OWNER, workspace_id=None, by=OWNER)
        with pytest.raises(evals.EvalRefused, match="refund"):
            await evals.run_suite(e, reg, suite, owner_id=OWNER, workspace_id=None)
    run(go())


def test_automatic_approvals_decide_agent_calls_in_evals_and_local_runs(monkeypatch):
    from aistrix_platform.local import run_local
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-local-test")     # the local runner's keys come from the environment

    async def env_secrets(owner, resource_key, names):
        return {"ORDERS_TOKEN": "tok-local"}
    doc = agent_doc()
    doc["spec"]["tools"][0]["approval"] = "always"
    api = FakeApi()

    async def go():
        approved = await run_local(doc, {"message": "Where is A-1?"}, spec_dir=Path("."), approvals="approve",
                                   adapter=FakeChat(use("get_order", {"id": "A-1"}), say("Shipped.")),
                                   services=Services(http=api, secrets=env_secrets))
        assert approved["status"] == "succeeded" and approved["output"] == "Shipped." and len(api.requests) == 1
        rejected_model = FakeChat(use("get_order", {"id": "A-1"}), say("I couldn't look it up."))
        rejected = await run_local(doc, {"message": "Where is A-1?"}, spec_dir=Path("."), approvals="reject",
                                   adapter=rejected_model, services=Services(http=api, secrets=env_secrets))
        assert rejected["status"] == "succeeded" and len(api.requests) == 1
        assert "Decided automatically (reject)" in rejected_model.turns[1]["messages"][-1]["results"][0]["content"]
    run(go())


def test_a_missing_secret_fails_the_run_instead_of_reaching_the_model():
    model = FakeChat(use("get_order", {"id": "A-1"}), say("never"))
    api = FakeApi()
    e = engine(model, api)

    async def no_secrets(owner, resource_key, names):
        return {}
    e.services.secrets = no_secrets

    async def go():
        done = await start_and_run(e)
        assert done["status"] == "failed" and "ORDERS_TOKEN has no value" in done["error"]
        assert api.requests == [] and len(model.turns) == 1
    run(go())


def test_reused_tool_call_ids_never_replay_an_earlier_result():
    model = FakeChat(use("get_order", {"id": "A-1"}, call_id="same"), use("get_order", {"id": "B-2"}, call_id="same"), say("ok"))
    api = FakeApi()
    e = engine(model, api)

    async def go():
        done = await start_and_run(e)
        assert done["status"] == "succeeded"
        assert [r["url"].rsplit("/", 1)[-1] for r in api.requests] == ["A-1", "B-2"]
    run(go())


def test_the_example_agent_and_its_suite_are_valid():
    root = Path(__file__).resolve().parents[2] / "examples" / "support-agent"
    agent = spec.load((root / "aistrix.yaml").read_text(encoding="utf-8"))
    suite = spec.load((root / "eval-suite.yaml").read_text(encoding="utf-8"))
    plan = plan_of(agent)
    assert plan["writeTools"] == ["refund_order"] and set(plan["writeTools"]) <= set(suite["spec"]["mocks"])
