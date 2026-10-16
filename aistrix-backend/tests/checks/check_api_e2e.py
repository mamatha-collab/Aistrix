"""End-to-end: SDK → real uvicorn server → main.py with an in-memory Supabase."""
import io, json, os, socket, threading, time, uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import _harness
from _harness import ok, finish
_harness.setup(RATE_LIMIT_PER_HOUR="1000")
import main  # noqa
main.platform_key = lambda provider: "test-platform-key"   # model calls are stubbed; never a real key
os.environ.pop("ANTHROPIC_API_KEY", None)   # never call the real API from tests
import uvicorn  # noqa
from aistrix import (AistrixClient, AuthenticationError, ContractError, PaymentRequiredError)  # noqa

# ── fake supabase ────────────────────────────────────────────────────────────
class Res(SimpleNamespace):
    pass

class Q:
    def __init__(self, db, table):
        self.db, self.t = db, table
        self.f, self.op, self.payload = [], "select", None
        self.one = None; self.count = False; self.head = False
        self.ord = None; self.lim = None; self.rng = None
    def select(self, cols="*", count=None, head=False): self.count = count == "exact"; self.head = head; return self
    def eq(self, k, v): self.f.append(lambda r: r.get(k) == v); return self
    def neq(self, k, v): self.f.append(lambda r: r.get(k) != v); return self
    def in_(self, k, vs): self.f.append(lambda r: r.get(k) in vs); return self
    def lt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) < v); return self
    def gte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) >= v); return self
    def or_(self, expr):
        conds = [c.split(".", 2) for c in expr.split(",")]
        self.f.append(lambda r: any(str(r.get(col)) == val for col, op, val in conds)); return self
    def ilike(self, k, v): self.f.append(lambda r: str(r.get(k) or "").lower() == v.lower()); return self
    def is_(self, k, v): self.f.append(lambda r: r.get(k) is None if v == "null" else r.get(k) is not None); return self
    def order(self, k, desc=False): self.ord = (k, desc); return self
    def limit(self, n): self.lim = n; return self
    def range(self, a, b): self.rng = (a, b); return self
    def maybe_single(self): self.one = "maybe"; return self
    def single(self): self.one = "single"; return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def upsert(self, rows, on_conflict=None): self.op, self.payload = "insert", rows; return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def delete(self): self.op = "delete"; return self
    def execute(self):
        rows = self.db.setdefault(self.t, [])
        if self.op == "insert":
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for r in new:
                r = {"created_at": datetime.now(timezone.utc).isoformat(), **r}
                if self.t != "batch_job_rows":
                    r.setdefault("id", str(uuid.uuid4()))
                rows.append(r); out.append(dict(r))
            return Res(data=out, count=None)
        match = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "update":
            for r in match: r.update(self.payload)
            return Res(data=[dict(r) for r in match], count=None)
        if self.op == "delete":
            self.db[self.t] = [r for r in rows if r not in match]
            return Res(data=match, count=None)
        if self.ord:
            match = sorted(match, key=lambda r: (r.get(self.ord[0]) is None, r.get(self.ord[0])), reverse=self.ord[1])
        n = len(match)
        if self.rng: match = match[self.rng[0]: self.rng[1] + 1]
        if self.lim is not None: match = match[: self.lim]
        data = [dict(r) for r in match]
        if self.one:
            return Res(data=data[0] if data else None, count=n)
        return Res(data=None if self.head else data, count=n if self.count else None)

class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)
    def rpc(self, name, params):
        db = self.db
        class R:
            def execute(_):
                if name == "reserve_entitlement_run":
                    for e in db.get("app_entitlements", []):
                        if e["id"] == params["p_entitlement_id"] and (e.get("run_quota") is None or e["runs_this_period"] < e["run_quota"]):
                            e["runs_this_period"] += 1
                            return Res(data=e["runs_this_period"])
                    return Res(data=None)
                if name == "release_entitlement_run":
                    for e in db.get("app_entitlements", []):
                        if e["id"] == params["p_entitlement_id"]:
                            e["runs_this_period"] = max(e["runs_this_period"] - 1, 0)
                            return Res(data=e["runs_this_period"])
                return Res(data=None)
        return R()

SB = FakeSB()
main.create_client = lambda *a, **k: SB
main._service_client = lambda: SB
main.get_anon_client = lambda: SB

