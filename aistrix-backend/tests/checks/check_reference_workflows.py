"""Reference workflows end to end: install creates draft apps and a wired
workflow; runs pause for approval, branch, and deliver to the developer's test
destinations (captured in-process). Fake database and models; no network."""
import json
import uuid
from types import SimpleNamespace

import _harness
from _harness import ok as _ok, finish


def ok(name, cond, info=None):
    if not _ok(name, cond) and info is not None:
        print(f"      got: {str(info)[:600]}")


_harness.setup()
import main
import reference_workflows as rw
from fastapi.testclient import TestClient

main.platform_key = lambda provider: None


class Q:
    def __init__(self, db, table):
        self.db, self.t = db, table
        self.f, self.op, self.payload, self.one, self.lim = [], "select", None, None, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f.append(lambda r: r.get(k) == v); return self
    def lt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) < v); return self
    def gte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) >= v); return self
    def order(self, *a, **k): return self
    def limit(self, n): self.lim = n; return self
    def maybe_single(self): self.one = True; return self
    def single(self): self.one = True; return self
    def delete(self): self.op = "delete"; return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def execute(self):
        rows = self.db.setdefault(self.t, [])
        if self.op == "insert":
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for r in new:
                r = {"id": str(uuid.uuid4()), "created_at": main.datetime.now(main.timezone.utc).isoformat(), **r}
                rows.append(json.loads(json.dumps(r))); out.append(r)
            return SimpleNamespace(data=out)
        match = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "delete":
            self.db[self.t] = [r for r in rows if r not in match]
            return SimpleNamespace(data=match)
        if self.op == "update":
            for r in match: r.update(json.loads(json.dumps(self.payload)))
            return SimpleNamespace(data=[dict(r) for r in match])
        if self.lim is not None: match = match[: self.lim]
        if self.one:
            return SimpleNamespace(data=json.loads(json.dumps(match[0])) if match else None)
        return SimpleNamespace(data=[json.loads(json.dumps(r)) for r in match])


class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)


SB = FakeSB()
main._service_client = lambda: SB
main.get_anon_client = lambda: SB
OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
async def verify(tok): return {"jwt-owner": OWNER, "jwt-other": OTHER}.get(tok)
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def key(user_id, provider): return f"key-{user_id}"
async def allow(*a, **k): return True, ""
main.verify_user_jwt = verify
main.workspace_role = none; main.app_member_role = none; main.personal_workspace_id = none
main.fetch_user_api_key_by_id = key; main.fetch_user_api_key = key
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main._load_app_secrets = emptyd
main._log_app_run = none; main.record_metered_run = none; main.check_rate_limit = allow

DECISION = {"invoice": "approve"}
SEEN_INPUT = {}
async def model(system, user_input, model, api_key=None, usage_holder=None, **kw):
    if "accounts-payable" in system:
        out = {"vendor": "Northwind Supplies Ltd", "invoice_number": "NW-2026-0418", "invoice_date": "2026-10-02",
               "due_date": "2026-11-01", "currency": "USD", "subtotal": 1556.0, "tax": 311.2, "total": 1867.2,
               "line_item_count": 3, "missing_fields": []}
    elif "check extracted invoices" in system:
        SEEN_INPUT["checker"] = user_input
        out = {"decision": DECISION["invoice"], "issues": [] if DECISION["invoice"] != "reject" else ["No invoice number"],
               "note": "Ready to book." if DECISION["invoice"] != "reject" else "Cannot book."}
    elif "triage customer support" in system:
        out = {"category": "billing", "urgency": "high", "customer_email": "dana@acme.example",
               "summary": "Charged twice for Pro. Wants the duplicate refunded.", "needs_human": True}
    elif "draft replies for a support team" in system:
        out = {"reply_subject": "Re: Charged twice this month", "reply_body": "Hi Dana, we're looking into it."}
    elif "export of orders" in system:
        SEEN_INPUT["analyst"] = user_input
        out = {"period": "2026-09", "total_revenue": 4567.0, "order_count": 10,
               "top_products": ["Pro plan", "Onboarding pack", "Team plan"],
               "anomalies": ["SO-1009: negative units", "SO-1010: units 10x the median"], "summary": "Solid month."}
    else:
        out = {"unexpected": system[:40]}
    if usage_holder is not None:
        usage_holder.update(input_tokens=10, output_tokens=10)
    yield json.dumps(out)
