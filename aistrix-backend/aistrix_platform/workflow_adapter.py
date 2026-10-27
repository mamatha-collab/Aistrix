"""Legacy workflows on the AEX orchestrator (phase 2, behind AEX_WORKFLOWS).

main.run_flow keeps everything around execution: compiling and pinning the
definition, the flow_runs lease and heartbeat, the approve / continue /
review / cancel endpoints and the recovery sweep. Only the step loop moves:
each workflow step becomes a `workflow.step` node that calls main's own
run_flow_step, and the AEX orchestrator drives the run through FlowRunStore,
which reads and writes the flow_runs row in exactly the shape the old loop
wrote. Workflows have one engine when the flag is on, and nothing that reads
flow_runs (endpoints, Dev Studio, the Business workspace) changes.
"""
import os
from datetime import datetime, timezone
from typing import Any, Optional

from .errors import Conflict, NodeError
from .nodes import NodeContext, NodeOutcome
from .orchestrator import Engine

WORKFLOW_NODE = "workflow.step"
DONE = ("succeeded", "skipped")


def enabled() -> bool:
    return os.getenv("AEX_WORKFLOWS", "off").strip().lower() == "on"


def _node_id(idx: int) -> str:
    return f"s{idx}"


def plan_for(flow: dict, host) -> dict:
    """A linear AEX plan for a legacy definition: one node per step, run in
    order. Steps read earlier outputs themselves (input maps, previous
    output), so no node waits on another's value and a skipped step doesn't
    skip what follows."""
    steps = flow.get("steps") or []
    order = [_node_id(i) for i in range(len(steps))]
    nodes = {}
    for i, step in enumerate(steps):
        nodes[_node_id(i)] = {
            "use": WORKFLOW_NODE, "config": {"index": i}, "when": None,
            "retry": host.flow_step_attempts(step or {}),
            # run_flow_step enforces each app's own time limit.
            "timeoutSeconds": 24 * 3600,
            "sources": [{"from": "input", "node": None, "path": []}],
            # Repeat safety is decided per attempt from the step's own report.
            "sideEffect": False, "ancestors": [],
        }
    return {"planVersion": 1, "planId": ((flow.get("_plan") or {}).get("id") or "legacy"), "target": "hosted",
            "resource": f"Workflow/legacy-flows/flow-{str(flow.get('id')).lower()}@1", "workload": "steps",
            "input": {}, "output": {},
            "order": order, "nodes": nodes, "outputSource": {"from": "input", "node": None, "path": []},
            "policies": {"secrets": [], "outboundHosts": [], "providers": None, "budgetUsd": None},
            "surfaces": {"granted": [], "refused": []}}


