"""Workflow engine: one runner for schedules, webhooks and Dev Studio tests;
published vs draft steps, field wiring, approval pause/resume, API steps,
app schemas for wiring, and agents calling apps through the run pipeline."""
import asyncio, json, uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import _harness
from _harness import ok as _ok, finish


def ok(name, cond, info=None):
    if not _ok(name, cond) and info is not None:
        print(f"      got: {str(info)[:400]}")
_harness.setup()
import main
main.platform_key = lambda provider: None          # nothing may fall back to Aistrix's key
from fastapi.testclient import TestClient

# ── fake supabase (same shape as check_api_e2e) ──────────────────────────────
class Res(SimpleNamespace):
    pass

class Q:
    def __init__(self, db, table):
        self.db, self.t = db, table
        self.f, self.op, self.payload, self.one, self.lim = [], "select", None, None, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f.append(lambda r: r.get(k) == v); return self
    def in_(self, k, vs): self.f.append(lambda r: r.get(k) in vs); return self
    def neq(self, k, v): self.f.append(lambda r: r.get(k) != v); return self
    def delete(self): self.op = "delete"; return self
    def gte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) >= v); return self
    def lte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) <= v); return self
    def is_(self, k, v): self.f.append(lambda r: r.get(k) is None if v == "null" else r.get(k) is not None); return self
    def not_(self): return self
    def order(self, *a, **k): return self
    def limit(self, n): self.lim = n; return self
    def maybe_single(self): self.one = True; return self
    def single(self): self.one = True; return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def execute(self):
        rows = self.db.setdefault(self.t, [])
        if self.op == "insert":
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for r in new:
                r = {"id": str(uuid.uuid4()), **r}
                rows.append(json.loads(json.dumps(r))); out.append(r)
            return Res(data=out)
        match = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "delete":
            self.db[self.t] = [r for r in rows if r not in match]
            return Res(data=match)
        if self.op == "update":
            for r in match: r.update(json.loads(json.dumps(self.payload)))
            return Res(data=[dict(r) for r in match])
        if self.lim is not None: match = match[: self.lim]
        if self.one:
            return Res(data=json.loads(json.dumps(match[0])) if match else None)
        return Res(data=[json.loads(json.dumps(r)) for r in match])

class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)

SB = FakeSB()
main._service_client = lambda: SB
main.create_client = lambda *a, **k: SB
main.get_anon_client = lambda: SB

OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
async def verify(tok): return {"jwt-owner": OWNER, "jwt-other": OTHER}.get(tok)
main.verify_user_jwt = verify
async def none(*a, **k): return None
main.workspace_role = none
main.app_member_role = none
main.personal_workspace_id = none
async def key(user_id, provider): return f"key-{user_id}"     # everyone has their own key (BYOK)
main.fetch_user_api_key_by_id = key
async def key_jwt(jwt, provider): return "key-jwt"
main.fetch_user_api_key = key_jwt
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
main.fetch_app_knowledge = empty
main.fetch_app_tools = emptyl
main._load_app_secrets = emptyd
async def no_log(*a, **k): return None
main._log_app_run = no_log
async def zero(*a, **k): return 0
main.dev_key_runs_today = zero           # metering for developer-paid runs is covered in check_providers_billing
main.record_metered_run = no_log
FACT_CALLS = []
async def facts(text, api_key): FACT_CALLS.append(api_key); return {}
main.extract_facts_headless = facts

def app(id_, prompt, **kw):
    return {"id": id_, "name": id_.title(), "created_by": OWNER, "is_published": True, "is_paid": False, "visibility": "public",
            "system_prompt": prompt, "ai_provider": "claude", "output_type": "markdown", **kw}

SCORE_BP = {"input_schema": {"fields": [{"field": "company", "type": "string"}, {"field": "seats", "type": "number"}]},
            "output_schema": {"fields": [{"field": "score", "type": "number"}, {"field": "email", "type": "string"}]},
            "output_contract": {"format": "json"}}
