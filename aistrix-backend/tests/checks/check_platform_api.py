"""Platform API (/v1/platform) end to end through main.py: specs, releases,
secrets, eval gate, promotion, runs (wait, stream, approvals), rollback,
ownership and key scope. Supabase, the model and the ERP are fakes; the
SupabaseStore code paths are the real ones."""
import asyncio
import atexit
import base64
import itertools
import json
import shutil
import tempfile
import uuid
from pathlib import Path

from cryptography.fernet import Fernet

import _harness
from _harness import finish


def ok(name, cond, detail=None):
    if not _harness.ok(name, cond) and detail is not None:
        print(f"  detail: {str(detail)[:600]}")


_harness.setup(SECRET_ENCRYPTION_KEY=Fernet.generate_key().decode(), PLATFORM_RESUME_SECONDS="0")

import httpx
from fastapi.testclient import TestClient

import main
import outbound

EXAMPLES = Path(__file__).resolve().parents[3] / "examples" / "invoice-pipeline"
APP_YAML = (EXAMPLES / "aistrix.yaml").read_text(encoding="utf-8")
SUITE_YAML = (EXAMPLES / "eval-suite.yaml").read_text(encoding="utf-8")

UNIQUE = {"platform_releases": ("owner_id", "resource_key", "version"),
          "platform_environments": ("owner_id", "resource_key", "stage"),
          "platform_resources": ("owner_id", "key"),
          "platform_secrets": ("owner_id", "resource_key", "key"),
          "platform_runs": ("id",)}
SEQ = itertools.count(1)


class Res:
    def __init__(self, data):
        self.data = data


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self.order_by, self.desc, self.limit_n, self.conflict = None, False, None, None

    def select(self, *_a, **_k): self.op = "select"; return self
    def insert(self, row): self.op, self.payload = "insert", row; return self
    def update(self, vals): self.op, self.payload = "update", vals; return self
    def upsert(self, row, on_conflict=None): self.op, self.payload, self.conflict = "upsert", row, on_conflict; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, k, v): self.filters.append(lambda r: r.get(k) == v); return self
    def gt(self, k, v): self.filters.append(lambda r: r.get(k) is not None and r.get(k) > v); return self
    def lt(self, k, v): self.filters.append(lambda r: r.get(k) is not None and r.get(k) < v); return self
    def in_(self, k, vs): self.filters.append(lambda r: r.get(k) in vs); return self
    def order(self, k, desc=False): self.order_by, self.desc = k, desc; return self
    def limit(self, n): self.limit_n = n; return self

    def _match(self):
        return [r for r in self.db.setdefault(self.table, []) if all(f(r) for f in self.filters)]

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "insert":
            row = json.loads(json.dumps(self.payload))
            if self.table == "platform_run_events":
                row["seq"] = next(SEQ)
            if self.table == "platform_runs":
                row.setdefault("lease_expires_at", "1970-01-01T00:00:00+00:00")
                row.setdefault("lease_owner", None)
            keys = UNIQUE.get(self.table)
            if keys and any(all(r.get(k) == row.get(k) for k in keys) for r in rows):
                raise Exception('duplicate key value violates unique constraint (23505)')
            rows.append(row)
            return Res([json.loads(json.dumps(row))])
        if self.op == "upsert":
            row = json.loads(json.dumps(self.payload))
            keys = (self.conflict or "").split(",")
            for r in rows:
                if all(r.get(k) == row.get(k) for k in keys):
                    r.update(row)
                    return Res([json.loads(json.dumps(r))])
            rows.append(row)
            return Res([json.loads(json.dumps(row))])
        match = self._match()
        if self.op == "update":
            if self.table == "platform_releases":
                raise Exception("Releases are immutable; release a new version instead")
            for r in match:
                r.update(json.loads(json.dumps(self.payload)))
            return Res([json.loads(json.dumps(r)) for r in match])
        if self.op == "delete":
            self.db[self.table] = [r for r in rows if r not in match]
            return Res(match)
        if self.order_by:
            match = sorted(match, key=lambda r: r.get(self.order_by) or "", reverse=self.desc)
        if self.limit_n:
            match = match[:self.limit_n]
        return Res([json.loads(json.dumps(r)) for r in match])


