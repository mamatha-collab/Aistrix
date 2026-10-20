"""Marketplace: a listing goes live only through the server, only for an
app that is published and has a complete listing, and only by its editors."""
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main
from fastapi import HTTPException
from fastapi.testclient import TestClient

APPS = {"app-1": {"id": "app-1", "created_by": "dev", "is_published": False, "live_version": None, "total_runs": 0, "is_paid": False}}
LISTINGS = [{"id": "l-1", "app_id": "app-1", "title": "Pitch writer", "tagline": "", "category": None, "status": "draft"}]


class Q:
    def __init__(self, t): self.t, self.f, self.patch = t, {}, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f[k] = v; return self
    def limit(self, *a): return self
    def update(self, patch): self.patch = patch; return self
    def execute(self):
        hits = [r for r in LISTINGS if all(r.get(k) == v for k, v in self.f.items())]
        if self.patch:
            for r in hits: r.update(self.patch)
        return NS(data=[dict(r) for r in hits])


async def caller(request, required=True):
    tok = request.headers.get("authorization", "").removeprefix("Bearer ")
    if tok not in ("dev", "other"): raise HTTPException(status_code=401, detail="Sign in")
    return main.ApiCaller(user_id=tok)
async def load(app_id): return APPS.get(app_id)
async def none(*a, **k): return None
main.resolve_api_caller = caller
main.require_verified_user = lambda request: caller(request)
main.load_app_row = load
main.workspace_role = none; main.app_member_role = none; main.personal_workspace_id = none
main._service_client = lambda: NS(table=Q)
c = TestClient(main.app)
dev = {"Authorization": "Bearer dev"}
go = lambda who=dev: c.post("/v1/apps/app-1/listing/go-live", headers=who)

r = go()
problems = r.json().get("problems", [])
ok("an unpublished app can't go live on the Marketplace", r.status_code == 409 and any("Publish the app" in p for p in problems) and LISTINGS[0]["status"] == "draft")
ok("…and an incomplete listing says what's missing", any("Tagline" in p for p in problems) and any("Category" in p for p in problems)
   and any("No runs yet" in p for p in problems))
ok("another developer can't put it live", go({"Authorization": "Bearer other"}).status_code == 404 and LISTINGS[0]["status"] == "draft")
ok("sign-in required", c.post("/v1/apps/app-1/listing/go-live").status_code == 401)

APPS["app-1"].update(is_published=True, live_version=1, total_runs=3, is_paid=True, price_per_run=0)
LISTINGS[0].update(tagline="Writes pitches", category="Writing & Content")
r = go()
ok("a paid app needs a price before listing", r.status_code == 409 and r.json()["problems"] == ["Paid app has no price — set one in Marketplace"])
APPS["app-1"]["price_per_run"] = 0.05
r = go()
ok("a price below the card minimum can't be listed (buyers couldn't pay)", r.status_code == 409 and "card minimum" in r.json()["problems"][0])
APPS["app-1"]["price_per_run"] = 2
r = go()
ok("a published app with a complete listing goes live", r.status_code == 200 and r.json()["listing"]["status"] == "live" and LISTINGS[0]["status"] == "live")
ok("the older endpoint applies the same checks", c.post("/apps/app-1/publish", headers=dev).status_code == 200)
finish()