WRITER_BP = {"input_schema": {"fields": [{"field": "to", "type": "string"}, {"field": "score", "type": "number"}]}}
SB.db["apps"] = [
    app("scorer", "DRAFT SCORER", output_type="json", live_version=2,
        prod_snapshot={"system_prompt": "LIVE SCORER v2", "output_type": "json", "blueprint": SCORE_BP}),
    app("writer", "DRAFT WRITER", live_version=3, prod_snapshot={"system_prompt": "LIVE WRITER v3", "blueprint": WRITER_BP}),
    app("newapp", "NEVER PUBLISHED", is_published=False),
]
SB.db["app_versions"] = [{"app_id": "writer", "version_num": 1, "version_data": {"system_prompt": "OLD WRITER v1", "blueprint": WRITER_BP}}]
APPS = {a["id"]: a for a in SB.db["apps"]}
async def load_app_row(app_id): return json.loads(json.dumps(APPS.get(app_id))) if app_id in APPS else None
main.load_app_row = load_app_row
async def bp(app_id): return {"scorer": SCORE_BP, "writer": WRITER_BP}.get(app_id, {})
main.fetch_app_blueprint = bp

CALLS = []
async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    CALLS.append({"system": system, "input": user_input, "key": api_key})
    if "SCORER" in system:
        yield json.dumps({"score": 87, "email": "sarah@acme.com"})
    else:
        yield f"reply for: {user_input}"
    if usage_holder is not None:
        usage_holder.update(input_tokens=1, output_tokens=1)
main.stream_claude = fake_stream

def flow(steps, **kw):
    f = {"id": str(uuid.uuid4()), "user_id": OWNER, "name": "Lead qualification", "kind": "developer", "steps": steps,
         "memory": {}, "memory_provenance": {}, "trigger": {"type": "manual", "fields": []}, **kw}
    SB.db.setdefault("flows", []).append(f)
    return f

def run(coro): return asyncio.run(coro)
c = TestClient(main.app)
H = {"Authorization": "Bearer jwt-owner"}

# ── wiring helpers ───────────────────────────────────────────────────────────
src = {"trigger": main._flow_data('{"company": "Acme", "seats": "50"}'), "s1": main._flow_data('{"score": 87, "lead": {"email": "a@b.c"}}')}
ok("wires read trigger fields and nested step fields",
   main.resolve_input_map({"company": {"from": "trigger.company"}, "to": {"from": "s1.lead.email"}}, src) == {"company": "Acme", "to": "a@b.c"})
ok("transforms convert values (text → number)", main.resolve_input_map({"seats": {"from": "trigger.seats", "transform": "to_number"}}, src) == {"seats": 50})
ok("constants and missing sources", main.resolve_input_map({"x": {"value": "USD"}, "y": {"from": "s9.z"}}, src) == {"x": "USD"})
ok("plain text output is available as .text", main._flow_data("hello") == {"text": "hello"})

# ── published steps run their fixed release, wired fields only ──────────────
f = flow([
    {"id": "s1", "app_id": "scorer", "app_name": "Qualify lead", "version": "published", "pinned_version": 2,
     "input_map": {"company": {"from": "trigger.company"}, "seats": {"from": "trigger.seats", "transform": "to_number"}}},
    {"id": "s2", "app_id": "writer", "app_name": "Draft reply", "version": "published", "pinned_version": 1,
     "input_map": {"to": {"from": "s1.email"}, "score": {"from": "s1.score"}}},
])
CALLS.clear()
r = c.post(f"/v1/flows/{f['id']}/runs", json={"wait": True, "input": json.dumps({"company": "Acme", "seats": "50"})}, headers=H)
body = r.json()
ok("a test run finishes every step", r.status_code == 200 and body["status"] == "done", body)
ok("step 1 ran the live release (v2), not the draft", "LIVE SCORER v2" in CALLS[0]["system"] and "DRAFT" not in CALLS[0]["system"])
ok("step 1 got exactly its wired fields", CALLS[0]["input"] == "company: Acme\nseats: 50")
ok("step 2 ran its pinned older release (v1)", "OLD WRITER v1" in CALLS[1]["system"])
ok("step 2 got fields from step 1's output", CALLS[1]["input"] == "to: sarah@acme.com\nscore: 87")
ok("developer workflows don't add earlier outputs to the prompt", "multi-app workflow" not in CALLS[1]["system"])
ok("versions are recorded per step", [s["version"] for s in body["steps"]] == ["v2", "v1"])
ok("the run is saved", any(x["id"] == body["id"] and x["status"] == "done" for x in SB.db.get("flow_runs", [])))
ok("steps run on the runner's own key", all(call["key"] for call in CALLS))
ok("developer workflows don't spend on memory facts", FACT_CALLS == [] or all(k is None for k in FACT_CALLS))
ok("the run can be read back", c.get(f"/v1/flows/{f['id']}/runs/{body['id']}", headers=H).json()["status"] == "done")
ok("other people can't run or read it", c.post(f"/v1/flows/{f['id']}/runs", json={"wait": True, "input": "x"}, headers={"Authorization": "Bearer jwt-other"}).status_code == 404
   and c.get(f"/v1/flows/{f['id']}/runs/{body['id']}", headers={"Authorization": "Bearer jwt-other"}).status_code == 404)