class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)
    def rpc(self, *a, **k): raise Exception("no such function")


SB = FakeSB()
main._service_client = lambda: SB
main.get_anon_client = lambda: SB

OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())


async def verify(tok): return {"jwt-owner": OWNER, "jwt-other": OTHER}.get(tok)
async def none(*a, **k): return None
main.verify_user_jwt = verify
main.resolve_user_workspace = none
main.personal_workspace_id = none


async def restricted_key(token):
    return {"user_id": OWNER, "workspace_id": None, "app_ids": ["some-app"]} if token == "ak_live_restricted1" else None
main.resolve_developer_key = restricted_key

KEYS = []
async def key(user_id, provider):
    KEYS.append((user_id, provider))
    return "sk-ant-developer-own"
main.fetch_user_api_key_by_id = key

ANSWERS = []
PROMPTS = []
async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None, **kw):
    PROMPTS.append({"model": model, "key": api_key, "prompt": user_input})
    yield ANSWERS.pop(0)
    if usage_holder is not None:
        usage_holder.update(input_tokens=500, output_tokens=100)
main.stream_claude = fake_stream

ERP = []
async def fake_fetch(method, url, *, timeout=15, max_redirects=5, allowed_hosts=None, **kwargs):
    ERP.append({"method": method, "url": url, "hosts": allowed_hosts, "headers": kwargs.get("headers"), "json": kwargs.get("json")})
    return httpx.Response(201, json={"id": f"erp-{len(ERP)}"})
outbound.fetch_safely = fake_fetch

c = TestClient(main.app)
H = {"Authorization": "Bearer jwt-owner"}
H2 = {"Authorization": "Bearer jwt-other"}


def b64(text): return base64.b64encode(text.encode()).decode()


def invoice(text="Invoice from ACME GmbH. Total: 120.00 EUR.", iid="inv-1"):
    return {"invoice_id": iid, "file": {"name": "i.txt", "mime": "text/plain", "content_base64": b64(text)}}


SMALL = json.dumps({"vendor": "ACME GmbH", "total": 120.0, "currency": "EUR", "needs_review": False})
LARGE = json.dumps({"vendor": "Bolt Ltd", "total": 54000.0, "currency": "GBP", "needs_review": True})

# ── catalog, validate, plan ──────────────────────────────────────────────────
r = c.get("/v1/platform/nodes")
ok("the node catalog lists the node types", r.status_code == 200 and {"http", "llm.structured"} <= {n["use"] for n in r.json()["nodes"]})
r = c.post("/v1/platform/specs/validate", json={"spec": APP_YAML}, headers=H)
ok("a valid spec validates with its ref and hash", r.json()["valid"] and r.json()["ref"] == "Application/acme/invoice-extractor@1.0.0"
   and len(r.json()["contentHash"]) == 64, r.text)
r = c.post("/v1/platform/specs/validate", json={"spec": APP_YAML.replace("version: 1.0.0", "version: one")}, headers=H)
ok("an invalid spec lists its problems with paths", not r.json()["valid"] and r.json()["problems"][0]["path"] == "metadata.version", r.text)
ok("validation needs a caller", c.post("/v1/platform/specs/validate", json={"spec": APP_YAML}).status_code == 401)
r = c.post("/v1/platform/specs/plan", json={"spec": APP_YAML}, headers=H)
ok("plan returns the compiled order", r.json()["plans"]["extract"]["order"] == ["read", "fields", "review", "post"], r.text)
r = c.post("/v1/platform/specs/plan", json={"spec": APP_YAML.replace("[api.example-erp.com]", "[other.example.com]")}, headers=H)
ok("plan explains compile problems", r.json()["plans"] == {} and "outboundHosts" in r.json()["problems"][0]["message"], r.text)

