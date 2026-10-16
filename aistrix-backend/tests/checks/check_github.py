"""GitHub feedback tracker: the token stays on the server (encrypted, never
returned), connecting never puts the session token in a URL, and issues are
filed server-side only for runs the developer can see and edit. Fake GitHub
and fake storage only."""
from types import SimpleNamespace as NS
from urllib.parse import parse_qs, urlparse

import _harness
from _harness import ok, finish
_harness.setup(GITHUB_CLIENT_SECRET="gh-secret-fixture")
import main
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi.testclient import TestClient

main.GITHUB_CLIENT_ID = "gh-client"
main.GITHUB_CLIENT_SECRET = "gh-secret-fixture"
main.GITHUB_REDIRECT_URI = "https://api.example.test/auth/github/callback"
main.FRONTEND_URL = "https://app.example.test"
main._fernet = Fernet(Fernet.generate_key())

TABLES = {"developer_github": []}
RUNS = [{"id": "run-1", "app_id": "app-1", "app_name": "Pitch", "input": "hi", "output": "bad answer", "rating_value": -1, "created_at": "2026-10-15"},
        {"id": "run-2", "app_id": "app-other", "app_name": "Theirs", "input": "x", "output": "y", "rating_value": -1, "created_at": "2026-10-15"}]
GITHUB = []          # requests sent to GitHub
GITHUB_STATUS = {"issues": 201}


class Query:
    def __init__(self, table): self.table, self.filters, self.action, self.value = table, {}, "select", None
    def select(self, *a, **k): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def limit(self, *a): return self
    def upsert(self, value, **k): self.action, self.value = "upsert", value; return self
    def update(self, value): self.action, self.value = "update", value; return self
    def delete(self): self.action = "delete"; return self
    def execute(self):
        rows = TABLES[self.table]
        hits = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]
        if self.action == "upsert":
            rows[:] = [r for r in rows if r["user_id"] != self.value["user_id"]] + [dict(self.value)]
        elif self.action == "update":
            for r in hits: r.update(self.value)
        elif self.action == "delete":
            rows[:] = [r for r in rows if r not in hits]
        return NS(data=[dict(r) for r in hits])


class RunQuery(Query):
    def execute(self):   # the developer's own view of run history (RLS)
        return NS(data=[r for r in RUNS if all(r.get(k) == v for k, v in self.filters.items())])


class FakeResponse:
    def __init__(self, status, data): self.status_code, self._data = status, data
    def json(self): return self._data


class FakeGitHub:
    def __init__(self, *a, **k): pass
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def post(self, url, headers=None, json=None):
        GITHUB.append(("POST", url, headers or {}, json))
        if url.endswith("/login/oauth/access_token"):
            return FakeResponse(200, {"access_token": "gho_fixture_token"} if json["code"] == "good" else {"error": "bad_verification_code"})
        return FakeResponse(GITHUB_STATUS["issues"], {"number": 7, "html_url": "https://github.com/acme/app/issues/7"})
    async def get(self, url, headers=None):
        GITHUB.append(("GET", url, headers or {}, None))
        return FakeResponse(200, {"login": "octo"})


