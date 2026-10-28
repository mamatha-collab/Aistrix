"""Phase 2 parity for prompt apps on native AEX nodes (AEX_NATIVE_TYPES=prompt).

The same request runs with the legacy provider call and with the native
path (an Application spec with one llm.chat node, compiled and run by the AEX
orchestrator through the model gateway). They must match on:

- HTTP status and response body, byte for byte (ids and times masked),
- the provider call: system prompt, input, model, key, temperature, options,
- the rows the run wrote (the app's run log, metering), minus ids and times,
- and the native path must really have run: one AEX run record whose
  llm.chat node has the run's outcome. Apps that don't qualify must keep the
  legacy call and leave no native record.

Runs are made by a regular end user of a public app (the run log is written).
Writes docs/architecture/native-prompt-parity-report.md.
"""
import asyncio
import copy
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import _harness
from _harness import finish


def ok(name, cond, detail=None):
    if not _harness.ok(name, cond) and detail is not None:
        print(f"  detail: {str(detail)[:900]}")


_harness.setup(AEX_APP_TYPES="", AEX_NATIVE_TYPES="", PLATFORM_RESUME_SECONDS="0")
import anthropic
import httpx
import main
from fastapi.testclient import TestClient
from starlette.requests import Request

import _parity
from _parity import BLUEPRINTS, OTHER, SB, clone_app, make_app, mask, rows_for, wait_for, written_for

PROVIDER = []
MODE = {"kind": "ok"}
KNOWLEDGE: dict = {}


def _auth_error():
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.AuthenticationError("invalid x-api-key", response=httpx.Response(401, request=req), body=None)


async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    PROVIDER.append({"system": system, "input": user_input, "model": model, "key": api_key, "max_tokens": max_tokens,
                     "temperature": temperature, "extra": sorted(kw)})
    kind = MODE["kind"]
    if kind == "auth":
        raise _auth_error()
    if kind == "timeout":
        yield "partial "
        raise asyncio.TimeoutError()
    if kind == "boom":
        yield "half an ans"
        raise RuntimeError("socket closed")
    for part in ("Hello ", "from ", "the ", "app."):
        yield part
    if usage_holder is not None:
        usage_holder.update(input_tokens=30, output_tokens=8)
        if kind in ("max_tokens", "refusal"):
            usage_holder["_stop"] = kind
main.stream_claude = fake_stream


async def fake_openai(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, provider="openai", **kw):
    async for t in fake_stream(system, user_input, model, api_key, max_tokens, temperature, usage_holder, **kw):
        yield t
main.stream_openai = fake_openai


async def knowledge(app_id):
    return KNOWLEDGE.get(app_id, "")
main.fetch_app_knowledge = knowledge

c = TestClient(main.app)
c.__enter__()


def native_record(app_id):
    # By the stored column (what queries filter on), and the record must agree.
    return [r for r in rows_for(app_id, "platform_runs")
            if r.get("workload") == "chat" and (r.get("record") or {}).get("workload") == "chat"]


def once(template: dict, body: dict, native: bool, *, path: str = "/run", logs: bool = True) -> dict:
    os.environ["AEX_NATIVE_TYPES"] = "prompt" if native else ""
    PROVIDER.clear()
    app = clone_app(template)
    if template["id"] in KNOWLEDGE:
        KNOWLEDGE[app["id"]] = KNOWLEDGE[template["id"]]
    payload = {**body, "app_id": app["id"]} if path == "/run" else body
    r = c.post(path.replace("{app}", app["id"]), json=payload, headers={"Authorization": "Bearer jwt-other"})
    wait_for(app["id"], {"app_runs": 1} if logs else {})
    return {"status": r.status_code, "body": mask(r.text), "provider": copy.deepcopy(PROVIDER),
            "writes": written_for(app["id"]), "native": native_record(app["id"])}


def compare(a: dict, b: dict) -> list[str]:
    return [f"{k}: legacy={str(a[k])[:400]} native={str(b[k])[:400]}" for k in ("status", "body", "provider", "writes") if a[k] != b[k]]