class FlowRunStore:
    """The AEX Store interface over one legacy flow_runs row. The lease is
    run_flow's (lease_token + heartbeat); saves go through main's fenced
    _save_flow_run, so a worker that lost the run can't write to it."""

    def __init__(self, host, flow: dict, legacy: dict, plan: dict):
        self.host = host
        self.flow = flow
        self.legacy = legacy
        self.plan = plan
        self.version = 1
        self.saved_once = False
        self.events_seen: list = []

    # ── legacy row → AEX run ──────────────────────────────────────────────────

    def view(self) -> dict:
        run = self.legacy
        steps = {nid: {"status": "pending", "attempts": 0} for nid in self.plan["order"]}
        for rec in run.get("steps") or []:
            idx = rec.get("index")
            if idx is None or idx >= len(self.plan["order"]):
                continue
            status = {"ok": "succeeded", "skipped": "skipped", "waiting_approval": "waiting_approval",
                      "failed": "failed", "rejected": "rejected"}.get(rec.get("status"), "failed")
            steps[_node_id(idx)] = {"status": status, "attempts": rec.get("attempts") or 1, "legacy": rec,
                                    "output": rec.get("output") or "", "pending": rec.get("output") or "",
                                    "reason": rec.get("reason"), "error": rec.get("error")}
        status = {"running": "running", "waiting_approval": "waiting_approval", "done": "succeeded",
                  "failed": "failed", "cancelled": "cancelled"}.get(run.get("status"), "running")
        return {"id": run["id"], "resource": self.plan["resource"], "resource_key": self.plan["resource"].split("@")[0],
                "workload": "steps", "plan": self.plan, "plan_id": self.plan["planId"], "owner_id": run.get("user_id"),
                "workspace_id": None, "trigger": run.get("trigger"), "status": status, "input": run.get("seed_input") or "",
                "output": None, "error": run.get("error"), "cost_usd": 0.0, "budget_usd": None,
                "cancel_requested": False, "mocks": {}, "auto_approval": None, "steps": steps,
                "version": self.version, "finished_at": run.get("finished_at")}

    async def get_run(self, run_id: str) -> Optional[dict]:
        run = self.view()
        # The cancel endpoint writes the row directly; the loop checks it like before.
        run["cancel_requested"] = await self.host._flow_run_cancelled(run_id)
        return run

    # ── AEX run → legacy row ──────────────────────────────────────────────────

    def _record(self, idx: int, step: dict) -> Optional[dict]:
        steps = self.flow.get("steps") or []
        name = self.host._step_name(steps, idx)
        detail = step.get("detail") or {}
        status = step["status"]
        if step.get("legacy") and step["legacy"].get("status") == {"succeeded": "ok"}.get(status, status):
            return step["legacy"]                           # written by an earlier pass; keep it exactly
        if status == "succeeded":
            rec = {"index": idx, "name": name, "status": "ok", "version": detail.get("version"),
                   "output": (step.get("output") or "")[:self.host.FLOW_OUTPUT_LIMIT], "error": None}
            if detail.get("ai_filled"):
                rec["ai_filled"] = detail["ai_filled"]
            if step["attempts"] > 1:
                rec["attempts"] = step["attempts"]
            return rec
        if status == "skipped":
            return {"index": idx, "name": name, "status": "skipped", "error": None, "output": "", "reason": step.get("reason")}
        if status == "waiting_approval":
            return {"index": idx, "name": name, "status": "waiting_approval",
                    "output": (step.get("pending") or "")[:self.host.FLOW_OUTPUT_LIMIT]}
        if status in ("failed", "uncertain"):
            rec = {"index": idx, "name": name, "status": "failed", "version": detail.get("version"),
                   "output": "", "error": step.get("error"), "sent": bool(detail.get("sent"))}
            if status == "uncertain":
                rec["uncertain"] = True
            if step["attempts"] > 1:
                rec["attempts"] = step["attempts"]
            return rec
        return None                                         # pending, running: not recorded yet

    def apply(self, run: dict) -> None:
        legacy = self.legacy
        records, current = [], len(self.plan["order"])
        for idx, nid in enumerate(self.plan["order"]):
            step = run["steps"][nid]
            rec = self._record(idx, step)
            if rec is None:
                current = idx
                break
            records.append(rec)
            if step["status"] not in DONE:
                current = idx
                break
        legacy["steps"] = records
        legacy["current_step"] = current
        status = run["status"]
        if status in ("succeeded",):
            legacy.update(status="done", current_step=len(self.plan["order"]), error=None,
                          finished_at=run.get("finished_at") or datetime.now(timezone.utc).isoformat())
        elif status in ("failed", "needs_review", "rejected"):
            legacy["status"] = "failed"
            legacy["finished_at"] = run.get("finished_at")
            failed = next((i for i, nid in enumerate(self.plan["order"])
                           if run["steps"][nid]["status"] in ("failed", "uncertain")), None)
            if failed is not None:
                step = run["steps"][self.plan["order"][failed]]
                name = self.host._step_name(self.flow.get("steps") or [], failed)
                error = f"Step {self.host._step_number(self.flow, failed)} ({name}) {step.get('error')}"
                if step["status"] == "uncertain":
                    legacy["needs_review"] = True
                    error += (". It may have reached an outside service before failing, so it wasn't repeated. "
                              "Check the destination, then continue the run or dismiss it.")
                elif step["attempts"] > 1:
                    error += f" (tried {step['attempts']} times)"
                legacy["error"] = error
            else:
                legacy["error"] = run.get("error")
        elif status == "waiting_approval":
            legacy["status"] = "waiting_approval"
        elif status == "cancelled":
            legacy["status"] = "cancelled"
        else:
            legacy["status"] = "running"

    async def save_run(self, run: dict) -> None:
        if run["version"] != self.version:
            raise Conflict("The run changed since it was read")
        self.version += 1
        run["version"] = self.version
        before = repr((self.legacy.get("status"), self.legacy.get("current_step"), self.legacy.get("steps")))
        self.apply(run)
        if run["status"] == "cancelled":
            return               # the cancel endpoint already wrote the row, as the old loop assumed
        after = repr((self.legacy.get("status"), self.legacy.get("current_step"), self.legacy.get("steps")))
        if not self.saved_once and before == after:
            # Marking an already-running row as running: nothing to write. Every
            # later save is kept, including the fence before each step.
            self.saved_once = True
            return
        self.saved_once = True
        await self.host._save_flow_run(self.legacy)

    # run_flow holds the lease; the AEX lease calls are no-ops here.
    async def claim(self, run_id, worker, seconds) -> bool:
        return True

    async def renew(self, run_id, worker, seconds) -> bool:
        return True

    async def release(self, run_id, worker) -> None:
        return None

    async def append_event(self, run_id, event) -> None:
        self.events_seen.append(event)

    async def events(self, run_id, after=0):
        return self.events_seen[after:]