main.stream_claude = model

c = TestClient(main.app)
H = {"Authorization": "Bearer jwt-owner"}


def deliveries(dest):
    return [d for d in c.get(f"/v1/test-deliveries?destination={dest}", headers=H).json()["deliveries"]]


# ── catalog and test destinations ────────────────────────────────────────────
cat = c.get("/v1/reference-workflows", headers=H).json()["workflows"]
ok("three reference workflows are offered", [w["key"] for w in cat] == ["invoice_processing", "support_email", "sales_data_sync"])
ok("…each with its apps, steps and a sample input", all(w["apps"] and w["steps"] and isinstance(w["sample_input"], dict) for w in cat))
dests = c.get("/v1/test-destinations", headers=H).json()
urls = {d["name"]: d["url"] for d in dests["destinations"] + dests["datasets"]}
ok("each developer has private test destination URLs", set(urls) >= {"accounting", "support-outbox", "crm", "sales-data"}
   and all(f"/v1/test-destinations/{OWNER}/" in u for u in urls.values()))
other_urls = {d["name"]: d["url"] for d in c.get("/v1/test-destinations", headers={"Authorization": "Bearer jwt-other"}).json()["destinations"]}
ok("…different for each developer", other_urls["accounting"] != urls["accounting"])
path = urls["crm"].replace(main.API_PUBLIC_URL, "")
r = c.post(path, json={"hello": "world"})
ok("a test destination captures a delivery", r.status_code == 200 and r.json()["received"] and deliveries("crm")[0]["json"] == {"hello": "world"})
ok("a wrong token is refused", c.post(path.replace(path.split("/")[4], "0" * 32), json={}).status_code == 404)
ok("other developers don't see your deliveries", c.get("/v1/test-deliveries", headers={"Authorization": "Bearer jwt-other"}).json()["deliveries"] == [])
ok("the sample dataset is served with GET", len(c.get(urls["sales-data"].replace(main.API_PUBLIC_URL, "")).json()["rows"]) == len(rw.SALES_ROWS))
ok("oversized deliveries are refused", c.post(path, content=b"x" * 70000).status_code == 413)
c.delete("/v1/test-deliveries", headers=H)
ok("deliveries can be cleared", deliveries("crm") == [])

# ── install ──────────────────────────────────────────────────────────────────
r = c.post("/v1/reference-workflows/invoice_processing/install", headers=H)
inv = r.json()
flow = next(f for f in SB.db["flows"] if f["id"] == inv["flow_id"])
apps = {a["name"]: a for a in SB.db["apps"]}
ok("install creates the apps as private drafts with their typed blueprints",
   r.status_code == 200 and set(apps) == {"Invoice reader", "Invoice checker"}
   and all(not a["is_published"] and a["visibility"] == "private" and a["created_by"] == OWNER for a in apps.values())
   and len(SB.db["app_blueprints"]) == 2, r.text)
ok("…and a wired developer workflow using those drafts", flow["kind"] == "developer" and flow["user_id"] == OWNER
   and [s.get("app_id") for s in flow["steps"][:2]] == [apps["Invoice reader"]["id"], apps["Invoice checker"]["id"]]
   and all(s.get("version") == "draft" for s in flow["steps"][:2]))
ok("its API steps point at your test destinations", flow["steps"][3]["api_url"] == urls["accounting"])
v = c.post(f"/v1/flows/{flow['id']}/validate", headers=H).json()
ok("the installed workflow compiles", v["ok"] and v["plan_id"], v)
again = c.post("/v1/reference-workflows/invoice_processing/install", headers=H).json()
ok("installing again makes separate copies with new names", again["name"] == "Invoice processing (2)"
   and {a["name"] for a in again["apps"]} == {"Invoice reader (2)", "Invoice checker (2)"})
ok("unknown reference workflows → 404", c.post("/v1/reference-workflows/payroll/install", headers=H).status_code == 404)
ok("API keys can't install", c.post("/v1/reference-workflows/invoice_processing/install", headers={"Authorization": "Bearer ak_live_x"}).status_code in (401, 403))

