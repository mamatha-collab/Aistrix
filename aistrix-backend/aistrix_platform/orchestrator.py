"""AEX orchestrator (data plane): runs a compiled plan durably.

- Every step's state is saved before and after it runs, so a run survives a
  worker crash and resumes at the first unfinished step.
- Delivery is at least once. A step with an outside effect is marked
  "dispatched" before it is sent; after a crash it is repeated only when it
  carries an idempotency key (the API dedupes it). Otherwise the run stops
  for review instead of guessing.
- A lease (with heartbeat) means one worker advances a run at a time.
- human.approve pauses the run until someone decides; it can expire.
- Retries with backoff for transient failures, only when repeating is safe.
- The run's budget caps model spend; each call reserves before it's made.
"""
import asyncio
import hashlib
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from . import spec, templates
from .errors import BudgetExceeded, Conflict, InputError, LeaseHeld, LeaseLost, NodeError
from .gateway import CallContext, ModelGateway
from .nodes import RUNTIMES, NodeContext, Services
from .store import Store

TERMINAL = ("succeeded", "failed", "cancelled", "rejected", "needs_review")
STEP_DONE = ("succeeded", "skipped")
MAX_OUTPUT_CHARS = 200_000
APPROVAL_HOURS = 72

EventSink = Callable[[dict], Awaitable[None]]


def _iso(ts: Optional[float] = None) -> str:
    return datetime.fromtimestamp(ts if ts is not None else time.time(), timezone.utc).isoformat()


class _Missing:
    pass


MISSING = _Missing()


def backoff(attempt: int) -> float:
    return min(30.0, 0.5 * (2 ** (attempt - 1)))


