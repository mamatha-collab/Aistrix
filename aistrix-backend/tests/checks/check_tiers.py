"""Developer tiers (both free): Free and Verified. Draft/published app limits,
test runs per day and at once, bring-your-own-key for everything a
developer's app runs, first publish reviewed by staff, Basic vs Standard
analytics, the plan endpoint and staff verification. Fake Supabase and fake
model streams only."""
import asyncio
import time
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup(DEVELOPER_TIERS="1", AISTRIX_TESTS_ALLOW_PLATFORM_KEYS="0")
import main  # noqa
main.platform_key = lambda provider: "test-platform-key"     # Aistrix has keys; developer apps must not use them
from fastapi.testclient import TestClient

FREE, VERIFIED, STAFF, TEAMMATE, CUSTOMER = "free-dev", "verified-dev", "staff-1", "teammate", "customer"
TIERS = {FREE: "free", VERIFIED: "verified", STAFF: "staff", TEAMMATE: "free", CUSTOMER: "free"}
KEYS: dict = {}                                  # (user, provider) → key
TABLES: dict = {}
LIMITS = [{"tier": "free", "draft_apps": 5, "published_apps": 3, "tests_per_day": 20, "concurrent_tests": 1, "analytics": "basic"},
          {"tier": "verified", "draft_apps": 10, "published_apps": 6, "tests_per_day": 100, "concurrent_tests": 3, "analytics": "standard"}]


def app_row(app_id, owner, **extra):
    return {"id": app_id, "name": app_id, "created_by": owner, "workspace_id": None, "is_published": False, "status": "approved",
            "visibility": "private", "system_prompt": "PROMPT", "ai_provider": "claude", "ai_model": "claude-haiku-5-5",
            "output_type": "markdown", "app_type": "native", "form_schema": [], "live_version": None, "prod_snapshot": None,
            "publish_approved_at": None, **extra}


def reset(*apps):
    TABLES.clear()
    TABLES.update({"apps": list(apps), "app_versions": [], "app_blueprints": [], "app_runs": [], "run_history": [],
                   "developer_limits": [dict(l) for l in LIMITS], "developer_test_usage": [], "developer_profiles": [],
                   "run_events": [], "app_test_runs": []})
    SLOTS.clear(); DAILY.clear(); RELEASED.clear(); SEEN.clear()
    main._tier_cache.clear()


class Q:
    def __init__(self, name): self.name, self.filters, self.op, self.payload, self.single = name, [], "select", None, False
    def select(self, *a, **k): return self
    def insert(self, row): self.op, self.payload = "insert", row; return self
    def upsert(self, row, on_conflict=None, **k): self.op, self.payload, self.conflict = "upsert", row, on_conflict; return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, k, v): self.filters.append(lambda r, k=k, v=v: r.get(k) == v); return self
    def neq(self, k, v): self.filters.append(lambda r, k=k, v=v: r.get(k) != v); return self
    def in_(self, k, vs): self.filters.append(lambda r, k=k: r.get(k) in vs); return self
    def gte(self, *a): return self
    def lte(self, *a): return self
    @property
    def not_(self): self.negate = True; return self
    def is_(self, k, v):
        neg = getattr(self, "negate", False); self.negate = False
        self.filters.append(lambda r, k=k: (r.get(k) is not None) if neg else (r.get(k) is None)); return self
    def order(self, *a, **k): return self
    def limit(self, *a): return self
    def range(self, *a): return self
    def maybe_single(self): self.single = True; return self
    def single_(self): return self
    def execute(self):
        rows = TABLES.setdefault(self.name, [])
        if self.op == "insert":
            rows.append(dict(self.payload)); return NS(data=[self.payload], count=None)
        if self.op == "upsert":
            key = self.conflict
            existing = next((r for r in rows if r.get(key) == self.payload.get(key)), None)
            existing.update(self.payload) if existing else rows.append(dict(self.payload))
            return NS(data=[self.payload], count=None)
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "delete":
            rows[:] = [r for r in rows if r not in match]; return NS(data=match)
        if self.op == "update":
            for r in match: r.update(self.payload)
            return NS(data=[dict(r) for r in match])
        if self.single:
            return NS(data=dict(match[0])) if match else None
        return NS(data=[dict(r) for r in match], count=len(match))


SLOTS, DAILY, RELEASED = {}, {}, []