# wiring that doesn't fit the app's input
bad = flow([{"id": "s1", "app_id": "writer", "app_name": "Draft reply", "version": "published",
             "input_map": {"score": {"from": "trigger.nothing"}}}])
CALLS.clear()
r = c.post(f"/v1/flows/{bad['id']}/runs", json={"wait": True, "input": "{}"}, headers=H)
ok("a missing required field is refused before anything runs, with a clear message",
   r.status_code == 422 and 'Input "to" is required' in r.json()["error"] and r.json()["problems"][0]["step"] == 0 and CALLS == [], r.text)

# ── draft steps: editors testing only ────────────────────────────────────────
d = flow([{"id": "s1", "app_id": "writer", "app_name": "Draft reply", "version": "draft"}])
CALLS.clear()
body = c.post(f"/v1/flows/{d['id']}/runs", json={"wait": True, "input": "hi"}, headers=H).json()
ok("an editor's test runs the draft", body["status"] == "done" and "DRAFT WRITER" in CALLS[0]["system"] and body["steps"][0]["version"] == "draft")
try:
    run(main.run_scheduled_workspace(SB, {"flow_id": d["id"], "user_id": OWNER}))
    sched_refused = False
except RuntimeError as e:
    sched_refused = "draft" in str(e)
ok("a schedule refuses a draft step", sched_refused)
np = flow([{"id": "s1", "app_id": "newapp", "app_name": "New", "version": "published"}])
body = c.post(f"/v1/flows/{np['id']}/runs", json={"wait": True, "input": "hi"}, headers=H).json()
ok("a published step needs a published app", body["status"] == "failed" and "isn't published" in body["error"])

# ── approval steps pause; API steps run on the server ───────────────────────
FETCHED = []
class FakeResp:
    status_code = 200
    text = '{"ok": true}'
    def json(self): return {"ok": True}
async def fake_fetch(method, url, **kw): FETCHED.append((method, url, kw.get("content"))); return FakeResp()
main.fetch_safely = fake_fetch
a = flow([
    {"id": "s1", "step_type": "api_call", "app_name": "CRM", "api_method": "POST", "api_url": "https://crm.example.com/x",
     "api_body": '{"note": "{{previous_output}}"}'},
    {"id": "s2", "step_type": "human_approval", "approval_type": "edit", "app_name": "Review"},
    {"id": "s3", "app_id": "writer", "app_name": "Send", "version": "published"},
], kind="business")
try:
    paused = run(main.run_scheduled_workspace(SB, {"flow_id": a["id"], "user_id": OWNER, "seed_input": "lead"}))
    crashed = False
except Exception as e:
    crashed, paused = repr(e), None
ok("a scheduled flow with API and approval steps no longer crashes", not crashed and paused and paused["status"] == "waiting_approval", crashed)
ok("the API step ran server side with the previous output", FETCHED and FETCHED[0][0] == "POST" and b'"note": "lead"' in FETCHED[0][2])
rid = paused["id"]
CALLS.clear()
body = c.post(f"/v1/flows/{a['id']}/runs/{rid}/resume", json={"wait": True, "approve": True, "output": "EDITED TEXT"}, headers=H).json()
ok("approving with an edit continues with the edited content", body["status"] == "done" and CALLS and "EDITED TEXT" in CALLS[0]["input"], body)
ok("a decided approval can't be decided again", c.post(f"/v1/flows/{a['id']}/runs/{rid}/resume", json={"wait": True, "approve": True}, headers=H).status_code == 409)
paused = run(main.run_scheduled_workspace(SB, {"flow_id": a["id"], "user_id": OWNER, "seed_input": "lead"}))
body = c.post(f"/v1/flows/{a['id']}/runs/{paused['id']}/resume", json={"wait": True, "approve": False, "reason": "Wrong tone"}, headers=H).json()
ok("rejecting ends the run with the reason", body["status"] == "failed" and "Wrong tone" in body["error"])

