"""Prompt apps on native AEX nodes (phase 2, behind AEX_NATIVE_TYPES).

For a qualifying prompt app, the model call in main._execute_run_legacy's
standard streaming branch is no longer a direct provider call. The app's
configuration becomes an Application spec with one `llm.chat` node, compiled
by the platform compiler and run by the AEX orchestrator through the model
gateway. Everything around the call stays where it is: access, quotas,
visitor limits, key choice, the spend reservation, knowledge, logging and
the user-facing error messages.

Parity by construction: the gateway's provider adapter makes the provider
call with exactly the arguments the legacy line used, writes usage (and stop
reasons) into the legacy usage dict, and re-raises the provider's own
exception, so the legacy error handling answers exactly as before. Tokens
reach the caller in lockstep: the provider is read only as fast as the
caller reads.

Apps that don't qualify (tools, an output contract, images, a custom or
private model, an unknown provider, a temperature above 1, or a system
prompt longer than the llm.chat node allows) keep the legacy call.
"""
import asyncio
import os
import uuid
from typing import Any, AsyncIterator, Optional

from . import compiler, spec
from .gateway import ModelGateway
from .nodes import Services
from .orchestrator import Engine
from .store import MemoryStore

NATIVE_PROVIDERS = ("claude", "openai", "gemini")
MAX_PROMPT = 20000          # llm.chat's system and prompt limits (node_types)
_END = object()


def enabled_for(app_type: Optional[str]) -> bool:
    raw = os.getenv("AEX_NATIVE_TYPES", "").strip().lower()
    return bool(raw) and raw != "off" and (app_type or "") in {t.strip() for t in raw.split(",") if t.strip()}


def eligible(*, app_row: Optional[dict], provider: str, system: str, temperature: float, tools, contract_fields,
             custom: bool, images, private_only: bool) -> bool:
    return bool(app_row and enabled_for(app_row.get("app_type")) and app_row.get("app_type") == "prompt"
                and provider in NATIVE_PROVIDERS and not tools and not contract_fields and not custom
                and not images and not private_only and system and len(system) <= MAX_PROMPT
                and 0 <= temperature <= 1)


def app_spec(app_row: dict, *, system: str, provider: str, model: str, temperature: float) -> dict:
    """The prompt app as an Application resource: input text → llm.chat → output."""
    return {
        "apiVersion": spec.API_VERSION, "kind": "Application",
        "metadata": {"name": f"app-{str(app_row['id']).lower()}", "namespace": "legacy-apps", "version": "1",
                     "description": "Native AEX run of a prompt app"},
        "spec": {"workloads": [{
            "name": "chat", "type": "pipeline",
            "input": {"type": "object", "required": ["text"], "properties": {"text": {"type": "string"}}},
            "output": {"type": "string"},
            "nodes": [{"id": "answer", "use": "llm.chat", "model": f"{provider}/{model}", "system": system,
                       "prompt": "{{input.text}}", "temperature": temperature, "maxTokens": 4096}],
            "edges": [["input.text", "answer"], ["answer", "output"]],
        }]},
        "policies": {"providers": [provider]},
    }


class _LegacyCall:
    """The gateway's provider adapter: the legacy provider call, unchanged."""

    def __init__(self, host, *, api_key, usage: dict, temperature: float, failures: list):
        self.host = host
        self.api_key = api_key
        self.usage = usage
        self.temperature = temperature
        self.failures = failures

    async def stream(self, *, provider, model, api_key, system, prompt, max_tokens, temperature, usage):
        fn = self.host.stream_fn_for(provider)
        try:
            # Exactly the legacy line: same positional arguments, same keywords,
            # usage written into the legacy dict (stop reasons included).
            async for token in fn(system, prompt, model, self.api_key, temperature=self.temperature,
                                  usage_holder=self.usage):
                yield token
        except Exception as e:
            self.failures.append(e)
            raise
        usage.update({k: v for k, v in self.usage.items() if not k.startswith("_")})


async def stream(host, *, app_row: dict, system: str, user_input: str, provider: str, model: str, api_key,
                 temperature: float, usage: dict, caller) -> AsyncIterator[str]:
    """Tokens from the model, produced by an AEX run of the app's spec."""
    doc = app_spec(app_row, system=system, provider=provider, model=model, temperature=temperature)
    plan, problems = compiler.compile_workload(doc, "chat")
    if problems:
        # A configuration the node can't express (an unusual model id, say):
        # the legacy call, exactly as without the flag.
        async for token in host.stream_fn_for(provider)(system, user_input, model, api_key,
                                                        temperature=temperature, usage_holder=usage):
            yield token
        return
    # Spending is the legacy pipeline's reservation for the whole run, not a second budget here.
    plan["policies"]["budgetUsd"] = None

    outbox: asyncio.Queue = asyncio.Queue()
    demand = asyncio.Semaphore(0)
    failures: list = []

    async def on_token(text: str):
        await demand.acquire()                 # lockstep with the caller
        await outbox.put(text)

    async def key_for(ctx, name):
        return api_key or "legacy-default-key"   # the adapter passes the legacy key (possibly None) through

    adapter = _LegacyCall(host, api_key=api_key, usage=usage, temperature=temperature, failures=failures)
    gateway = ModelGateway(adapter, prices=host.MODEL_PRICES, key_for=key_for)
    store = MemoryStore()
    engine = Engine(store, gateway, Services(), worker_id=f"native-{uuid.uuid4().hex[:8]}", lease_seconds=24 * 3600)
    run = await engine.start(plan, {"text": user_input}, owner_id=getattr(caller, "user_id", None),
                             workspace_id=getattr(caller, "workspace_id", None), trigger="native")

    async def sink(event):
        if event["type"] == "node.token":
            await on_token(event["data"]["text"])

    async def drive():
        try:
            await engine.execute(run["id"], on_event=sink)
        finally:
            await outbox.put(_END)

    task = asyncio.create_task(drive())
    try:
        while True:
            demand.release()
            item = await outbox.get()
            if item is _END:
                break
            yield item
        await task
    finally:
        if not task.done():
            task.cancel()                       # the caller went away: stop the provider call too
            await asyncio.gather(task, return_exceptions=True)
        final = await store.get_run(run["id"])
        if final:
            if final["status"] not in ("succeeded", "failed", "needs_review"):
                final.update(status="cancelled", error="The caller disconnected")
            from . import app_adapter
            app_adapter._record_later(host, final)
    if failures:
        raise failures[0]                       # the provider's own error, for the legacy handlers
    if final and final["status"] != "succeeded":
        raise RuntimeError(f"Native run {final['status']}: {final.get('error')}")