OWNER, BUYER, DEV, OUT = "u-owner", "u-buyer", "u-dev", "u-out"
async def verify(tok): return {"jwt-owner": OWNER, "jwt-buyer": BUYER, "jwt-dev": DEV, "jwt-out": OUT}.get(tok)
WS = {u: str(uuid.uuid4()) for u in (OWNER, BUYER, DEV, OUT)}          # personal workspaces
TEAM = str(uuid.uuid4())
SB.db["workspaces"] = [{"id": w, "name": u, "is_personal": True, "personal_owner_id": u, "slug": u, "plan": "free"} for u, w in WS.items()]
SB.db["workspaces"].append({"id": TEAM, "name": "Acme", "is_personal": False, "personal_owner_id": None, "slug": "acme", "plan": "team"})
SB.db["workspace_members"] = [{"workspace_id": w, "user_id": u, "role": "owner"} for u, w in WS.items()] + [
    {"workspace_id": TEAM, "user_id": OWNER, "role": "owner"},
    {"workspace_id": TEAM, "user_id": BUYER, "role": "member"},
    {"workspace_id": TEAM, "user_id": DEV, "role": "developer"},
]
main.verify_user_jwt = verify
BLUEPRINTS = {}
async def bp(app_id): return BLUEPRINTS.get(app_id, {})
main.fetch_app_blueprint = bp
async def nothing(*a, **k): return {}
main._load_app_secrets = nothing
async def empty_str(*a, **k): return ""
main.fetch_app_knowledge = empty_str
async def no_tools(*a, **k): return []
main.fetch_app_tools = no_tools

CALLS = []
async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None):
    CALLS.append(user_input)
    if "<output_contract>" in system:
        yield json.dumps({"company": user_input.split("company: ")[-1].split("\n")[0], "score": len(user_input) % 100})
    else:
        yield f"ok({len(user_input)})"
    if usage_holder is not None:
        usage_holder.update(input_tokens=10, output_tokens=5)
main.stream_claude = fake_stream

STRUCT, PAID, OTHER = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
SB.db["apps"] = [
    {"id": STRUCT, "name": "Lead scorer", "created_by": OWNER, "workspace_id": WS[OWNER], "is_published": True, "is_paid": False, "visibility": "public",
     "app_type": "structured", "output_type": "json", "system_prompt": "Score the lead", "ai_provider": "claude",
     "form_schema": [{"id": "1", "label": "Company", "type": "text", "required": True}]},
    {"id": PAID, "name": "Paid", "created_by": OWNER, "workspace_id": WS[OWNER], "is_published": True, "is_paid": True, "visibility": "public",
     "output_type": "markdown", "system_prompt": "paid", "ai_provider": "claude"},
    {"id": OTHER, "name": "Other", "created_by": OWNER, "workspace_id": WS[OWNER], "is_published": True, "is_paid": False, "visibility": "public",
     "output_type": "markdown", "system_prompt": "other", "ai_provider": "claude"},
]
TEAM_DRAFT, VENDOR_PAID = str(uuid.uuid4()), str(uuid.uuid4())
SB.db["apps"] += [
    {"id": TEAM_DRAFT, "name": "Team draft", "created_by": OWNER, "workspace_id": TEAM, "is_published": False,
     "is_paid": False, "visibility": "public", "output_type": "markdown", "system_prompt": "TEAM SECRET PROMPT", "ai_provider": "claude"},
    {"id": VENDOR_PAID, "name": "Vendor paid", "created_by": OUT, "workspace_id": WS[OUT], "is_published": True,
     "is_paid": True, "visibility": "public", "output_type": "markdown", "system_prompt": "vendor", "ai_provider": "claude"},
]
SB.db["app_entitlements"] = [{"id": "ent-team", "app_id": VENDOR_PAID, "user_id": OWNER, "workspace_id": TEAM,
                              "status": "active", "runs_this_period": 0, "run_quota": None, "created_at": "2026-01-01"}]
BLUEPRINTS[STRUCT] = {
    "input_schema": {"fields": [{"field": "company", "type": "string", "required": True}]},
    "output_schema": {"fields": [{"field": "company", "type": "string"}, {"field": "score", "type": "number"}]},
    "output_contract": {"format": "json"},
}