# webhook path uses the same engine
a2 = flow([{"id": "s1", "app_id": "writer", "app_name": "Send", "version": "published"}], kind="business", webhook_token=str(uuid.uuid4()))
r = c.post(f"/webhooks/{a2['webhook_token']}", json={"wait": True, "input": "from webhook"})
ok("a workflow webhook runs through the engine and reports the run", r.status_code == 200 and r.json()["status"] == "done" and r.json()["run_id"], r.text)

# ── schemas for wiring ──────────────────────────────────────────────────────
r = c.get("/v1/apps/scorer/schema?version=live", headers=H).json()
ok("live schema lists input and structured output fields",
   [x["field"] for x in r["input"]] == ["company", "seats"] and [x["field"] for x in r["output"]] == ["score", "email"] and r["structured"])
r = c.get("/v1/apps/writer/schema?version=1", headers=H).json()
ok("an older release's schema", [x["field"] for x in r["input"]] == ["to", "score"] and r["structured"] is False)
ok("unknown release → 404", c.get("/v1/apps/writer/schema?version=9", headers=H).status_code == 404)
ok("someone else's app → 404", c.get("/v1/apps/writer/schema", headers={"Authorization": "Bearer jwt-other"}).status_code == 404)

# ── agents calling apps go through the run pipeline ─────────────────────────
CALLS.clear()
out = run(main.execute_tool({"type": "app", "config": {"app_id": "writer"}}, {"input": "hello"},
                            {"caller": main.ApiCaller(user_id=OTHER)}))
ok("an agent calling another developer's app gets its live release on a key", out.startswith("reply for") and "LIVE WRITER v3" in CALLS[0]["system"] and CALLS[0]["key"])
token = main._APP_CALL_DEPTH.set(main.MAX_APP_CALL_DEPTH)
deep = run(main.execute_tool({"type": "app", "config": {"app_id": "writer"}}, {"input": "hello"}, {"caller": main.ApiCaller(user_id=OTHER)}))
main._APP_CALL_DEPTH.reset(token)
ok("apps calling apps stop at the depth limit", "levels deep" in deep)

# ── branches: steps that run only if a condition holds ─────────────────────
src = {"s1": main._flow_data('{"score": 8, "tier": "Gold"}')}
ok("conditions compare numbers, text and emptiness",
   main.flow_condition_met({"from": "s1.score", "op": "gte", "value": "7"}, src)
   and not main.flow_condition_met({"from": "s1.score", "op": "lt", "value": "7"}, src)
   and main.flow_condition_met({"from": "s1.tier", "op": "equals", "value": "gold"}, src)
   and main.flow_condition_met({"from": "s1.missing", "op": "empty"}, src)
   and not main.flow_condition_met({"from": "s1.score", "op": "gt", "value": "abc"}, src))
main.stream_claude = fake_stream
br = flow([
    {"id": "s1", "app_id": "scorer", "app_name": "Qualify lead", "version": "published",
     "input_map": {"company": {"from": "trigger.company"}, "seats": {"value": 5}}},
    {"id": "s2", "app_id": "writer", "app_name": "Draft reply", "version": "published",
     "run_if": {"from": "s1.score", "op": "gte", "value": "50", "label": "Qualified"},
     "input_map": {"to": {"from": "s1.email"}, "score": {"from": "s1.score"}}},
    {"id": "s3", "app_id": "writer", "app_name": "Ask for details", "version": "published",
     "run_if": {"from": "s1.score", "op": "lt", "value": "50", "label": "Needs details"},
     "input_map": {"to": {"from": "s1.email"}, "score": {"value": 0}}},
])
CALLS.clear()
body = c.post(f"/v1/flows/{br['id']}/runs", json={"wait": True, "input": '{"company": "Acme"}'}, headers=H).json()
ok("a branch runs only the step whose condition holds",
   body["status"] == "done" and [s["status"] for s in body["steps"]] == ["ok", "ok", "skipped"] and len(CALLS) == 2, body.get("steps"))