# ── releases ─────────────────────────────────────────────────────────────────
r = c.post("/v1/platform/releases", json={"spec": APP_YAML}, headers=H)
ok("an app is released", r.status_code == 201 and r.json()["release"]["workloads"] == ["extract"], r.text)
app_release = r.json()["release"]
r = c.get(f"/v1/platform/releases/{app_release['id']}", headers=H)
ok("Studio reads the pinned spec and missing evaluation requirements", r.status_code == 200
   and r.json()["spec"]["kind"] == "Application" and not r.json()["gate"]["eligible"]
   and r.json()["gate"]["checks"][0]["status"] == "missing"
   and r.json()["evaluation"]["workloads"][0]["external_steps"] == ["post"], r.text)
ok("another owner cannot read a release spec or evaluation gate", c.get(f"/v1/platform/releases/{app_release['id']}", headers=H2).status_code == 404)
ok("release detail needs authentication", c.get(f"/v1/platform/releases/{app_release['id']}").status_code == 401)
r2 = c.post("/v1/platform/releases", json={"spec": APP_YAML}, headers=H)
ok("releasing the same content again returns the same release", r2.status_code == 201 and r2.json()["release"]["id"] == app_release["id"])
r = c.post("/v1/platform/releases", json={"spec": APP_YAML.replace("Extracts invoice fields", "Changed")}, headers=H)
ok("different content under a released version is refused", r.status_code == 409 and "raise metadata.version" in r.json()["detail"], r.text)
cyclic = APP_YAML.replace("version: 1.0.0", "version: 9.0.0").replace("- [fields, output]", "- [fields, output]\n        - [post, fields]")
r = c.post("/v1/platform/releases", json={"spec": cyclic}, headers=H)
ok("a spec that doesn't compile can't be released", r.status_code == 422 and any("cycle" in p["message"] for p in r.json()["problems"]), r.text)
r = c.post("/v1/platform/releases", json={"spec": SUITE_YAML}, headers=H)
ok("the eval suite is released", r.status_code == 201, r.text)
ok("other people don't see the resource", c.get("/v1/platform/resources/Application/acme/invoice-extractor", headers=H2).status_code == 404)
ok("a restricted API key can't manage platform resources",
   c.get("/v1/platform/resources", headers={"Authorization": "Bearer ak_live_restricted1"}).status_code == 403)

# ── secrets ──────────────────────────────────────────────────────────────────
r = c.put("/v1/platform/resources/Application/acme/invoice-extractor/secrets/ERP_API_KEY", json={"value": "erp-live-secret-9876"}, headers=H)
ok("a secret is stored encrypted", r.status_code == 200 and r.json()["secret"]["last4"] == "9876"
   and SB.db["platform_secrets"][0]["encrypted_value"] != "erp-live-secret-9876", r.text)
r = c.get("/v1/platform/resources/Application/acme/invoice-extractor/secrets", headers=H)
ok("listing secrets shows names, never values", r.json()["secrets"][0]["key"] == "ERP_API_KEY" and "erp-live" not in r.text)
ok("bad secret names are refused",
   c.put("/v1/platform/resources/Application/acme/invoice-extractor/secrets/bad-name", json={"value": "x"}, headers=H).status_code == 422)

# ── environments and the production gate ────────────────────────────────────
base = "/v1/platform/resources/Application/acme/invoice-extractor/environments"
r = c.post(f"{base}/staging/promote", json={"version": "1.0.0"}, headers=H)
ok("promote to staging", r.status_code == 200 and r.json()["environment"]["version"] == "1.0.0", r.text)
r = c.post(f"{base}/production/promote", json={"version": "1.0.0"}, headers=H)
ok("production needs the release's evals to pass first", r.status_code == 409 and r.json()["code"] == "gate_refused", r.text)

