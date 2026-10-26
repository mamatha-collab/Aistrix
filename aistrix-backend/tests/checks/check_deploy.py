"""Deploy step: promote only real changes, inbound trigger links (live
version, owner's key, daily quota), the per-app run log and stats, the user
preview, signed webhooks, readable server errors, and access checks that
fail loudly instead of reading as "no access"."""
import asyncio
import hashlib
import hmac
import time
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
main.platform_key = lambda provider: "test-platform-key"   # model calls are stubbed; never a real key
from fastapi import HTTPException
from fastapi.testclient import TestClient

OWNER, USER = "owner", "user"
LIVE = {"system_prompt": "LIVE PROMPT", "ai_provider": "claude", "ai_model": "claude-haiku-5-5", "output_type": "markdown",
        "form_schema": [{"id": "1", "label": "Name", "required": True}], "app_type": "native", "greeting": "Hi from live",
        "blueprint": {}}
APP = {}


def reset_app(**extra):
    APP.clear()
    APP.update({"id": "app-1", "name": "Pitch", "emoji": "🎯", "description": "Writes pitches", "created_by": OWNER,
                "workspace_id": None, "is_published": True, "visibility": "public", "system_prompt": "DRAFT PROMPT",
                "ai_provider": "claude", "ai_model": "claude-sonnet-5-5", "output_type": "markdown", "app_type": "native",
                "form_schema": [{"id": "1", "label": "Company", "required": True}], "greeting": "Hi from draft",
                "live_version": 1, "prod_snapshot": dict(LIVE), **extra})


# ── In-memory database ───────────────────────────────────────────────────────
TABLES = {"app_triggers": [], "app_runs": [], "run_history": [], "app_versions": [], "app_blueprints": [], "run_events": []}
RUN_DAYS = {}


class Q:
    def __init__(self, name):
        self.name, self.filters, self.op, self.payload, self.count, self.single, self.order_key = name, [], "select", None, None, False, None

    def select(self, *a, count=None, head=False, **k): self.count = count; return self
    def insert(self, row): self.op, self.payload = "insert", row; return self
    def upsert(self, row, on_conflict=None, **kwargs): self.op, self.payload, self.conflict = "upsert", row, on_conflict; return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, k, v): self.filters.append(lambda r, k=k, v=v: r.get(k) == v); return self
    def neq(self, k, v): self.filters.append(lambda r, k=k, v=v: r.get(k) != v); return self
    def gte(self, k, v): return self
    @property
    def not_(self): return self
    def is_(self, k, v): self.filters.append(lambda r, k=k: r.get(k) is not None); return self
    def order(self, k, desc=False): self.order_key, self.desc = k, desc; return self
    def limit(self, n): return self
    def maybe_single(self): self.single = True; return self

    def execute(self):
        if self.name == "apps":
            if self.op == "update":
                APP.update(self.payload)
            return NS(data=[APP], count=1)
        rows = TABLES.setdefault(self.name, [])
        if self.op == "insert":
            rows.append(dict(self.payload)); return NS(data=[self.payload], count=None)
        if self.op == "upsert":
            key = self.conflict
            rows[:] = [r for r in rows if r.get(key) != self.payload.get(key)] + [dict(self.payload)]
            return NS(data=[self.payload], count=None)
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "delete":
            rows[:] = [r for r in rows if r not in match]; return NS(data=match, count=None)
        if self.op == "update":
            for r in match:
                r.update(self.payload)
            return NS(data=match, count=None)
        if self.order_key:
            match.sort(key=lambda r: str(r.get(self.order_key) or ""), reverse=self.desc)
        if self.single:
            return NS(data=match[0] if match else None)
        return NS(data=match, count=len(match))


def rpc(name, params):
    if name == "claim_app_daily_run":
        key = params["p_app_id"]
        if RUN_DAYS.get(key, 0) >= params["p_limit"]:
            return NS(execute=lambda: NS(data=False))
        RUN_DAYS[key] = RUN_DAYS.get(key, 0) + 1
        return NS(execute=lambda: NS(data=True))
    return NS(execute=lambda: NS(data=None))


main._service_client = lambda: NS(table=lambda t: Q(t), rpc=rpc)
main._telemetry_service_client = main._service_client

SEEN = []