ok("a skipped step says why", body["steps"][2]["reason"] == "Needs details")

# ── AI fills inputs that aren't connected ───────────────────────────────────
TEXT_CALLS = []
async def fake_run_text(system, user_input, provider, model, api_key=None):
    TEXT_CALLS.append({"system": system, "key": api_key})
    return json.dumps({"to": "filled@acme.com", "score": 5, "extra": "ignored"})
main.run_text = fake_run_text
af = flow([{"id": "s1", "app_id": "writer", "app_name": "Draft reply", "version": "published", "ai_fill": True,
            "input_map": {"score": {"value": 9}}}])
CALLS.clear()
body = c.post(f"/v1/flows/{af['id']}/runs", json={"wait": True, "input": "Lead from filled@acme.com"}, headers=H).json()
ok("AI fills unconnected fields; connected values win", body["status"] == "done" and CALLS and CALLS[0]["input"] == "to: filled@acme.com\nscore: 9", CALLS[:1])
ok("…on the runner's own key, and the step records which fields AI filled",
   TEXT_CALLS and TEXT_CALLS[0]["key"] and body["steps"][0].get("ai_filled") == ["to"])

# ── stopping a run ──────────────────────────────────────────────────────────
stop = flow([{"id": "s1", "step_type": "human_approval", "app_name": "Review"},
             {"id": "s2", "app_id": "writer", "app_name": "Send", "version": "published"}])
paused = c.post(f"/v1/flows/{stop['id']}/runs", json={"wait": True, "input": "x"}, headers=H).json()
r = c.post(f"/v1/flows/{stop['id']}/runs/{paused['id']}/cancel", headers=H)
ok("a waiting run can be stopped", r.status_code == 200 and r.json()["status"] == "cancelled")
ok("…and then can't be approved", c.post(f"/v1/flows/{stop['id']}/runs/{paused['id']}/resume", json={"wait": True, "approve": True}, headers=H).status_code == 409)
ok("…or stopped again", c.post(f"/v1/flows/{stop['id']}/runs/{paused['id']}/cancel", headers=H).status_code == 409)

# ── webhook/scheduled runs waiting for approval tell the owner ──────────────
NOTICES = []
async def fake_notify(user_id, kind, ref, **kw): NOTICES.append((user_id, kind, ref)); return True
main.notify_developer = fake_notify
waiting = run(main.run_scheduled_workspace(SB, {"flow_id": stop["id"], "user_id": OWNER}))
ok("a scheduled run waiting for approval notifies the owner (email + in-app)",
   NOTICES == [(OWNER, "flow_approval", waiting["id"])] and any(n["type"] == "workflow_approval" and n["user_id"] == OWNER for n in SB.db.get("notifications", [])))
NOTICES.clear()
c.post(f"/v1/flows/{stop['id']}/runs", json={"wait": True, "input": "x"}, headers=H)
ok("test runs don't send notifications", NOTICES == [])

# ── schedules ───────────────────────────────────────────────────────────────
r = c.put(f"/v1/flows/{d['id']}/schedule", json={"enabled": True, "frequency": "daily", "hour_utc": 9}, headers=H)
ok("a workflow with a draft step can't be scheduled", r.status_code == 409 and "draft" in r.json()["detail"])
r = c.put(f"/v1/flows/{br['id']}/schedule", json={"enabled": True, "frequency": "weekly", "hour_utc": 14, "day_of_week": 1, "seed_input": '{"company": "Acme"}'}, headers=H)
sched = r.json().get("schedule") or {}
ok("a published workflow can be scheduled weekly", r.status_code == 200 and sched.get("frequency") == "weekly" and sched.get("next_run_at") and sched.get("user_id") == OWNER, r.text)
r = c.put(f"/v1/flows/{br['id']}/schedule", json={"enabled": False, "frequency": "daily", "hour_utc": 8}, headers=H)
ok("saving again updates the one schedule", len([x for x in SB.db["flow_schedules"] if x["flow_id"] == br["id"]]) == 1 and r.json()["schedule"]["enabled"] is False)
ok("weekly needs a day", c.put(f"/v1/flows/{br['id']}/schedule", json={"frequency": "weekly", "hour_utc": 8}, headers=H).status_code == 422)
ok("other people can't see or change it", c.get(f"/v1/flows/{br['id']}/schedule", headers={"Authorization": "Bearer jwt-other"}).status_code == 404)
ok("a schedule can be removed", c.delete(f"/v1/flows/{br['id']}/schedule", headers=H).status_code == 200 and c.get(f"/v1/flows/{br['id']}/schedule", headers=H).json()["schedule"] is None)