main.httpx = NS(AsyncClient=FakeGitHub)
main._service_client = lambda: NS(table=Query)
main.get_supabase_for_user = lambda jwt: NS(table=RunQuery)
async def user(request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if token not in ("dev", "other"): raise HTTPException(status_code=401, detail="Sign in required")
    return token
async def load_app_row(app_id): return {"id": app_id, "created_by": "dev" if app_id == "app-1" else "someone"}
async def no_role(*a): return None
main.require_verified_user = user
main.load_app_row = load_app_row
main.workspace_role = no_role
main.app_member_role = no_role
main.personal_workspace_id = no_role

c = TestClient(main.app, raise_server_exceptions=False, follow_redirects=False)
dev = {"Authorization": "Bearer dev"}

ok("connecting requires sign-in", c.post("/github/connect", json={"repo": "acme/app"}).status_code == 401)
ok("the old start link that put the session token in the URL is gone", c.get("/auth/github?token=dev").status_code in (404, 405))
ok("a malformed repository is refused", c.post("/github/connect", headers=dev, json={"repo": "not a repo"}).status_code == 400)
r = c.post("/github/connect", headers=dev, json={"repo": "https://github.com/acme/app"})
url = r.json().get("url", "")
q = parse_qs(urlparse(url).query)
ok("connect returns GitHub's authorisation URL with a one-time state", r.status_code == 200 and url.startswith("https://github.com/login/oauth/authorize")
   and q["client_id"] == ["gh-client"] and len(q["state"][0]) > 30)
ok("the session token never appears in the URL", "dev" not in url.replace("redirect_uri", ""))

r = c.get(f"/auth/github/callback?code=bad&state={q['state'][0]}")
ok("a failed token exchange goes back to the app without connecting", r.status_code in (302, 307) and r.headers["location"].endswith("/developer?github_connected=0") and not TABLES["developer_github"])
r = c.get(f"/auth/github/callback?code=good&state={q['state'][0]}")
ok("a state can only be used once", r.status_code == 400)

state = parse_qs(urlparse(c.post("/github/connect", headers=dev, json={"repo": "acme/app"}).json()["url"]).query)["state"][0]
r = c.get(f"/auth/github/callback?code=good&state={state}")
row = TABLES["developer_github"][0] if TABLES["developer_github"] else {}
ok("callback returns to the developer page (an existing route)", r.status_code in (302, 307) and r.headers["location"] == "https://app.example.test/developer?github_connected=1")
ok("the token is stored encrypted, with the chosen repository", row.get("token_encrypted") not in (None, "gho_fixture_token")
   and main._decrypt(row["token_encrypted"]) == "gho_fixture_token" and row["repo"] == "acme/app" and row["login"] == "octo")

conn = c.get("/github/connection", headers=dev)
ok("connection status never contains the token", conn.status_code == 200 and conn.json()["connected"] and conn.json()["repo"] == "acme/app"
   and "gho_" not in conn.text and "token" not in conn.text)
ok("another developer is not connected", c.get("/github/connection", headers={"Authorization": "Bearer other"}).json()["connected"] is False)

r = c.post("/github/issues", headers=dev, json={"run_id": "run-1"})
sent = [g for g in GITHUB if g[1].endswith("/repos/acme/app/issues")]
ok("an issue is filed server-side with the stored token", r.status_code == 200 and r.json()["number"] == 7 and len(sent) == 1
   and sent[0][2]["Authorization"] == "Bearer gho_fixture_token" and "bad answer" in sent[0][3]["body"])
ok("runs of apps the developer can't edit can't be filed", c.post("/github/issues", headers=dev, json={"run_id": "run-2"}).status_code == 404)
ok("unknown runs can't be filed", c.post("/github/issues", headers=dev, json={"run_id": "nope"}).status_code == 404)
ok("filing needs a GitHub connection", c.post("/github/issues", headers={"Authorization": "Bearer other"}, json={"run_id": "run-1"}).status_code == 409)
GITHUB_STATUS["issues"] = 401
r = c.post("/github/issues", headers=dev, json={"run_id": "run-1"})
ok("a revoked GitHub token asks to reconnect", r.status_code == 409 and "Reconnect" in r.json()["detail"])
GITHUB_STATUS["issues"] = 201

ok("the repository can be changed", c.put("/github/connection", headers=dev, json={"repo": "acme/other"}).json()["repo"] == "acme/other"
   and TABLES["developer_github"][0]["repo"] == "acme/other")
ok("disconnecting removes the stored token", c.delete("/github/connection", headers=dev).status_code == 200 and not TABLES["developer_github"])
main.SUPABASE_SERVICE_ROLE_KEY = ""
ok("unavailable storage is an error, not 'not connected'", c.get("/github/connection", headers=dev).status_code == 503)
finish()