def rpc(name, params):
    if name == "developer_tier":
        return NS(execute=lambda: NS(data=TIERS.get(params["p_user"], "free")))
    if name == "claim_test_run":
        user = params["p_user"]; tier = TIERS.get(user, "free")
        if tier == "staff":
            return NS(execute=lambda: NS(data={"ok": True, "slot": None, "tier": tier}))
        lim = next(l for l in LIMITS if l["tier"] == tier)
        active = SLOTS.setdefault(user, set())
        if len(active) >= lim["concurrent_tests"]:
            return NS(execute=lambda: NS(data={"ok": False, "reason": "concurrent", "limit": lim["concurrent_tests"], "tier": tier}))
        if DAILY.get(user, 0) >= lim["tests_per_day"]:
            return NS(execute=lambda: NS(data={"ok": False, "reason": "daily", "limit": lim["tests_per_day"], "tier": tier}))
        slot = min(set(range(1, lim["concurrent_tests"] + 1)) - active)
        active.add(slot); DAILY[user] = DAILY.get(user, 0) + 1
        return NS(execute=lambda: NS(data={"ok": True, "slot": slot, "tier": tier}))
    if name == "release_test_run":
        SLOTS.get(params["p_user"], set()).discard(params["p_slot"]); RELEASED.append(params["p_slot"])
        return NS(execute=lambda: NS(data=None))
    return NS(execute=lambda: NS(data=None))


main._service_client = lambda: NS(table=lambda t: Q(t), rpc=rpc)
main._telemetry_service_client = main._service_client
SEEN = []


async def load_app_row(app_id): return next((dict(a) for a in TABLES["apps"] if a["id"] == app_id), None)
async def verify(tok): return tok.removeprefix("tok-") or None
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyd(*a, **k): return {}
async def emptyl(*a, **k): return []
async def allow(*a, **k): return True, ""
async def key_by_id(user_id, provider): return KEYS.get((user_id, provider))
async def key_by_jwt(jwt, provider): return KEYS.get((jwt.removeprefix("tok-"), provider))
async def can_edit(app, caller): return bool(app) and caller is not None and caller.user_id in (app.get("created_by"), TEAMMATE)
async def tests_pass(app_row, user_id=None):
    return {"all_passed": True, "required_passed": 1, "required_total": 1, "draft_hash": main.state_hash(await main.app_draft_state(app_row))}


async def fake_stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    SEEN.append({"model": model, "key": api_key})
    if usage_holder is not None:
        usage_holder.update(input_tokens=10, output_tokens=20)
    yield '{"pass": true, "reason": "fine"}' if "grade one answer" in system else "ok"

main.load_app_row = load_app_row; main.verify_user_jwt = verify; main.can_edit_app = can_edit
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main._load_app_secrets = emptyd
main.check_rate_limit = allow; main.record_metered_run = none; main.find_active_entitlement = none
main.fetch_user_api_key = key_by_jwt; main.fetch_user_api_key_by_id = key_by_id
main._publish_checks = emptyl; main.app_test_status = tests_pass
main.stream_claude = fake_stream; main.stream_openai = fake_stream
c = TestClient(main.app, raise_server_exceptions=False)
as_ = lambda who: {"Authorization": f"Bearer tok-{who}"}
run = asyncio.run

# ── Bring your own key: a developer's app never runs on Aistrix's key ───────
reset(app_row("app-free", FREE, is_published=True, publish_approved_at="2026-10-01"))
r = c.post("/run", json={"app_id": "app-free", "input": "hi"}, headers=as_(FREE))
ok("a developer without a key can't run their app on Aistrix's key (says to add one)",
   r.status_code == 409 and r.json()["code"] == "needs_own_key" and "Settings → Keys" in r.json()["error"] and not SEEN)
r = c.post("/run", json={"app_id": "app-free", "input": "hi"}, headers=as_(CUSTOMER))
ok("…and their customers get a clear 'not available' instead of a run on Aistrix's key",
   r.status_code == 503 and r.json()["code"] == "app_needs_developer_key" and not SEEN)
KEYS[(FREE, "claude")] = "sk-ant-free-dev"
c.post("/run", json={"app_id": "app-free", "input": "hi"}, headers=as_(CUSTOMER))
ok("with the developer's key, customers' runs use it", SEEN and SEEN[-1]["key"] == "sk-ant-free-dev")
SEEN.clear()
c.post("/run", json={"app_id": "app-free", "input": "hi"}, headers=as_(TEAMMATE))
ok("a teammate without a key builds on the owner's key, not Aistrix's", SEEN and SEEN[-1]["key"] == "sk-ant-free-dev")
SEEN.clear(); KEYS.clear()
reset(app_row("app-staff", STAFF, is_published=True, publish_approved_at="2026-10-01"))
c.post("/run", json={"app_id": "app-staff", "input": "hi"}, headers=as_(CUSTOMER))
ok("customers of Aistrix's own apps still run on Aistrix's key", SEEN and SEEN[-1]["key"] in (None, "test-platform-key"))
SEEN.clear()
r = c.post("/run", json={"app_id": "app-staff", "input": "hi"}, headers=as_(STAFF))
ok("…but staff building their own app need their own key too", r.status_code == 409 and r.json()["code"] == "needs_own_key" and not SEEN)