class _StepRunner:
    """The `workflow.step` node: what the old loop did for one step."""

    def __init__(self, host, flow: dict, caller, trigger: str, store: FlowRunStore):
        self.host = host
        self.flow = flow
        self.caller = caller
        self.trigger = trigger
        self.store = store
        self.memory = dict(flow.get("memory") or {})
        self.provenance = dict(flow.get("memory_provenance") or {})
        self.learns = flow.get("kind") != "developer" and flow.get("privacy") != "private_only"
        self.fact_key = None
        self.fact_key_loaded = False

    def _earlier(self, run: dict, idx: int):
        """(current input, results, sources) from the steps before idx, the way
        the old loop accumulated them."""
        host, steps = self.host, self.flow.get("steps") or []
        seed = run.get("input") or ""
        current, results = seed, []
        sources = {"trigger": host._flow_data(seed)}
        for i in range(idx):
            step = run["steps"][_node_id(i)]
            if step["status"] == "succeeded":
                out = step.get("output") or ""
                current = out
                results.append(out)
                sid = (steps[i] or {}).get("id")
                if sid:
                    sources[sid] = host._flow_data(out)
            elif step["status"] == "skipped":
                results.append("")
        return current, results, sources

    async def __call__(self, ctx: NodeContext) -> NodeOutcome:
        host, steps = self.host, self.flow.get("steps") or []
        idx = ctx.node["config"]["index"]
        current, results, sources = self._earlier(ctx.run, idx)
        cond = (steps[idx] or {}).get("run_if")
        if cond and not host.flow_condition_met(cond, sources):
            return NodeOutcome(None, skipped=cond.get("label") or "Its condition wasn't met")
        try:
            out = await host.run_flow_step(self.flow, idx, caller=self.caller, trigger=self.trigger, step_input=current,
                                           results=results, memory=self.memory, sources=sources)
        except Exception as e:
            host.sentry_sdk.capture_exception(e)
            out = {"status": "failed", "error": f"failed unexpectedly ({type(e).__name__})"}
        if out["status"] == "waiting_approval":
            return NodeOutcome(current, wait=True)
        if out["status"] != "ok":
            transient = bool(out.get("transient"))
            raise NodeError(out.get("error") or "failed", transient=transient, uncertain=bool(out.get("uncertain")),
                            repeat_safe=bool(out.get("repeat_safe")),
                            detail={"version": out.get("version"), "sent": bool(out.get("dispatched"))})
        output = out.get("output") or ""
        if self.learns:
            if not self.fact_key_loaded:
                self.fact_key = await host.fetch_user_api_key_by_id(self.caller.user_id, "claude") if self.caller.user_id else None
                self.fact_key_loaded = True
            facts = await host.extract_facts_headless(output, self.fact_key)
            if facts:
                self.memory = host.merge_memory(self.memory, facts)
                now_iso = datetime.now(timezone.utc).isoformat()
                for key in facts:
                    self.provenance[key] = {"step_name": host._step_name(steps, idx), "step_index": idx, "updated_at": now_iso}
                await host._save_flow_memory(self.flow, self.memory, self.provenance)
        return NodeOutcome(output, detail={"version": out.get("version"), "ai_filled": out.get("ai_filled") or []})


async def execute_flow(host, flow: dict, *, caller, trigger: str, run: dict) -> dict:
    """Drop-in for main._execute_flow: run (or continue) a workflow on AEX and
    return the legacy run record."""
    plan = plan_for(flow, host)
    store = FlowRunStore(host, flow, run, plan)
    runner = _StepRunner(host, flow, caller, trigger, store)
    engine = Engine(store, None, worker_id=f"flow-{run['id'][:8]}", lease_seconds=24 * 3600,
                    backoff=lambda attempt: host.flow_retry_delay(attempt), runtimes={WORKFLOW_NODE: runner})
    engine._sleep = lambda seconds: host.asyncio.sleep(seconds)
    result = await engine.execute(run["id"])
    if result["status"] == "waiting_approval" and trigger != "interactive":
        idx = run.get("current_step") or 0
        await host._notify_flow_waiting(flow, run, host._step_name(flow.get("steps") or [], idx))
    if result["status"] == "succeeded" and flow.get("privacy") != "private_only":
        _, results, _ = runner._earlier(result, len(plan["order"]))
        await host._post_flow_integration(flow, flow.get("steps") or [], results)
    return run
