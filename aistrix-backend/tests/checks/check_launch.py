"""Launch readiness: the built-in scheduler (each scheduled flow runs once even
with several servers), developer notification emails (once per event, opt-out
respected), Monitor alert emails, account export (no secrets) and deletion
(refused while others depend on the account), and the production-config
report. Fake Supabase, fake email only."""
import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup(ENVIRONMENT="production")
import main
from fastapi import HTTPException
from fastapi.testclient import TestClient

UNIQUE = {"developer_notifications": ("user_id", "kind", "ref"), "server_once": ("key",)}
TABLES: dict = {}


def reset(**tables):
    TABLES.clear()
    TABLES.update({"developer_notifications": [], "server_once": [], "developer_profiles": [], "apps": [],
                   "flow_schedules": [], "app_runs": [], "run_history": [], "purchases": [], "app_entitlements": [],
                   "workspace_members": [], "workspaces": [], "app_files": [], "app_secrets": [], **tables})


class Query:
    def __init__(self, table):
        self.table, self.filters, self.action, self.value, self.bounds = table, [], "select", None, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.filters.append(lambda r: r.get(k) == v); return self
    def in_(self, k, vs): self.filters.append(lambda r: r.get(k) in vs); return self
    def lte(self, k, v): self.filters.append(lambda r: str(r.get(k)) <= v); return self
    def gte(self, k, v): self.filters.append(lambda r: str(r.get(k)) >= v); return self
    @property
    def not_(self): return self
    def is_(self, *a): return self
    def order(self, *a, **k): return self
    def limit(self, *a): return self
    def range(self, a, b): self.bounds = (a, b); return self
    def insert(self, v): self.action, self.value = "insert", v; return self
    def update(self, v): self.action, self.value = "update", v; return self
    def delete(self): self.action = "delete"; return self
    def execute(self):
        rows = TABLES.setdefault(self.table, [])
        if self.action == "insert":
            keys = UNIQUE.get(self.table)
            if keys and any(all(r.get(k) == self.value.get(k) for k in keys) for r in rows):
                raise Exception("duplicate key value violates unique constraint (23505)")
            value = {"id": len(rows) + 1, "created_at": datetime.now(timezone.utc).isoformat(),
                     "attempts": 0, "next_attempt_at": datetime.now(timezone.utc).isoformat(), **self.value}
            rows.append(value)
            return NS(data=[dict(value)])
        hits = [r for r in rows if all(f(r) for f in self.filters)]
        if self.action == "update":
            for r in hits: r.update(self.value)
        elif self.action == "delete":
            rows[:] = [r for r in rows if r not in hits]
        if self.bounds: hits = hits[self.bounds[0]:self.bounds[1] + 1]
        return NS(data=[dict(r) for r in hits])


