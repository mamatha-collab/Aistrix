"""Draft vs production: end users run the promoted (frozen) version, editors
run the draft; promoting requires the publish checks and passing tests for
the current draft, then saves the live version and publishes."""
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
main.platform_key = lambda provider: "test-platform-key"   # model calls are stubbed; never a real key
from fastapi.testclient import TestClient

c = TestClient(main.app)
OWNER, USER = "owner", "user"
DRAFT_BP = {"input_schema": {"fields": [{"field": "company", "type": "string", "required": True}]}}
LIVE_BP = {"input_schema": {"fields": [{"field": "name", "type": "string", "required": True}]}}
APP = {"id": "app-1", "name": "Pitch", "created_by": OWNER, "is_published": True, "visibility": "public",
       "system_prompt": "DRAFT PROMPT", "ai_provider": "claude", "ai_model": "claude-sonnet-5-5", "output_type": "markdown",
       "form_schema": [{"id": "1", "label": "Company", "required": True}], "app_type": "native",
       "prod_snapshot": {"system_prompt": "LIVE PROMPT", "ai_provider": "claude", "ai_model": "claude-haiku-5-5",
                         "output_type": "markdown", "form_schema": [{"id": "1", "label": "Name", "required": True}],
                         "app_type": "native", "blueprint": LIVE_BP,
                         "tools": [{"name": "live_tool", "description": "d", "type": "http", "config": {}, "input_schema": {}}]}}
SEEN = []

async def load_app_row(app_id): return dict(APP) if app_id == APP["id"] else None
async def verify(tok): return {"tok-owner": OWNER, "tok-user": USER}.get(tok)
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyd(*a, **k): return {}
async def allow(*a, **k): return True, ""
async def draft_bp(app_id): return DRAFT_BP
TOOL_CALLS = []
async def draft_tools(app_id): TOOL_CALLS.append(app_id); return [{"name": "draft_tool", "description": "d", "type": "http", "config": {}, "input_schema": {}}]
main.load_app_row = load_app_row; main.verify_user_jwt = verify
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_blueprint = draft_bp; main.fetch_app_tools = draft_tools
main._load_app_secrets = emptyd; main.check_rate_limit = allow; main.record_metered_run = none
main.fetch_user_api_key = none; main.fetch_user_api_key_by_id = none; main.find_active_entitlement = none

async def fake_stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    SEEN.append({"system": system, "model": model})
    yield "ok"
async def fake_tools_loop(system, user_input, model, tools, api_key=None, max_steps=10, ctx=None, **kw):
    SEEN.append({"system": system, "model": model, "tools": [t["name"] for t in tools]})
    yield ("token", "ok")
main.stream_claude = fake_stream
main.run_claude_with_tools = fake_tools_loop

def run(tok):
    SEEN.clear()
    # Screens send the prompt they show; the server ignores it for end users.
    return c.post("/run", json={"app_id": "app-1", "input": "hi", "system_prompt": APP["system_prompt"]}, headers={"Authorization": f"Bearer {tok}"})

# ── who runs what ───────────────────────────────────────────────────────────
r = run("tok-user")
ok("end users run the live version (prompt, model, tools)", r.status_code == 200 and "LIVE PROMPT" in SEEN[0]["system"]
   and "DRAFT PROMPT" not in SEEN[0]["system"] and SEEN[0]["model"] == "claude-haiku-5-5" and SEEN[0]["tools"] == ["live_tool"])
r = run("tok-owner")
ok("editors run the draft", "DRAFT PROMPT" in SEEN[0]["system"] and SEEN[0]["model"] == "claude-sonnet-5-5" and SEEN[0]["tools"] == ["draft_tool"])
saved = APP.pop("prod_snapshot")
run("tok-user")
ok("apps never promoted run as they are", "DRAFT PROMPT" in SEEN[0]["system"])
APP["prod_snapshot"] = saved