# ── server ───────────────────────────────────────────────────────────────────
sock = socket.socket(); sock.bind(("127.0.0.1", 0)); PORT = sock.getsockname()[1]; sock.close()
server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=PORT, log_level="warning"))
threading.Thread(target=server.run, daemon=True).start()
while not server.started: time.sleep(0.05)
URL = f"http://127.0.0.1:{PORT}"

import httpx  # noqa
# keys: created by backend, hashed, shown once
r = httpx.post(f"{URL}/v1/keys", json={"name": "prod"}, headers={"Authorization": "Bearer jwt-owner"})
key = r.json()["key"]
row = SB.db["developer_api_keys"][0]
ok("key created + hashed", r.status_code == 200 and row.get("api_key") is None and row["key_hash"] == main.hash_api_key(key))
r2 = httpx.post(f"{URL}/v1/keys", json={"name": "x"}, headers={"Authorization": f"Bearer {key}"})
ok("key can't mint keys", r2.status_code == 403)
scoped = httpx.post(f"{URL}/v1/keys", json={"name": "s", "app_ids": [OTHER]}, headers={"Authorization": "Bearer jwt-owner"}).json()["key"]
SB.db["developer_api_keys"].append({"id": "legacy", "user_id": OWNER, "api_key": "ak_live_legacy123", "is_active": True, "name": "old"})

c = AistrixClient(api_key=key, api_url=URL)
apps = c.list_apps()
ok("list_apps via key", len(apps) == 3)
meta = c.get_app(STRUCT)
ok("get_app exposes contract", meta["parameters"][0]["name"] == "company" and meta["output_schema"][1]["field"] == "score")

res = c.run(STRUCT, fields={"company": "Acme"})
ok("structured run → parsed data", res.data == {"company": "Acme", "score": res.data["score"]} and isinstance(res.data["score"], int))
try:
    c.run(STRUCT, fields={"wrong": 1}); ok("bad fields raise", False)
except ContractError as e:
    ok("bad fields → ContractError", e.status == 422 and any("company" in x for x in e.errors))

toks = list(c.stream(OTHER, "hello"))
ok("stream yields tokens", "".join(toks).startswith("ok("))

try:
    AistrixClient(api_key=scoped, api_url=URL).run(STRUCT, "x"); ok("scoped key blocked", False)
except AuthenticationError as e:
    ok("scoped key → 403", e.status == 403)
ok("scoped key works on its app", AistrixClient(api_key=scoped, api_url=URL).run(OTHER, "x").output.startswith("ok("))
try:
    AistrixClient(api_key="ak_live_legacy123", api_url=URL).run(OTHER, "x"); ok("plaintext keys rejected", False)
except AuthenticationError:
    ok("plaintext (unhashed) keys rejected", True)
try:
    AistrixClient(api_key="ak_live_nope", api_url=URL).list_apps(); ok("bad key", False)
except AuthenticationError:
    ok("invalid key → AuthenticationError", True)

# file input: small docx + big csv (map-reduce)
import openpyxl  # noqa
wb = openpyxl.Workbook(); ws = wb.active; ws.append(["name", "amount"])
for i in range(3000): ws.append([f"customer-{i}", i])
bio = io.BytesIO(); wb.save(bio)
CALLS.clear()
res = c.run(OTHER, "Total the amounts", file=("sales.xlsx", bio.getvalue()))
ok(f"large xlsx split into {len(CALLS) - 1} parts + combine", len(CALLS) > 2 and "Combine these partial results" in CALLS[-1] and res.output.startswith("ok("))
ok("each part repeats CSV header", all("name,amount" in x for x in CALLS[:-1]))
res = c.run(OTHER, "Summarise", file=("notes.txt", b"short notes"))
ok("small text file", res.output.startswith("ok("))

# paid app without purchase
bc = AistrixClient(api_key="jwt-buyer", api_url=URL)
try:
    bc.run(PAID, "x"); ok("paywall", False)
except PaymentRequiredError:
    ok("paid app → PaymentRequiredError", True)
try:
    bc.create_batch(PAID, ["a"]); ok("paywall batch", False)
except PaymentRequiredError:
    ok("paid batch → PaymentRequiredError", True)

