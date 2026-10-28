"""Phase 2 parity for output contracts on native AEX nodes
(AEX_NATIVE_TYPES includes "structured").

The same request runs with the legacy structured-output loop and with the
native path (an Application spec with one llm.structured node, compiled and
run by the AEX orchestrator through the model gateway, checked with the
legacy parser and field validator). They must match on:

- HTTP status and response body, byte for byte (ids and times masked),
  including the "repairing_output" event and contract errors,
- every provider call: system prompt, input (the repair prompt included),
  model, key, temperature, options,
- the rows the run wrote (the app's run log, metering), minus ids and times,
- and the native path must really have run: one AEX run record whose
  llm.structured node has the outcome. Runs that don't qualify keep the
  legacy loop and leave no native record.

Runs are made by a regular end user of a public app (the run log is written).
Writes docs/architecture/native-structured-parity-report.md.
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
SCRIPT: list = []          # one entry per provider call: text, ("refusal", text), or an exception
SCRIPT_TEMPLATE: list = []


def _auth_error():
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.AuthenticationError("invalid x-api-key", response=httpx.Response(401, request=req), body=None)


async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    PROVIDER.append({"system": system, "input": user_input, "model": model, "key": api_key, "max_tokens": max_tokens,
                     "temperature": temperature, "extra": sorted(kw)})
    step = SCRIPT.pop(0) if SCRIPT else "{}"
    if isinstance(step, Exception):
        yield "{"
        raise step
    refusal = isinstance(step, tuple)
    text = step[1] if refusal else step
    for i in range(0, len(text), 9):
        yield text[i:i + 9]
    if usage_holder is not None:
        usage_holder.update(input_tokens=20, output_tokens=10)
        if refusal:
            usage_holder["_stop"] = "refusal"
main.stream_claude = fake_stream


async def fake_openai(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, provider="openai", **kw):
    async for t in fake_stream(system, user_input, model, api_key, max_tokens, temperature, usage_holder, **kw):
        yield t
main.stream_openai = fake_openai

c = TestClient(main.app)
c.__enter__()

FIELDS = [{"field": "vendor", "type": "string"}, {"field": "total", "type": "number"},
          {"field": "currency", "type": "enum", "enum_values": ["EUR", "GBP", "USD"]},
          {"field": "lines", "type": "array", "required": False,
           "nested_fields": [{"field": "item", "type": "string"}, {"field": "amount", "type": "number"}]}]
GOOD = json.dumps({"vendor": "Northwind", "total": 144.0, "currency": "GBP",
                   "lines": [{"item": "Pallet wrap", "amount": 120.0}]})


def contract_app(app_type="structured", **over):
    bp = {"output_schema": {"fields": FIELDS}, "output_contract": {"format": "json"}}
    app = make_app(app_type, output_type="json", system_prompt="Extract the invoice.",
                   prod_snapshot={"system_prompt": "Extract the invoice.", "output_type": "json", "blueprint": bp}, **over)
    BLUEPRINTS[app["id"]] = bp
    return app


def native_record(app_id):
    return [r for r in rows_for(app_id, "platform_runs")
            if r.get("workload") == "structured" and (r.get("record") or {}).get("workload") == "structured"]


def once(template: dict, body: dict, flags: str, script: list, *, path: str = "/run") -> dict:
    os.environ["AEX_NATIVE_TYPES"] = flags
    PROVIDER.clear()
    SCRIPT[:] = list(script)
    app = clone_app(template)
    payload = {**body, "app_id": app["id"]} if path == "/run" else body
    r = c.post(path.replace("{app}", app["id"]), json=payload, headers={"Authorization": "Bearer jwt-other"})
    wait_for(app["id"], {"app_runs": 1})
    return {"status": r.status_code, "body": mask(r.text), "provider": copy.deepcopy(PROVIDER),
            "writes": written_for(app["id"]), "native": native_record(app["id"])}


def compare(a: dict, b: dict) -> list[str]:
    return [f"{k}: legacy={str(a[k])[:500]} native={str(b[k])[:500]}" for k in ("status", "body", "provider", "writes") if a[k] != b[k]]


REPORT = []


def case(name, template, body, script, *, expect_native=True, expect_status="succeeded", path="/run",
         native_flags="structured"):
    legacy = once(template, body, "", script, path=path)
    native = once(template, body, native_flags, script, path=path)
    diffs = compare(legacy, native)
    ok(f"{name}: reached the provider and wrote the run log", legacy["provider"] and "app_runs" in legacy["writes"],
       (legacy["status"], legacy["body"][:200], list(legacy["writes"])))
    ok(f"{name}: matches the legacy loop", not diffs, diffs)
    ok(f"{name}: legacy path leaves no native record", not legacy["native"], legacy["native"])
    recs = native["native"]
    if expect_native:
        ok(f"{name}: ran as an AEX llm.structured node ({expect_status})",
           len(recs) == 1 and recs[0]["status"] == expect_status
           and recs[0]["record"]["steps"]["answer"]["status"] in ("succeeded", "failed"),
           [(r["status"], r["record"].get("error")) for r in recs])
    else:
        ok(f"{name}: doesn't qualify, so it keeps the legacy loop", not recs, [r["status"] for r in recs])
    events = [e for e in legacy["body"].split("\n") if e.startswith("data: ")]
    REPORT.append((name, legacy["status"], len(legacy["provider"]), any("repairing_output" in e for e in events),
                   not diffs, (recs[0]["status"] if recs else "—") if expect_native else "legacy loop (not eligible)"))


ask = {"input": "INVOICE from Northwind. Pallet wrap 120.00, VAT 24.00, total 144.00 GBP"}
inv = contract_app()
case("valid JSON on the first try", inv, ask, [GOOD])
case("JSON in a code fence", inv, ask, ["```json\n" + GOOD + "\n```"])
case("repair: not JSON, then valid", inv, ask, ["Sure! Here is the data.", GOOD])
case("repair: a wrong field type, then valid", inv, ask, [json.dumps({"vendor": "N", "total": "lots", "currency": "GBP"}), GOOD])
case("repair fails: contract error", inv, ask, ["nope", "still nope"], expect_status="failed")
case("enum and nested field errors twice", inv, ask,
     [json.dumps({"vendor": "N", "total": 1, "currency": "YEN", "lines": [{"item": 3}]})] * 2, expect_status="failed")
case("refusal on the first attempt", inv, ask, [("refusal", "I can't help with that.")], expect_status="failed")
case("refusal on the repair attempt", inv, ask, ["nope", ("refusal", "I can't help with that.")], expect_status="failed")
case("provider timeout on the first attempt", inv, ask, [asyncio.TimeoutError()], expect_status="failed")
case("provider error on the repair attempt", inv, ask, ["nope", RuntimeError("socket closed")], expect_status="failed")
case("invalid provider key", inv, ask, [_auth_error()], expect_status="failed")
case("temperature above 0.3 is capped", inv, {**ask, "temperature": 0.9}, [GOOD])
case("low temperature is kept", inv, {**ask, "temperature": 0.1}, [GOOD])
gpt = contract_app(ai_provider="openai", ai_model="gpt-4o-mini")
case("OpenAI app with an output contract", gpt, ask, ["nope", GOOD])
case("api app type with a contract", contract_app("api"), ask, [GOOD])
case("prompt app type with a contract", contract_app("prompt"), ask, [GOOD])
case("data app type with a contract", contract_app("data"), ask, ["nope", GOOD])
case("public API, stream: false", inv, {"input": ask["input"], "stream": False}, ["nope", GOOD], path="/v1/apps/{app}/run")
case("public API, contract error", inv, {"input": ask["input"], "stream": False}, ["x", "y"], path="/v1/apps/{app}/run",
     expect_status="failed")
case("flag lists only prompt: legacy loop", inv, ask, [GOOD], expect_native=False, native_flags="prompt")

# A caller that stops reading at the "repairing_output" event: one cancelled
# outcome on both paths, and the native run is recorded as stopped.
stopped = {}
for flags in ("", "structured"):
    os.environ["AEX_NATIVE_TYPES"] = flags
    SCRIPT[:] = ["nope", GOOD]
    PROVIDER.clear()
    app = clone_app(inv)

    async def close_early():
        request = Request({"type": "http", "method": "POST", "headers": [], "client": ("127.0.0.1", 1)})
        response = await main.execute_run(main.RunRequest(app_id=app["id"], input=ask["input"], output_type="json"), request,
                                          caller=main.ApiCaller(user_id=OTHER, user_jwt="jwt-other"))
        first = await response.body_iterator.__anext__()
        await response.body_iterator.aclose()
        await asyncio.gather(*main._telemetry_tasks)
        from aistrix_platform import app_adapter
        await asyncio.gather(*app_adapter._RECORD_TASKS)
        return first
    first = asyncio.run(close_early())
    stopped[flags] = (mask(first if isinstance(first, str) else first.decode()), len(PROVIDER),
                      [(x["status"], x["error_kind"]) for x in rows_for(app["id"], "app_runs")],
                      [r["status"] for r in native_record(app["id"])])
ok("a caller who leaves at the repair event: same first event and one provider call on both paths",
   stopped[""][:2] == stopped["structured"][:2] and "repairing_output" in stopped[""][0] and stopped[""][1] == 1, stopped)
ok("…one cancelled outcome on both paths", stopped[""][2] == stopped["structured"][2] == [("error", "cancelled")], stopped)
ok("…and the native run is recorded as stopped", stopped["structured"][3] == ["cancelled"], stopped)
REPORT.append(("caller leaves at the repair event", 200, stopped[""][1], True, stopped[""][2] == stopped["structured"][2],
               stopped["structured"][3][0] if stopped["structured"][3] else "—"))

os.environ["AEX_NATIVE_TYPES"] = ""
lines = ["# Native structured-output parity report: legacy loop vs AEX llm.structured node", "",
         f"Generated by `tests/checks/check_platform_native_structured.py` on {datetime.now(timezone.utc):%Y-%m-%d}. "
         "Each row ran the same request as a regular end user with `AEX_NATIVE_TYPES` off and `structured`, against a "
         "fake provider and database. \"Match\" means the HTTP status, the response body (ids and times masked, the "
         "repair and contract-error events included), every provider call (system prompt, input including the repair "
         "prompt, model, key, temperature, options) and the rows the run wrote (including the app's run log) were "
         "identical. \"Native run\" is the outcome of the AEX run whose llm.structured node made the calls.", "",
         "| Case | HTTP | Provider calls | Repair event | Match | Native run |", "| --- | --- | --- | --- | --- | --- |"]
for name, status, calls, repaired, same, rec in REPORT:
    lines.append(f"| {name} | {status} | {calls} | {'yes' if repaired else 'no'} | {'yes' if same else 'NO'} | {rec} |")
lines += ["", "Qualifying runs: any app type whose run has an output contract, with no tools, no images, not a custom "
          "or private model, provider Claude, OpenAI or Gemini, system prompt within the node's limit. The node uses "
          "the legacy system prompt as is, the legacy repair prompt and temperature (at most 0.3), and the legacy "
          "parser and field validator. Access, limits, key choice, the spending reservation, logging and error "
          "messages stay in the legacy pipeline."]
out = Path(__file__).resolve().parents[3] / "docs" / "architecture" / "native-structured-parity-report.md"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"report written: {out.name}")
c.__exit__(None, None, None)
finish()
