"""Spending limits: each run holds its worst-case cost before the provider is
called, settles to real usage, and is refused at a cap, for an unknown price
or when the limits can't be checked. Fake database and providers only."""
import asyncio
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
import spend_guard as sg
from fastapi.testclient import TestClient

# ── estimates and outcomes ───────────────────────────────────────────────────
HAIKU = main.MODEL_PRICES["claude-haiku-5-5"]
one = sg.estimate_usd(HAIKU, prompt_chars=3000, calls=1)
ok("an estimate covers the prompt and a full output allowance",
   one == round((1000 * HAIKU[0] + 4096 * HAIKU[1]) / 1_000_000, 6))
ok("an unknown price has no estimate", sg.estimate_usd(None, prompt_chars=10) is None)
ok("images raise the estimate", sg.estimate_usd(HAIKU, prompt_chars=3000, images=2) > one)
ok("structured output reserves its repair retry", sg.calls_for(tools=False, max_tool_steps=10, structured=True) == 2)
ok("tool loops reserve their whole step budget (capped at 20)",
   sg.calls_for(tools=True, max_tool_steps=5, structured=False) == 6 and sg.calls_for(tools=True, max_tool_steps=99, structured=False) == 21)
ok("later calls in a loop carry the growing context",
   sg.estimate_usd(HAIKU, prompt_chars=3000, calls=2) > 2 * one)
ok("a finished run settles to its real cost", sg.settle_outcome(finished=True, failure_kind=None, actual=0.1, has_usage=True) == "settled")
ok("a provider refusal before any work releases the hold",
   all(sg.settle_outcome(finished=False, failure_kind=k, actual=None, has_usage=False) == "released" for k in ("auth", "permission", "bad_request")))
ok("a timeout or crash without usage stays counted as uncertain",
   sg.settle_outcome(finished=False, failure_kind="timeout", actual=None, has_usage=False) == "uncertain"
   and sg.settle_outcome(finished=False, failure_kind=None, actual=None, has_usage=False) == "uncertain")
ok("a failed run that reported usage settles to that usage", sg.settle_outcome(finished=False, failure_kind="contract", actual=0.2, has_usage=True) == "settled")
msg = sg.refusal_message({"code": "cap_reached", "scope": "key", "period": "month", "limit_usd": 25}, payer="developer", label="Claude")
ok("a cap refusal says whose limit, which period and how much", "app developer's" in msg and "this month's" in msg and "$25.00" in msg)
ok("an unknown-price refusal says why", "price isn't known" in sg.refusal_message({"code": "unknown_price", "scope": "workspace"}, payer="own", label="Claude"))
ok("periods start at midnight UTC or the 1st of the month",
   main.spend_period_start("month", main.datetime(2026, 10, 24, 15, 30, tzinfo=main.timezone.utc)).isoformat() == "2026-10-01T00:00:00+00:00"
   and main.spend_period_start("day", main.datetime(2026, 10, 24, 15, 30, tzinfo=main.timezone.utc)).isoformat() == "2026-10-24T00:00:00+00:00")

# ── runs: hold, settle, refuse ───────────────────────────────────────────────
OWNER, BUYER = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
WS = "33333333-3333-4333-8333-333333333333"
APP_ID = "44444444-4444-4444-8444-444444444444"
APPS = {APP_ID: {"id": APP_ID, "name": "Helper", "created_by": OWNER, "is_published": True, "is_paid": False,
                 "visibility": "public", "system_prompt": "Help", "ai_provider": "claude", "ai_model": "claude-haiku-5-5",
                 "billing_mode": "free"}}
KEYS, CALLS, RPCS, SETTLED = {}, [], [], []
STATE = {"ready": True, "reserve": {"ok": True}, "raise": False, "role": None}
CAPS = []

class Table:
    def __init__(self, name): self.name, self.filters, self.op, self.row = name, {}, "select", None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.filters[k] = v; return self
    def limit(self, *a): return self
    def delete(self): self.op = "delete"; return self
    def upsert(self, row, **k): self.op, self.row = "upsert", row; return self
    def execute(self):
        hits = [r for r in CAPS if all(r.get(k) == v for k, v in self.filters.items())]
        if self.op == "delete":
            CAPS[:] = [r for r in CAPS if r not in hits]
        elif self.op == "upsert":
            CAPS[:] = [r for r in CAPS if not (r["scope"] == self.row["scope"] and r["scope_id"] == self.row["scope_id"])] + [dict(self.row)]
        return NS(data=[dict(r) for r in hits] if self.op == "select" else [])