# batch: fields + csv, completes
b = c.create_batch(STRUCT, [{"company": f"Co{i}"} for i in range(5)] + ["company: Raw"])
b = c.wait_for_batch(b.id, poll_interval=0.2, timeout=30)
rows = list(c.batch_results(b.id))
ok("batch completed", b.status == "completed" and b.completed == 6 and len(rows) == 6 and rows[0]["data"]["company"] == "Co0")
csv_text = c.batch_results_csv(b.id)
ok("batch csv export", csv_text.startswith("idx,input,status") and csv_text.count("\n") >= 7)
try:
    c.create_batch(STRUCT, [{"nope": 1}]); ok("batch row validation", False)
except ContractError as e:
    ok("bad batch row → ContractError", "row 0" in e.message)

# batch hits platform rate limit → stopped, warning, retry resumes
main.HOURLY_LIMIT = len([r for r in SB.db.get("run_events", []) if r["user_id"] == OWNER]) + 3
b = c.create_batch(OTHER, csv="name,notes\n" + "\n".join(f"n{i},x" for i in range(8)))
ok("quota warning returned", any("allow 3 more runs" in w for w in b.warnings))
b = c.wait_for_batch(b.id, poll_interval=0.2, timeout=30)
ok(f"batch stopped on rate limit ({b.completed}/8)", b.status == "stopped" and 0 < b.completed < 8 and "Rate limit" in (b.stop_reason or ""))
main.HOURLY_LIMIT = 1000
b = c.retry_batch(b.id)
b = c.wait_for_batch(b.id, poll_interval=0.2, timeout=30)
ok("retry resumes to completion", b.status == "completed" and b.completed == 8)

# cancel
CALLS.clear()
async def slow_stream(*a, **k):
    import asyncio; await asyncio.sleep(0.3)
    async for t in fake_stream(*a, **k): yield t
main.stream_claude = slow_stream
b = c.create_batch(OTHER, [f"r{i}" for i in range(30)])
time.sleep(0.5)
c.cancel_batch(b.id)
time.sleep(1.0)
b = c.get_batch(b.id)
ok(f"cancel stops batch ({b.completed}/30 done)", b.status == "cancelled" and b.completed < 30)
main.stream_claude = fake_stream

u = c.usage()
ok("usage endpoint", u["hourly"]["limit"] == 1000 and "own_provider_keys" in u)
ok("API runs recorded in run_history", len(SB.db.get("run_history", [])) > 10)
key_row = next(k for k in SB.db["developer_api_keys"] if k.get("key_hash") == main.hash_api_key(key))
ok("key usage counted", (key_row.get("total_calls") or 0) > 3)

# ════ Workspaces ════════════════════════════════════════════════════════════
def http(method, path, tok=None, ws=None, **kw):
    h = {}
    if tok: h["Authorization"] = f"Bearer {tok}"
    if ws: h["X-Workspace-Id"] = ws
    return httpx.request(method, f"{URL}{path}", headers=h, timeout=30, **kw)

def run_status(app_id, tok=None, ws=None):
    r = http("POST", f"/v1/apps/{app_id}/run", tok, ws, json={"input": "hi", "stream": False})
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text)

ok("member runs unpublished team app", run_status(TEAM_DRAFT, "jwt-buyer", TEAM)[0] == 200)
ok("outsider can't run it (404)", run_status(TEAM_DRAFT, "jwt-out")[0] == 404)
ok("non-member X-Workspace-Id → 403", http("GET", "/v1/apps", "jwt-out", TEAM).status_code == 403)
ok("member doesn't see the prompt", "system_prompt" not in http("GET", f"/v1/apps/{TEAM_DRAFT}", "jwt-buyer", TEAM).json())
ok("developer sees the prompt", http("GET", f"/v1/apps/{TEAM_DRAFT}", "jwt-dev", TEAM).json().get("system_prompt") == "TEAM SECRET PROMPT")
ok("list apps = active workspace", [a["id"] for a in http("GET", "/v1/apps", "jwt-buyer", TEAM).json()["apps"]] == [TEAM_DRAFT])
ok("workspace list has team + personal",
   {w["id"]: w["role"] for w in http("GET", "/v1/workspaces", "jwt-buyer").json()["workspaces"]} == {WS[BUYER]: "owner", TEAM: "member"})

