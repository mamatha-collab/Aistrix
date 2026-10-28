"""Phase 2 parity report for app types: every type runs through the legacy
pipeline and through the AEX adapter (AEX_APP_TYPES), and the two must
match on what callers and the platform see:

- the HTTP status and the response body, byte for byte (ids and times masked),
- what was sent to the model provider (system prompt, input, model, key),
- the rows the run wrote (run logs, metering), minus their ids and times,
- for the adapter, one finished platform_runs record with the same outcome.

Runs are made by a regular end user of a public app, so the app's run log
is written and compared. Cases per type: a normal run, a provider failure
mid-stream, a refusal before running (a private app), for structured output
a contract failure, and the public API with stream: false. Writes a
markdown report next to the architecture docs.
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
        print(f"  detail: {str(detail)[:800]}")


_harness.setup(AEX_APP_TYPES="", AEX_NATIVE_TYPES="", PLATFORM_RESUME_SECONDS="0")
import main
from fastapi.testclient import TestClient

import _parity
from _parity import BLUEPRINTS, SB, clone_app, make_app, mask, rows_for, wait_for, written_for

PROVIDER = []
MODE = {"kind": "ok"}


async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    PROVIDER.append({"system": system, "input": user_input, "model": model, "key": api_key})
    if MODE["kind"] == "fail":
        yield "partial "
        raise asyncio.TimeoutError()
    if MODE["kind"] == "badjson":
        yield "not json at all"
    elif "<output_contract>" in system:
        yield json.dumps({"score": 7, "summary": "fine"})
    else:
        yield f"answer to {user_input[:40]}"
    if usage_holder is not None:
        usage_holder.update(input_tokens=12, output_tokens=6)
main.stream_claude = fake_stream

TYPES = ["prompt", "native", "api", "data", "agent", "iframe", "vision", "website", "ai_builder", "structured",
         "batch", "voice", "translation", "code", "chatbot", "code_job"]
JSON_TYPES = ("api", "structured")
BP = {"input_schema": {"fields": [{"field": "company", "type": "string"}]},
      "output_schema": {"fields": [{"field": "score", "type": "number"}, {"field": "summary", "type": "string"}]},
      "output_contract": {"format": "json"}}

# One event loop for the whole check, like a running server: background
# deliveries spawned at the end of a request keep running afterwards.
c = TestClient(main.app)
c.__enter__()


def once(path: str, body: dict, token: str, aex: bool, logs: bool, template: dict) -> dict:
    """One run on its own copy of `template`. logs: the case must write one
    run-log row (and, on AEX, one run record) for that copy."""
    os.environ["AEX_APP_TYPES"] = "all" if aex else ""
    PROVIDER.clear()
    app = clone_app(template)
    body = {**body, "app_id": app["id"]} if "app_id" in body else body
    path = path.replace("{app}", app["id"])
    r = c.post(path, json=body, headers={"Authorization": f"Bearer {token}"})
    wait_for(app["id"], {"app_runs": 1, **({"platform_runs": 1} if aex else {})} if logs else {})
    return {"status": r.status_code, "body": mask(r.text), "provider": copy.deepcopy(PROVIDER),
            "writes": written_for(app["id"]), "platform_runs": rows_for(app["id"], "platform_runs"),
            "output": r.json().get("output") if r.headers.get("content-type", "").startswith("application/json") else None}


def compare(legacy: dict, aex: dict) -> list[str]:
    return [f"{key}: legacy={str(legacy[key])[:300]} aex={str(aex[key])[:300]}"
            for key in ("status", "body", "provider", "writes") if legacy[key] != aex[key]]


REPORT = []
for app_type in TYPES:
    json_out = app_type in JSON_TYPES
    app = make_app(app_type, output_type="json" if json_out else "markdown",
                   prod_snapshot={"system_prompt": f"You are the {app_type} app.", "output_type": "json" if json_out else "markdown",
                                  **({"blueprint": BP} if json_out else {})})
    if json_out:
        BLUEPRINTS[app["id"]] = BP
    payload = {"app_id": app["id"], "input": "company: Acme"}
    if app_type == "native":
        payload["field_values"] = {"company": "Acme"}
    cases = [("run", "ok", "jwt-other"), ("provider failure", "fail", "jwt-other")]
    if json_out:
        cases.append(("contract failure", "badjson", "jwt-other"))
    for case, kind, token in cases:
        logs = app_type != "code_job"
        MODE["kind"] = kind
        legacy = once("/run", payload, token, aex=False, logs=logs, template=app)
        MODE["kind"] = kind
        aex = once("/run", payload, token, aex=True, logs=logs, template=app)
        diffs = compare(legacy, aex)
        streamed = legacy["status"] == 200 and "data:" in legacy["body"]
        recorded = aex["platform_runs"]
        if app_type != "code_job":
            # Guards against a vacuous comparison: the run reached the provider
            # and wrote the app's run log, on the legacy path.
            ok(f"{app_type}: {case} reached the provider and wrote the run log", streamed and legacy["provider"]
               and "app_runs" in legacy["writes"], (legacy["status"], legacy["body"][:200], list(legacy["writes"])))
        ok(f"{app_type}: {case} matches the legacy pipeline", not diffs, diffs)
        rec_ok = (len(recorded) == 1 and recorded[0]["status"] == ("succeeded" if kind == "ok" else "failed")) if streamed else not recorded
        ok(f"{app_type}: {case} {'is recorded once with its outcome' if streamed else 'is answered before running, not recorded'}",
           rec_ok, [(x["status"], x["record"].get("error")) for x in recorded])
        REPORT.append((app_type, case, legacy["status"], len(legacy["provider"]), "app_runs" in legacy["writes"],
                       not diffs, recorded[0]["status"] if recorded else "—"))
    # Refusal before running: a private app, someone else.
    private = {**app, "visibility": "private", "is_published": False}
    MODE["kind"] = "ok"
    legacy = once("/run", payload, "jwt-other", aex=False, logs=False, template=private)
    aex = once("/run", payload, "jwt-other", aex=True, logs=False, template=private)
    diffs = compare(legacy, aex)
    ok(f"{app_type}: access refusal matches the legacy pipeline", not diffs and legacy["status"] in (403, 404, 409), diffs or legacy["status"])
    REPORT.append((app_type, "no access", legacy["status"], len(legacy["provider"]), False, not diffs,
                   aex["platform_runs"][0]["status"] if aex["platform_runs"] else "—"))

# The public API (stream: false) stops reading at the "done" event. The adapter
# must count that as finished, not as a caller who went away.
api_app = make_app("prompt")
MODE["kind"] = "ok"
api_legacy = once("/v1/apps/{app}/run", {"input": "hi", "stream": False}, "jwt-other", aex=False, logs=True, template=api_app)
api_aex = once("/v1/apps/{app}/run", {"input": "hi", "stream": False}, "jwt-other", aex=True, logs=True, template=api_app)
ok("API run (stream: false) on AEX answers like legacy", api_legacy["status"] == api_aex["status"] == 200
   and api_legacy["output"] == api_aex["output"] and api_legacy["writes"] == api_aex["writes"], compare(api_legacy, api_aex))
ok("…and is recorded as succeeded, not cancelled", [x["status"] for x in api_aex["platform_runs"]] == ["succeeded"],
   [x["status"] for x in api_aex["platform_runs"]])

os.environ["AEX_APP_TYPES"] = ""
lines = ["# App type parity report: legacy pipeline vs AEX adapter", "",
         f"Generated by `tests/checks/check_platform_app_parity.py` on {datetime.now(timezone.utc):%Y-%m-%d}. "
         "Each row ran the same request twice through `/run`, as a regular end user, with `AEX_APP_TYPES` off and `all`, "
         "against a fake provider and database. \"Match\" means the HTTP status, the response body (ids and times masked), "
         "what was sent to the provider and the rows the run wrote (including the app's run log) were identical.", "",
         "| App type | Case | HTTP | Provider calls | Run log written | Match | AEX run record |",
         "| --- | --- | --- | --- | --- | --- | --- |"]
for t, case, status, calls, logged, same, rec in REPORT:
    lines.append(f"| {t} | {case} | {status} | {calls} | {'yes' if logged else 'no'} | {'yes' if same else 'NO'} | {rec} |")
lines += ["", "Not covered here: real providers, tools that reach outside services, file and image inputs, "
          "paid-app entitlements and spending reservations (each has its own suite, which also runs with the flags on)."]
out = Path(__file__).resolve().parents[3] / "docs" / "architecture" / "app-type-parity-report.md"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"report written: {out.name}")
c.__exit__(None, None, None)
finish()