# ── invoice processing ───────────────────────────────────────────────────────
sample = json.dumps(rw.build("invoice_processing", lambda n: "")["sample_input"])
run = c.post(f"/v1/flows/{flow['id']}/runs", json={"wait": True, "input": sample}, headers=H).json()
ok("invoice: the run reads, checks and waits for finance approval", run.get("status") == "waiting_approval"
   and [s["status"] for s in run["steps"]] == ["ok", "ok", "waiting_approval"], run)
ok("…the checker got the reader's typed fields", "total: 1867.2" in SEEN_INPUT.get("checker", "") and "NW-2026-0418" in SEEN_INPUT["checker"])
ok("…and nothing is booked before approval", deliveries("accounting") == [])
done = c.post(f"/v1/flows/{flow['id']}/runs/{run['id']}/resume", json={"approve": True, "wait": True}, headers=H).json()
booked = deliveries("accounting")
ok("invoice: after approval it's booked in accounting with the extracted fields", done.get("status") == "done"
   and len(booked) == 1 and booked[0]["json"]["total"] == 1867.2 and booked[0]["json"]["invoice_number"] == "NW-2026-0418"
   and booked[0]["json"]["checker_note"] == "Ready to book.", (done, booked))
ok("…and the exceptions branch is skipped", done["steps"][-1]["status"] == "skipped" and deliveries("invoice-exceptions") == [])
DECISION["invoice"] = "reject"
run = c.post(f"/v1/flows/{flow['id']}/runs", json={"wait": True, "input": sample}, headers=H).json()
ex = deliveries("invoice-exceptions")
ok("invoice: a rejected invoice skips approval and booking and goes to exceptions",
   run.get("status") == "done" and [s["status"] for s in run["steps"][2:]] == ["skipped", "skipped", "ok"]
   and len(ex) == 1 and ex[0]["json"]["issues"] == ["No invoice number"] and len(deliveries("accounting")) == 1, run)

# ── support email ────────────────────────────────────────────────────────────
sup = c.post("/v1/reference-workflows/support_email/install", headers=H).json()
sample = json.dumps(rw.build("support_email", lambda n: "")["sample_input"])
run = c.post(f"/v1/flows/{sup['flow_id']}/runs", json={"wait": True, "input": sample}, headers=H).json()
esc = deliveries("support-escalations")
ok("support: an urgent email is escalated at once", len(esc) == 1 and esc[0]["json"]["customer_email"] == "dana@acme.example"
   and esc[0]["json"]["subject"] == "Charged twice this month", esc)
ok("support: the drafted reply waits for an agent", run.get("status") == "waiting_approval" and deliveries("support-outbox") == [], run)
edited = json.dumps({"reply_subject": "Re: Charged twice this month",
                     "reply_body": "Hi Dana, we've refunded the duplicate $49. It arrives in 3–5 days."})
done = c.post(f"/v1/flows/{sup['flow_id']}/runs/{run['id']}/resume", json={"approve": True, "output": edited, "wait": True}, headers=H).json()
sent = deliveries("support-outbox")
ok("support: the agent's edited reply is what's sent", done.get("status") == "done" and len(sent) == 1
   and sent[0]["json"] == {"to": "dana@acme.example", "subject": "Re: Charged twice this month",
                           "body": "Hi Dana, we've refunded the duplicate $49. It arrives in 3–5 days."}, (done, sent))

# ── business data integration ────────────────────────────────────────────────
sales = c.post("/v1/reference-workflows/sales_data_sync/install", headers=H).json()
run = c.post(f"/v1/flows/{sales['flow_id']}/runs", json={"wait": True}, headers=H).json()
ok("sales: orders are fetched from the source and analysed", '"SO-1009"' in SEEN_INPUT.get("analyst", "")
   and run["steps"][0]["status"] == "ok", run)
ok("sales: anomalies hold the run for review before the CRM is updated",
   run.get("status") == "waiting_approval" and deliveries("crm") == [], run)
done = c.post(f"/v1/flows/{sales['flow_id']}/runs/{run['id']}/resume", json={"approve": True, "wait": True}, headers=H).json()
crm = deliveries("crm")
ok("sales: after review the CRM gets the summary", done.get("status") == "done" and len(crm) == 1
   and crm[0]["json"]["total_revenue"] == 4567.0 and crm[0]["json"]["anomalies"][0].startswith("SO-1009"), (done, crm))
finish()
