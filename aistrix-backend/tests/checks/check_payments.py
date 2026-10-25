"""Payments: the server sets the price, only signed Stripe events count, and
each real payment is recorded, paid out to the developer and emailed once —
however many times Stripe delivers it. Fake Stripe and fake storage only."""
import hashlib
import hmac
import json
import os
import time
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup(STRIPE_SECRET_KEY="sk_test_fixture", ENVIRONMENT="production")
import main
import stripe
from fastapi import HTTPException
from fastapi.testclient import TestClient

main.STRIPE_PLATFORM_FEE_PCT = 20
TABLES = {
    "apps": [{"id": "paid-app", "name": "Pricey <b>App</b>", "created_by": "dev", "is_paid": True, "price_per_run": 25},
             {"id": "free-app", "name": "Free", "created_by": "dev", "is_paid": False, "price_per_run": 0}],
    "developer_profiles": [{"user_id": "dev", "stripe_account_id": "acct_dev"}],
    "purchases": [],
    "app_entitlements": [],
}
TRANSFERS, INTENTS, EMAILS = [], [], []


class Query:
    def __init__(self, table): self.table, self.filters, self.action, self.value, self.bounds = table, {}, "select", None, None
    def select(self, *a, **k): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def in_(self, key, values): self.filters[key] = ("in", tuple(values)); return self
    def gte(self, *a): return self
    def limit(self, *a): return self
    def order(self, *a, **k): return self
    def range(self, start, end): self.bounds = (start, end); return self
    def maybe_single(self): self.single = True; return self
    def insert(self, value): self.action, self.value = "insert", value; return self
    def update(self, value): self.action, self.value = "update", value; return self
    def upsert(self, value, **k): self.action, self.value = "upsert", value; return self
    def execute(self):
        rows = TABLES[self.table]
        if self.table == "purchases":
            for r in rows: r.setdefault("payout_attempts", 0)      # column default
        hits = [r for r in rows if all((r.get(k) in v[1]) if isinstance(v, tuple) else r.get(k) == v for k, v in self.filters.items())]
        if self.action == "insert":
            ref = self.value.get("stripe_payment_ref")
            if ref and any(r.get("stripe_payment_ref") == ref for r in rows):
                raise Exception('duplicate key value violates unique constraint (23505)')
            row = {"id": f"p{len(rows) + 1}", **self.value}
            rows.append(row)
            return NS(data=[row])
        if self.action == "update":
            for r in hits: r.update(self.value)
            return NS(data=hits)
        if self.action == "upsert" and self.table == "developer_profiles":
            same = next((r for r in rows if r["user_id"] == self.value["user_id"]), None)
            same.update(self.value) if same else rows.append(dict(self.value))
            return NS(data=[self.value])
        if self.action == "upsert":
            same = next((r for r in rows if r["app_id"] == self.value["app_id"] and r["user_id"] == self.value["user_id"]), None)
            same.update(self.value) if same else rows.append(dict(self.value))
            return NS(data=[self.value])
        if self.bounds: hits = hits[self.bounds[0]:self.bounds[1] + 1][:1000]
        if getattr(self, "single", False):
            return NS(data=dict(hits[0])) if hits else None     # supabase-py: no row → None, not an empty response
        return NS(data=[dict(r) for r in hits])


def record_purchase(p, runs):
    """Mirror of the database function: one row per payment, plus its runs."""
    rows = TABLES["purchases"]
    if any(r.get("stripe_payment_ref") == p["stripe_payment_ref"] for r in rows):
        return None
    row = {"id": f"p{len(rows) + 1}", **p}
    rows.append(row)
    if runs > 0:
        ent = next((e for e in TABLES["app_entitlements"] if e["app_id"] == p["app_id"] and e["user_id"] == p["buyer_id"]), None)
        if ent is None:
            TABLES["app_entitlements"].append({"app_id": p["app_id"], "user_id": p["buyer_id"], "plan": "pay_per_run",
                                               "status": "active", "run_quota": runs, "runs_this_period": 0})
        elif ent["plan"] == "pay_per_run" and ent["status"] == "active":
            ent["run_quota"] = (ent.get("run_quota") or 0) + runs
        elif not (ent["plan"] == "subscription" and ent["status"] == "active"):
            ent.update(plan="pay_per_run", status="active", run_quota=runs, runs_this_period=0)
    return row["id"]