# ── Dev Studio runs answer at once and finish in the background ────────────
async def slow_stream(system, user_input, model, api_key=None, **kw):
    await asyncio.sleep(0.3)
    yield "slow reply"
main.stream_claude = slow_stream
with TestClient(main.app) as live_client:
    f2 = flow([{"id": "s1", "app_id": "writer", "app_name": "Send", "version": "published"}])
    first = live_client.post(f"/v1/flows/{f2['id']}/runs", json={"input": "go"}, headers=H).json()
    ok("a test run answers at once while it works", first["status"] == "running" and first["steps"] == [])
    import time as _t
    state = first
    for _ in range(40):
        _t.sleep(0.1)
        state = live_client.get(f"/v1/flows/{f2['id']}/runs/{first['id']}", headers=H).json()
        if state["status"] != "running":
            break
    ok("…and its progress can be followed until it finishes", state["status"] == "done" and state["steps"][0]["output"] == "slow reply", state)
    runs = live_client.get(f"/v1/flows/{f2['id']}/runs", headers=H).json()["runs"]
    ok("run history lists the workflow's runs", runs and runs[0]["id"] == first["id"])
    ok("other people can't list a workflow's runs", live_client.get(f"/v1/flows/{f2['id']}/runs", headers={"Authorization": "Bearer jwt-other"}).status_code == 404)

# Persistence failures stop before spending or performing another effect.
real_db = main.db
async def no_initial_save(query):
    if getattr(query, 't', None) == 'flow_runs' and query.op == 'insert':
        raise RuntimeError('storage unavailable')
    return await real_db(query)
main.db = no_initial_save
CALLS.clear()
r = c.post(f"/v1/flows/{f['id']}/runs", json={"wait": True, "input": "x"}, headers=H)
ok("no initial durable record means no workflow execution", r.status_code == 503 and CALLS == [])
updates = 0
async def fail_after_effect(query):
    global updates
    if getattr(query, 't', None) == 'flow_runs' and query.op == 'update':
        updates += 1
        if updates == 2:
            raise RuntimeError('checkpoint lost after first effect')
    return await real_db(query)
main.db = fail_after_effect
main.stream_claude = fake_stream
CALLS.clear()
r = c.post(f"/v1/flows/{f['id']}/runs", json={"wait": True, "input": '{"company":"Acme","seats":5}'}, headers=H)
ok("a failed post-step checkpoint prevents the next external effect", r.status_code == 503 and len(CALLS) == 1)
main.db = real_db

# The approval resumes the saved definition, not subsequent designer edits.
snap = flow([{"id": "s1", "step_type": "human_approval", "app_name": "Review"},
             {"id": "s2", "app_id": "writer", "version": "published", "pinned_version": 1}])
paused = c.post(f"/v1/flows/{snap['id']}/runs", json={"wait": True, "input": "x"}, headers=H).json()
snap['steps'][1]['app_id'] = 'newapp'
CALLS.clear()
resumed = c.post(f"/v1/flows/{snap['id']}/runs/{paused['id']}/resume", json={"wait": True, "approve": True}, headers=H).json()
ok("approval continues the immutable run definition", resumed.get('status') == 'done' and CALLS and 'OLD WRITER v1' in CALLS[0]['system'], resumed)
read = c.get(f"/v1/flows/{snap['id']}/runs/{paused['id']}", headers=H).json()
ok("API responses hide internal ownership and definition fields", all(k not in read and k not in paused for k in ('lease_token', 'lease_expires_at', 'definition')))

# Losing the heartbeat cancels an in-flight step, never advancing to step 2.
real_heartbeat, real_step = main._heartbeat_flow_run, main.run_flow_step
ENTERED, CANCELLED = [], []
async def blocked_step(flow, idx, **kw):
    ENTERED.append(idx)
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        CANCELLED.append(idx)
        raise