def rpc(name, params):
    RPCS.append((name, params))
    if STATE["raise"] and name == "reserve_spend":
        raise RuntimeError("database unavailable")
    data = {"spend_controls_status": {"ready": STATE["ready"]}, "reserve_spend": STATE["reserve"],
            "settle_spend": True, "spend_used": 1.25, "expire_spend_reservations": 0}[name]
    return NS(execute=lambda: NS(data=data))
main._service_client = lambda: NS(table=Table, rpc=rpc)
main.SUPABASE_SERVICE_ROLE_KEY = "service-role-for-checks"

async def load_app_row(app_id): return dict(APPS[app_id]) if app_id in APPS else None
async def verify(tok): return {"tok-owner": OWNER, "tok-buyer": BUYER}.get(tok)
async def key_by_jwt(jwt, provider): return KEYS.get(({"tok-owner": OWNER, "tok-buyer": BUYER}.get(jwt), provider))
async def key_by_id(uid, provider): return KEYS.get((uid, provider))
async def none(*a, **k): return None
async def zero(*a, **k): return 0
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def allow(*a, **k): return True, ""
async def ws(uid, requested=None): return WS
async def role(workspace_id, user_id): return STATE["role"]
async def stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    CALLS.append({"key": api_key, "model": model})
    if STATE.get("crash"):
        raise RuntimeError("connection reset mid-stream")
    if usage_holder is not None:
        usage_holder.update(input_tokens=1000, output_tokens=500)
    yield "ok"
main.load_app_row = load_app_row; main.verify_user_jwt = verify
main.fetch_user_api_key = key_by_jwt; main.fetch_user_api_key_by_id = key_by_id
main.dev_key_runs_today = zero; main.record_metered_run = none
main.app_member_role = none; main.workspace_role = role; main.personal_workspace_id = none
main.resolve_user_workspace = ws
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main.fetch_app_blueprint = emptyd
main._load_app_secrets = emptyd; main.check_rate_limit = allow; main.claim_app_daily_run = allow
main.stream_claude = stream
main.platform_key = lambda provider: None
real_settle = main.settle_run_spend
main.settle_run_spend = lambda rid, actual, outcome: SETTLED.append((rid, actual, outcome))
main.developer_tier = lambda *a: asyncio.sleep(0, result="free")

c = TestClient(main.app)
def run(tok="tok-buyer"):
    CALLS.clear(); RPCS.clear(); SETTLED.clear()
    main._SPEND_READY.update(value=None, checked=0.0)
    r = c.post("/run", json={"app_id": APP_ID, "input": "hi"}, headers={"Authorization": f"Bearer {tok}"})
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text)

def reserved(): return [p for n, p in RPCS if n == "reserve_spend"]

KEYS[(OWNER, "claude")] = "sk-dev"
code, _ = run()
held = reserved()
ok("a run holds its cost before the provider is called", code == 200 and len(held) == 1 and CALLS)
ok("…charged to the developer whose key pays, in the runner's workspace",
   held[0]["p_payer"] == "developer" and held[0]["p_key_owner"] == OWNER and held[0]["p_workspace"] == WS and held[0]["p_app"] == APP_ID)
ok("…for the model actually used, with a worst-case amount", held[0]["p_model"] == "claude-haiku-5-5" and held[0]["p_amount"] > 0)
ok("a finished run settles to the provider's reported usage",
   SETTLED == [(held[0]["p_id"], main.model_cost_usd("claude-haiku-5-5", {"input_tokens": 1000, "output_tokens": 500}), "settled")])

KEYS[(BUYER, "claude")] = "sk-buyer"; APPS[APP_ID]["billing_mode"] = "byok"
run()
ok("a run on the runner's own key is charged to the runner", reserved()[0]["p_payer"] == "own" and reserved()[0]["p_key_owner"] == BUYER)
APPS[APP_ID]["billing_mode"] = "free"; KEYS.pop((BUYER, "claude"))