REPORT = []


def case(name: str, template: dict, body: dict, kind: str, *, expect_native: bool, expect_status: str = "succeeded",
         path: str = "/run"):
    MODE["kind"] = kind
    legacy = once(template, body, False, path=path)
    MODE["kind"] = kind
    native = once(template, body, True, path=path)
    diffs = compare(legacy, native)
    ok(f"{name}: reached the provider and wrote the run log", legacy["provider"] and "app_runs" in legacy["writes"],
       (legacy["status"], legacy["body"][:200], list(legacy["writes"])))
    ok(f"{name}: matches the legacy call", not diffs, diffs)
    ok(f"{name}: legacy path leaves no native record", not legacy["native"], legacy["native"])
    recs = native["native"]
    if expect_native:
        node = ((recs[0]["record"].get("steps") or {}).get("answer") or {}) if recs else {}
        ok(f"{name}: ran as an AEX llm.chat node ({expect_status})", len(recs) == 1 and recs[0]["status"] == expect_status
           and recs[0]["record"]["plan"]["nodes"]["answer"]["use"] == "llm.chat" if recs and "plan" in recs[0]["record"] else
           len(recs) == 1 and recs[0]["status"] == expect_status and node.get("status") in ("succeeded", "failed"),
           [(r["status"], r["record"].get("error")) for r in recs])
    else:
        ok(f"{name}: doesn't qualify, so it keeps the legacy call", not recs, [(r["status"]) for r in recs])
    REPORT.append((name, legacy["status"], len(legacy["provider"]), not diffs,
                   (recs[0]["status"] if recs else "—") if expect_native else "legacy call (not eligible)"))


plain = make_app("prompt", name="Reply drafter", system_prompt="You draft polite replies.",
                 prod_snapshot={"system_prompt": "You draft polite replies.", "output_type": "markdown"})
ask = {"input": "Customer asks: where is my order?"}
case("plain prompt app", plain, ask, "ok", expect_native=True)
case("custom temperature", plain, {**ask, "temperature": 0.3}, "ok", expect_native=True)
with_kb = make_app("prompt", name="FAQ bot", system_prompt="Answer from the knowledge base.",
                   prod_snapshot={"system_prompt": "Answer from the knowledge base.", "output_type": "markdown"})
KNOWLEDGE[with_kb["id"]] = "Shipping takes 3 days. Returns within 30 days."
case("app with knowledge", with_kb, ask, "ok", expect_native=True)
gpt = make_app("prompt", name="GPT helper", ai_provider="openai", ai_model="gpt-4o-mini",
               prod_snapshot={"system_prompt": "You are the prompt app.", "output_type": "markdown"})
case("OpenAI prompt app", gpt, ask, "ok", expect_native=True)
case("answer cut at the token limit", plain, ask, "max_tokens", expect_native=True)
case("model refusal", plain, ask, "refusal", expect_native=True)
case("provider timeout mid-answer", plain, ask, "timeout", expect_native=True, expect_status="failed")
case("invalid provider key", plain, ask, "auth", expect_native=True, expect_status="failed")
case("unexpected provider error", plain, ask, "boom", expect_native=True, expect_status="failed")
case("public API, stream: false", plain, {"input": "hi", "stream": False}, "ok", expect_native=True,
     path="/v1/apps/{app}/run")

# Not eligible: the legacy call stays.
contract_app = make_app("prompt", name="JSON prompt", output_type="json",
                        prod_snapshot={"system_prompt": "Score it.", "output_type": "json",
                                       "blueprint": {"output_schema": {"fields": [{"field": "score", "type": "number"}]},
                                                     "output_contract": {"format": "json"}}})
BLUEPRINTS[contract_app["id"]] = contract_app["prod_snapshot"]["blueprint"]