class Engine:
    def __init__(self, store: Store, gateway: ModelGateway, services: Optional[Services] = None, *,
                 worker_id: Optional[str] = None, lease_seconds: float = 60.0,
                 clock: Callable[[], float] = time.time):
        self.store = store
        self.gateway = gateway
        self.services = services or Services()
        self.worker_id = worker_id or f"aex-{uuid.uuid4().hex[:12]}"
        self.lease_seconds = lease_seconds
        self.clock = clock
        self._sleep = self.services.sleep or asyncio.sleep

    # ── Starting and controlling runs ─────────────────────────────────────────

    async def start(self, plan: dict, input_value: Any, *, owner_id: Optional[str], workspace_id: Optional[str] = None,
                    release_id: Optional[str] = None, environment: Optional[str] = None, trigger: str = "api",
                    run_id: Optional[str] = None) -> dict:
        problems = spec.validate_value(plan["input"], input_value, "input")
        if problems:
            raise InputError(problems)
        now = self.clock()
        run = {
            "id": run_id or str(uuid.uuid4()),
            "resource": plan["resource"],
            "resource_key": spec.parse_ref(plan["resource"]).key,
            "workload": plan["workload"],
            "release_id": release_id,
            "environment": environment,
            "plan_id": plan["planId"],
            "plan": plan,
            "owner_id": owner_id,
            "workspace_id": workspace_id,
            "trigger": trigger,
            "status": "queued",
            "input": input_value,
            "output": None,
            "error": None,
            "cost_usd": 0.0,
            "budget_usd": plan["policies"]["budgetUsd"],
            "cancel_requested": False,
            "steps": {nid: {"status": "pending", "attempts": 0} for nid in plan["order"]},
            "created_at": _iso(now),
            "updated_at": _iso(now),
            "finished_at": None,
        }
        await self.store.create_run(run)
        await self._event(run, "run.created", None)
        return await self.store.get_run(run["id"])

    async def approve(self, run_id: str, node_id: str, *, approved: bool, by: Optional[str], note: str = "") -> dict:
        run = await self._load(run_id)
        step = run["steps"].get(node_id)
        if run["status"] != "waiting_approval" or not step or step["status"] != "waiting_approval":
            raise Conflict("This run isn't waiting for that approval")
        if step.get("expiresAt") and step["expiresAt"] < _iso(self.clock()):
            step.update(status="rejected", decidedBy=None, note="The approval expired")
        else:
            step.update(status="approved" if approved else "rejected", decidedBy=by, note=note[:500], decidedAt=_iso(self.clock()))
        run["status"] = "queued"
        await self._save(run)
        await self._event(run, "node.decided", node_id, {"approved": step["status"] == "approved"})
        return run

    async def cancel(self, run_id: str) -> dict:
        run = await self._load(run_id)
        if run["status"] in TERMINAL:
            return run
        if run["status"] in ("queued", "waiting_approval"):
            run.update(status="cancelled", finished_at=_iso(self.clock()))
        else:
            run["cancel_requested"] = True
        await self._save(run)
        await self._event(run, "run.cancel_requested", None)
        return run

    # ── Executing ─────────────────────────────────────────────────────────────

    async def execute(self, run_id: str, *, on_event: Optional[EventSink] = None) -> dict:
        """Advance the run until it finishes or waits. Safe to call again
        after a crash: finished steps are not repeated."""
        if not await self.store.claim(run_id, self.worker_id, self.lease_seconds):
            raise LeaseHeld("Another worker is running this run")
        lost = asyncio.Event()
        heartbeat = asyncio.create_task(self._heartbeat(run_id, lost))
        try:
            run = await self._load(run_id)
            if run["status"] in TERMINAL or run["status"] == "waiting_approval":
                return run
            if run["cancel_requested"]:
                return await self._finish(run, "cancelled", None, on_event)
            run["status"] = "running"
            await self._save(run)
            await self._event(run, "run.started", None, sink=on_event)
            return await self._advance(run, lost, on_event)
        finally:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            await self.store.release(run_id, self.worker_id)

    async def _heartbeat(self, run_id: str, lost: asyncio.Event) -> None:
        while True:
            await asyncio.sleep(max(1.0, self.lease_seconds / 3))
            if not await self.store.renew(run_id, self.worker_id, self.lease_seconds):
                lost.set()
                return

    async def _advance(self, run: dict, lost: asyncio.Event, on_event: Optional[EventSink]) -> dict:
        plan = run["plan"]
        secrets = await self._secrets(run)
        for nid in plan["order"]:
            step = run["steps"][nid]
            if step["status"] in STEP_DONE:
                continue
            fresh = await self._load(run["id"])
            if fresh["cancel_requested"]:
                run = fresh
                return await self._finish(run, "cancelled", None, on_event)
            if lost.is_set():
                raise LeaseLost("Lost the run's lease; another worker may take over")
            node = plan["nodes"][nid]
            value = self._incoming(run, node)
            if value is MISSING:
                step.update(status="skipped", reason="Every input to this step was skipped")
                await self._save(run)
                await self._event(run, "node.skipped", nid, sink=on_event)
                continue
            needed = self._when(run, node)
            if node["use"] == "human.approve":
                outcome = await self._approval(run, nid, node, value, needed, on_event)
                if outcome is not None:
                    return outcome
                continue
            if not needed:
                step.update(status="skipped", reason=f"{node['when']} was false")
                await self._save(run)
                await self._event(run, "node.skipped", nid, sink=on_event)
                continue
            if step["status"] == "dispatched" and not step.get("idempotencyKey"):
                # It may have reached the outside service; never guess.
                step["status"] = "uncertain"
                return await self._finish(run, "needs_review", f"Step {nid} may have run before the worker stopped. "
                                          "Check the destination before running it again.", on_event)
            failed = await self._run_node(run, nid, node, value, secrets, lost, on_event)
            if failed:
                return failed
        output = self._resolve_source(run, plan["outputSource"])
        if output is MISSING:
            return await self._finish(run, "failed", "The step wired to output was skipped, so there is no output", on_event)
        problems = spec.validate_value(plan["output"], output, "output")
        if problems:
            return await self._finish(run, "failed", "The output doesn't match the output schema: " +
                                      "; ".join(f"{p.path}: {p.message}" for p in problems[:3]), on_event)
        run["output"] = output
        return await self._finish(run, "succeeded", None, on_event)

    async def _approval(self, run, nid, node, value, needed, on_event) -> Optional[dict]:
        step = run["steps"][nid]
        if not needed:
            step.update(status="succeeded", output=value, note=f"Approval not needed ({node['when']} was false)")
            await self._save(run)
            await self._event(run, "node.finished", nid, {"approval": "not_needed"}, sink=on_event)
            return None
        if step["status"] == "approved":
            step.update(status="succeeded", output=value, approved=True)
            await self._save(run)
            await self._event(run, "node.finished", nid, {"approval": "approved"}, sink=on_event)
            return None
        if step["status"] == "rejected":
            return await self._finish(run, "rejected", step.get("note") or f"Step {nid} was rejected", on_event)
        if step["status"] == "waiting_approval":
            if step.get("expiresAt") and step["expiresAt"] < _iso(self.clock()):
                step.update(status="rejected", note="The approval expired")
                return await self._finish(run, "rejected", f"The approval for {nid} expired", on_event)
            run["status"] = "waiting_approval"
            await self._save(run)
            return run
        hours = node["config"].get("expiresHours") or APPROVAL_HOURS
        step.update(status="waiting_approval", pending=_clip(value), message=node["config"].get("message") or "",
                    expiresAt=_iso(self.clock() + hours * 3600), startedAt=_iso(self.clock()))
        run["status"] = "waiting_approval"
        await self._save(run)
        await self._event(run, "run.waiting", nid, {"expiresAt": step["expiresAt"]}, sink=on_event)
        return run

    async def _run_node(self, run, nid, node, value, secrets, lost, on_event) -> Optional[dict]:
        step = run["steps"][nid]
        attempts_allowed = node["retry"]
        resolver = self._resolver(run, secrets)
        try:
            config = templates.render(node["config"], resolver)
        except templates.MissingValue as e:
            step.update(status="failed", error=f"No value for {{{{{e.args[0]}}}}}")
            return await self._finish(run, "failed", f"Step {nid}: no value for {{{{{e.args[0]}}}}}", on_event)
        key = None
        if node["config"].get("idempotencyKey"):
            scope = f"{run['resource_key']}/{run['workload']}/{config['idempotencyKey']}"
            key = hashlib.sha256(scope.encode("utf-8")).hexdigest()[:40]
            step["idempotencyKey"] = key
        repeat_safe = not node["sideEffect"] or key is not None
        while True:
            if lost.is_set():
                raise LeaseLost("Lost the run's lease; another worker may take over")
            remaining = None if run["budget_usd"] is None else max(0.0, run["budget_usd"] - run["cost_usd"])
            step.update(status="dispatched" if node["sideEffect"] else "running",
                        attempts=step["attempts"] + 1, startedAt=_iso(self.clock()), error=None)
            await self._save(run)        # the checkpoint before any outside work
            await self._event(run, "node.started", nid, {"attempt": step["attempts"]}, sink=on_event)

            async def token(text: str, _nid=nid):
                if on_event:
                    await on_event({"type": "node.token", "node": nid, "data": {"text": text}, "run": run["id"]})

            call = CallContext(owner_id=run["owner_id"], workspace_id=run["workspace_id"], resource=run["resource"],
                               budget_remaining=remaining, on_token=token)
            ctx = NodeContext(run=run, node_id=nid, node=node, config=config, value=value, gateway=self.gateway,
                              services=self.services, call=call, idempotency_key=key, timeout=node["timeoutSeconds"])
            try:
                outcome = await asyncio.wait_for(RUNTIMES[node["use"]](ctx), timeout=node["timeoutSeconds"])
            except asyncio.TimeoutError:
                error = NodeError(f"Timed out after {node['timeoutSeconds']}s", transient=True, uncertain=node["sideEffect"])
            except NodeError as e:
                error = e
            except Exception as e:
                error = NodeError(f"Failed unexpectedly ({type(e).__name__})", uncertain=node["sideEffect"])
            else:
                run["cost_usd"] = round(run["cost_usd"] + (outcome.cost_usd or 0.0), 6)
                step.update(status="succeeded", output=_clip(outcome.output), detail=outcome.detail,
                            cost_usd=outcome.cost_usd, finishedAt=_iso(self.clock()))
                await self._save(run)
                await self._event(run, "node.finished", nid, {"cost_usd": outcome.cost_usd}, sink=on_event)
                return None
            step["error"] = error.message
            if error.transient and repeat_safe and step["attempts"] < attempts_allowed:
                await self._save(run)
                await self._event(run, "node.retrying", nid, {"error": error.message}, sink=on_event)
                await self._sleep(backoff(step["attempts"]))
                continue
            if error.uncertain and not repeat_safe:
                step["status"] = "uncertain"
                return await self._finish(run, "needs_review", f"Step {nid} {error.message}. It may have reached the "
                                          "outside service, so it wasn't repeated.", on_event)
            step["status"] = "failed"
            status = "failed"
            text = f"Step {nid}: {error.message}"
            if step["attempts"] > 1:
                text += f" (tried {step['attempts']} times)"
            if isinstance(error, BudgetExceeded):
                text = f"Step {nid}: {error.message}"
            return await self._finish(run, status, text, on_event)

    # ── Values ────────────────────────────────────────────────────────────────

    def _resolve_source(self, run: dict, source: dict) -> Any:
        if source["node"] is None:
            value = run["input"]
        else:
            step = run["steps"][source["node"]]
            if step["status"] != "succeeded":
                return MISSING
            value = step.get("output")
        for part in source["path"]:
            if isinstance(value, dict) and part in value:
                value = value[part]
            else:
                return None
        return value

    def _incoming(self, run: dict, node: dict) -> Any:
        values = {s["from"]: self._resolve_source(run, s) for s in node["sources"]}
        present = {k: v for k, v in values.items() if v is not MISSING}
        if not present:
            return MISSING
        if len(node["sources"]) == 1:
            return next(iter(present.values()))
        return present

    def _when(self, run: dict, node: dict) -> bool:
        if not node.get("when"):
            return True
        head, *path = node["when"].split(".")
        value = self._resolve_source(run, {"node": head, "path": path})
        return bool(value) and value is not MISSING

    def _resolver(self, run: dict, secrets: dict) -> Callable[[str], Any]:
        def resolve(path: str) -> Any:
            head, *rest = path.split(".")
            if head == "secrets":
                if rest and rest[0] in secrets:
                    return secrets[rest[0]]
                raise templates.MissingValue(path)
            if head == "input":
                base = run["input"]
            else:
                step = run["steps"].get(head) or {}
                if step.get("status") != "succeeded":
                    raise templates.MissingValue(path)
                base = step.get("output")
            return templates.lookup(".".join(["v", *rest]), {"v": base})
        return resolve

    async def _secrets(self, run: dict) -> dict:
        names = run["plan"]["policies"]["secrets"]
        if not names:
            return {}
        if not self.services.secrets:
            return {}
        return await self.services.secrets(run["owner_id"], names)

    # ── Persistence ───────────────────────────────────────────────────────────

    async def _load(self, run_id: str) -> dict:
        run = await self.store.get_run(run_id)
        if not run:
            raise KeyError(run_id)
        return run

    async def _save(self, run: dict) -> None:
        run["updated_at"] = _iso(self.clock())
        await self.store.save_run(run)

    async def _finish(self, run: dict, status: str, error: Optional[str], on_event: Optional[EventSink]) -> dict:
        run.update(status=status, error=error, finished_at=_iso(self.clock()))
        await self._save(run)
        await self._event(run, "run.finished", None, {"status": status, "error": error, "cost_usd": run["cost_usd"]},
                          sink=on_event)
        return run

    async def _event(self, run: dict, kind: str, node: Optional[str], data: Optional[dict] = None, *,
                     sink: Optional[EventSink] = None) -> None:
        event = {"type": kind, "node": node, "data": data or {}, "at": _iso(self.clock()), "run": run["id"]}
        await self.store.append_event(run["id"], event)
        if sink:
            await sink(event)


def _clip(value: Any) -> Any:
    """Outputs are kept whole up to a size; larger text is cut with a note."""
    if isinstance(value, str) and len(value) > MAX_OUTPUT_CHARS:
        return value[:MAX_OUTPUT_CHARS]
    return value
