"""Existing app types on the AEX orchestrator (phase 2, behind AEX_APP_TYPES).

AEX_APP_TYPES is empty by default (off), "all", or a comma list of app types
("prompt,native,api"). For those types every run of main.execute_run (the
browser, the public API, workflows, batches, embeds) is an AEX run with one
`legacy.app` node. The node calls the unchanged legacy pipeline and forwards
its stream chunk by chunk, so what callers receive is byte-for-byte the same;
what changes is that the orchestrator drives the run and each finished run
is recorded in platform_runs.

Refusals the legacy pipeline answers before streaming (not found, access,
limits, spending) are passed through untouched. Recording is best effort: a
missing table or a failed write never fails an app run. Only finished runs
are written, so the resume supervisor never sees an app run it can't continue.
"""
import asyncio
import json
import os
import time
import uuid
from typing import Any, Optional

from starlette.responses import StreamingResponse

from .errors import NodeError
from .nodes import NodeContext, NodeOutcome
from .orchestrator import Engine
from .store import MemoryStore

APP_NODE = "legacy.app"
_END = object()
_RECORD_TASKS: set = set()
_RECORD_WARNED = {"done": False}


def enabled_for(app_type: Optional[str]) -> bool:
    raw = os.getenv("AEX_APP_TYPES", "").strip().lower()
    if not raw or raw == "off":
        return False
    if raw == "all":
        return True
    return (app_type or "prompt").lower() in {t.strip() for t in raw.split(",") if t.strip()}


def _plan(app_id: str) -> dict:
    # A valid resource reference, so the run sits beside platform resources.
    return {"planVersion": 1, "planId": "legacy-app", "target": "hosted",
            "resource": f"Application/legacy-apps/app-{app_id.lower()}@1",
            "workload": "run", "input": {}, "output": {}, "order": ["app"],
            "nodes": {"app": {"use": APP_NODE, "config": {}, "when": None, "retry": 1, "timeoutSeconds": 24 * 3600,
                              "sources": [{"from": "input", "node": None, "path": []}], "sideEffect": False,
                              "ancestors": []}},
            "outputSource": {"from": "app", "node": "app", "path": []},
            "policies": {"secrets": [], "outboundHosts": [], "providers": None, "budgetUsd": None},
            "surfaces": {"granted": [], "refused": []}}


def _summarise(chunks: list) -> tuple[dict, Optional[dict]]:
    """(result, error event) from the SSE chunks the legacy pipeline sent."""
    parts, final, error = [], {}, None
    for chunk in chunks:
        text = chunk.decode() if isinstance(chunk, bytes) else str(chunk)
        for raw in text.split("\n"):
            if not raw.startswith("data: "):
                continue
            try:
                ev = json.loads(raw[6:])
            except ValueError:
                continue
            if "token" in ev:
                parts.append(ev["token"])
            elif ev.get("done"):
                final = {k: ev.get(k) for k in ("usage", "provider", "model")}
            elif "contract_error" in ev or "error" in ev:
                error = ev
    return {"output": "".join(parts), **final}, error


def _final(chunk) -> bool:
    """Whether a chunk carries the run's last event (done, error, contract error)."""
    text = chunk.decode() if isinstance(chunk, bytes) else str(chunk)
    for raw in text.split("\n"):
        if raw.startswith("data: "):
            try:
                ev = json.loads(raw[6:])
            except ValueError:
                continue
            if ev.get("done") or "error" in ev or "contract_error" in ev:
                return True
    return False


async def _record(host, run: dict) -> None:
    sb = host._service_client()
    if not sb:
        return
    row = {"id": run["id"], "owner_id": run.get("owner_id"), "workspace_id": run.get("workspace_id"),
           "resource_key": run["resource_key"], "workload": "run", "release_id": None, "environment": None,
           "trigger": run["trigger"], "status": run["status"], "record": {k: v for k, v in run.items() if k != "plan"},
           "version": run.get("version") or 1, "created_at": run["created_at"], "updated_at": run["updated_at"]}
    try:
        await host.db(sb.table("platform_runs").insert(row))
    except Exception as e:
        if not _RECORD_WARNED["done"]:
            _RECORD_WARNED["done"] = True
            print(f"AEX app runs aren't being recorded ({type(e).__name__}); check the platform_v1 migration")


def _record_later(host, run: dict) -> None:
    task = asyncio.create_task(_record(host, run))
    _RECORD_TASKS.add(task)
    task.add_done_callback(_RECORD_TASKS.discard)


async def execute_run(host, legacy, req, request, *, caller, **kwargs):
    """Drop-in for main.execute_run for flagged app types."""
    response = await legacy(req, request, caller=caller, **kwargs)
    if not isinstance(response, StreamingResponse):
        return response                                   # refused before running: unchanged
    # Lockstep: the legacy stream is asked for its next chunk only when the
    # caller asks for one, exactly as without the adapter. A caller that stops
    # reading leaves it paused where it was, and its own cancel handling runs
    # (the legacy pipeline records side effects before its final chunk).
    queue: asyncio.Queue = asyncio.Queue()
    demand = asyncio.Semaphore(0)
    seen: list = []

    async def node(ctx: NodeContext) -> NodeOutcome:
        iterator = response.body_iterator
        try:
            while True:
                await demand.acquire()
                try:
                    chunk = await iterator.__anext__()
                except StopAsyncIteration:
                    break
                seen.append(chunk)
                await queue.put(chunk)
                if _final(chunk):
                    # "done" or an error is the run's last event; API callers stop
                    # reading there (side effects already ran before it), so the
                    # run is finished here rather than when the stream is drained.
                    break
        finally:
            closer = getattr(response.body_iterator, "aclose", None)
            if closer:
                await closer()
        result, error = _summarise(seen)
        if error:
            raise NodeError(str(error.get("error") or "Output contract failed")[:500],
                            detail={"kind": error.get("kind"), "contract_error": error.get("contract_error")})
        return NodeOutcome(result, detail={"usage": result.get("usage"), "provider": result.get("provider"),
                                           "model": result.get("model")})

    store = MemoryStore()
    engine = Engine(store, None, worker_id=f"app-{uuid.uuid4().hex[:8]}", lease_seconds=24 * 3600,
                    runtimes={APP_NODE: node})
    app_id = req.app_id or "inline"
    trigger = "api" if caller.via_key else "app"
    run = await engine.start(_plan(app_id), {}, owner_id=caller.user_id, workspace_id=caller.workspace_id, trigger=trigger)

    async def drive():
        try:
            await engine.execute(run["id"])
        finally:
            await queue.put(_END)

    async def body():
        task = asyncio.create_task(drive())
        try:
            while True:
                demand.release()
                chunk = await queue.get()
                if chunk is _END:
                    break
                yield chunk
            await task
        finally:
            if not task.done():
                task.cancel()                             # the caller went away: stop the legacy stream too
                await asyncio.gather(task, return_exceptions=True)
            final = await store.get_run(run["id"])
            if final and final["status"] not in ("succeeded", "failed", "needs_review"):
                final.update(status="cancelled", error="The caller disconnected",
                             updated_at=final["updated_at"])
            if final:
                _record_later(host, final)

    return StreamingResponse(body(), status_code=response.status_code, media_type=response.media_type,
                             headers={k: v for k, v in response.headers.items() if k.lower() != "content-length"},
                             background=response.background)