ANSWERS[:] = [SMALL, LARGE]
r = c.post("/v1/platform/evals", json={"suite": "EvalSuite/acme/invoice-regression@1.0.0"}, headers=H)
result = r.json().get("result") or {}
ok("the eval suite passes on the release", r.status_code == 200 and result.get("passed") and result.get("pass_rate") == 1.0, r.text)
ok("eval runs didn't call the ERP", ERP == [])
ok("eval runs use the developer's own key", all(p["key"] == "sk-ant-developer-own" for p in PROMPTS))
r = c.get(f"/v1/platform/releases/{app_release['id']}/evals", headers=H)
ok("eval results are listed per release", r.json()["results"][0]["passed"] is True)
r = c.get(f"/v1/platform/releases/{app_release['id']}", headers=H)
ok("Studio reports the same passing gate used by promotion", r.json()["gate"]["eligible"] and r.json()["gate"]["checks"][0]["status"] == "passed", r.text)
r = c.post(f"{base}/production/promote", json={"version": "1.0.0"}, headers=H)
ok("then production accepts it", r.status_code == 200 and r.json()["environment"]["release_id"] == app_release["id"], r.text)

# ── runs ─────────────────────────────────────────────────────────────────────
ANSWERS[:] = [SMALL]
r = c.post("/v1/platform/apps/acme/invoice-extractor/runs", json={"input": invoice(), "wait": True}, headers=H)
run = r.json().get("run") or {}
ok("a production run succeeds", r.status_code == 200 and run.get("status") == "succeeded", r.text)
ok("its output matches the schema", run.get("output", {}).get("vendor") == "ACME GmbH")
ok("the ERP got the secret and an idempotency key", len(ERP) == 1 and ERP[0]["headers"]["Authorization"] == "Bearer erp-live-secret-9876"
   and len(ERP[0]["headers"]["Idempotency-Key"]) == 40 and ERP[0]["hosts"] == ["api.example-erp.com"])
ok("run records never carry the idempotency key or the plan", "Idempotency" not in r.text and "plan" not in run and "erp-live" not in r.text)
ok("cost is recorded", run.get("cost_usd") == round((500 * 0.10 + 100 * 0.50) / 1e6, 6), run.get("cost_usd"))
run_id = run["id"]
ok("the owner can read the run", c.get(f"/v1/platform/runs/{run_id}", headers=H).json()["run"]["status"] == "succeeded")
ok("other people can't", c.get(f"/v1/platform/runs/{run_id}", headers=H2).status_code == 404)
events = c.get(f"/v1/platform/runs/{run_id}/events", headers=H).json()["events"]
ok("events are stored in order", events[0]["type"] == "run.created" and events[-1]["type"] == "run.finished"
   and [e["seq"] for e in events] == sorted(e["seq"] for e in events))
r = c.get("/v1/platform/runs?resource=Application/acme/invoice-extractor", headers=H)
ok("runs are listed per resource", any(x["id"] == run_id for x in r.json()["runs"]))

r = c.post("/v1/platform/apps/acme/invoice-extractor/runs", json={"input": {"invoice_id": "x"}, "wait": True}, headers=H)
ok("bad input is refused before anything runs", r.status_code == 422 and r.json()["problems"][0]["path"] == "input", r.text)

ANSWERS[:] = [LARGE]
ERP.clear()
r = c.post("/v1/platform/apps/acme/invoice-extractor/runs", json={"input": invoice("Invoice from Bolt Ltd. Total: 54,000.00 GBP.", "inv-2"), "wait": True}, headers=H)
waiting = r.json()["run"]
ok("a large invoice waits for review", waiting["status"] == "waiting_approval" and waiting["steps"]["review"]["pending"]["total"] == 54000.0 and ERP == [], r.text)
ok("other people can't approve it",
   c.post(f"/v1/platform/runs/{waiting['id']}/approvals/review", json={"approved": True}, headers=H2).status_code == 404)
r = c.post(f"/v1/platform/runs/{waiting['id']}/approvals/review", json={"approved": True, "wait": True}, headers=H)
ok("approving it finishes the run and posts once", r.json()["run"]["status"] == "succeeded" and len(ERP) == 1, r.text)