view = c.get("/v1/apps/app-1", headers={"Authorization": "Bearer tok-user"}).json()
ok("API: end users see the live form and contract", [p["label"] for p in view["parameters"]] == ["Name"]
   and view["input_schema"][0]["field"] == "name")
view = c.get("/v1/apps/app-1", headers={"Authorization": "Bearer tok-owner"}).json()
ok("API: editors see the draft", [p["label"] for p in view["parameters"]] == ["Company"])
r = c.post("/v1/apps/app-1/run", json={"fields": {"company": "Acme"}, "stream": False}, headers={"Authorization": "Bearer tok-user"})
ok("API runs are validated against the live contract", r.status_code == 422)

# ── promote ─────────────────────────────────────────────────────────────────
UPDATES = []
class _T:
    def __init__(self, name): self.name = name; self.patch = None
    def update(self, patch): self.patch = patch; return self
    def eq(self, *a): return self
    def execute(self): UPDATES.append((self.name, self.patch)); return NS(data=[])
main._service_client = lambda: NS(table=lambda t: _T(t))
CHECKS = {"errors": []}
async def checks(app_id, jwt): return CHECKS["errors"]
main._publish_checks = checks
STATUS = {}
async def status(app_row):
    return {"draft_hash": main.state_hash(await main.app_draft_state(app_row)), **STATUS}
main.app_test_status = status
owner = {"Authorization": "Bearer tok-owner"}

STATUS.update(all_passed=False, requirements=[{"id": "safety", "label": "Safety and leakage checks", "required": True,
                                                "passed": False, "fix": "Run a prompt/secret leakage test."}])
r = c.post("/v1/apps/app-1/promote", headers=owner)
ok("promote blocked until the tests pass (409, says which)", r.status_code == 409
   and r.json()["test_problems"] == ["Safety and leakage checks: Run a prompt/secret leakage test."] and UPDATES == [])
STATUS.update(all_passed=True, requirements=[])
CHECKS["errors"] = ["Description is required"]
r = c.post("/v1/apps/app-1/promote", headers=owner)
ok("promote blocked by the publish checks", r.status_code == 409 and r.json()["checks"] == ["Description is required"])
CHECKS["errors"] = []
ok("only editors can promote (404)", c.post("/v1/apps/app-1/promote", headers={"Authorization": "Bearer tok-user"}).status_code == 404)

r = c.post("/v1/apps/app-1/promote", headers=owner)
apps_patch = next(p for t, p in UPDATES if t == "apps")
ok("promote saves the draft as the live version and publishes", r.status_code == 200 and apps_patch["is_published"]
   and apps_patch["prod_snapshot"]["system_prompt"] == "DRAFT PROMPT" and apps_patch["prod_snapshot"]["blueprint"] == DRAFT_BP
   and [t["name"] for t in apps_patch["prod_snapshot"]["tools"]] == ["draft_tool"] and apps_patch["has_draft_changes"] is False)
ok("…and keeps blueprint_prod in step for the Deploy diff", ("app_blueprints", {"blueprint_prod": DRAFT_BP}) in UPDATES)

async def moving_status(app_row):
    return {"draft_hash": "an-older-draft", "all_passed": True, "requirements": []}
main.app_test_status = moving_status
UPDATES.clear()
r = c.post("/v1/apps/app-1/promote", headers=owner)
ok("draft changed after testing → not promoted", r.status_code == 409 and UPDATES == [])
main.app_test_status = status

# ── release status ──────────────────────────────────────────────────────────
APP["prod_snapshot"] = apps_patch["prod_snapshot"]
rel = c.get("/v1/apps/app-1/release", headers=owner).json()
ok("release: just promoted → no draft changes, ready", rel["has_live_version"] and not rel["has_changes"] and rel["ready"])
APP["system_prompt"] = "DRAFT PROMPT v2"
rel = c.get("/v1/apps/app-1/release", headers=owner).json()
ok("release: editing the draft shows unpromoted changes", rel["has_changes"] and rel["draft_hash"] != rel["live_hash"])

finish()
