"""Agent runtime (AEX data plane): the `agent.loop` step an Agent release
compiles to.

The agent talks to its model through the gateway (budget, keys and spend
reservations as for any model call) and calls the tools its spec declares.
Everything it does is saved on the step as it happens:

- The conversation is checkpointed after every model turn and every tool
  result, so a resumed run continues where it stopped and never pays for a
  model turn or repeats a tool call twice.
- A write is marked dispatched before it is sent and carries an
  idempotency key derived from the run and the tool call, so resending it
  after a crash is safe.
- Calls that need approval pause the run. Approved calls run; a rejected
  call is reported back to the model, which can change course.
- Each turn and tool call is also published as a trace event.
- Limits: model turns (maxSteps), tool calls (maxToolCalls), the run's
  budget, and the step timeout.

In eval runs, a tool named in the run's mocks returns the mock instead of
running (evals refuse to start while any write tool is unmocked).
"""
import copy
import hashlib
import json
import re
from typing import Any, Optional

from . import spec, templates
from .errors import NodeError
from .nodes import NodeContext, NodeOutcome

USE = "agent.loop"
DEFAULT_STEPS = 10
DEFAULT_TOOL_CALLS = 20
DEFAULT_TIMEOUT = 300
MAX_RESULT_CHARS = 20_000
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.S)

OUTPUT_RULE = ("When you are done, reply with one JSON value only, no prose and no code fences. "
               "It must match this JSON Schema:\n{schema}")


def tool_writes(tool: dict) -> bool:
    if "http" in tool:
        return tool["http"]["method"] in WRITE_METHODS
    return False          # code apps run without network access


def needs_approval(tool: dict) -> bool:
    mode = tool.get("approval") or "auto"
    return mode == "always" or (mode == "auto" and tool_writes(tool))


def first_message(value: Any) -> str:
    if isinstance(value, dict) and set(value) == {"message"} and isinstance(value["message"], str):
        return value["message"]
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)


def _clip(text: str) -> str:
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "\n…(cut)"


def _as_text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)


def _parse_final(text: str, schema: dict) -> tuple[Any, list[str]]:
    m = _FENCE.match(text)
    cleaned = m.group(1) if m else text
    try:
        data = json.loads(cleaned)
    except ValueError:
        return None, ["The answer wasn't valid JSON."]
    return data, [f"{p.path or '(root)'}: {p.message}" for p in spec.validate_value(schema, data)[:5]]