# Developer tools (Build with AI, copilot, Improve…) never use Aistrix's key — staff included.
SEEN.clear()
r = c.post("/run", json={"purpose": "build", "input": "make an app", "system_prompt": "You build apps"}, headers=as_(FREE))
ok("developer tools without the developer's own key are refused, never run on Aistrix's key",
   r.status_code == 409 and r.json()["code"] == "needs_own_key" and "Settings → Keys" in r.json()["error"] and not SEEN)
ok("…for staff too", c.post("/run", json={"purpose": "build", "input": "x"}, headers=as_(STAFF)).status_code == 409 and not SEEN)
KEYS[(FREE, "claude")] = "sk-ant-free-dev"
c.post("/run", json={"purpose": "build", "input": "make an app", "system_prompt": "You build apps"}, headers=as_(FREE))
ok("…and with their key they run on it", SEEN and SEEN[-1]["key"] == "sk-ant-free-dev")
SEEN.clear(); KEYS.clear()
c.post("/run", json={"input": "monthly report", "system_prompt": "You write reports"}, headers=as_(CUSTOMER))
ok("business-user features (no app, not a developer tool) keep Aistrix's key", SEEN and SEEN[-1]["key"] in (None, "test-platform-key"))

get_key, _ = main.pdf_reader_for(None, None, None, {"created_by": FREE})
try:
    run(get_key()); refused = False
except main.OcrError as e:
    refused = "hasn't connected a Claude key" in str(e)
ok("website visitors' scanned PDFs are read on the developer's key, never Aistrix's", refused)

# ── Tests: per day and at once, by tier ──────────────────────────────────────
reset(app_row("app-free", FREE))
KEYS[(FREE, "claude")] = "sk-ant-free-dev"
case = {"source": "suite", "case_ref": "c1", "label": "t", "input": "hi", "checks": [{"type": "must-contain", "value": "ok"}]}
r = c.post("/v1/apps/app-free/tests/run", json=case, headers=as_(FREE))
ok("a test runs and frees its slot afterwards", r.status_code == 200 and r.json()["passed"] and RELEASED == [1] and not SLOTS[FREE])
SLOTS[FREE].add(1)                                        # another test is running
r = c.post("/v1/apps/app-free/tests/run", json=case, headers=as_(FREE))
ok("Free developers run 1 test at a time", r.status_code == 429 and "1 test at a time" in r.json()["detail"])
SLOTS[FREE].clear(); DAILY[FREE] = 20
r = c.post("/v1/apps/app-free/tests/run", json=case, headers=as_(FREE))
ok("…and 20 a day, with a clear message (and what Verified gets)", r.status_code == 429
   and "20 tests a day" in r.json()["detail"] and "Verified developers get 100" in r.json()["detail"])
reset(app_row("app-ver", VERIFIED, ai_provider="openai", ai_model="gpt-4o-mini")); KEYS[(VERIFIED, "openai")] = "sk-openai-verified"
SLOTS[VERIFIED] = {1, 2}
ok("Verified developers run 3 at a time", c.post("/v1/apps/app-ver/tests/run", json=case, headers=as_(VERIFIED)).status_code == 200)

# AI-graded checks are graded with whichever provider key the developer has.
judged = {**case, "checks": [{"type": "judge", "value": "is polite"}]}
SEEN.clear(); SLOTS.clear()
r = c.post("/v1/apps/app-ver/tests/run", json=judged, headers=as_(VERIFIED))
ok("AI-graded checks use the developer's OpenAI key when that's what they have",
   r.status_code == 200 and r.json()["judged_checks"] == 1 and any(s["key"] == "sk-openai-verified" and s["model"] == "gpt-4o-mini" for s in SEEN))
KEYS.clear(); KEYS[(VERIFIED, "claude")] = "sk-ant-x"
ok("…and with no key at all they say so", run(main.judge_key_for("nobody", FREE)) == (None, ""))

