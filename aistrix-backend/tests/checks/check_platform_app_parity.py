"""Phase 2 parity report for app types: every type runs through the legacy
pipeline and through the AEX adapter (AEX_APP_TYPES), and the two must
match on what callers and the platform see:

- the HTTP status and the response body, byte for byte (ids and times masked),
- what was sent to the model provider (system prompt, input, model, key),
- the rows the run wrote (run logs, history, metering), minus their ids/times,
- for the adapter, one finished platform_runs record with the same outcome.

Cases per type: a normal run, a provider failure mid-stream, a refusal
before running (someone without access), and for structured output a
contract failure. Writes a markdown report next to the architecture docs.
"""
import asyncio
import copy
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import _harness
from _harness import finish


def ok(name, cond, detail=None):
    if not _harness.ok(name, cond) and detail is not None:
        print(f"  detail: {str(detail)[:800]}")


_harness.setup(AEX_APP_TYPES="")
import main
from fastapi.testclient import TestClient

main.platform_key = lambda provider: None


class Res(SimpleNamespace):
    pass


class Q:
    def __init__(self, db, table):
        self.db, self.t, self.f, self.op, self.payload, self.one, self.lim = db, table, [], "select", None, None, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f.append(lambda r: r.get(k) == v); return self
    def neq(self, k, v): self.f.append(lambda r: r.get(k) != v); return self
    def in_(self, k, vs): self.f.append(lambda r: r.get(k) in vs); return self
    def lt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) < v); return self
    def gt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) > v); return self
    def gte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) >= v); return self
    def lte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) <= v); return self
    def is_(self, k, v): self.f.append(lambda r: r.get(k) is None if v == "null" else r.get(k) is not None); return self
    def or_(self, *a, **k): return self
    def ilike(self, *a, **k): return self
    def not_(self): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def limit(self, n): self.lim = n; return self
    def maybe_single(self): self.one = True; return self
    def single(self): self.one = True; return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def upsert(self, rows, **k): self.op, self.payload = "insert", rows; return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def delete(self): self.op = "delete"; return self
    def execute(self):
        rows = self.db.setdefault(self.t, [])
        if self.op == "insert":
            out = []
            for r in (self.payload if isinstance(self.payload, list) else [self.payload]):
                r = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), **json.loads(json.dumps(r))}
                rows.append(r)
                out.append(dict(r))
            return Res(data=out, count=None)
        match = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "update":
            for r in match:
                r.update(json.loads(json.dumps(self.payload)))
            return Res(data=[dict(r) for r in match], count=None)
        if self.op == "delete":
            self.db[self.t] = [r for r in rows if r not in match]
            return Res(data=match, count=None)
        if self.lim is not None:
            match = match[:self.lim]
        data = [dict(r) for r in match]
        return Res(data=(data[0] if data else None) if self.one else data, count=len(data))


class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)
    def rpc(self, *a, **k):
        return SimpleNamespace(execute=lambda: Res(data=None))


SB = FakeSB()
main._service_client = lambda: SB
main.create_client = lambda *a, **k: SB
main.get_anon_client = lambda: SB
OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())


async def verify(tok): return {"jwt-owner": OWNER, "jwt-other": OTHER}.get(tok)
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def zero(*a, **k): return 0
main.verify_user_jwt = verify
main.resolve_user_workspace = none
main.personal_workspace_id = none
main.workspace_role = none
main.app_member_role = none
main.fetch_app_knowledge = empty
main.fetch_app_tools = emptyl
main._load_app_secrets = emptyd
main.fetch_app_blueprint = emptyd
main.dev_key_runs_today = zero
main.HOURLY_LIMIT = main.DAILY_LIMIT = 10_000


async def own_key(user_id, provider): return f"sk-ant-{user_id[:6]}"
async def own_key_jwt(jwt, provider): return f"sk-ant-{jwt[-5:]}"
main.fetch_user_api_key_by_id = own_key
main.fetch_user_api_key = own_key_jwt

PROVIDER = []
MODE = {"kind": "ok"}


async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    PROVIDER.append({"system": system, "input": user_input, "model": model, "key": api_key})
    if MODE["kind"] == "fail":
        yield "partial "
        raise asyncio.TimeoutError()
    if "<output_contract>" in system or MODE["kind"] == "json":
        yield json.dumps({"score": 7, "summary": "fine"}) if MODE["kind"] != "badjson" else "not json at all"
    elif MODE["kind"] == "badjson":
        yield "not json at all"
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


def make_app(app_type: str) -> dict:
    row = {"id": str(uuid.uuid4()), "name": f"{app_type} app", "created_by": OWNER, "workspace_id": None,
           "is_published": True, "is_paid": False, "visibility": "public", "app_type": app_type,
           "system_prompt": f"You are the {app_type} app.", "ai_provider": "claude", "ai_model": "claude-haiku-5-5",
           "output_type": "json" if app_type in JSON_TYPES else "markdown", "live_version": 1,
           "prod_snapshot": {"system_prompt": f"You are the {app_type} app.", "output_type": "json" if app_type in JSON_TYPES else "markdown",
                             **({"blueprint": BP} if app_type in JSON_TYPES else {})}}
    SB.db.setdefault("apps", []).append(row)
    return row


async def load_app_row(app_id):
    row = next((a for a in SB.db.get("apps", []) if a["id"] == app_id), None)
    return json.loads(json.dumps(row)) if row else None
main.load_app_row = load_app_row


