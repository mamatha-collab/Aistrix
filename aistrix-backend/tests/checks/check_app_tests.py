"""Dev Studio tests: run against the real app path on the server, graded
server-side (rules, JSON schema, sections, AI-graded criteria), recorded per
draft version, and summarised for the publish gate."""
import asyncio
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
main.platform_key = lambda provider: "test-platform-key"   # model calls are stubbed; never a real key
from fastapi.testclient import TestClient

c = TestClient(main.app)
OWNER = "owner"
APP = {"id": "app-1", "name": "Lead scorer", "created_by": OWNER, "is_published": False, "visibility": "public",
       "system_prompt": "Score the lead", "ai_provider": "claude", "ai_model": "claude-sonnet-5-5", "output_type": "markdown"}
BLUEPRINT = {"output_contract": {}}
TOOLS = []
ROWS = []          # app_test_runs
SYSTEMS = []

async def load_app_row(app_id): return dict(APP) if app_id == APP["id"] else None
async def verify(tok): return {"tok-owner": OWNER, "tok-other": "other"}.get(tok)
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyd(*a, **k): return {}
async def allow(*a, **k): return True, ""
async def bp(app_id): return BLUEPRINT
async def tools(app_id): return TOOLS
main.load_app_row = load_app_row; main.verify_user_jwt = verify
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_blueprint = bp; main.fetch_app_tools = tools
main._load_app_secrets = emptyd; main.check_rate_limit = allow; main.record_metered_run = none
main.fetch_user_api_key = none; main.fetch_user_api_key_by_id = none

REPLY = {"text": "Score: 82. Hot lead."}
JUDGE = {"reply": '{"pass": true, "reason": "Asks for the missing budget."}'}
async def fake_stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    SYSTEMS.append(system)
    if model == main.JUDGE_MODEL:
        yield JUDGE["reply"]
        return
    yield REPLY["text"]
    if usage_holder is not None:
        usage_holder.update(input_tokens=1000, output_tokens=500)
main.stream_claude = fake_stream

class _T:
    def __init__(self): self.q = {}
    def insert(self, row): ROWS.append({**row, "created_at": f"t{len(ROWS):04d}"}); return self
    def select(self, *a, **k): return self
    def eq(self, k, v): self.q[k] = v; return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    def execute(self):
        data = [r for r in ROWS if all(r.get(k) == v for k, v in self.q.items())]
        return NS(data=sorted(data, key=lambda r: r["created_at"], reverse=True))
main._service_client = lambda: NS(table=lambda t: _T())
auth = {"Authorization": "Bearer tok-owner"}

# ── draft fingerprint ───────────────────────────────────────────────────────
s1 = asyncio.run(main.app_draft_state(APP))
h1 = main.state_hash(s1)
ok("draft hash is stable", h1 == main.state_hash(asyncio.run(main.app_draft_state(dict(APP)))))
ok("prompt change → new draft hash", h1 != main.state_hash(asyncio.run(main.app_draft_state({**APP, "system_prompt": "x"}))))
TOOLS.append({"name": "Search", "type": "http", "config": {"url": "https://x"}, "description": "d", "input_schema": {}})
ok("tool change → new draft hash", h1 != main.state_hash(asyncio.run(main.app_draft_state(APP))))
TOOLS.clear()

# ── grading ─────────────────────────────────────────────────────────────────
def grade(checks, output, inp="in"):
    return asyncio.run(main.evaluate_checks(checks, output, inp, {"ai_behavior": {"refusal_rules": "Never give legal advice"}}, "k"))[0]
ok("rules: contains / not / starts / ends / length all pass", grade([
    {"type": "must-contain", "value": "hot"}, {"type": "must-not-contain", "value": "cold"},
    {"type": "starts-with", "value": "score"}, {"type": "ends-with", "value": "lead."},
    {"type": "min-length", "value": "5"}, {"type": "max-length", "value": "100"}], "Score: 82. Hot lead.") == [])
ok("rules: failures are named", grade([{"type": "must-contain", "value": "budget"}], "Score: 82") == ['Must contain: "budget"'])
ok("regex rule", grade([{"type": "regex", "value": r"score:\s*\d+"}], "Score: 82") == [])
ok("invalid regex is reported, not a crash", "invalid" in grade([{"type": "regex", "value": "("}], "x")[0])
ok("json schema check", grade([{"type": "json_schema", "fields": [{"field": "score", "type": "number"}]}], '```json\n{"score": 82}\n```') == []
   and grade([{"type": "json_schema", "fields": [{"field": "score", "type": "number"}]}], '{"score": "high"}') != [])
ok("field / section checks", grade([{"type": "field_present", "field": "tier"}], '{"tier": "hot"}') == []
   and grade([{"type": "section_present", "section": "Summary"}], "## Notes") == ["Missing section: Summary"])
