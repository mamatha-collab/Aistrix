"""Customer feedback: a customer rates their own run; developers of the app
see the rating and comment (the question and answer only if shared), never
who gave it, and triage it. Synthetic rows; fake storage."""
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main
from fastapi import HTTPException
from fastapi.testclient import TestClient

APPS = {"app-1": {"id": "app-1", "created_by": "dev", "is_published": True},
        "app-2": {"id": "app-2", "created_by": "other-dev", "is_published": True}}
T = {
    "run_history": [
        {"id": "run-1", "user_id": "customer", "app_id": "app-1", "input": "PRIVATE QUESTION", "output": "WRONG ANSWER"},
        {"id": "run-2", "user_id": "customer", "app_id": "app-1", "input": "Another question", "output": "Fine"},
        {"id": "run-3", "user_id": "someone", "app_id": "app-1", "input": "x", "output": "y"},
    ],
    "app_feedback": [],
    "app_test_cases": [{"id": "case-1", "app_id": "app-1"}, {"id": "case-9", "app_id": "app-2"}],
}


class Q:
    def __init__(self, t, user=None): self.t, self.user, self.f, self.op, self.val, self.inf = t, user, {}, "select", None, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f[k] = v; return self
    def in_(self, k, v): self.inf = (k, v); return self
    def order(self, *a, **k): return self
    def limit(self, *a): return self
    def update(self, v): self.op, self.val = "update", v; return self
    def upsert(self, v, **k): self.op, self.val = "upsert", v; return self
    def execute(self):
        rows = T[self.t]
        hits = [r for r in rows if all(r.get(k) == v for k, v in self.f.items())]
        if self.inf: hits = [r for r in hits if r.get(self.inf[0]) in self.inf[1]]
        if self.user is not None:          # the customer's own client: run_history is owner-only
            hits = [r for r in hits if r.get("user_id") == self.user]
        if self.op == "update":
            for r in hits: r.update(self.val)
            return NS(data=hits)
        if self.op == "upsert":
            same = next((r for r in rows if r["run_id"] == self.val["run_id"]), None)
            if same: same.update(self.val)
            else: rows.append({"id": f"fb-{len(rows) + 1}", "status": "new", "note": None, "test_case_id": None,
                               "created_at": "2026-10-19T10:00:00Z", **self.val})
            return NS(data=[self.val])
        return NS(data=[dict(r) for r in hits])


async def user(request):
    tok = request.headers.get("authorization", "").removeprefix("Bearer ")
    if tok not in ("customer", "dev", "other-dev"): raise HTTPException(status_code=401, detail="Sign in")
    return tok
async def caller(request, required=True): return main.ApiCaller(user_id=await user(request))
async def load(app_id): return APPS.get(app_id)
async def none(*a, **k): return None
main.require_verified_user = user
main.resolve_api_caller = caller
main.load_app_row = load
main.workspace_role = none; main.app_member_role = none; main.personal_workspace_id = none
main._service_client = lambda: NS(table=lambda t: Q(t))
main.get_supabase_for_user = lambda jwt: NS(table=lambda t: Q(t, user=jwt))
c = TestClient(main.app)
as_ = lambda who: {"Authorization": f"Bearer {who}"}

# ── customer side ────────────────────────────────────────────────────────────
ok("rating needs sign-in", c.post("/v1/runs/run-1/feedback", json={"rating": -1}).status_code == 401)
ok("you can only rate your own run", c.post("/v1/runs/run-3/feedback", headers=as_("customer"), json={"rating": -1}).status_code == 404)
ok("ratings are 1 or -1", c.post("/v1/runs/run-1/feedback", headers=as_("customer"), json={"rating": 0}).status_code == 400)
r = c.post("/v1/runs/run-1/feedback", headers=as_("customer"), json={"rating": -1, "comment": "It invented a date"})
fb = T["app_feedback"][0] if T["app_feedback"] else {}
ok("'not useful' reaches the developers with the comment", r.status_code == 200 and r.json()["shared_with_developer"]
   and fb.get("rating") == -1 and fb.get("comment") == "It invented a date")
ok("the question and answer stay private unless shared", fb.get("shared_input") is None and fb.get("shared_output") is None)
ok("the run itself keeps the rating", T["run_history"][0]["rating_value"] == -1 and T["run_history"][0]["feedback_text"] == "It invented a date")
c.post("/v1/runs/run-1/feedback", headers=as_("customer"), json={"rating": -1, "comment": "It invented a date", "share_run": True})
ok("sharing attaches the question and the answer (one item per run)", len(T["app_feedback"]) == 1
   and T["app_feedback"][0]["shared_input"] == "PRIVATE QUESTION" and T["app_feedback"][0]["shared_output"] == "WRONG ANSWER")
r = c.post("/v1/runs/run-2/feedback", headers=as_("customer"), json={"rating": 1})
ok("a plain 'useful' is a rating only, not an inbox item", r.json()["shared_with_developer"] is False and len(T["app_feedback"]) == 1)

# ── developer side ───────────────────────────────────────────────────────────
r = c.get("/v1/apps/app-1/feedback", headers=as_("dev"))
item = r.json()["items"][0]
ok("the app's developer sees open feedback", r.status_code == 200 and len(r.json()["items"]) == 1 and r.json()["counts"] == {"new": 1})
ok("…but never who gave it", "customer" not in r.text and "user_id" not in item)
ok("another developer can't read it", c.get("/v1/apps/app-1/feedback", headers=as_("other-dev")).status_code == 404)
ok("customers can't read the inbox", c.get("/v1/apps/app-1/feedback", headers=as_("customer")).status_code == 404)
ok("unknown status filter is refused", c.get("/v1/apps/app-1/feedback?status=zzz", headers=as_("dev")).status_code == 400)

r = c.patch(f"/v1/feedback/{item['id']}", headers=as_("dev"), json={"status": "investigating", "test_case_id": "case-1", "note": "Regression saved"})
ok("triage: status, note and the regression test are saved", r.status_code == 200 and T["app_feedback"][0]["status"] == "investigating"
   and T["app_feedback"][0]["test_case_id"] == "case-1" and T["app_feedback"][0]["updated_by"] == "dev")
ok("a test from another app can't be linked", c.patch(f"/v1/feedback/{item['id']}", headers=as_("dev"), json={"test_case_id": "case-9"}).status_code == 400)
ok("unknown status refused", c.patch(f"/v1/feedback/{item['id']}", headers=as_("dev"), json={"status": "done"}).status_code == 400)
ok("another developer can't triage it", c.patch(f"/v1/feedback/{item['id']}", headers=as_("other-dev"), json={"status": "dismissed"}).status_code == 404)
c.patch(f"/v1/feedback/{item['id']}", headers=as_("dev"), json={"status": "verified"})
ok("verified items leave the open list but stay in 'all'",
   c.get("/v1/apps/app-1/feedback", headers=as_("dev")).json()["items"] == []
   and len(c.get("/v1/apps/app-1/feedback?status=all", headers=as_("dev")).json()["items"]) == 1)
finish()