async def blueprint(app_id):
    row = next((a for a in SB.db.get("apps", []) if a["id"] == app_id), None)
    return copy.deepcopy(BP) if row and row["app_type"] in JSON_TYPES else {}
main.fetch_app_blueprint = blueprint

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(\+00:00|Z)?")
MS = re.compile(r'"(elapsed_ms|duration_ms|latency_ms)":\s*\d+')
VOLATILE = ("id", "created_at", "updated_at", "started_at", "finished_at", "elapsed_ms", "duration_ms", "latency_ms", "run_id")


def mask(text: str) -> str:
    return MS.sub(r'"\1": 0', TIME.sub("<time>", UUID.sub("<id>", text)))


def written(before: dict) -> dict:
    """Rows added since `before`, per table, without volatile fields."""
    out = {}
    for table, rows in SB.db.items():
        if table in ("apps", "platform_runs"):
            continue
        new = rows[len(before.get(table, [])):]
        if new:
            out[table] = [mask(json.dumps({k: v for k, v in r.items() if k not in VOLATILE}, sort_keys=True)) for r in new]
    return out


c = TestClient(main.app)


def once(path: str, body: dict, token: str, aex: bool) -> dict:
    os.environ["AEX_APP_TYPES"] = "all" if aex else ""
    PROVIDER.clear()
    before = {t: list(rows) for t, rows in SB.db.items()}
    runs_before = len(SB.db.get("platform_runs", []))
    r = c.post(path, json=body, headers={"Authorization": f"Bearer {token}"})
    # Let the adapter's best-effort record land.
    asyncio.run(asyncio.sleep(0))
    return {"status": r.status_code, "body": mask(r.text), "provider": copy.deepcopy(PROVIDER),
            "writes": written(before), "platform_runs": SB.db.get("platform_runs", [])[runs_before:]}


def compare(legacy: dict, aex: dict) -> list[str]:
    diffs = []
    for key in ("status", "body", "provider", "writes"):
        if legacy[key] != aex[key]:
            diffs.append(f"{key}: legacy={str(legacy[key])[:300]} aex={str(aex[key])[:300]}")
    return diffs


REPORT = []
for app_type in TYPES:
    app = make_app(app_type)
    payload = {"app_id": app["id"], "input": "company: Acme"}
    if app_type == "native":
        payload["field_values"] = {"company": "Acme"}
    cases = [("run", "ok", "jwt-owner"), ("provider failure", "fail", "jwt-owner")]
    if app_type in JSON_TYPES:
        cases.append(("contract failure", "badjson", "jwt-owner"))
    for case, kind, token in cases:
        MODE["kind"] = kind
        legacy = once("/run", payload, token, aex=False)
        MODE["kind"] = kind
        aex = once("/run", payload, token, aex=True)
        diffs = compare(legacy, aex)
        streamed = legacy["status"] == 200 and "data:" in legacy["body"]
        recorded = aex["platform_runs"]
        rec_ok = (len(recorded) == 1 and recorded[0]["status"] == ("succeeded" if kind == "ok" else "failed")) if streamed else not recorded
        if app_type != "code_job":
            # Guards against a vacuous comparison: the run must really reach the provider.
            ok(f"{app_type}: {case} reached the provider and streamed", streamed and legacy["provider"],
               (legacy["status"], legacy["body"][:200]))
        ok(f"{app_type}: {case} matches the legacy pipeline", not diffs, diffs)
        ok(f"{app_type}: {case} {'is recorded once with its outcome' if streamed else 'is answered before running, not recorded'}",
           rec_ok, [(x["status"], x["record"].get("error")) for x in recorded])
        REPORT.append((app_type, case, legacy["status"], len(legacy["provider"]), not diffs,
                       recorded[0]["status"] if recorded else "—"))
    # Access: private app, someone else
    SB.db["apps"][-1]["visibility"] = "private"
    SB.db["apps"][-1]["is_published"] = False
    MODE["kind"] = "ok"
    legacy, aex = once("/run", payload, "jwt-other", aex=False), once("/run", payload, "jwt-other", aex=True)
    diffs = compare(legacy, aex)
    ok(f"{app_type}: access refusal matches the legacy pipeline", not diffs, diffs)
    REPORT.append((app_type, "no access", legacy["status"], len(legacy["provider"]), not diffs,
                   aex["platform_runs"][0]["status"] if aex["platform_runs"] else "—"))

os.environ["AEX_APP_TYPES"] = ""
lines = ["# App type parity report: legacy pipeline vs AEX adapter", "",
         f"Generated by `tests/checks/check_platform_app_parity.py` on {datetime.now(timezone.utc):%Y-%m-%d}. "
         "Each row ran the same request twice through `/run`, with `AEX_APP_TYPES` off and `all`, against a fake provider "
         "and database. \"Match\" means the HTTP status, the response body (ids and times masked), what was sent to the provider "
         "and the rows the run wrote were identical.", "",
         "| App type | Case | HTTP | Provider calls | Match | AEX run record |", "| --- | --- | --- | --- | --- | --- |"]
for t, case, status, calls, same, rec in REPORT:
    lines.append(f"| {t} | {case} | {status} | {calls} | {'yes' if same else 'NO'} | {rec} |")
lines += ["", "Not covered here: real providers, tools that reach outside services, file and image inputs, "
          "paid-app entitlements and spending reservations (each has its own suite, which also runs with the flag on)."]
out = Path(__file__).resolve().parents[3] / "docs" / "architecture" / "app-type-parity-report.md"
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"report written: {out.name}")
finish()