# keys belong to the workspace
r = http("POST", "/v1/keys", "jwt-buyer", TEAM, json={"name": "nope"})
ok("member can't create keys (403)", r.status_code == 403)
team_key = http("POST", "/v1/keys", "jwt-dev", TEAM, json={"name": "ci"}).json()["key"]
ok("developer creates team key", team_key.startswith("ak_live_"))
ok("team key runs team draft", run_status(TEAM_DRAFT, team_key)[0] == 200)
owner_team_key = http("POST", "/v1/keys", "jwt-owner", TEAM, json={"name": "owner-in-team"}).json()["key"]
SB.db["apps"].append({"id": "personal-draft", "name": "Owner personal draft", "created_by": OWNER, "workspace_id": WS[OWNER],
                      "is_published": False, "is_paid": False, "visibility": "public", "output_type": "markdown",
                      "system_prompt": "p", "ai_provider": "claude"})
ok("team key can't reach creator's personal drafts", run_status("personal-draft", owner_team_key)[0] == 404)
r = http("POST", "/v1/keys", "jwt-dev", TEAM, json={"name": "x", "app_ids": [STRUCT]})
ok("key scope must be apps in the workspace (422)", r.status_code == 422)

# purchases cover the buying workspace
ok("team purchase covers members", run_status(VENDOR_PAID, "jwt-buyer", TEAM)[0] == 200)
ok("…and the team's keys", run_status(VENDOR_PAID, team_key)[0] == 200)
ok("…but not the member's personal workspace", run_status(VENDOR_PAID, "jwt-buyer")[0] == 402)
ok("…nor outsiders' keys", run_status(VENDOR_PAID, key)[0] == 402)

# member removed → their key keeps working for the team
SB.db["workspace_members"] = [m for m in SB.db["workspace_members"] if not (m["workspace_id"] == TEAM and m["user_id"] == DEV)]
ok("key survives its creator leaving", run_status(TEAM_DRAFT, team_key)[0] == 200)
ok("removed developer lost access", run_status(TEAM_DRAFT, "jwt-dev", TEAM)[0] == 403)

# batches are workspace-scoped
b = AistrixClient(api_key=team_key, api_url=URL).create_batch(TEAM_DRAFT, ["a", "b"])
job = next(j for j in SB.db["batch_jobs"] if j["id"] == b.id)
ok("batch stored in team workspace", job["workspace_id"] == TEAM)
AistrixClient(api_key=team_key, api_url=URL).wait_for_batch(b.id, poll_interval=0.2, timeout=30)
ok("team admin can view the batch", http("GET", f"/v1/batches/{b.id}", "jwt-owner", TEAM).status_code == 200)
ok("plain member can't (404)", http("GET", f"/v1/batches/{b.id}", "jwt-buyer", TEAM).status_code == 404)
ok("run history attributed to team", all(r.get("workspace_id") == TEAM for r in SB.db["run_history"] if r["app_id"] == TEAM_DRAFT))

# invites
r = http("POST", f"/v1/workspaces/{TEAM}/invites", "jwt-owner", json={"email": "New@Acme.com", "role": "developer"})
ok("owner invites (link returned)", r.status_code == 201 and "/invite/" in r.json()["invite_url"] and r.json()["email"] == "new@acme.com")
ok("member can't invite (403)", http("POST", f"/v1/workspaces/{TEAM}/invites", "jwt-buyer", json={"email": "x@y.co"}).status_code == 403)
ok("no invites into personal workspaces (422)", http("POST", f"/v1/workspaces/{WS[OWNER]}/invites", "jwt-owner", json={"email": "x@y.co"}).status_code == 422)
http("POST", f"/v1/workspaces/{TEAM}/invites", "jwt-owner", json={"email": "new@acme.com", "role": "member"})
ok("re-invite replaces the open invite", len([i for i in SB.db["workspace_invites"] if i["email"] == "new@acme.com"]) == 1)

ok("metering rows written server-side", len(SB.db.get("run_events", [])) > 10)
SB.db["run_history"] = []   # user clears their history...
try:
    main.HOURLY_LIMIT = len([r for r in SB.db["run_events"] if r["user_id"] == OWNER])
    c.run(OTHER, "x"); ok("clearing history doesn't reset limit", False)
except Exception as e:
    ok("clearing history doesn't reset limit", "Rate limit" in str(e))
main.HOURLY_LIMIT = 1000
server.should_exit = True   # after the last request: stopping earlier raced it
finish()