# ── Publishing: first publish reviewed by staff; published-app limits ────────
reset(app_row("app-free", FREE))
r = c.post("/v1/apps/app-free/promote", headers=as_(FREE))
app = TABLES["apps"][0]
ok("a first publish is sent for review, not made live", r.status_code == 200 and r.json()["pending_review"]
   and app["status"] == "pending" and not app["is_published"] and app["prod_snapshot"] and TABLES["app_versions"])
r = c.post("/v1/apps/app-free/promote", headers=as_(FREE))
ok("…publishing again while it waits says it's in review", r.status_code == 409 and r.json()["code"] == "in_review")
rel = c.get("/v1/apps/app-free/release", headers=as_(FREE)).json()
ok("…and Deploy can show it", rel["review"] == "pending")
ok("…it can't be pushed live by a rollback either", c.post("/v1/apps/app-free/versions/1/rollback", headers=as_(FREE)).status_code == 409)
app.update(status="approved", is_published=True, publish_approved_at="2026-10-20T10:00:00+00:00")   # staff approve (Moderator)
app["system_prompt"] = "BETTER"
r = c.post("/v1/apps/app-free/promote", headers=as_(FREE))
ok("once approved, later releases go live straight away", r.status_code == 200 and r.json()["is_published"] and not r.json().get("pending_review"))
TABLES["apps"] += [app_row("app-free-2", FREE, is_published=True), app_row("app-free-3", FREE, status="pending"), app_row("app-free-4", FREE)]
r = c.post("/v1/apps/app-free-4/promote", headers=as_(FREE))
ok("Free developers can have 3 published apps, counting one in review (says what Verified gets)", r.status_code == 409
   and r.json()["code"] == "published_limit" and "can have 3 published apps" in r.json()["error"]
   and "Unpublish one first" in r.json()["error"] and "Verified developers can publish 6" in r.json()["error"])
reset(app_row("app-staff", STAFF))
r = c.post("/v1/apps/app-staff/promote", headers=as_(STAFF))
ok("staff's own apps don't wait for review", r.status_code == 200 and r.json()["is_published"])

# ── Analytics: Basic (Free) vs Standard (Verified) ───────────────────────────
from datetime import datetime, timedelta, timezone
now = datetime.now(timezone.utc).isoformat()
runs = [{"created_at": now, "status": "ok", "live_version": 1, "latency_ms": 900, "user_id": f"u{i}", "source": "app",
         "error_kind": None, "cost_usd": 0.01} for i in range(30)]
async def rows(app_id, days, owner_id=None): return runs, [], False
main._monitor_rows = rows
reset(app_row("app-free", FREE, is_published=True, live_version=1), app_row("app-ver", VERIFIED, is_published=True, live_version=1))
basic = c.get("/v1/apps/app-free/monitor?days=7", headers=as_(FREE)).json()
standard = c.get("/v1/apps/app-ver/monitor?days=7", headers=as_(VERIFIED)).json()
ok("Basic: totals and errors, without response times, cost, per-version health or alerts",
   basic["analytics"] == "basic" and basic["totals"]["runs"] == 30 and basic["totals"]["errors"] == 0
   and basic["totals"]["latency_p95_ms"] is None and basic["totals"]["cost_usd"] is None and basic["by_version"] == []
   and basic["alerts"] == [] and all(d["cost_usd"] is None for d in basic["daily"]))
ok("Standard: all of it", standard["analytics"] == "standard" and standard["totals"]["latency_p95_ms"] == 900
   and standard["totals"]["cost_usd"] and standard["by_version"])

# ── Plan and staff verification ──────────────────────────────────────────────
reset(app_row("a1", FREE), app_row("a2", FREE, is_published=True), app_row("a3", FREE, status="pending"))
TABLES["developer_test_usage"].append({"user_id": FREE, "day": datetime.now(timezone.utc).date().isoformat(), "runs": 7})
plan = c.get("/v1/developer/plan", headers=as_(FREE)).json()
ok("the plan shows the tier, its limits and usage", plan["tier"] == "free" and plan["limits"]["draft_apps"] == 5
   and plan["limits"]["published_apps"] == 3
   and plan["usage"] == {"draft_apps": 2, "published_apps": 2, "tests_today": 7} and plan["all_limits"]["verified"]["published_apps"] == 6)
dev_id = "00000000-0000-0000-0000-00000000d001"
ok("only staff can verify a developer", c.post(f"/v1/admin/developers/{dev_id}/verification", json={"verified": True}, headers=as_(FREE)).status_code == 404
   and not TABLES["developer_profiles"])