async def json_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    PROVIDER.append({"system": system, "input": user_input, "model": model, "key": api_key, "temperature": temperature})
    yield json.dumps({"score": 4})
    if usage_holder is not None:
        usage_holder.update(input_tokens=5, output_tokens=3)
main.stream_claude = json_stream
case("prompt app with an output contract", contract_app, ask, "ok", expect_native=False)
main.stream_claude = fake_stream
hot = make_app("prompt", name="Hot GPT", ai_provider="openai", ai_model="gpt-4o-mini",
               prod_snapshot={"system_prompt": "Be creative.", "output_type": "markdown"})
case("OpenAI temperature above 1", hot, {**ask, "temperature": 1.5}, "ok", expect_native=False)
data_app = make_app("data", name="Data app", prod_snapshot={"system_prompt": "Analyse.", "output_type": "markdown"})
case("another app type (data)", data_app, ask, "ok", expect_native=False)

# A caller that stops reading after the first chunk: exactly one "cancelled"
# outcome on both paths, and the native run is stopped, not left running.
cancelled = {}
for native in (False, True):
    os.environ["AEX_NATIVE_TYPES"] = "prompt" if native else ""
    MODE["kind"] = "ok"
    app = clone_app(plain)

    async def close_early():
        request = Request({"type": "http", "method": "POST", "headers": [], "client": ("127.0.0.1", 1)})
        response = await main.execute_run(main.RunRequest(app_id=app["id"], input="hi"), request,
                                          caller=main.ApiCaller(user_id=OTHER, user_jwt="jwt-other"))
        await response.body_iterator.__anext__()
        await response.body_iterator.aclose()
        await asyncio.gather(*main._telemetry_tasks)
        from aistrix_platform import app_adapter
        await asyncio.gather(*app_adapter._RECORD_TASKS)
    asyncio.run(close_early())
    logs = rows_for(app["id"], "app_runs")
    cancelled[native] = ([(x["status"], x["error_kind"]) for x in logs], [r["status"] for r in native_record(app["id"])])
ok("an early disconnect logs one cancelled outcome on both paths",
   cancelled[False][0] == cancelled[True][0] == [("error", "cancelled")], cancelled)
ok("…and the native run is recorded as stopped, not succeeded", cancelled[True][1] in (["cancelled"], ["failed"]), cancelled)
REPORT.append(("caller disconnects after the first chunk", 200, 1, cancelled[False][0] == cancelled[True][0],
               cancelled[True][1][0] if cancelled[True][1] else "—"))

os.environ["AEX_NATIVE_TYPES"] = ""
lines = ["# Native prompt parity report: legacy provider call vs AEX llm.chat node", "",
         f"Generated by `tests/checks/check_platform_native_prompt.py` on {datetime.now(timezone.utc):%Y-%m-%d}. "
         "Each row ran the same request as a regular end user with `AEX_NATIVE_TYPES` off and `prompt`, against a fake "
         "provider and database. \"Match\" means the HTTP status, the response body (ids and times masked), the provider "
         "call (system prompt, input, model, key, temperature, options) and the rows the run wrote (including the app's "
         "run log) were identical. \"Native run\" is the outcome of the AEX run whose llm.chat node made the call.", "",
         "| Case | HTTP | Provider calls | Match | Native run |", "| --- | --- | --- | --- | --- |"]
for name, status, calls, same, rec in REPORT:
    lines.append(f"| {name} | {status} | {calls} | {'yes' if same else 'NO'} | {rec} |")
lines += ["", "Qualifying prompt apps: no tools, no output contract, no images, not a custom or private model, "
          "provider Claude, OpenAI or Gemini, temperature at most 1, system prompt within the llm.chat limit. "
          "Everything around the call (access, limits, key choice, spending reservation, knowledge, logging, error "
          "messages) is still the legacy pipeline's."]
out = Path(__file__).resolve().parents[3] / "docs" / "architecture" / "native-prompt-parity-report.md"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"report written: {out.name}")
c.__exit__(None, None, None)
finish()