REVOKED = []
def rpc(name, params):
    if name == "revoke_purchased_run":
        REVOKED.append((params["p_app_id"], params["p_user_id"]))
        return NS(execute=lambda: NS(data=True))
    assert name == "record_purchase"
    return NS(execute=lambda: NS(data=record_purchase(params["p_purchase"], params["p_grant_runs"])))

client = NS(table=Query, rpc=rpc)
main._service_client = lambda: client
main.get_anon_client = lambda: client
async def lookup_email(uid): return f"{uid}@example.test"
async def send_email(to, subject, html): EMAILS.append((to, subject, html)); return True
async def user(request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if token not in ("buyer", "dev"): raise HTTPException(status_code=401, detail="Sign in required")
    return token
main._lookup_email = lookup_email
main.send_email = send_email
main.require_verified_user = user
def create_transfer(**kw):
    TRANSFERS.append(kw)
    return {"id": f"tr_{len(TRANSFERS)}"}
stripe.Transfer.create = create_transfer
stripe.Transfer.list = lambda transfer_group, limit=1: {"data": [{"id": f"tr_{i + 1}"} for i, t in enumerate(TRANSFERS) if t.get("transfer_group") == transfer_group][:limit]}
stripe.PaymentIntent.create = lambda **kw: INTENTS.append(kw) or NS(client_secret="pi_secret_fixture")

c = TestClient(main.app, raise_server_exceptions=False)
buyer = {"Authorization": "Bearer buyer"}

# ── The price comes from the app, never from the browser ──────────────────────
r = c.post("/create-payment-intent", json={"app_id": "paid-app", "amount": 1})
ok("card payment requires sign-in", r.status_code == 401 and not INTENTS)
r = c.post("/create-payment-intent", headers=buyer, json={"app_id": "paid-app", "amount": 1})
ok("a 1-cent request is charged the app's real price", r.status_code == 200 and INTENTS[-1]["amount"] == 2500)
ok("the payment carries the signed-in buyer, not a browser-supplied one", INTENTS[-1]["metadata"]["user_id"] == "buyer")
ok("free apps can't take card payments", c.post("/create-payment-intent", headers=buyer, json={"app_id": "free-app"}).status_code == 400)
ok("unknown apps can't take card payments", c.post("/create-payment-intent", headers=buyer, json={"app_id": "nope"}).status_code == 404)

# ── Only signed events count ──────────────────────────────────────────────────
def event(kind, obj): return json.dumps({"id": f"evt_{time.time_ns()}", "type": kind, "data": {"object": obj}})
paid_intent = {"id": "pi_1", "amount_received": 2500, "customer": "cus_1",
               "metadata": {"app_id": "paid-app", "user_id": "buyer", "plan": "pay_per_run"}}

os.environ["STRIPE_WEBHOOK_SECRET"] = ""
r = c.post("/stripe/webhook", content=event("payment_intent.succeeded", paid_intent))
ok("production refuses webhooks when no signing secret is set", r.status_code == 503 and not TABLES["app_entitlements"] and not TABLES["purchases"])

SECRET = "whsec_fixture"
os.environ["STRIPE_WEBHOOK_SECRET"] = SECRET
def signed(body, secret=SECRET):
    t = int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.{body}".encode(), hashlib.sha256).hexdigest()
    return {"stripe-signature": f"t={t},v1={sig}", "content-type": "application/json"}
def deliver(kind, obj, secret=SECRET):
    body = event(kind, obj)
    return c.post("/stripe/webhook", content=body, headers=signed(body, secret))

r = deliver("payment_intent.succeeded", paid_intent, secret="whsec_attacker")
ok("a forged signature grants nothing", r.status_code == 400 and not TABLES["app_entitlements"])

r = deliver("payment_intent.succeeded", paid_intent)
ok("a signed payment is accepted", r.status_code == 200)
ok("the purchase buys exactly one run", [(e["plan"], e["run_quota"], e["runs_this_period"]) for e in TABLES["app_entitlements"]] == [("pay_per_run", 1, 0)])
ok("the payment is recorded at the amount Stripe charged",
   len(TABLES["purchases"]) == 1 and TABLES["purchases"][0]["gross_amount"] == 25 and TABLES["purchases"][0]["dev_share"] == 20)
ok("the developer is paid their share once, with an idempotency key",
   len(TRANSFERS) == 1 and TRANSFERS[0]["amount"] == 2000 and TRANSFERS[0]["idempotency_key"] == "aistrix-payout-pi_1-1"
   and TRANSFERS[0]["transfer_group"] == "aistrix-pi_1")
ok("payout status records the transfer", TABLES["purchases"][0]["payout_status"] == "transferred")
ok("buyer and developer are each emailed once", sorted(e[0] for e in EMAILS) == ["buyer@example.test", "dev@example.test"])
ok("app names are escaped in email HTML", all("<b>App</b>" not in e[2] for e in EMAILS))

deliver("payment_intent.succeeded", paid_intent)
ok("Stripe redelivering the event records, pays and emails nothing more",
   len(TABLES["purchases"]) == 1 and len(TRANSFERS) == 1 and len(EMAILS) == 2)
ok("…and adds no extra run", TABLES["app_entitlements"][0]["run_quota"] == 1)

# ── The app confirms a card payment so the run can start right away ──────────
INTENTS_BY_ID = {"pi_app": {"id": "pi_app", "status": "succeeded", "amount_received": 2500,
                            "metadata": {"app_id": "paid-app", "user_id": "buyer"}},
                 "pi_pending": {"id": "pi_pending", "status": "processing", "amount_received": 0,
                                "metadata": {"app_id": "paid-app", "user_id": "buyer"}}}
def retrieve(pid):
    if pid not in INTENTS_BY_ID: raise stripe.error.InvalidRequestError("No such payment_intent", None)
    return stripe.PaymentIntent.construct_from(INTENTS_BY_ID[pid], "sk_test_fixture")
stripe.PaymentIntent.retrieve = retrieve
confirm = lambda pid, who="buyer": c.post("/payments/confirm", headers={"Authorization": f"Bearer {who}"}, json={"payment_intent_id": pid})
ok("confirming requires sign-in", c.post("/payments/confirm", json={"payment_intent_id": "pi_app"}).status_code == 401)
ok("someone else's payment can't be confirmed", confirm("pi_app", "dev").status_code == 404)
ok("an unfinished payment grants nothing", confirm("pi_pending").status_code == 409)
ok("an unknown payment grants nothing", confirm("pi_nope").status_code == 404)
ok("a confirmed card payment adds one run straight away", confirm("pi_app").status_code == 200 and TABLES["app_entitlements"][0]["run_quota"] == 2)
deliver("payment_intent.succeeded", {**INTENTS_BY_ID["pi_app"], "customer": "cus_1"})
confirm("pi_app")
ok("the webhook and repeat confirmations for the same payment add nothing more",
   TABLES["app_entitlements"][0]["run_quota"] == 2 and sum(p["stripe_payment_ref"] == "pi_app" for p in TABLES["purchases"]) == 1)

# ── Checkout: one-time payment, then a subscription with renewals ─────────────
checkout = {"id": "cs_1", "mode": "payment", "payment_status": "paid", "payment_intent": "pi_2", "amount_total": 2500,
            "customer": "cus_1", "metadata": {"app_id": "paid-app", "user_id": "buyer", "plan": "pay_per_run"}}
deliver("checkout.session.completed", checkout)
deliver("checkout.session.completed", checkout)
ok("a checkout payment is recorded once", sum(p["stripe_payment_ref"] == "pi_2" for p in TABLES["purchases"]) == 1)
ok("…and buys one run", TABLES["app_entitlements"][0]["run_quota"] == 3)
unpaid = {**checkout, "id": "cs_unpaid", "payment_status": "unpaid", "payment_intent": "pi_unpaid"}
before = len(TABLES["purchases"])
deliver("checkout.session.completed", unpaid)
ok("an unpaid checkout (e.g. a delayed bank payment) grants and records nothing yet", len(TABLES["purchases"]) == before)

sub_checkout = {"id": "cs_sub", "mode": "subscription", "payment_status": "paid", "subscription": "sub_1", "customer": "cus_2",
                "amount_total": 2500, "metadata": {"app_id": "paid-app", "user_id": "buyer", "plan": "subscription"}}
before = len(TABLES["purchases"])
deliver("checkout.session.completed", sub_checkout)
ok("starting a subscription grants access; money is recorded per invoice", len(TABLES["purchases"]) == before
   and any(e.get("stripe_sub_id") == "sub_1" for e in TABLES["app_entitlements"]))
deliver("customer.subscription.updated", {"id": "sub_1", "customer": "cus_2", "status": "active", "metadata": {"app_id": "paid-app", "user_id": "buyer"}})
ok("a subscription update (e.g. a new card) is not a sale", len(TABLES["purchases"]) == before)
INTENTS.clear()
r = c.post("/create-payment-intent", headers=buyer, json={"app_id": "paid-app"})
ok("a subscriber isn't sold single runs", r.status_code == 409 and "subscribe" in r.json()["detail"] and not INTENTS)
invoice = {"id": "in_1", "amount_paid": 2500, "customer": "cus_2",
           "parent": {"subscription_details": {"subscription": "sub_1", "metadata": {"app_id": "paid-app", "user_id": "buyer"}}}}
deliver("invoice.paid", invoice); deliver("invoice.paid", invoice)
deliver("invoice.paid", {**invoice, "id": "in_2"})
ok("each paid invoice (first month and renewal) is recorded once",
   [p["stripe_payment_ref"] for p in TABLES["purchases"] if p["plan"] == "subscription"] == ["in_1", "in_2"])
r = deliver("invoice.paid", {"id": "in_3", "amount_paid": 2500, "subscription": "sub_unknown"})
ok("an invoice for a subscription not linked yet is retried by Stripe, not dropped", r.status_code == 503)
before = len(TABLES["purchases"])
deliver("invoice.paid", {**invoice, "id": "in_zero", "amount_paid": 0})
ok("a $0 invoice (trial) is not revenue", len(TABLES["purchases"]) == before)

# ── Failed payout stays visible as money owed ─────────────────────────────────
def fail(**kw): raise stripe.error.InvalidRequestError("no funds", None)
stripe.Transfer.create = fail
deliver("payment_intent.succeeded", {**paid_intent, "id": "pi_fail"})
row = next(p for p in TABLES["purchases"] if p["stripe_payment_ref"] == "pi_fail")
ok("a failed transfer is marked, not silently lost", row["payout_status"] == "transfer_failed")
earnings = c.get("/stripe/earnings", headers={"Authorization": "Bearer dev"}).json()
ok("money not yet paid out counts as pending", earnings["total_pending"] == 20 and earnings["owed_count"] == 1)
stripe.Transfer.create = create_transfer
dev = {"Authorization": "Bearer dev"}

# ── Refunds take back the sale, the developer's share and the unused run ───────
REVERSALS = []
stripe.Transfer.create_reversal = lambda transfer_id, **kw: REVERSALS.append((transfer_id, kw)) or {"id": "trr_1"}
by_ref = lambda ref: next(p for p in TABLES["purchases"] if p["stripe_payment_ref"] == ref)
before_runs = TABLES["app_entitlements"][0]["run_quota"]
deliver("charge.refunded", {"id": "ch_1", "payment_intent": "pi_1", "amount_refunded": 2500})
ok("a full refund marks the purchase refunded", by_ref("pi_1")["payout_status"] == "refunded" and by_ref("pi_1")["refunded_amount"] == 25)
ok("…takes back the developer's share of the payout", REVERSALS == [(by_ref("pi_1")["stripe_transfer_id"], {"amount": 2000, "idempotency_key": "aistrix-reversal-pi_1-2500"})])
ok("…and the run it bought, if unused", REVOKED == [("paid-app", "buyer")])
deliver("charge.refunded", {"id": "ch_1", "payment_intent": "pi_1", "amount_refunded": 2500})
ok("a redelivered refund changes nothing more", len(REVERSALS) == 1 and len(REVOKED) == 1)
deliver("charge.refunded", {"id": "ch_2", "payment_intent": "pi_2", "amount_refunded": 1000})
ok("a partial refund reduces the sale and reverses that part of the payout",
   by_ref("pi_2")["refunded_amount"] == 10 and by_ref("pi_2")["payout_status"] == "transferred" and REVERSALS[-1][1]["amount"] == 800
   and len(REVOKED) == 1)
ok("a refund for a charge Aistrix didn't sell is ignored", deliver("charge.refunded", {"id": "ch_x", "payment_intent": "pi_unknown", "amount_refunded": 100}).status_code == 200)
deliver("charge.dispute.created", {"id": "dp_1", "payment_intent": "pi_2", "charge": "ch_2"})
ok("a chargeback flags the purchase", by_ref("pi_2")["disputed"] is True)

earnings = c.get("/stripe/earnings", headers=dev).json()
ok("earnings are net of refunds, with refunds and disputes shown", earnings["total_refunded"] == 35 and earnings["disputed_count"] == 1
   and earnings["total_gross"] == round(sum(p["gross_amount"] for p in TABLES["purchases"]) - 35, 2))
ok("purchase ids and Stripe references aren't sent to the browser", "stripe_payment_ref" not in str(earnings["recent"]) and "'id'" not in str(earnings["recent"]))
ok("periods are 7, 30, 90, 365 days or all time", c.get("/stripe/earnings?days=30", headers=dev).status_code == 200
   and c.get("/stripe/earnings?days=5", headers=dev).status_code == 400)
r = c.get("/stripe/earnings.csv", headers=dev)
ok("CSV export lists every purchase for accounting", r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
   and r.text.splitlines()[0].startswith("date,app,plan,sale_usd") and len(r.text.splitlines()) == 1 + len(TABLES["purchases"])
   and "attachment" in r.headers["content-disposition"])
ok("CSV needs sign-in", c.get("/stripe/earnings.csv").status_code == 401)

# ── Owed payouts can be sent later, never twice ──────────────────────────────
TABLES["purchases"].append({"id": "p-owed", "app_id": "paid-app", "buyer_id": "buyer", "dev_id": "dev", "plan": "pay_per_run",
                            "gross_amount": 25, "platform_fee": 5, "dev_share": 20, "refunded_amount": 0,
                            "stripe_payment_ref": "pi_before_connect", "payout_status": "no_connect_account"})
stripe.Account.retrieve = lambda acct: {"id": acct, "payouts_enabled": True}
before = len(TRANSFERS)
r = c.post("/stripe/payouts/retry", headers=dev)
ok("owed payouts are sent once the payout account is ready", r.status_code == 200 and r.json()["sent"] == 2
   and by_ref("pi_before_connect")["payout_status"] == "transferred" and by_ref("pi_fail")["payout_status"] == "transferred"
   and len(TRANSFERS) == before + 2)
r = c.post("/stripe/payouts/retry", headers=dev)
ok("sending again pays nothing twice", r.json()["sent"] == 0 and len(TRANSFERS) == before + 2)
by_ref("pi_fail")["payout_status"] = "transfer_failed"          # e.g. the response was lost after Stripe paid
c.post("/stripe/payouts/retry", headers=dev)
ok("a transfer Stripe already made is found and recorded, not repeated", len(TRANSFERS) == before + 2 and by_ref("pi_fail")["payout_status"] == "transferred")
stripe.Account.retrieve = lambda acct: {"id": acct, "payouts_enabled": False}
ok("payouts wait until Stripe enables the account", c.post("/stripe/payouts/retry", headers=dev).status_code == 409)
stripe.Account.retrieve = lambda acct: {"id": acct, "payouts_enabled": True}

# ── A payout is claimed first: concurrent attempts can't both pay ────────────
import asyncio
from datetime import datetime, timedelta, timezone
def owed_row(ref, **kw):
    row = {"id": f"p-{ref}", "app_id": "paid-app", "buyer_id": "buyer", "dev_id": "dev", "plan": "pay_per_run",
           "gross_amount": 25, "platform_fee": 5, "dev_share": 20, "refunded_amount": 0, "payout_attempts": 0,
           "stripe_payment_ref": ref, "payout_status": "transfer_failed", "created_at": "2026-10-01T00:00:00+00:00", **kw}
    TABLES["purchases"].append(row); return row
race = owed_row("pi_race")
stale_read = dict(race)                                          # both callers read the row before either claims it
before = len(TRANSFERS)
first = asyncio.run(main._pay_out(client, dict(race), "acct_dev"))
second = asyncio.run(main._pay_out(client, stale_read, "acct_dev"))
ok("two concurrent attempts on one purchase send one transfer", first == "transferred" and second == "busy" and len(TRANSFERS) == before + 1)
ok("…keyed by payment and attempt", TRANSFERS[-1]["idempotency_key"] == "aistrix-payout-pi_race-1" and by_ref("pi_race")["payout_attempts"] == 1)

retry_row = owed_row("pi_retry")
stripe.Transfer.create = fail
asyncio.run(main._pay_out(client, dict(retry_row), "acct_dev"))
stripe.Transfer.create = create_transfer
asyncio.run(main._pay_out(client, dict(by_ref("pi_retry")), "acct_dev"))
ok("a later attempt after a failure uses a new key (not Stripe's cached error)",
   by_ref("pi_retry")["payout_status"] == "transferred" and TRANSFERS[-1]["idempotency_key"] == "aistrix-payout-pi_retry-2")

now = datetime.now(timezone.utc)
busy = owed_row("pi_busy", payout_status="transferring", payout_attempts=1, payout_claimed_at=now.isoformat())
before = len(TRANSFERS)
r = c.post("/stripe/payouts/retry", headers=dev).json()
ok("a payout another attempt is sending right now is left alone", by_ref("pi_busy")["payout_status"] == "transferring" and len(TRANSFERS) == before)
r = deliver("charge.refunded", {"id": "ch_busy", "payment_intent": "pi_busy", "amount_refunded": 2500})
ok("a refund arriving mid-payout is retried by Stripe, not applied over it", r.status_code == 503 and by_ref("pi_busy")["refunded_amount"] == 0)
by_ref("pi_busy")["payout_claimed_at"] = (now - timedelta(hours=1)).isoformat()   # that server stopped
r = c.post("/stripe/payouts/retry", headers=dev).json()
ok("a claim left by a stopped server is taken over and paid once", by_ref("pi_busy")["payout_status"] == "transferred"
   and len(TRANSFERS) == before + 1 and TRANSFERS[-1]["idempotency_key"] == "aistrix-payout-pi_busy-2")
r = deliver("charge.refunded", {"id": "ch_busy", "payment_intent": "pi_busy", "amount_refunded": 2500})
ok("…and Stripe's retried refund then takes the payout back", r.status_code == 200 and by_ref("pi_busy")["payout_status"] == "refunded"
   and REVERSALS[-1][0] == by_ref("pi_busy")["stripe_transfer_id"])

refunded_first = owed_row("pi_refunded_first", refunded_amount=25)
stale = dict(refunded_first, refunded_amount=0)
before = len(TRANSFERS)
asyncio.run(main._pay_out(client, stale, "acct_dev"))
ok("a payout uses the current row: a refund recorded meanwhile is not paid out", len(TRANSFERS) == before
   and by_ref("pi_refunded_first")["payout_status"] == "refunded")

# ── Every purchase counts; a partial ledger is never presented as complete ──
TABLES["purchases"][:] = [r for r in TABLES["purchases"] if r["dev_id"] == "dev"]
TABLES["purchases"] += [{"id": f"bulk-{i}", "app_id": "paid-app", "dev_id": "dev", "plan": "pay_per_run", "gross_amount": 1,
                         "platform_fee": 0.2, "dev_share": 0.8, "refunded_amount": 0, "payout_status": "transferred",
                         "stripe_payment_ref": f"pi_bulk_{i}", "created_at": "2026-09-01T00:00:00+00:00"} for i in range(2500)]
total = len(TABLES["purchases"])
e = c.get("/stripe/earnings", headers=dev).json()
ok("earnings read past the database API's 1000-row page", e["purchase_count"] == total and e["truncated"] is False
   and e["by_app"][0]["sale_count"] == total)
ok("the CSV lists every purchase", len(c.get("/stripe/earnings.csv", headers=dev).text.splitlines()) == 1 + total)
main.PURCHASE_ROW_LIMIT = 2000
e = c.get("/stripe/earnings", headers=dev).json()
ok("past the row limit, earnings say they're incomplete", e["truncated"] is True and e["purchase_count"] == 2000)
r = c.get("/stripe/earnings.csv", headers=dev)
ok("…and the CSV is refused rather than silently partial", r.status_code == 413 and "shorter period" in r.json()["detail"])
main.PURCHASE_ROW_LIMIT = 200000

# ── Owed payouts: all of them, in as many runs as it takes ───────────────────
for i in range(1200):
    owed_row(f"pi_owed_{i}", payout_status="no_connect_account", created_at=f"2026-08-01T00:00:{i % 60:02d}+00:00")
main.PAYOUT_BATCH_SECONDS = 0                      # no time: nothing is sent, all is "remaining"
r = c.post("/stripe/payouts/retry", headers=dev).json()
ok("payouts not reached in one run are reported as remaining", r["sent"] == 0 and r["remaining"] == 1200)
main.PAYOUT_BATCH_SECONDS = 60
r = c.post("/stripe/payouts/retry", headers=dev).json()
ok("more than 500 owed payouts are all sent", r["sent"] == 1200 and r["remaining"] == 0
   and not any(p["payout_status"] == "no_connect_account" for p in TABLES["purchases"]))
# ── Payout setup (Stripe Connect onboarding) ─────────────────────────────────
ACCOUNTS = []
def create_account(**kw):
    ACCOUNTS.append(kw)
    return NS(id="acct_new")
stripe.Account.create = create_account
stripe.AccountLink.create = lambda **kw: NS(url=f"https://connect.stripe.test/{kw['account']}")
newdev = {"Authorization": "Bearer buyer"}                       # has no developer profile yet
r = c.post("/stripe/connect/onboard", headers=newdev)
ok("a developer with no profile yet can start payout setup", r.status_code == 200 and r.json()["url"].endswith("acct_new")
   and any(p["user_id"] == "buyer" and p["stripe_account_id"] == "acct_new" for p in TABLES["developer_profiles"]))
ok("…with one Stripe account per developer, even on a double click", ACCOUNTS[-1]["idempotency_key"] == "aistrix-connect-buyer")
r = c.post("/stripe/connect/onboard", headers=newdev)
ok("starting again reuses the account", r.status_code == 200 and len(ACCOUNTS) == 1)
def refuse(**kw): raise stripe.error.InvalidRequestError("You can only create new accounts if you've signed up for Connect", None)
stripe.AccountLink.create = refuse
r = c.post("/stripe/connect/onboard", headers=newdev)
ok("a Stripe refusal is explained, not a server error", r.status_code == 502 and "signed up for Connect" in r.json()["detail"])

# ── Checkout returns only to this site ───────────────────────────────────────
main.ALLOWED_ORIGINS = ["https://staging.aistrix.test", "http://localhost:3000"]
main.FRONTEND_URL = "https://aistrix.test"
SESSIONS = []
async def verify_jwt(token): return token if token in ("buyer", "dev") else None
async def no_workspace(user_id, requested): return None
async def not_subscribed(app_id, user_id): return None
main.verify_user_jwt, main.resolve_user_workspace, main._refuse_if_subscribed = verify_jwt, no_workspace, not_subscribed
Query.single = Query.maybe_single
stripe.checkout.Session.create = lambda **kw: SESSIONS.append(kw) or NS(url="https://checkout.stripe.test/cs", id="cs_new")
stripe.Price.create = lambda **kw: NS(id="price_new")
def checkout_with(success, cancel, plan="pay_per_run"):
    return c.post("/create-checkout-session", headers=buyer,
                  json={"app_id": "paid-app", "plan": plan, "success_url": success, "cancel_url": cancel})
for site in ("https://aistrix.test", "https://staging.aistrix.test", "http://localhost:3000", "https://AISTRIX.test:443"):
    r = checkout_with(f"{site}/app/paid-app?checkout=success", f"{site}/marketplace/paid-app")
    ok(f"checkout may return to the site's own address {site}", r.status_code == 200 and SESSIONS[-1]["success_url"].endswith("checkout=success"))
r = checkout_with("https://aistrix.test/app/paid-app?checkout=success", "https://aistrix.test/app/paid-app", plan="subscription")
ok("subscription checkout accepts the site's own addresses", r.status_code == 200 and SESSIONS[-1]["mode"] == "subscription")
before = len(SESSIONS)
for success, cancel, why in (
    ("https://evil.test/thanks", "https://aistrix.test/app/paid-app", "another website after payment"),
    ("https://aistrix.test/app/paid-app", "https://evil.test/", "another website on cancel"),
    ("https://aistrix.test.evil.test/x", "https://aistrix.test/", "a look-alike host"),
    ("https://aistrix.test@evil.test/x", "https://aistrix.test/", "a user-info trick"),
    ("http://aistrix.test/x", "https://aistrix.test/", "the site over plain http"),
    ("https://aistrix.test:8443/x", "https://aistrix.test/", "the site on another port"),
    ("javascript:alert(1)", "https://aistrix.test/", "a script address"),
    ("/app/paid-app", "https://aistrix.test/", "a relative address"),
    ("https://aistrix.test:99999/x", "https://aistrix.test/", "an invalid port"),
):
    r = checkout_with(success, cancel)
    ok(f"checkout refuses to return to {why}", r.status_code == 400 and "can only return" in r.json()["detail"])
ok("…and no Stripe session is created for a refused address", len(SESSIONS) == before)
r = c.post("/create-checkout-session", json={"app_id": "paid-app", "success_url": "https://evil.test/", "cancel_url": "https://evil.test/"})
ok("an unsigned caller is told to sign in first", r.status_code == 401)
finish()