async def lost_heartbeat(run):
    await asyncio.sleep(0.05)
    raise RuntimeError('lease lost')
main.run_flow_step, main._heartbeat_flow_run = blocked_step, lost_heartbeat
async def lose_worker():
    try:
        await main.run_flow(f, caller=main.ApiCaller(user_id=OWNER), trigger='interactive')
    except RuntimeError:
        return True
ok("lease loss cancels the active step and prevents later steps", run(lose_worker()) and ENTERED == [0] and CANCELLED == [0])
main.run_flow_step, main._heartbeat_flow_run = real_step, real_heartbeat

# Developer and Business share workflow identity, permissions and runtime.
shared = flow([{"id": "s1", "app_id": "writer", "app_name": "Published", "version": "published"}])
SB.db["flow_members"] = [{"flow_id": shared["id"], "user_id": OTHER, "role": "viewer"}]
OH = {"Authorization": "Bearer jwt-other"}
CALLS.clear()
live = c.post(f"/v1/flows/{shared['id']}/runs", json={"wait": True, "live": True, "input": "hello"}, headers=OH)
ok("shared viewers run published workflows from Business", live.status_code == 200 and live.json().get("status") == "done", live.json())
ok("Business run uses the same published app snapshot", CALLS and "LIVE WRITER v3" in CALLS[-1]["system"])
ok("shared viewers cannot test drafts", c.post(f"/v1/flows/{shared['id']}/runs", json={"wait": True}, headers=OH).status_code == 404)
owner_run = c.post(f"/v1/flows/{shared['id']}/runs", json={"wait": True, "live": True}, headers=H).json()
ok("viewers cannot read another person's run", c.get(f"/v1/flows/{shared['id']}/runs/{owner_run['id']}", headers=OH).status_code == 404)
viewer_runs = c.get(f"/v1/flows/{shared['id']}/runs", headers=OH).json().get("runs", [])
ok("viewer run history contains only their own runs", len(viewer_runs) == 1 and all(r["user_id"] == OTHER for r in viewer_runs))
ok("viewers cannot manage schedules", c.put(f"/v1/flows/{shared['id']}/schedule", json={"hour_utc": 9}, headers=OH).status_code == 404)
ok("Business refuses explicit draft steps even for the owner", c.post(f"/v1/flows/{d['id']}/runs", json={"live": True, "wait": True}, headers=H).status_code == 409)
legacy_unpublished = flow([{"id": "s1", "app_id": "newapp", "app_name": "Unpublished"}])
blocked = c.post(f"/v1/flows/{legacy_unpublished['id']}/runs", json={"live": True, "wait": True}, headers=H).json()
ok("Business cannot fall back to an owner's unpublished legacy draft", blocked.get("status") == "failed" and "isn't published" in blocked.get("error", ""), blocked)
SB.db["flow_members"] = []
ok("revoked members lose runtime access", c.get(f"/v1/flows/{shared['id']}/runs/{live.json()['id']}", headers=OH).status_code == 404)

live_pause = flow([{"id": "s1", "step_type": "human_approval", "app_name": "Review"},
                   {"id": "s2", "app_id": "newapp", "app_name": "Unpublished"}])
paused_live = c.post(f"/v1/flows/{live_pause['id']}/runs", json={"live": True, "wait": True}, headers=H).json()
resumed_live = c.post(f"/v1/flows/{live_pause['id']}/runs/{paused_live['id']}/resume", json={"approve": True, "wait": True}, headers=H).json()
ok("Business approval resume retains release-only execution", resumed_live.get("status") == "failed" and "isn't published" in resumed_live.get("error", ""), resumed_live)

# ── compiled before running: plan ids, pinning, refusals, time limits ───────
good = flow([{"id": "s1", "app_id": "scorer", "app_name": "Score", "version": "published",
              "input_map": {"company": {"from": "trigger.company"}, "seats": {"from": "trigger.seats", "transform": "to_number"}}},
             {"id": "s2", "app_id": "writer", "app_name": "Write", "version": "published",
              "input_map": {"to": {"from": "s1.email"}, "score": {"from": "s1.score"}}}])