ANSWERS[:] = [SMALL]
ERP.clear()
with c.stream("POST", "/v1/platform/apps/acme/invoice-extractor/runs", json={"input": invoice(iid="inv-3")},
              headers={**H, "Accept": "text/event-stream"}) as s:
    lines = [json.loads(line[6:]) for line in s.iter_lines() if line.startswith("data: ")]
types = [e["type"] for e in lines]
ok("streaming sends tokens and the final state", "node.token" in types and "run.finished" in types
   and lines[-1]["type"] == "run.state" and lines[-1]["data"]["status"] == "succeeded", types)

# ── resume after a stopped worker ───────────────────────────────────────────
engine, registry = main.app.state.platform_parts()
rel = asyncio.run(registry.resolve("Application/acme/invoice-extractor", "production", owner_id=OWNER))
stuck = asyncio.run(engine.start(rel["plans"]["extract"], invoice(iid="inv-4"), owner_id=OWNER, release_id=rel["id"]))
ok("a run with no live worker is found by the resume sweep", stuck["id"] in asyncio.run(engine.store.resumable_runs()))
ANSWERS[:] = [SMALL]
r = c.post(f"/v1/platform/runs/{stuck['id']}/resume", headers=H)
ok("resuming finishes it", r.json()["run"]["status"] == "succeeded", r.text)
ok("finished runs aren't resumable", stuck["id"] not in asyncio.run(engine.store.resumable_runs()))

# ── surfaces, rollback ───────────────────────────────────────────────────────
hidden = APP_YAML.replace("version: 1.0.0", "version: 1.1.0").replace("surfaces: [rest, sdk, hosted-ui]", "surfaces: [hosted-ui]").replace(
    "tests: [EvalSuite/acme/invoice-regression@1.0.0]", "")
r = c.post("/v1/platform/releases", json={"spec": hidden, "promote": "staging"}, headers=H)
ok("release and promote in one call", r.status_code == 201 and r.json()["environment"]["version"] == "1.1.0", r.text)
r = c.post("/v1/platform/apps/acme/invoice-extractor/runs", json={"input": invoice(), "environment": "staging", "wait": True}, headers=H)
ok("a release without the REST surface can't be called over REST", r.status_code == 403, r.text)
r = c.post(f"{base}/staging/rollback", headers=H)
ok("rollback returns staging to the previous release", r.status_code == 200 and r.json()["environment"]["version"] == "1.0.0", r.text)
r = c.post(f"{base}/staging/rollback", headers=H)
ok("rolling back past the first release is refused", r.status_code == 409)
detail = c.get("/v1/platform/resources/Application/acme/invoice-extractor", headers=H).json()
ok("the resource view shows releases and environments",
   {x["version"] for x in detail["releases"]} == {"1.0.0", "1.1.0"} and detail["environments"]["production"]["version"] == "1.0.0")

# ── test destinations capture the write inside Aistrix ──────────────────────
captured_spec = APP_YAML.replace("version: 1.0.0", "version: 1.3.0").replace(
    "https://api.example-erp.com/v1/invoices", "aistrix-test://destinations/erp").replace(
    "tests: [EvalSuite/acme/invoice-regression@1.0.0]", "")
r = c.post("/v1/platform/releases", json={"spec": captured_spec}, headers=H)
ok("a release can post to a test destination", r.status_code == 201, r.text)
ANSWERS[:] = [SMALL]
ERP.clear()
r = c.post("/v1/platform/apps/acme/invoice-extractor/runs", json={"input": invoice(iid="inv-td"), "version": "1.3.0", "wait": True}, headers=H)
deliveries = SB.db.get("test_deliveries", [])
ok("the write is captured for the owner, not sent out", r.json()["run"]["status"] == "succeeded" and ERP == []
   and len(deliveries) == 1 and deliveries[0]["user_id"] == OWNER and deliveries[0]["destination"] == "erp"
   and json.loads(deliveries[0]["body"])["invoice_id"] == "inv-td", r.text)