r = c.post(f"/v1/admin/developers/{dev_id}/verification", json={"verified": True}, headers=as_(STAFF))
ok("staff mark a developer Verified", r.status_code == 200 and TABLES["developer_profiles"][0] == {"user_id": dev_id, "is_verified": True})

# ── Staff: developer list and app review (the developer is emailed) ────────
EMAILS = []
async def notify(user_id, kind, ref, subject, title, body, **kw): EMAILS.append((user_id, kind, subject, body)); return True
main.notify_developer = notify
reset(app_row("in-review", FREE, status="pending", prod_snapshot={"system_prompt": "P"}, live_version=1), app_row("other", VERIFIED, is_published=True))
TABLES["developer_profiles"] = [{"user_id": VERIFIED, "display_name": "Vera", "is_verified": True}]
TABLES["user_roles"] = [{"user_id": STAFF}]
ok("only staff list developers", c.get("/v1/admin/developers", headers=as_(FREE)).status_code == 404)
devs = {d["user_id"]: d for d in c.get("/v1/admin/developers", headers=as_(STAFF)).json()["developers"]}
ok("staff see each developer's tier and app counts", devs[FREE]["tier"] == "free" and devs[FREE]["draft_apps"] == 1
   and devs[VERIFIED]["tier"] == "verified" and devs[VERIFIED]["display_name"] == "Vera" and devs[VERIFIED]["published_apps"] == 1)
ok("sending an app back needs a note", c.post("/v1/admin/apps/in-review/review", json={"decision": "reject", "note": " "}, headers=as_(STAFF)).status_code == 400)
r = c.post("/v1/admin/apps/in-review/review", json={"decision": "reject", "note": "Add a privacy notice"}, headers=as_(STAFF))
app = TABLES["apps"][0]
ok("staff can ask for changes; the app stays offline and the developer is emailed the note", r.status_code == 200 and app["status"] == "rejected"
   and not app["is_published"] and EMAILS[-1][0] == FREE and "Add a privacy notice" in EMAILS[-1][3])
ok("…and Deploy shows the notes", c.get("/v1/apps/in-review/release", headers=as_(FREE)).json()["review_notes"] == "Add a privacy notice")
r = c.post("/v1/admin/apps/in-review/review", json={"decision": "approve"}, headers=as_(STAFF))
ok("approving puts it live, marks it approved and emails the developer", r.status_code == 200 and app["is_published"]
   and app["status"] == "approved" and app["publish_approved_at"] and EMAILS[-1][1] == "review_approve")
ok("only staff review apps", c.post("/v1/admin/apps/in-review/review", json={"decision": "approve"}, headers=as_(FREE)).status_code == 404)

# Signed-in users of a developer's Data app: scanned PDFs on their key or the developer's.
KEYS.clear()
get_key, _ = main.pdf_reader_for(None, CUSTOMER, "tok-customer", None, {"created_by": FREE})
try:
    run(get_key()); refused = False
except main.OcrError:
    refused = True
ok("a signed-in user's scanned PDF in a developer's app never uses Aistrix's key", refused)
KEYS[(FREE, "claude")] = "sk-ant-free-dev"
ok("…it uses the developer's key", run(get_key()) == "sk-ant-free-dev")
KEYS[(CUSTOMER, "claude")] = "sk-ant-customer"
ok("…or the user's own, first", run(get_key()) == "sk-ant-customer")
KEYS.clear()

# ── Scheduled flows: the scheduler's or developer's key, never Aistrix's ────
KEYS.clear()
ok("a scheduled step for a developer's app without any key is refused", run(main.scheduled_step_key({"created_by": FREE}, CUSTOMER, "claude"))[1])
KEYS[(CUSTOMER, "gemini")] = "gm-key"
ok("…the person who scheduled it pays with their own key", run(main.scheduled_step_key({"created_by": FREE}, CUSTOMER, "gemini")) == ("gm-key", None))
ok("…staff's apps may use Aistrix's key", run(main.scheduled_step_key({"created_by": STAFF}, "x", "claude")) == (None, None))
seen = []
async def fake_gemini(system, user_input, model, api_key=None, **kw): seen.append((model, api_key)); yield "ok"
main.stream_fn_for = lambda provider: fake_gemini if provider == "gemini" else fake_stream
ok("Gemini apps in flows are sent to Gemini (they went to Claude before)",
   run(main.run_text("s", "hi", "gemini", "gemini-3.8-flash", "gm-key")) == "ok" and seen == [("gemini-3.8-flash", "gm-key")])
finish()
