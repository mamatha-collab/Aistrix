"""Monitor: production health from the run log — totals, daily series,
per-version split, alerts with minimum samples — and editors-only access.
Synthetic rows only; no inputs or answers are ever returned."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main
from fastapi import HTTPException
from fastapi.testclient import TestClient

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
def at(hours_ago): return (NOW - timedelta(hours=hours_ago)).isoformat()
def run(hours_ago=1, status="ok", version=2, latency=1000, user="u1", source="app", kind=None, cost=0.002):
    return {"created_at": at(hours_ago), "status": status, "live_version": version, "latency_ms": latency,
            "user_id": user, "source": source, "error_kind": kind, "cost_usd": cost}

# ── summary maths ────────────────────────────────────────────────────────────
runs = [run(h, user=f"u{h % 3}") for h in range(1, 41)] + [run(5, "error", kind="timeout", latency=60000)] * 2
ratings = [{"created_at": at(2), "rating_value": 1}] * 3 + [{"created_at": at(3), "rating_value": -1}]
s = main.monitor_summary(runs, ratings, 7, now=NOW)
t = s["totals"]
ok("totals: runs, distinct users, errors and error rate", t["runs"] == 42 and t["users"] == 3 and t["errors"] == 2 and t["error_rate"] == round(2 / 42, 4))
ok("satisfaction comes from ratings only", t["rated"] == 4 and t["satisfaction"] == 0.75)
ok("cost totals what was recorded", t["cost_usd"] == round(42 * 0.002, 4) and t["cost_per_run_usd"] == 0.002)
slow = main.monitor_summary([run(1)] * 18 + [run(1, latency=60000)] * 2, [], 7, now=NOW)["totals"]
ok("p95 response time reflects the slowest 1 in 20", slow["latency_p95_ms"] == 60000 and slow["latency_p50_ms"] == 1000
   and t["latency_p95_ms"] == 1000)
ok("daily series has one point per day, oldest first", len(s["daily"]) == 7 and s["daily"][-1]["date"] == NOW.date().isoformat()
   and sum(d["runs"] for d in s["daily"]) == 42)
ok("errors are grouped by kind", s["error_kinds"] == {"timeout": 2})
ok("no alert from a small, healthy sample", [a["kind"] for a in s["alerts"]] == ["latency"] or s["alerts"] == [])

failing = [run(1, "error", kind="provider_error")] * 5 + [run(2)] * 15
ok("critical alert when ≥10% failed in 24h with enough runs",
   any(a["kind"] == "errors_24h" and a["level"] == "critical" for a in main.monitor_summary(failing, [], 7, now=NOW)["alerts"]))
ok("…but not from 5 runs", not main.monitor_summary(failing[:5], [], 7, now=NOW)["alerts"])

unhappy = [{"created_at": at(10), "rating_value": -1}] * 6 + [{"created_at": at(10), "rating_value": 1}] * 4
ok("satisfaction alert needs 10 ratings in 7 days", any(a["kind"] == "satisfaction" for a in main.monitor_summary([], unhappy, 7, now=NOW)["alerts"])
   and not any(a["kind"] == "satisfaction" for a in main.monitor_summary([], unhappy[:9], 7, now=NOW)["alerts"]))

v3_bad = [run(2, version=3)] * 18 + [run(2, "error", version=3)] * 7 + [run(30, version=2)] * 30
s = main.monitor_summary(v3_bad, [], 7, now=NOW)
ok("per-version split, newest first", [v["version"] for v in s["by_version"]] == [3, 2] and s["by_version"][0]["errors"] == 7)
ok("a release that fails more than the previous one is flagged", any(a["kind"] == "version" and "v3" in a["message"] for a in s["alerts"]))
draft = main.monitor_summary([run(1, version=None)] * 3 + [run(1)], [], 7, now=NOW)
ok("draft runs (no version) are listed after released versions", [v["version"] for v in draft["by_version"]] == [2, None])
ok("a published app with no runs this week is flagged as idle", any(a["kind"] == "idle" for a in main.monitor_summary([], [], 7, now=NOW, published=True)["alerts"]))

# ── endpoints: editors only, aggregates only ─────────────────────────────────
APPS = {"mine": {"id": "mine", "created_by": "owner", "is_published": True, "live_version": 2},
        "theirs": {"id": "theirs", "created_by": "other", "is_published": True}}
ROWS = {"app_runs": [{**run(1), "app_id": "mine", "input": "SECRET INPUT"}],
        "app_feedback": [{"app_id": "mine", "status": "new"}, {"app_id": "mine", "status": "investigating"}, {"app_id": "mine", "status": "verified"}],
        "run_history": [{"created_at": at(1), "rating_value": 1, "app_id": "mine", "user_id": "customer"},
                        {"created_at": at(1), "rating_value": -1, "app_id": "mine", "user_id": "owner"}]}

class Q:
    def __init__(self, t): self.t, self.f = t, {}
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f[k] = v; return self
    def gte(self, *a): return self
    def order(self, *a, **k): return self
    def limit(self, *a): return self
    @property
    def not_(self): return self
    def is_(self, *a): return self
    def in_(self, k, v): self.f[k] = ("in", v); return self
    def execute(self):
        rows = [r for r in ROWS[self.t] if all((r.get(k) in v[1]) if isinstance(v, tuple) else r.get(k) == v for k, v in self.f.items())]
        return NS(data=rows, count=len(rows))

async def load(app_id): return APPS.get(app_id)
async def caller(request, required=True):
    tok = request.headers.get("authorization", "").removeprefix("Bearer ")
    if tok not in ("owner", "other"): raise HTTPException(status_code=401, detail="Sign in")
    return main.ApiCaller(user_id=tok)
async def none(*a, **k): return None
main.load_app_row = load
main.resolve_api_caller = caller
main.workspace_role = none; main.app_member_role = none; main.personal_workspace_id = none
main._service_client = lambda: NS(table=Q)
c = TestClient(main.app)
owner = {"Authorization": "Bearer owner"}

r = c.get("/v1/apps/mine/monitor?days=7", headers=owner)
ok("the app's editor gets its health", r.status_code == 200 and r.json()["totals"]["runs"] == 1 and len(r.json()["daily"]) == 7)
ok("the developer's own rating isn't counted as customer satisfaction", r.json()["totals"]["rated"] == 1 and r.json()["totals"]["satisfaction"] == 1)
ok("no inputs or answers are returned", "SECRET INPUT" not in r.text)
ok("another developer can't see it", c.get("/v1/apps/mine/monitor", headers={"Authorization": "Bearer other"}).status_code == 404)
ok("sign-in required", c.get("/v1/apps/mine/monitor").status_code == 401)
ok("only supported periods", c.get("/v1/apps/mine/monitor?days=5", headers=owner).status_code == 400)
r = c.get("/v1/monitor?app_ids=mine,theirs,mine&days=7", headers=owner)
ok("overview lists only apps the caller can edit, once each", r.status_code == 200 and [a["app_id"] for a in r.json()["apps"]] == ["mine"])
ok("overview counts open feedback (new + investigating)", r.json()["apps"][0]["open_feedback"] == 2)
finish()