async def load_app_row(app_id): return dict(APP) if app_id == APP.get("id") else None
async def verify(tok): return {"tok-owner": OWNER, "tok-user": USER}.get(tok)
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyd(*a, **k): return {}
async def emptyl(*a, **k): return []
async def allow(*a, **k): return True, ""
async def no_checks(*a, **k): return []


async def tests_pass(app_row, user_id=None):
    state = await main.app_draft_state(app_row)
    return {"all_passed": True, "required_passed": 1, "required_total": 1, "draft_hash": main.state_hash(state)}


async def fake_stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    SEEN.append({"system": system, "model": model})
    if usage_holder is not None:
        usage_holder.update(input_tokens=10, output_tokens=20)
    yield "ok"

main.load_app_row = load_app_row; main.verify_user_jwt = verify
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main._load_app_secrets = emptyd
main.check_rate_limit = allow; main.record_metered_run = none; main.find_active_entitlement = none
main.fetch_user_api_key = none; main.fetch_user_api_key_by_id = none
main._publish_checks = no_checks; main.app_test_status = tests_pass
main.stream_claude = fake_stream

c = TestClient(main.app, raise_server_exceptions=False)
owner = {"Authorization": "Bearer tok-owner"}
user = {"Authorization": "Bearer tok-user"}


def settle():
    time.sleep(0.3)   # run-log rows are written by a background task


# ── Draft vs live: missing fields aren't changes ─────────────────────────────
ok("old live snapshots missing newer fields still match an unchanged draft",
   main.same_as_live({"a": 1}, {"a": 1, "added_later": None}) and not main.same_as_live({"a": 1}, {"a": 2}))
ok("no live version → not the same", not main.same_as_live(None, {"a": 1}))

# ── Promote only real changes ────────────────────────────────────────────────
reset_app()
state = asyncio.run(main.app_draft_state(dict(APP)))
reset_app(prod_snapshot=state)
r = c.post("/v1/apps/app-1/promote", headers=owner)
ok("promote with no changes is refused (409 no_changes)", r.status_code == 409 and r.json().get("code") == "no_changes")
ok("…and saves no version", TABLES["app_versions"] == [])
reset_app(prod_snapshot=state, is_published=False)
r = c.post("/v1/apps/app-1/promote", headers=owner)
ok("unpublished + unchanged: back online as the same version, no new one",
   r.status_code == 200 and r.json().get("unchanged") and r.json()["version"] == 1 and APP["is_published"] and TABLES["app_versions"] == [])
rel = c.get("/v1/apps/app-1/release", headers=owner).json()
ok("release: unchanged draft has no changes", rel["has_changes"] is False)
reset_app()
ok("release: a changed draft has changes", c.get("/v1/apps/app-1/release", headers=owner).json()["has_changes"] is True)

# ── What users will see ──────────────────────────────────────────────────────
reset_app()
v = c.get("/v1/apps/app-1/live-preview", headers=owner).json()
ok("preview shows the live version, not the draft", v["source"] == "live" and v["greeting"] == "Hi from live"
   and v["form_schema"][0]["label"] == "Name" and v["live_version"] == 1)
reset_app(is_published=False)
ok("preview of an unpublished app shows the last live version", c.get("/v1/apps/app-1/live-preview", headers=owner).json()["source"] == "offline")
reset_app(prod_snapshot=None, live_version=None)
ok("preview of a never-published app shows the draft", c.get("/v1/apps/app-1/live-preview", headers=owner).json()["source"] == "draft")
ok("preview: only editors (404)", c.get("/v1/apps/app-1/live-preview", headers=user).status_code == 404)

# ── Inbound trigger links ────────────────────────────────────────────────────
reset_app()
tok = c.post("/v1/apps/app-1/trigger", headers=owner).json()["token"]
ok("trigger link created (trg_…)", tok.startswith("trg_") and c.get("/v1/apps/app-1/trigger", headers=owner).json()["token"] == tok)
ok("trigger link: only editors (404)", c.post("/v1/apps/app-1/trigger", headers=user).status_code == 404)
SEEN.clear(); TABLES["app_runs"].clear()
r = c.post(f"/webhooks/{tok}", json={"input": "hello"})
settle()
ok("trigger runs the LIVE version (not the developer's draft)", r.status_code == 200 and r.json()["output"] == "ok"
   and "LIVE PROMPT" in SEEN[0]["system"] and SEEN[0]["model"] == "claude-haiku-5-5")