ok("captured deliveries don't keep the secret header", "erp-live-secret" not in json.dumps(deliveries))

# ── agents ───────────────────────────────────────────────────────────────────
# The real Claude adapter path (MainProviders.chat → anthropic SDK) with the
# SDK client faked: checks the Messages API shapes the agent sends.
class _Blk:
    def __init__(self, **kw):
        self.__dict__.update(kw)


CLAUDE_CALLS, CLAUDE_REPLIES = [], []


class FakeAnthropic:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self.messages = self

    async def create(self, **kw):
        CLAUDE_CALLS.append({**kw, "api_key": self.api_key})
        return CLAUDE_REPLIES.pop(0)

    def stream(self, **kw):          # agents stream their text (node.token events)
        CLAUDE_CALLS.append({**kw, "api_key": self.api_key})
        reply = CLAUDE_REPLIES.pop(0)

        class Stream:
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False

            @property
            async def text_stream(self):
                for b in reply.content:
                    if b.type == "text":
                        yield b.text

            async def get_final_message(self): return reply
        return Stream()


main.anthropic.AsyncAnthropic = FakeAnthropic


def claude_reply(*blocks, stop="end_turn"):
    return _Blk(content=list(blocks), usage=_Blk(input_tokens=500, output_tokens=100), stop_reason=stop)


AGENT_YAML = """apiVersion: aistrix.ai/v1alpha1
kind: Agent
metadata: {namespace: acme, name: support, version: 1.0.0}
spec:
  model: claude/claude-sonnet-5-5
  instructions: You help customers with orders.
  tools:
    - name: refund
      description: Refund an order.
      parameters:
        type: object
        required: [id, amount]
        properties: {id: {type: string}, amount: {type: number}}
      http:
        method: POST
        url: https://api.example-erp.com/v1/refunds
        headers: {Authorization: "Bearer {{secrets.ERP_API_KEY}}"}
policies:
  secrets: [ERP_API_KEY]
  outboundHosts: [api.example-erp.com]
"""
r = c.post("/v1/platform/specs/plan", json={"spec": AGENT_YAML}, headers=H)
ok("an agent plans to one agent step", r.json()["plans"]["agent"]["order"] == ["agent"]
   and r.json()["plans"]["agent"]["writeTools"] == ["refund"], r.text)
r = c.post("/v1/platform/specs/plan", json={"spec": AGENT_YAML.replace("[api.example-erp.com]", "[other.example.com]")}, headers=H)
ok("agent tools are held to outboundHosts", r.json()["plans"] == {} and "outboundHosts" in r.json()["problems"][0]["message"], r.text)
r = c.post("/v1/platform/releases", json={"spec": AGENT_YAML, "promote": "staging"}, headers=H)
ok("an agent is released and promoted", r.status_code == 201 and r.json()["release"]["kind"] == "Agent"
   and r.json()["release"]["workloads"] == ["agent"] and r.json()["environment"]["version"] == "1.0.0", r.text)
agent_release = r.json()["release"]
r = c.get(f"/v1/platform/releases/{agent_release['id']}", headers=H)
ok("release detail lists the agent's write tools and its gate", r.json()["evaluation"]["workloads"][0]["external_steps"] == ["refund"]
   and r.json()["gate"]["eligible"] is True, r.text)
c.put("/v1/platform/resources/Agent/acme/support/secrets/ERP_API_KEY", json={"value": "agent-erp-secret-4321"}, headers=H)

ERP.clear()
CLAUDE_REPLIES[:] = [claude_reply(_Blk(type="text", text="Refunding now."),
                                  _Blk(type="tool_use", id="toolu_1", name="refund", input={"id": "A-1", "amount": 20}),
                                  stop="tool_use"),
                     claude_reply(_Blk(type="text", text="Refunded 20 for A-1."))]