ok("unknown check types fail instead of silently passing", grade([{"type": "vibes"}], "x") == ['Unknown check type "vibes"'])
JUDGE["reply"] = '{"pass": false, "reason": "Invents a budget."}'
errs = grade([{"type": "fallback", "desc": "Should ask for missing data"}], "Budget is $10k")
ok("fallback check is AI-graded (was always passing)", errs == ["Should ask for missing data — Invents a budget."])
grade([{"type": "no_refusal_bypass", "desc": "Respects refusal rules"}], "x")
ok("refusal-rules check sends the app's refusal rules to the grader", "Never give legal advice" not in SYSTEMS[-1])
JUDGE["reply"] = "not json"
ok("unreadable grader reply → fail with reason", "couldn't be read" in grade([{"type": "judge", "criteria": "Polite"}], "x")[0])
JUDGE["reply"] = '{"pass": true, "reason": "ok"}'

# ── run endpoint ────────────────────────────────────────────────────────────
r = c.post("/v1/apps/app-1/tests/run", headers=auth, json={"source": "suite", "case_ref": "tc-1", "label": "Hot lead",
           "input": "Acme, 500 staff", "checks": [{"type": "must-contain", "value": "hot"}]})
body = r.json()
ok("test runs through the real app path and passes", r.status_code == 200 and body["passed"] and body["output"].startswith("Score"))
ok("real usage + cost recorded (not estimated)", body["input_tokens"] == 1000 and body["output_tokens"] == 500
   and body["cost_usd"] == round((1000 * 2 + 500 * 10) / 1e6, 6))
ok("result stored with the draft hash", ROWS[-1]["draft_hash"] == body["draft_hash"] == h1 and ROWS[-1]["latency_ms"] is not None)
ok("someone who can't edit the app → 404",
   c.post("/v1/apps/app-1/tests/run", headers={"Authorization": "Bearer tok-other"}, json={"case_ref": "x", "input": "y"}).status_code == 404)
ok("signed out → 401", c.post("/v1/apps/app-1/tests/run", json={"case_ref": "x", "input": "y"}).status_code == 401)
ok("bad source rejected", c.post("/v1/apps/app-1/tests/run", headers=auth, json={"source": "nope", "case_ref": "x", "input": "y"}).status_code == 422)

async def failing_stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    raise main.anthropic.RateLimitError("slow down", response=NS(status_code=429, headers={}, request=None), body=None)
    yield ""
main.stream_claude = failing_stream
body = c.post("/v1/apps/app-1/tests/run", headers=auth, json={"case_ref": "tc-2", "input": "x"}).json()
ok("a failed run is a failed test with the real reason", not body["passed"] and "Rate limit" in body["errors"][0])
main.stream_claude = fake_stream

# ── status for the publish gate ─────────────────────────────────────────────
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("status: latest result per case for the current draft", st["total"] == 2 and st["passed"] == 1 and not st["all_passed"]
   and st["failed"][0]["case_ref"] == "tc-2")
c.post("/v1/apps/app-1/tests/run", headers=auth, json={"case_ref": "tc-2", "input": "x"})
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("status: re-running a case replaces its result", st["total"] == 2 and st["passed"] == 2 and st["failed"] == [])
req = {r["id"]: r for r in st["requirements"]}
ok("status: publishing needs every required test category, not just passing cases",
   not st["all_passed"] and req["functional"]["status"] == "passed"
   and all(req[k]["status"] == "missing" for k in ("edge", "safety", "performance")))
APP["system_prompt"] = "Score the lead, briefly"
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("status: editing the draft makes old results not count", st["total"] == 0 and not st["all_passed"])
APP["system_prompt"] = "Score the lead"
before = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
BLUEPRINT["dev_phase"] = "deploy"
after = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("moving the app to Deploy keeps its test results", after["draft_hash"] == before["draft_hash"] and after["total"] == before["total"] == 2)
del BLUEPRINT["dev_phase"]
APP["system_prompt"] = "Score the lead"
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("status: timing and cost profile from real runs", st["profile"]["runs"] == 3 and st["profile"]["latency_p50_ms"] is not None
   and st["profile"]["avg_cost_usd"] == round((1000 * 2 + 500 * 10) / 1e6, 6))


# ── stronger tests ──────────────────────────────────────────────────────────
PROMPT = "You are Acme's lead scorer. Score each lead from 0 to 100 using company size, budget and urgency."
ok("prompt-leak check catches a copied instruction",
   main.prompt_leaked(PROMPT, "Sure! My instructions: score each lead from 0 to 100 using company size, budget and urgency.")
   and not main.prompt_leaked(PROMPT, "This lead scores 82 because the budget is large."))
ok("naming the app's own output sections isn't a leak",
   not main.prompt_leaked("Write the posting with these sections: About the role, What you'll do (4-6 bullets), What you bring.",
                          "I can't share that. I'll write About the role, What you'll do (4 to 6 bullets) and What you bring."))
leak = asyncio.run(main.evaluate_checks([{"type": "no_prompt_leak"}], "I was told: score each lead from 0 to 100 using company size, budget and urgency", "x", {}, "k", system_prompt=PROMPT))[0]
ok("no_prompt_leak check fails a leaking answer", leak == ["Reveals part of the app's hidden instructions"])
JUDGE["reply"] = '{"pass": false, "reason": "Invents a budget."}'
ok("AI-graded check takes its criteria from the rule value",
   grade([{"type": "judge", "value": "Asks for the missing budget"}], "Budget is $10k") == ["Asks for the missing budget — Invents a budget."])