DELETED_USERS, REMOVED_FILES = [], []
def rpc(name, params):
    def execute():
        if name != "claim_developer_notifications":
            return NS(data=True)
        now = datetime.now(timezone.utc).isoformat()
        claimed = []
        for row in TABLES.get("developer_notifications", []):
            if params.get("p_id") is not None and row["id"] != params["p_id"]:
                continue
            if not ((row.get("status") == "pending" and row["next_attempt_at"] <= now)
                    or (row.get("status") == "sending" and row["lease_expires_at"] <= now)):
                continue
            row.update(status="sending", attempts=row["attempts"] + 1, lease_token=str(__import__('uuid').uuid4()),
                       lease_expires_at=(datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat())
            claimed.append(dict(row))
        return NS(data=claimed)
    return NS(execute=execute)


client = NS(table=Query, rpc=rpc,
            auth=NS(admin=NS(delete_user=lambda uid: DELETED_USERS.append(uid))),
            storage=NS(from_=lambda bucket: NS(remove=lambda paths: REMOVED_FILES.extend((bucket, p) for p in paths))))
main._service_client = lambda: client
EMAILS = []
provider_send_email = main.send_email
async def send_email(to, subject, html): EMAILS.append((to, subject, html)); return True
async def lookup_email(uid): return f"{uid}@example.test"
async def load_app(app_id): return next((dict(a) for a in TABLES["apps"] if a["id"] == app_id), None)
main.send_email = send_email
main._lookup_email = lookup_email
main.load_app_row = load_app
run = asyncio.run

# ── Scheduled flows: one run per slot, however many servers ask ──────────────
reset()
due = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
TABLES["flow_schedules"] = [{"id": "s1", "flow_id": "f1", "user_id": "u1", "enabled": True, "frequency": "daily",
                             "hour_utc": 9, "day_of_week": None, "next_run_at": due}]
RAN = []
async def fake_run(sb, schedule): RAN.append(schedule["id"])
main.run_scheduled_workspace = fake_run
async def two_servers():
    stale = dict(TABLES["flow_schedules"][0])          # both servers read the due schedule before either claims it
    first = await main._claim_schedule(client, stale, datetime.now(timezone.utc))
    second = await main._claim_schedule(client, stale, datetime.now(timezone.utc))
    return first, second
first, second = run(two_servers())
ok("two servers that read the same due schedule: only one claims it", first is True and second is False)
TABLES["flow_schedules"][0]["next_run_at"] = due
ran, failed = run(main._execute_due_schedules())
ran_again, _ = run(main._execute_due_schedules())
ok("a due schedule runs once and moves to its next slot", ran == ["s1"] and ran_again == []
   and TABLES["flow_schedules"][0]["next_run_at"] > datetime.now(timezone.utc).isoformat())
TABLES["flow_schedules"][0]["next_run_at"] = due
async def failing_run(sb, schedule): raise RuntimeError("provider down")
main.run_scheduled_workspace = failing_run
ran, failed = run(main._execute_due_schedules())
ok("a failing scheduled run waits for its next slot (no retry every minute)", failed == ["s1"]
   and TABLES["flow_schedules"][0]["next_run_at"] > datetime.now(timezone.utc).isoformat())
main.run_scheduled_workspace = fake_run
ok("the built-in scheduler can be switched off", main.SCHEDULER_INTERVAL_SECONDS == 0 and run(main._scheduler_loop()) is None)

# ── Developer notifications: once per event, opt-out respected ───────────────
reset()
sent = run(main.notify_developer("dev", "refund", "pi_1:2500", "A buyer was refunded", "Refunded", "body"))
again = run(main.notify_developer("dev", "refund", "pi_1:2500", "A buyer was refunded", "Refunded", "body"))
ok("a notification is emailed once, even if the event is delivered again", sent and not again and len(EMAILS) == 1
   and EMAILS[0][0] == "dev@example.test")
TABLES["developer_profiles"].append({"user_id": "quiet", "email_alerts": False})
ok("a developer who turned alert emails off gets none", not run(main.notify_developer("quiet", "refund", "x", "s", "t", "b")) and len(EMAILS) == 1)
def broken(table): raise RuntimeError("database down")
main._service_client = lambda: NS(table=broken)
ok("a notification failure never breaks the work that triggered it", run(main.notify_developer("dev", "refund", "y", "s", "t", "b")) is False)
main._service_client = lambda: client

# Failed attempts survive event deduplication and restart into a new worker.
reset()
ATTEMPTS = []
async def flaky_email(to, subject, html):
    ATTEMPTS.append((main._EMAIL_IDEMPOTENCY_KEY.get(), to, subject, html, main._EMAIL_FROM_OVERRIDE.get()))
    return len(ATTEMPTS) > 1
main.send_email = flaky_email
sent = run(main.notify_developer("dev", "refund", "retry", "Refund", "Refund", "body"))
queued = TABLES["developer_notifications"][0]
ok("failed email remains pending with a future retry", not sent and queued["status"] == "pending"
   and queued["next_attempt_at"] > datetime.now(timezone.utc).isoformat() and queued["attempts"] == 1)
run(main.notify_developer("dev", "refund", "retry", "changed", "changed", "changed"))
ok("duplicate events preserve the original queued payload", len(TABLES["developer_notifications"]) == 1
   and queued["payload"]["subject"] == "Refund" and len(ATTEMPTS) == 1)
queued["next_attempt_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
run(main._developer_jobs_tick())
ok("another worker delivers a failed attempt with stable content and idempotency key",
   queued["status"] == "sent" and queued["attempts"] == 2 and ATTEMPTS[0] == ATTEMPTS[1])

reset()
async def missing_email(uid): return None
main._lookup_email = missing_email
run(main.notify_developer("dev", "refund", "missing", "Refund", "Refund", "body"))
queued = TABLES["developer_notifications"][0]
ok("missing recipient is retried rather than marked delivered", queued["status"] == "pending")
main._lookup_email = lookup_email
TABLES["developer_profiles"].append({"user_id": "dev", "email_alerts": False})
queued["next_attempt_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
before = len(ATTEMPTS)
run(main._developer_jobs_tick())
ok("opting out before a queued retry suppresses delivery", queued["status"] == "suppressed"
   and queued["payload"] is None and len(ATTEMPTS) == before)

# Provider acknowledged, but the acknowledgement checkpoint was lost.
reset()
DELIVERED, REQUESTS = set(), []
async def idempotent_email(to, subject, html):
    key = main._EMAIL_IDEMPOTENCY_KEY.get()
    DELIVERED.add(key); REQUESTS.append(key)
    return True
main.send_email = idempotent_email
checkpoint = main._notification_checkpoint
async def lose_ack(row, patch):
    if patch.get("status") == "sent" and len(REQUESTS) == 1:
        raise RuntimeError("ack lost")
    await checkpoint(row, patch)
main._notification_checkpoint = lose_ack
run(main.notify_developer("dev", "refund", "ack", "Refund", "Refund", "body"))
queued = TABLES["developer_notifications"][0]
queued["next_attempt_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
run(main._developer_jobs_tick())
ok("lost acknowledgement retries the same provider operation", len(REQUESTS) == 2 and len(DELIVERED) == 1
   and queued["status"] == "sent")
main._notification_checkpoint = checkpoint
main.send_email = send_email

reset()
run(main.notify_developer("dev", "refund", "expired", "Refund", "Refund", "body"))
queued = TABLES["developer_notifications"][0]
# Model a worker crash before acknowledging an old send.
queued.update(status="sending", attempts=2,
              created_at=(datetime.now(timezone.utc) - timedelta(hours=21)).isoformat(),
              lease_expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
              payload={"subject": "Refund", "html": "body", "to": "dev@example.test"})
before = len(EMAILS)
run(main._developer_jobs_tick())
ok("ambiguous old sends stop before the provider idempotency window expires", queued["status"] == "failed" and len(EMAILS) == before)

# Exercise the actual HTTP adapter, without sending any email.
real_async_client, real_resend_key = main.httpx.AsyncClient, main.RESEND_API_KEY
HTTP_REQUESTS = []
class EmailHTTP:
    async def __aenter__(self): return self
    async def __aexit__(self, *a): pass
    async def post(self, url, **kw):
        HTTP_REQUESTS.append(kw)
        return NS(status_code=200)
main.httpx.AsyncClient = lambda **kw: EmailHTTP()
main.RESEND_API_KEY = 'fake-provider-key'
async def send_with_context():
    key_token = main._EMAIL_IDEMPOTENCY_KEY.set('project/event/1')
    from_token = main._EMAIL_FROM_OVERRIDE.set('frozen@example.test')
    try:
        return await provider_send_email('dev@example.test', 'Refund', '<p>Refund</p>')
    finally:
        main._EMAIL_IDEMPOTENCY_KEY.reset(key_token)
        main._EMAIL_FROM_OVERRIDE.reset(from_token)
ok("provider requests carry the stable key and frozen sender", run(send_with_context())
   and HTTP_REQUESTS[0]['headers']['Idempotency-Key'] == 'project/event/1'
   and HTTP_REQUESTS[0]['json']['from'] == 'frozen@example.test')
main.httpx.AsyncClient, main.RESEND_API_KEY = real_async_client, real_resend_key

# A refund emails the developer.
reset(apps=[{"id": "app-1", "name": "Pitch <b>", "created_by": "dev", "is_published": True}],
      purchases=[{"id": "p1", "app_id": "app-1", "buyer_id": "buyer", "dev_id": "dev", "plan": "pay_per_run", "gross_amount": 25,
                  "dev_share": 20, "refunded_amount": 0, "stripe_payment_ref": "pi_9", "stripe_transfer_id": None,
                  "payout_status": "pending", "payout_attempts": 0}])
EMAILS.clear()
async def rpc_ok(*a, **k): return NS(data=True)
client.rpc = rpc
run(main._record_refund({"payment_intent": "pi_9", "amount_refunded": 1000}))
ok("a refund emails the developer what changed (app names escaped)", len(EMAILS) == 1 and "$10.00" in EMAILS[0][2]
   and "Pitch &lt;b&gt;" in EMAILS[0][2] and "<b>" not in EMAILS[0][2].split("Pitch")[1][:5])

# ── Monitor alert emails: serious alerts, once per app and day ───────────────
now = datetime.now(timezone.utc)
reset(apps=[{"id": "app-1", "name": "Pitch", "created_by": "dev", "is_published": True, "live_version": 2},
            {"id": "app-2", "name": "Quiet", "created_by": "dev2", "is_published": True, "live_version": 1}])
TABLES["app_runs"] = [{"app_id": "app-1", "created_at": (now - timedelta(hours=1)).isoformat(), "status": "error" if i < 8 else "ok",
                       "live_version": 2, "latency_ms": 900, "user_id": f"c{i}", "source": "app", "error_kind": "timeout", "cost_usd": 0}
                      for i in range(20)] + \
                     [{"app_id": "app-2", "created_at": (now - timedelta(hours=1)).isoformat(), "status": "ok", "live_version": 1,
                       "latency_ms": 900, "user_id": "c", "source": "app", "error_kind": None, "cost_usd": 0} for _ in range(20)]
async def rows(app_id, days, owner_id=None):
    return [r for r in TABLES["app_runs"] if r["app_id"] == app_id], [], False
main._monitor_rows = rows
EMAILS.clear(); main._monitor_alert_check["at"] = 0.0
count = run(main._send_monitor_alert_emails())
ok("the owner of an app that's failing is emailed; a healthy app's owner isn't", count == 1 and EMAILS[0][0] == "dev@example.test"
   and "failed" in EMAILS[0][2])
main._monitor_alert_check["at"] = 0.0
ok("…and only once that day", run(main._send_monitor_alert_emails()) == 0 and len(EMAILS) == 1)
ok("checks run every 15 minutes at most", run(main._send_monitor_alert_emails()) == 0)

# ── Your account: export and deletion ────────────────────────────────────────
async def user(request):
    tok = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not tok: raise HTTPException(status_code=401, detail="Unauthorized")
    return tok
main.require_verified_user = user
c = TestClient(main.app)
me = {"Authorization": "Bearer dev"}
reset(apps=[{"id": "app-1", "name": "Pitch", "created_by": "dev", "workspace_id": "personal-dev", "system_prompt": "MY PROMPT"}],
      app_secrets=[{"app_id": "app-1", "key": "CRM_KEY", "encrypted_value": "gAAAA-ciphertext", "created_at": "2026-10-01"}],
      user_api_keys=[{"user_id": "dev", "provider": "anthropic", "is_active": True, "encrypted_key": "gAAAA-key", "created_at": "2026-10-01"}],
      run_history=[{"id": "r1", "user_id": "dev", "input": "hello", "output": "world"}],
      workspace_members=[{"workspace_id": "personal-dev", "user_id": "dev", "role": "owner"}],
      workspaces=[{"id": "personal-dev", "name": "Personal", "is_personal": True}],
      app_files=[{"app_id": "app-1", "owner_id": "dev", "bucket": "app-files", "storage_path": "dev/a.pdf"}])
r = c.get("/v1/account/export", headers=me)
data = r.json() if r.status_code == 200 else {}
ok("export: everything the account owns, as a download", r.status_code == 200 and "attachment" in r.headers.get("content-disposition", "")
   and data["apps"][0]["system_prompt"] == "MY PROMPT" and data["run_history"][0]["input"] == "hello")
ok("…secret names but never values, keys or ciphertext", data.get("app_secrets") == [{"app_id": "app-1", "key": "CRM_KEY", "created_at": "2026-10-01"}]
   and "gAAAA" not in r.text and data["user_api_keys"][0]["provider"] == "anthropic")
ok("export requires sign-in", c.get("/v1/account/export").status_code == 401)

ok("deletion needs the typed confirmation", c.post("/v1/account/delete", headers=me, json={"confirm": "yes"}).status_code == 400 and not DELETED_USERS)
TABLES["workspaces"].append({"id": "team", "name": "Acme", "is_personal": False})
TABLES["workspace_members"].append({"workspace_id": "team", "user_id": "dev", "role": "owner"})
TABLES["apps"].append({"id": "team-app", "name": "Team bot", "created_by": "dev", "workspace_id": "team"})
TABLES["app_entitlements"] += [{"app_id": "other", "user_id": "dev", "plan": "subscription", "status": "active"},
                               {"app_id": "app-1", "user_id": "customer", "plan": "subscription", "status": "active"}]
TABLES["purchases"].append({"dev_id": "dev", "dev_share": 20, "gross_amount": 25, "refunded_amount": 0, "payout_status": "no_connect_account"})
check = c.get("/v1/account/deletion-check", headers=me).json()
ok("deletion is refused while others depend on the account, saying what to do",
   not check["can_delete"] and len(check["blockers"]) == 5
   and any("Acme" in b for b in check["blockers"]) and any("Team bot" in b for b in check["blockers"])
   and any("subscription" in b and "charged" in b for b in check["blockers"]) and any("Customers subscribe" in b for b in check["blockers"])
   and any("$20.00" in b for b in check["blockers"]))
r = c.post("/v1/account/delete", headers=me, json={"confirm": "delete my account"})
ok("…and the delete itself is refused too (409), changing nothing", r.status_code == 409 and not DELETED_USERS and len(TABLES["apps"]) == 2)
TABLES["workspace_members"] = [m for m in TABLES["workspace_members"] if m["workspace_id"] != "team"]
TABLES["apps"] = [a for a in TABLES["apps"] if a["id"] != "team-app"]
TABLES["app_entitlements"].clear(); TABLES["purchases"].clear()
r = c.post("/v1/account/delete", headers=me, json={"confirm": "Delete my account"})
ok("with nothing depending on it, the account, its apps and its files are deleted",
   r.status_code == 200 and DELETED_USERS == ["dev"] and not TABLES["apps"] and REMOVED_FILES == [("app-files", "dev/a.pdf")])

# ── Private deployment: only allowed addresses reach the API ────────────────
import ipaddress
main.ALLOWED_CLIENT_IPS = [ipaddress.ip_network("203.0.113.7/32"), ipaddress.ip_network("198.51.100.0/24")]
os.environ["TRUST_PROXY_HEADERS"] = "1"
ok("an address that isn't allowed is refused", c.get("/v1/developer/plan", headers={**me, "X-Forwarded-For": "8.8.8.8"}).status_code == 403)
ok("an allowed address (or range) gets through", c.get("/v1/account/deletion-check", headers={**me, "X-Forwarded-For": "198.51.100.42"}).status_code != 403)
ok("the host's health check is never blocked", c.get("/health", headers={"X-Forwarded-For": "8.8.8.8"}).status_code == 200)
main.ALLOWED_CLIENT_IPS = []
os.environ["TRUST_PROXY_HEADERS"] = ""

# ── Production configuration report ──────────────────────────────────────────
main._fernet, main.FRONTEND_URL = None, "http://localhost:5173"
gaps = main.production_config_gaps()
ok("missing production settings are named (never their values)", any("SECRET_ENCRYPTION_KEY" in g for g in gaps["missing_required"])
   and any("FRONTEND_URL" in g for g in gaps["missing_required"]) and "RESEND_API_KEY" in gaps["missing_required"])
import os
os.environ["OPS_HEALTH_TOKEN"] = "ops-secret"
gaps = main.production_config_gaps()
details = c.get("/health/details", headers={"X-Ops-Token": "ops-secret"}).json()
ok("/health/details (operator only) reports the gaps", "config" in details and details["config"]["missing_required"] == gaps["missing_required"]
   and c.get("/health/details").status_code == 404)
ok("readiness refuses missing production configuration", c.get('/health/ready').status_code == 503)
main.production_config_gaps = lambda: {'missing_required': [], 'missing_recommended': []}
client.rpc = lambda name, params: NS(execute=lambda: NS(data={'workflow_lease': False}))
ok("readiness refuses an incomplete recovery schema", c.get('/health/ready').status_code == 503)
client.rpc = lambda name, params: NS(execute=lambda: NS(data={k: True for k in ('workflow_lease', 'workflow_snapshot', 'notification_queue', 'recovery_functions', 'server_only')}))
ok("readiness admits a configured deployment with the new schema", c.get('/health/ready').status_code == 200)
def unavailable_rpc(*a, **kw): raise RuntimeError('database unavailable')
client.rpc = unavailable_rpc
ok("readiness fails closed during a database outage", c.get('/health/ready').status_code == 503)

class MissingRecoveryRPC(Exception):
    code = 'PGRST202'
def missing_recovery_rpc(*a, **kw):
    raise MissingRecoveryRPC('private database error payload must not appear in logs')
client.rpc = missing_recovery_rpc
async def missing_recovery_diagnostic():
    try:
        await main._developer_jobs_tick()
    except RuntimeError as error:
        return str(error)
diagnostic = run(missing_recovery_diagnostic())
ok("missing recovery RPC names the migration and operation without exposing error payloads",
   'recover_interrupted_flow_runs' in diagnostic and '[PGRST202]' in diagnostic
   and '20261023020000_durable_developer_jobs.sql' in diagnostic and 'private database error' not in diagnostic)
ok("recovery permission failures explain service-role configuration",
   'service-role key' in main._developer_job_error(NS(code='42501'), 'claim_developer_notifications'))
finish()