r = c.post("/v1/platform/agents/acme/support/runs", json={"input": {"message": "Refund A-1"}, "environment": "staging", "wait": True}, headers=H)
arun = r.json().get("run") or {}
ok("an agent's write waits for approval", r.status_code == 200 and arun.get("status") == "waiting_approval"
   and arun["steps"]["agent"]["pending"]["tool"] == "refund" and ERP == [], r.text)
ok("the agent calls Claude with the owner's key, its tools and instructions",
   CLAUDE_CALLS[0]["api_key"] == "sk-ant-developer-own" and CLAUDE_CALLS[0]["tools"][0]["name"] == "refund"
   and CLAUDE_CALLS[0]["system"] == "You help customers with orders." and CLAUDE_CALLS[0]["model"] == "claude-sonnet-5-5")
ok("other people can't approve an agent's call",
   c.post(f"/v1/platform/runs/{arun['id']}/approvals/agent", json={"approved": True}, headers=H2).status_code == 404)
r = c.post(f"/v1/platform/runs/{arun['id']}/approvals/agent", json={"approved": True, "wait": True}, headers=H)
done = r.json()["run"]
ok("approving runs the write once and the agent finishes", done["status"] == "succeeded" and done["output"] == "Refunded 20 for A-1."
   and len(ERP) == 1 and ERP[0]["json"] == {"id": "A-1", "amount": 20}, r.text)
ok("the write carries the secret and an idempotency key", ERP[0]["headers"]["Authorization"] == "Bearer agent-erp-secret-4321"
   and len(ERP[0]["headers"]["Idempotency-Key"]) == 40)
second = CLAUDE_CALLS[1]["messages"]
ok("tool results go back to Claude as tool_result blocks", second[1]["content"][1]["type"] == "tool_use"
   and second[2]["content"][0]["type"] == "tool_result" and second[2]["content"][0]["tool_use_id"] == "toolu_1", second)
ok("agent runs record cost per turn", done["cost_usd"] == round(2 * (500 * 2.0 + 100 * 10.0) / 1e6, 6), done["cost_usd"])
ok("agent run records keep neither the secret nor the idempotency key", "agent-erp-secret" not in r.text and "Idempotency" not in r.text)
types = [e["type"] for e in c.get(f"/v1/platform/runs/{done['id']}/events", headers=H).json()["events"]]
ok("the trace shows each turn, the wait, the approval and the tool call",
   {"agent.turn", "agent.waiting", "agent.approval", "agent.tool"} <= set(types) and types[-1] == "run.finished", types)
ok("agents are only reachable at /agents", c.post("/v1/platform/apps/acme/support/runs", json={"input": {"message": "x"},
   "environment": "staging", "wait": True}, headers=H).status_code == 404)
ok("other people can't run the agent", c.post("/v1/platform/agents/acme/support/runs", json={"input": {"message": "x"},
   "environment": "staging"}, headers=H2).status_code == 404)

# ── the SDK and CLI use the same API ────────────────────────────────────────
from typer.testing import CliRunner

from aistrix import AistrixClient, ContractError
from aistrix import cli as aistrix_cli

sdk = AistrixClient(api_key="jwt-owner", api_url="http://testserver")
sdk._http = TestClient(main.app, headers=H)
ok("the SDK validates a spec file", sdk.validate_spec(EXAMPLES / "aistrix.yaml")["valid"])
ANSWERS[:] = [SMALL]
ERP.clear()
record = sdk.invoke("acme/invoice-extractor", invoice(iid="inv-5"))
ok("the SDK runs the production release", record["status"] == "succeeded" and record["trigger"] == "sdk" and len(ERP) == 1)
try:
    sdk.invoke("acme/invoice-extractor", {"invoice_id": "x"})
    refused = None
except ContractError as e:
    refused = e
ok("SDK errors carry the problem paths", refused is not None and any(x.startswith("input") for x in refused.errors), refused)
ANSWERS[:] = [SMALL]
streamed = list(sdk.invoke_stream("acme/invoice-extractor", invoice(iid="inv-6")))
ok("the SDK streams run events", streamed[-1]["type"] == "run.state" and streamed[-1]["data"]["status"] == "succeeded")