ok("trigger run is logged as 'trigger' and not as a person", [(x["source"], x["user_id"]) for x in TABLES["app_runs"]] == [("trigger", None)])
ok("unknown trigger → 404", c.post("/webhooks/trg_nope_nope_nope_nope", json={"input": "x"}).status_code == 404)
APP["is_published"] = False
ok("trigger on an unpublished app → 409", c.post(f"/webhooks/{tok}", json={"input": "x"}).status_code == 409)
APP["is_published"] = True
new = c.post("/v1/apps/app-1/trigger", headers=owner).json()["token"]
ok("replacing the link turns the old one off", new != tok and c.post(f"/webhooks/{tok}", json={"input": "x"}).status_code == 404)
c.delete("/v1/apps/app-1/trigger", headers=owner)
ok("turning it off → 404", c.post(f"/webhooks/{new}", json={"input": "x"}).status_code == 404)

# ── Daily run quota ──────────────────────────────────────────────────────────
reset_app(max_runs_per_day=2)
RUN_DAYS.clear()
codes = [c.post("/run", json={"app_id": "app-1", "input": "hi"}, headers=user).status_code for _ in range(3)]
ok("end users: quota allows 2 runs, refuses the 3rd (429)", codes == [200, 200, 429])
r = c.post("/run", json={"app_id": "app-1", "input": "hi"}, headers=user)
ok("…with a clear message", r.status_code == 429 and r.json().get("code") == "app_quota")
ok("the developer's own runs don't count against it", c.post("/run", json={"app_id": "app-1", "input": "hi", "system_prompt": "DRAFT PROMPT"}, headers=owner).status_code == 200)

# ── Run log and stats ────────────────────────────────────────────────────────
reset_app()
TABLES["app_runs"].clear()
c.post("/run", json={"app_id": "app-1", "input": "hi"}, headers=user)
c.post("/run", json={"app_id": "app-1", "input": "hi", "system_prompt": "DRAFT PROMPT"}, headers=owner)
settle()
ok("end-user runs are logged; the developer's draft runs aren't",
   [(x["source"], x["user_id"]) for x in TABLES["app_runs"]] == [("app", USER)])
ok("run log keeps token counts", TABLES["app_runs"][0]["input_tokens"] == 10 and TABLES["app_runs"][0]["output_tokens"] == 20)
TABLES["app_runs"] += [{"app_id": "app-1", "user_id": None, "source": "embed", "created_at": "2026-10-14T01:00:00Z"},
                       {"app_id": "app-1", "user_id": None, "source": "trigger", "created_at": "2026-10-14T02:00:00Z"}]
st = c.get("/v1/apps/app-1/stats", headers=owner).json()
ok("stats count everyone: people, visitors, API", st["total"] == 3 and st["users"] == 1 and st["visitor_runs"] == 1 and st["api_runs"] == 1)
ok("stats: only editors (404)", c.get("/v1/apps/app-1/stats", headers=user).status_code == 404)

# Closing a response early is a real outcome, not a silent disappearance.
from starlette.requests import Request
async def close_early():
    request = Request({'type': 'http', 'method': 'POST', 'headers': [(b'authorization', b'Bearer tok-user')], 'client': ('127.0.0.1', 1)})
    response = await main.execute_run(main.RunRequest(app_id='app-1', input='hi'), request,
                                      caller=main.ApiCaller(user_id=USER, user_jwt='tok-user'))
    await response.body_iterator.__anext__()
    await response.body_iterator.aclose()
    await asyncio.gather(*main._telemetry_tasks)      # delivery runs in the background
before = len(TABLES['app_runs'])
asyncio.run(close_early())
ok('a disconnected stream records exactly one cancelled outcome', len(TABLES['app_runs']) == before + 1
   and TABLES['app_runs'][-1]['error_kind'] == 'cancelled' and TABLES['app_runs'][-1]['status'] == 'error')
real_outbox = main._telemetry_outbox
def disk_full(*args): raise OSError('SIMULATED DISK FULL')
main._telemetry_outbox = NS(begin=disk_full, finish=disk_full, acknowledged=disk_full, failed=disk_full)
before, logged = len(SEEN), len(TABLES['app_runs'])
r = c.post('/run', json={'app_id': 'app-1', 'input': 'hi'}, headers=user)
settle()
ok('unavailable recovery storage never stops a customer run', r.status_code == 200 and len(SEEN) == before + 1)
deadline = time.time() + 3
while len(TABLES['app_runs']) == logged and time.time() < deadline: time.sleep(0.05)
ok('…and its outcome is still sent directly to the run log', len(TABLES['app_runs']) == logged + 1)
main._telemetry_outbox = real_outbox