STATE["reserve"] = {"ok": False, "code": "cap_reached", "scope": "key", "period": "day", "limit_usd": 5, "used_usd": 4.9}
code, body = run()
ok("a run past a spending cap is refused before the provider is called",
   code == 429 and body["code"] == "spend_limit" and "today's" in body["error"] and "$5.00" in body["error"] and not CALLS and not SETTLED)
STATE["reserve"] = {"ok": False, "code": "unknown_price", "scope": "workspace"}
code, body = run()
ok("a capped run on a model without a known price is refused", code == 429 and "price isn't known" in body["error"] and not CALLS)
STATE["reserve"] = {"ok": True}

STATE["raise"] = True
code, body = run()
ok("when the limits can't be checked, the run doesn't start", code == 503 and body["code"] == "spend_unavailable" and not CALLS)
STATE["raise"] = False

STATE["ready"] = False
code, _ = run()
ok("before the spending migration is applied, runs work as before", code == 200 and CALLS and not reserved() and not SETTLED)
STATE["ready"] = True

STATE["crash"] = True
run()
ok("a run that breaks without reporting usage stays counted as uncertain", SETTLED and SETTLED[0][2] == "uncertain")
STATE["crash"] = False

APPS[APP_ID]["custom_model_url"], APPS[APP_ID]["custom_model_name"] = "https://llm.example.com/v1", "house-model"
code, _ = run("tok-owner")
ok("custom models are paid outside the platform and hold nothing", not reserved())
APPS[APP_ID].pop("custom_model_url"); APPS[APP_ID].pop("custom_model_name")

# ── settlement runs in the background against the database ────────────────
async def settle_once():
    RPCS.clear()
    real_settle("rid-1", 0.01, "uncertain")
    await asyncio.gather(*list(main._SPEND_TASKS))
asyncio.run(settle_once())
ok("settlement sends the outcome and real cost to the database",
   RPCS == [("settle_spend", {"p_id": "rid-1", "p_actual": 0.01, "p_outcome": "uncertain"})])
ok("nothing is settled without a reservation", real_settle(None, 1, "settled") is None)

# ── usage and caps API ───────────────────────────────────────────────────────
H = {"Authorization": "Bearer tok-owner"}
main._SPEND_READY.update(value=None, checked=0.0)
body = c.get("/v1/spend", headers=H).json()
ok("your usage shows spend on your keys this period", body["key"]["used_usd"] == 1.25 and body["key"]["limit_usd"] is None and body["workspace"] is None)
r = c.put("/v1/spend/caps/key", json={"limit_usd": 20, "period": "day"}, headers=H)
ok("you can cap your own keys' spending", r.status_code == 200 and r.json()["key"]["limit_usd"] == 20 and r.json()["key"]["period"] == "day"
   and CAPS == [{**CAPS[0], "scope": "key", "scope_id": OWNER, "period": "day", "limit_usd": 20}])
ok("bad periods and negative limits are refused",
   c.put("/v1/spend/caps/key", json={"limit_usd": 5, "period": "week"}, headers=H).status_code == 422
   and c.put("/v1/spend/caps/key", json={"limit_usd": -1}, headers=H).status_code == 422)
r = c.put("/v1/spend/caps/key", json={"limit_usd": None}, headers=H)
ok("a cap can be removed", r.status_code == 200 and r.json()["key"]["limit_usd"] is None and CAPS == [])
ok("only billing managers can cap a workspace", c.put(f"/v1/workspaces/{WS}/spend-cap", json={"limit_usd": 50}, headers=H).status_code == 404)
STATE["role"] = "billing"
r = c.put(f"/v1/workspaces/{WS}/spend-cap", json={"limit_usd": 50, "period": "month"}, headers=H)
ok("a workspace's billing manager can cap it", r.status_code == 200 and r.json()["workspace"]["limit_usd"] == 50)
ok("…and sees its usage", c.get("/v1/spend", headers=H).json()["workspace"]["limit_usd"] == 50)
ok("you must be signed in", c.get("/v1/spend").status_code == 401)
STATE["ready"] = False; main._SPEND_READY.update(value=None, checked=0.0)
ok("without the migration the API says so", c.get("/v1/spend", headers=H).status_code == 503)
finish()