aistrix_cli._client = lambda: sdk
runner = CliRunner()
res = runner.invoke(aistrix_cli.app, ["spec", "validate", str(EXAMPLES / "aistrix.yaml")])
ok("aistrix spec validate", res.exit_code == 0 and "Application/acme/invoice-extractor@1.0.0" in res.output, res.output)
res = runner.invoke(aistrix_cli.app, ["spec", "plan", str(EXAMPLES / "aistrix.yaml")])
ok("aistrix spec plan shows order and outside effects", res.exit_code == 0 and "post: http" in res.output and "outside effect" in res.output, res.output)
TMP = Path(tempfile.mkdtemp(prefix="aistrix-platform-check-"))
atexit.register(shutil.rmtree, TMP, ignore_errors=True)
broken = TMP / "broken.yaml"
broken.write_text(APP_YAML.replace("[api.example-erp.com]", "[nope.example.com]"), encoding="utf-8")
res = runner.invoke(aistrix_cli.app, ["spec", "plan", str(broken)])
ok("aistrix spec plan fails with the problem", res.exit_code == 1 and "outboundHosts" in res.output, res.output)
v12 = TMP / "v12.yaml"
v12.write_text(APP_YAML.replace("version: 1.0.0", "version: 1.2.0").replace("tests: [EvalSuite/acme/invoice-regression@1.0.0]", ""), encoding="utf-8")
res = runner.invoke(aistrix_cli.app, ["release", str(v12), "--promote", "staging"])
ok("aistrix release --promote", res.exit_code == 0 and "Released Application/acme/invoice-extractor@1.2.0" in res.output, res.output)
ANSWERS[:] = [SMALL, LARGE]
res = runner.invoke(aistrix_cli.app, ["eval", "EvalSuite/acme/invoice-regression@1.0.0"])
ok("aistrix eval prints each case", res.exit_code == 0 and "100% passed" in res.output, res.output)
ANSWERS[:] = [LARGE]
res = runner.invoke(aistrix_cli.app, ["invoke", "acme/invoice-extractor", "--input", json.dumps(invoice("Bolt 54,000 GBP", "inv-7"))])
ok("aistrix invoke shows a waiting approval", res.exit_code == 0 and "waiting_approval" in res.output and "aistrix runs approve" in res.output, res.output)
waiting_id = res.output.split("Run ", 1)[1].split()[0]
res = runner.invoke(aistrix_cli.app, ["runs", "approve", waiting_id, "review"])
ok("aistrix runs approve finishes it", res.exit_code == 0 and "succeeded" in res.output, res.output)
res = runner.invoke(aistrix_cli.app, ["rollback", "Application/acme/invoice-extractor", "--env", "staging"])
ok("aistrix rollback", res.exit_code == 0 and "staging → 1.0.0" in res.output, res.output)

CLAUDE_REPLIES[:] = [claude_reply(_Blk(type="text", text="Orders ship in 2 days."))]
answer = sdk.ask("acme/support", "How long does shipping take?", environment="staging")
ok("the SDK asks an agent", answer["status"] == "succeeded" and answer["output"] == "Orders ship in 2 days."
   and answer["trigger"] == "sdk" and answer["steps"]["agent"]["state"]["messages"][0]["content"] == "How long does shipping take?", answer)
CLAUDE_REPLIES[:] = [claude_reply(_Blk(type="tool_use", id="toolu_9", name="refund", input={"id": "B-2", "amount": 5}), stop="tool_use")]
res = runner.invoke(aistrix_cli.app, ["ask", "acme/support", "Refund B-2", "--env", "staging"])
ok("aistrix ask shows the call waiting for approval", res.exit_code == 0 and "waiting_approval" in res.output
   and "refund" in res.output and "aistrix runs approve" in res.output, res.output)

finish()