# ── Signed webhooks ──────────────────────────────────────────────────────────
secret = c.get("/v1/apps/app-1/webhook/secret", headers=owner).json()["secret"]
ok("signing secret is stable per app and differs between apps",
   secret.startswith("whsec_") and secret == main.webhook_secret("app-1") and secret != main.webhook_secret("app-2"))
SENT = {}


async def fake_safe_post(method, url, *, content=None, headers=None, max_redirects=5, **kw):
    SENT.update(method=method, url=url, body=content, headers=headers, max_redirects=max_redirects); return NS(status_code=204)

real_fetch = main.fetch_safely
main.fetch_safely = fake_safe_post
reset_app(webhook_url="https://hooks.example.com/aistrix")
r = c.post("/v1/apps/app-1/webhook/test", headers=owner)
t, v1 = [p.split("=", 1)[1] for p in SENT["headers"]["X-Aistrix-Signature"].split(",")]
expected = hmac.new(secret.encode(), t.encode() + b"." + SENT["body"], hashlib.sha256).hexdigest()
ok("Send test: signed sample payload, receiver's status returned", r.json() == {"ok": True, "status": 204} and b'"event": "test"' in SENT["body"])
ok("signature = HMAC-SHA256(secret, '<t>.<body>')", hmac.compare_digest(expected, v1))
ok("deliveries go through the checked outbound path and don't follow redirects", SENT["method"] == "POST" and SENT["max_redirects"] == 0)
main.fetch_safely = real_fetch
reset_app(webhook_url=None)
ok("Send test without a saved URL → 400", c.post("/v1/apps/app-1/webhook/test", headers=owner).status_code == 400)

# ── Readable server errors ───────────────────────────────────────────────────
@main.app.get("/__check_boom")
async def boom():
    raise RuntimeError("kaboom")
r = c.get("/__check_boom", headers={"Origin": main.ALLOWED_ORIGINS[0]})
ok("unexpected error → readable JSON 500 with CORS headers (not 'Failed to fetch')",
   r.status_code == 500 and "Server error" in r.json()["error"] and r.headers.get("access-control-allow-origin") == main.ALLOWED_ORIGINS[0])

# ── Access checks fail loudly ────────────────────────────────────────────────
class Boom:
    def __init__(self, err): self.err = err
    def table(self, t): return self
    def select(self, *a, **k): return self
    def eq(self, *a): return self
    def limit(self, n): return self
    def execute(self): raise self.err

import importlib  # noqa: E402
fresh = importlib.reload(main)   # the real lookups (this script stubbed them above)
fresh._service_client = lambda: Boom(ConnectionError("network down"))
try:
    asyncio.run(fresh.workspace_role("ws-1", "u-1"))
    ok("a failed membership lookup is an error (503), not 'not a member'", False)
except HTTPException as e:
    ok("a failed membership lookup is an error (503), not 'not a member'", e.status_code == 503)
fresh._service_client = lambda: Boom(Exception("PGRST205: Could not find the table 'public.workspace_members'"))
ok("…but a missing table (not migrated yet) still means no workspace", asyncio.run(fresh.workspace_role("ws-1", "u-1")) is None)

# ── Health: public basics, operator-only deployment details ─────────────────
import os
h = c.get("/health").json()
ok("public /health has no database or process details", "database_project" not in h and "process_id" not in h)
os.environ.pop("OPS_HEALTH_TOKEN", None)
ok("deployment details are hidden when no operator token is set", c.get("/health/details", headers={"X-Ops-Token": ""}).status_code == 404)
os.environ["OPS_HEALTH_TOKEN"] = "ops-fixture-token"
ok("…and need the operator token", c.get("/health/details", headers={"X-Ops-Token": "wrong"}).status_code == 404)
d = c.get("/health/details", headers={"X-Ops-Token": "ops-fixture-token"})
ok("the operator sees the database project and recovery setup", d.status_code == 200 and "database_project" in d.json() and "telemetry_recovery_configured" in d.json())
finish()