class _Agent:
    def __init__(self, ctx: NodeContext):
        self.ctx = ctx
        self.cfg = ctx.node["config"]           # raw config: tool templates are filled per call
        self.tools = {t["name"]: t for t in self.cfg.get("tools") or []}
        limits = self.cfg.get("limits") or {}
        self.max_steps = limits.get("maxSteps") or DEFAULT_STEPS
        self.max_calls = limits.get("maxToolCalls") or DEFAULT_TOOL_CALLS
        self.state = copy.deepcopy(ctx.state or {})
        self.state.setdefault("messages", [{"role": "user", "content": first_message(ctx.value)}])
        self.state.setdefault("turns", 0)
        self.state.setdefault("toolCalls", 0)
        self.state.setdefault("calls", {})      # tool call id -> {status, result, ...}
        self.state.setdefault("costUsd", 0.0)

    # ── Persistence and trace ─────────────────────────────────────────────────

    async def save(self, cost: float = 0.0):
        if cost:
            self.state["costUsd"] = round(self.state["costUsd"] + cost, 6)
        await self.ctx.checkpoint(self.state, cost)

    async def trace(self, kind: str, data: dict):
        if self.ctx.trace:
            await self.ctx.trace(kind, data)

    # ── The loop ──────────────────────────────────────────────────────────────

    async def run(self) -> NodeOutcome:
        decision = self.ctx.decision
        while True:
            last = self.state["messages"][-1]
            if last["role"] == "assistant" and last.get("tool_calls"):
                waiting = await self.answer_calls(last["tool_calls"], decision)
                decision = None
                if waiting is not None:
                    return waiting
                continue
            if last["role"] == "assistant":
                done = await self.finish(last["text"])
                if done is not None:
                    return done
                continue
            await self.model_turn()

    async def model_turn(self):
        if self.state["turns"] >= self.max_steps:
            raise NodeError(f"The agent didn't finish within {self.max_steps} model turns", code="agent_step_limit",
                            detail=self.detail())
        system = self.cfg["instructions"]
        if self.cfg.get("output"):
            system += "\n\n" + OUTPUT_RULE.format(schema=json.dumps(self.cfg["output"], ensure_ascii=False))
        tools = [{"name": t["name"], "description": t["description"], "parameters": t["parameters"]}
                 for t in self.tools.values()]
        turn = await self.ctx.gateway.converse(self.ctx.call, model_ref=self.cfg["model"],
                                               providers=self.ctx.run["plan"]["policies"]["providers"],
                                               system=system, messages=self.state["messages"], tools=tools,
                                               max_tokens=self.cfg.get("maxTokens") or 1024,
                                               temperature=self.cfg.get("temperature", 0.0))
        cost = turn.cost_usd or 0.0
        if self.ctx.call.budget_remaining is not None:
            self.ctx.call.budget_remaining -= cost
        self.state["turns"] += 1
        calls, seen = [], set()
        for i, c in enumerate(turn.tool_calls):
            cid = str(c.get("id") or "")
            if not cid or cid in seen or cid in self.state["calls"]:
                # Calls are remembered by id; a missing or reused id would replay another call's result.
                cid = f"{cid or 'call'}_{self.state['turns']}_{i}"
            seen.add(cid)
            calls.append({"id": cid, "name": str(c.get("name") or ""),
                          "arguments": c.get("arguments") if isinstance(c.get("arguments"), dict) else {}})
        self.state["messages"].append({"role": "assistant", "text": turn.text, "tool_calls": calls})
        self.state["model"] = {"provider": turn.provider, "model": turn.model}
        await self.save(cost)
        await self.trace("agent.turn", {"turn": self.state["turns"], "text": turn.text[:2000], "stop": turn.stop,
                                        "toolCalls": [{"id": c["id"], "name": c["name"], "arguments": c["arguments"]} for c in calls],
                                        "usage": turn.usage, "costUsd": cost, "provider": turn.provider, "model": turn.model})

    async def answer_calls(self, calls: list, decision: Optional[dict]) -> Optional[NodeOutcome]:
        results = []
        for call in calls:
            record = self.state["calls"].get(call["id"])
            if record and record.get("status") in ("done", "error", "rejected"):
                results.append(record["result"])
                continue
            tool = self.tools.get(call["name"])
            if not tool:
                results.append(await self.settle(call, f"There is no tool named {call['name']!r}.", "error"))
                continue
            problems = spec.validate_value(tool["parameters"], call["arguments"], "arguments")
            if problems:
                text = "Invalid arguments: " + "; ".join(f"{p.path}: {p.message}" for p in problems[:3])
                results.append(await self.settle(call, text, "error"))
                continue
            mocks = self.ctx.run.get("mocks") or {}
            if call["name"] in mocks:
                results.append(await self.settle(call, _as_text(mocks[call["name"]]), "done", mocked=True))
                continue
            # dispatched: approved and sent before the worker stopped; resend it.
            if needs_approval(tool) and not (record and record.get("status") in ("approved", "dispatched")):
                auto = self.ctx.run.get("auto_approval")
                if auto and decision is None:
                    # Eval runs and the local runner's --approve/--reject decide without a person.
                    record = self.state["calls"].setdefault(call["id"], {"tool": call["name"]})
                    record["status"] = "waiting"
                    decision = {"approved": auto == "approve", "by": None, "note": f"Decided automatically ({auto})"}
                if record and record.get("status") == "waiting" and decision is not None:
                    if decision.get("approved"):
                        record.update(status="approved", decidedBy=decision.get("by"), note=decision.get("note") or "")
                        await self.save()
                        await self.trace("agent.approval", {"id": call["id"], "tool": call["name"], "approved": True})
                    else:
                        note = decision.get("note") or ""
                        text = "A reviewer rejected this call." + (f" Their note: {note}" if note else "")
                        results.append(await self.settle(call, text, "rejected"))
                        await self.trace("agent.approval", {"id": call["id"], "tool": call["name"], "approved": False})
                        decision = None
                        continue
                    decision = None
                else:
                    self.state["calls"][call["id"]] = {"status": "waiting", "tool": call["name"]}
                    await self.save()
                    pending = {"tool": call["name"], "arguments": call["arguments"], "callId": call["id"],
                               "description": tool["description"], "writes": tool_writes(tool)}
                    await self.trace("agent.waiting", pending)
                    return NodeOutcome(pending, wait=True, detail=self.detail())
            if self.state["toolCalls"] >= self.max_calls:
                raise NodeError(f"The agent tried more than {self.max_calls} tool calls", code="agent_tool_limit",
                                detail=self.detail())
            results.append(await self.call_tool(call, tool))
        self.state["messages"].append({"role": "tool", "results": results})
        await self.save()
        return None

    async def settle(self, call: dict, text: str, status: str, *, mocked: bool = False) -> dict:
        result = {"id": call["id"], "name": call["name"], "content": _clip(text), "is_error": status != "done"}
        self.state["calls"][call["id"]] = {**self.state["calls"].get(call["id"], {}), "status": status,
                                           "tool": call["name"], "result": result}
        await self.save()
        await self.trace("agent.tool", {"id": call["id"], "tool": call["name"], "status": status, "mocked": mocked,
                                        "result": result["content"][:2000]})
        return result

    async def call_tool(self, call: dict, tool: dict) -> dict:
        self.state["toolCalls"] += 1
        self.state["calls"][call["id"]] = {**self.state["calls"].get(call["id"], {}), "status": "dispatched",
                                           "tool": call["name"]}
        await self.save()                 # the checkpoint before any outside work
        try:
            value = await self.execute(call, tool)
        except NodeError as e:
            if e.code == "missing_secret":
                raise                     # configuration, not something the model can fix: fail the run
            if e.transient:
                raise                     # the step is retried; this call resends with the same key
            return await self.settle(call, e.message, "error")
        return await self.settle(call, _as_text(value), "done")

    async def execute(self, call: dict, tool: dict) -> Any:
        args = call["arguments"]
        secrets = self.ctx.secrets or {}

        def resolve(path: str) -> Any:
            head, *rest = path.split(".")
            if head == "args":
                return templates.lookup(".".join(["a", *rest]), {"a": args})
            if head == "secrets" and rest and rest[0] in secrets:
                return secrets[rest[0]]
            raise templates.MissingValue(path)

        services = self.ctx.services
        if "code" in tool:
            if not services.run_code_app:
                raise NodeError("Code hosting isn't enabled on this server", code="code_unavailable")
            return await services.run_code_app(tool["code"]["app"], self.ctx.run.get("owner_id"), args, self.ctx.timeout)
        h = tool["http"]
        try:
            url = templates.render(h["url"], resolve)
            headers = templates.render(h.get("headers") or {}, resolve)
            body = templates.render(h["body"], resolve) if "body" in h else (args if h["method"] != "GET" else None)
        except templates.MissingValue as e:
            ref = e.args[0]
            if ref.startswith("secrets."):
                raise NodeError(f"Tool {call['name']}: the secret {ref.split('.', 1)[1]} has no value. Set it for this agent.",
                                code="missing_secret")
            raise NodeError(f"Missing argument for {{{{{ref}}}}}", code="missing_value")
        if not services.http:
            raise NodeError("Outbound HTTP isn't configured", code="http_unavailable")
        headers = dict(headers)
        write = h["method"] in WRITE_METHODS
        if write:
            scope = f"{self.ctx.run['id']}/{self.ctx.node_id}/{call['id']}"
            headers["Idempotency-Key"] = hashlib.sha256(scope.encode("utf-8")).hexdigest()[:40]
        try:
            resp = await services.http(h["method"], url, headers, body, self.ctx.run["plan"]["policies"]["outboundHosts"],
                                       min(self.ctx.timeout, 60), owner_id=self.ctx.run.get("owner_id"))
        except NodeError:
            raise
        except ValueError as e:
            raise NodeError(f"Request refused: {e}", code="http_refused")
        except Exception as e:
            raise NodeError(f"The request failed ({type(e).__name__})", transient=True, code="http_error")
        if resp.status in (408, 425, 429) or resp.status >= 500:
            raise NodeError(f"The API answered {resp.status}", transient=True, code="http_status")
        if resp.status >= 400:
            return {"status": resp.status, "error": resp.body}
        return {"status": resp.status, "body": resp.body}

    async def finish(self, text: str) -> Optional[NodeOutcome]:
        schema = self.cfg.get("output")
        if not schema:
            return NodeOutcome(text, detail=self.detail())
        data, problems = _parse_final(text, schema)
        if not problems:
            return NodeOutcome(data, detail=self.detail())
        if self.state.get("repaired"):
            raise NodeError("The agent's final answer didn't match the output schema: " + "; ".join(problems),
                            code="schema_mismatch", detail={**self.detail(), "errors": problems})
        # One repair turn, telling the model what was wrong.
        self.state["repaired"] = True
        self.state["messages"].append({"role": "user", "content": "Your answer was rejected: " + "; ".join(problems) +
                                       "\nReply again with valid JSON only."})
        await self.save()
        await self.trace("agent.repair", {"errors": problems})
        return None

    def detail(self) -> dict:
        return {"turns": self.state["turns"], "toolCalls": self.state["toolCalls"], "costUsd": self.state["costUsd"],
                **(self.state.get("model") or {})}


async def agent_loop(ctx: NodeContext) -> NodeOutcome:
    if ctx.checkpoint is None:
        raise NodeError("Agents need a runtime that saves their progress", code="agent_unavailable")
    return await _Agent(ctx).run()