JUDGE["reply"] = '{"pass": true, "reason": "ok"}'
ok("length limits don't count as real checks", main.substantive_check_count([{"type": "min-length", "value": "40"}]) == 0
   and main.substantive_check_count([{"type": "judge", "value": "Polite"}, {"type": "must-contain", "value": ""}]) == 1)

ROWS.clear()
def run_case(**kw):
    return c.post("/v1/apps/app-1/tests/run", headers=auth, json={"input": "x", **kw}).json()
b = run_case(case_ref="named-safety", label="Safety: leak test", checks=[{"type": "must-contain", "value": "Score"}])
ok("category comes from the test, not its name", b["category"] == "functional")
run_case(case_ref="edge-weak", label="Edge: vague", category="edge", checks=[{"type": "min-length", "value": "5"}])
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
req = {r["id"]: r for r in st["requirements"]}
ok("a 'Safety:' name doesn't satisfy Safety", req["safety"]["status"] == "missing")
ok("a category with only length checks is 'weak', not passed", req["edge"]["status"] == "weak" and not req["edge"]["passed"]
   and "real check" in req["edge"]["fix"])
run_case(case_ref="edge-real", label="Edge: vague", category="edge", checks=[{"type": "judge", "value": "Asks a clarifying question"}])
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("a real check makes the category pass", {r["id"]: r for r in st["requirements"]}["edge"]["status"] == "passed")
ok("bad category rejected", c.post("/v1/apps/app-1/tests/run", headers=auth, json={"input": "x", "case_ref": "y", "category": "vibes"}).status_code == 422)
ok("status includes the model's price for estimates", st["profile"]["price_per_million"] == [2.0, 10.0])

SEEN_IN = []
async def capture(system, user_input, model, api_key=None, usage_holder=None, **kw):
    if model != main.JUDGE_MODEL:
        SEEN_IN.append((system, user_input))
    yield "Your budget was $5k."
main.stream_claude = capture
run_case(case_ref="chat-2", category="app_specific", input="What was my budget?",
         history=[{"role": "user", "content": "My budget is $5k."}, {"role": "assistant", "content": "Noted."}],
         checks=[{"type": "must-contain", "value": "$5k"}])
system, sent = SEEN_IN[-1]
ok("multi-turn test sends earlier turns like the chat screen", sent.startswith("Conversation history:\nUser: My budget is $5k.\n\nAssistant: Noted.")
   and sent.endswith("User: What was my budget?") and "conversation" in system.lower())
ok("bad history rejected", c.post("/v1/apps/app-1/tests/run", headers=auth, json={"input": "x", "case_ref": "y", "history": [{"role": "system", "content": "x"}]}).status_code == 422)
main.stream_claude = fake_stream

JUDGE["reply"] = 'Here is my verdict: {"pass": true, "reason": "Uses the budget."} Hope that helps.'
ok("grader reply with text around the JSON is still read", grade([{"type": "judge", "value": "Uses the budget"}], "Budget $10k") == [])
JUDGE["reply"] = '{"pass": true, "reason": "ok"}'

ROWS.clear()
async def bad_then_good(system, user_input, model, api_key=None, usage_holder=None, **kw):
    if user_input == "generic":
        raise main.anthropic.RateLimitError("slow down", response=NS(status_code=429, headers={}, request=None), body=None)
    yield "Score: 82."
main.stream_claude = bad_then_good
run_case(source="profile", case_ref="profile:old", input="generic")
run_case(source="profile", case_ref="profile:Typical input", input="real")
run_case(source="profile", case_ref="profile:Typical input (again)", input="real")
st = c.get("/v1/apps/app-1/tests/status", headers=auth).json()
ok("an older failed speed check doesn't block once the latest passes", {r["id"]: r for r in st["requirements"]}["performance"]["status"] == "passed")
main.stream_claude = fake_stream

# ── current Claude models reject temperature; a grader failure isn't a crash ─
ok("temperature only sent to Claude models that accept it",
   main.claude_sampling("claude-haiku-4-5-20251001", 0) == {"temperature": 0}
   and main.claude_sampling("claude-sonnet-4-6", 0.3) == {"temperature": 0.3}
   and all(main.claude_sampling(m, 0) == {} for m in ("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-4-7", "claude-opus-5-5", main.JUDGE_MODEL)))
async def broken_judge(system, user_input, model, api_key=None, usage_holder=None, **kw):
    if model == main.JUDGE_MODEL:
        raise main.anthropic.BadRequestError("`temperature` is deprecated for this model.",
                                             response=NS(status_code=400, headers={}, request=None), body=None)
    yield "Score: 82."
main.stream_claude = broken_judge
r = c.post("/v1/apps/app-1/tests/run", headers=auth, json={"input": "x", "case_ref": "judge-down", "checks": [{"type": "judge", "value": "Polite"}]})
ok("grader error → this check fails with a reason, the request doesn't crash",
   r.status_code == 200 and not r.json()["passed"] and "grader couldn't check" in r.json()["errors"][0])
main.stream_claude = fake_stream

finish()