v = c.post(f"/v1/flows/{good['id']}/validate", headers=H).json()
ok("validate compiles a well-wired workflow to a plan", v["ok"] and v["plan_id"].startswith("plan_") and v["problems"] == [], v)
ok("validating again gives the same plan id", c.post(f"/v1/flows/{good['id']}/validate", headers=H).json()["plan_id"] == v["plan_id"])
ok("only people who can edit it can validate it", c.post(f"/v1/flows/{good['id']}/validate", headers={"Authorization": "Bearer jwt-other"}).status_code == 404)
body = c.post(f"/v1/flows/{good['id']}/runs", json={"wait": True, "input": json.dumps({"company": "Acme", "seats": "5"})}, headers=H).json()
ok("a run records the plan it executed", body.get("status") == "done" and body.get("plan_id") == v["plan_id"], body)
saved = next(x for x in SB.db["flow_runs"] if x["id"] == body["id"])
ok("published steps are pinned to the release live when the run started",
   [s.get("pinned_version") for s in saved["definition"]["steps"]] == [2, 3])
ok("…and the saved workflow itself isn't changed", all(not s.get("pinned_version") for s in good["steps"]))
read = c.get(f"/v1/flows/{good['id']}/runs/{body['id']}", headers=H).json()
ok("the plan id is readable later, the definition still isn't", read.get("plan_id") == v["plan_id"] and "definition" not in read)

forward = flow([{"id": "s1", "app_id": "writer", "app_name": "Write", "version": "published", "input_map": {"to": {"from": "s2.text"}, "score": {"value": 1}}},
                {"id": "s2", "app_id": "scorer", "app_name": "Score", "version": "published"}])
v = c.post(f"/v1/flows/{forward['id']}/validate", headers=H).json()
ok("validate reports a forward reference without running anything", not v["ok"] and v["plan_id"] is None
   and v["problems"][0]["step"] == 0 and "later step" in v["problems"][0]["text"], v)
CALLS.clear()
r = c.post(f"/v1/flows/{forward['id']}/runs", json={"wait": True}, headers=H)
ok("a test run of it is refused with the same problem", r.status_code == 422 and "later step" in r.json()["error"] and CALLS == [], r.text)
before = len(SB.db["flow_runs"])
try:
    run(main.run_scheduled_workspace(SB, {"flow_id": forward["id"], "user_id": OWNER}))
    refused = False
except RuntimeError as e:
    refused = "Not run:" in str(e) and "later step" in str(e)
recorded = SB.db["flow_runs"][before:] if len(SB.db["flow_runs"]) > before else []
ok("a scheduled run of it is recorded as not run, so the owner sees why",
   refused and recorded and recorded[-1]["status"] == "failed" and recorded[-1]["steps"] == [] and CALLS == [], recorded)
types = flow([{"id": "s1", "app_id": "scorer", "app_name": "Score", "version": "published"},
              {"id": "s2", "app_id": "writer", "app_name": "Write", "version": "published",
               "input_map": {"to": {"from": "s1.score"}, "score": {"from": "s1.score"}}}])
v = c.post(f"/v1/flows/{types['id']}/validate", headers=H).json()
ok("incompatible wiring is found from the releases' contracts", not v["ok"] and any('"to" expects string but gets number' in p["text"] for p in v["problems"]), v)

schema = c.get("/v1/apps/scorer/schema", headers=H).json()
ok("an app's schema includes its contract", schema["contract"]["contract_version"] == 1
   and schema["contract"]["output"]["structured"] and schema["contract"]["side_effects"] == "none")

async def slow_stream(*a, **k):
    await asyncio.sleep(2)
    yield "late"
real_contract, main.stream_claude = main.release_contract, slow_stream
def quick(app_row, snapshot):
    contract = real_contract(app_row, snapshot)
    return {**contract, "execution": {**contract["execution"], "timeout_seconds": 0.2}}
main.release_contract = quick
slow = flow([{"id": "s1", "app_id": "writer", "app_name": "Write", "version": "published"}])
body = c.post(f"/v1/flows/{slow['id']}/runs", json={"wait": True, "input": "x"}, headers=H).json()
ok("a step that runs past its release's time limit fails clearly", body.get("status") == "failed" and "0.2-second limit" in body.get("error", ""), body)
main.release_contract, main.stream_claude = real_contract, fake_stream

finish()
