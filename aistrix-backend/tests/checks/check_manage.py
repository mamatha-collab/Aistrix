"""Manage: current app permission for app-wide secrets and isolated purchase ledgers.
Only synthetic records, encrypted fixture values, and fake services are used.
"""
from types import SimpleNamespace as NS
import _harness
from _harness import ok, finish
_harness.setup()
import main
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from fastapi import HTTPException

APP = {"id": "managed-app", "created_by": "owner", "workspace_id": "team"}
ROLE = {"editor": "developer", "viewer": "member"}
TABLES = {
    "app_secrets": [],
    "purchases": [
        {"app_id": APP["id"], "dev_id": "owner", "gross_amount": 100, "dev_share": 80, "platform_fee": 20, "payout_status": "pending", "created_at": "2026-10-15"},
        {"app_id": "another-app", "dev_id": "other", "gross_amount": 900, "dev_share": 720, "platform_fee": 180, "payout_status": "paid", "created_at": "2026-10-15"},
    ],
}
CALLS = []

class Query:
    def __init__(self, table): self.table = table; self.filters = {}; self.columns = None; self.action = "select"; self.value = None
    def select(self, columns): self.columns = columns; return self
    def eq(self, key, value): self.filters[key] = value; return self
    def order(self, *args, **kwargs): return self
    def limit(self, *a): return self
    def gte(self, *a): return self
    def delete(self): self.action = "delete"; return self
    def upsert(self, value, **kwargs): self.action = "upsert"; self.value = value; return self
    def execute(self):
        CALLS.append((self.table, self.action, dict(self.filters)))
        table = TABLES[self.table]
        hits = [row for row in table if all(row.get(k) == v for k, v in self.filters.items())]
        if self.action == "upsert":
            existing = next((row for row in table if row["app_id"] == self.value["app_id"] and row["key"] == self.value["key"]), None)
            if existing is None: table.append(dict(self.value))
            else: existing.update(self.value)
            return NS(data=[dict(self.value)])
        if self.action == "delete":
            table[:] = [row for row in table if row not in hits]
            return NS(data=hits)
        columns = self.columns.split(",") if self.columns else []
        return NS(data=[{key.strip(): row.get(key.strip()) for key in columns} for row in hits])

async def user(request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if token not in ("owner", "editor", "viewer", "other"):
        raise HTTPException(status_code=401, detail="Sign in required")
    return token

async def app(app_id): return APP if app_id == APP["id"] else None
async def workspace_role(workspace_id, user_id): return ROLE.get(user_id) if workspace_id == "team" else None
async def collaborator(*args): return None
main.require_verified_user = user
main.load_app_row = app
main.workspace_role = workspace_role
main.app_member_role = collaborator
main._service_client = lambda: NS(table=Query)
main._fernet = Fernet(Fernet.generate_key())
c = TestClient(main.app)
headers = lambda identity: {"Authorization": f"Bearer {identity}"}
base = f"/apps/{APP['id']}/secrets"

for method, path, body in [("GET", base, None), ("PUT", base, {"key": "TOKEN", "value": "synthetic"}), ("DELETE", base + "/TOKEN", None)]:
    ok(f"secrets {method}: sign-in required", c.request(method, path, json=body).status_code == 401)
    for identity in ("viewer", "other"):
        before = len(CALLS)
        result = c.request(method, path, headers=headers(identity), json=body)
        ok(f"secrets {method}: {identity} denied before storage", result.status_code == 404 and len(CALLS) == before)

result = c.put(base, headers=headers("owner"), json={"key": "TOKEN", "value": "fixture-secret-value"})
row = TABLES["app_secrets"][0]
ok("owner can save; only encrypted values enter storage", result.status_code == 200 and row["encrypted_value"] != "fixture-secret-value" and main._decrypt(row["encrypted_value"]) == "fixture-secret-value")
result = c.get(base, headers=headers("owner"))
ok("secret metadata never contains plaintext or ciphertext", result.status_code == 200 and result.json()["secrets"][0]["key"] == "TOKEN" and "encrypted_value" not in result.text and "fixture-secret-value" not in result.text)
ok("secrets belong to the app: an editor sees the same names (never values)", [x["key"] for x in c.get(base, headers=headers("editor")).json()["secrets"]] == ["TOKEN"])

c.put(base, headers=headers("editor"), json={"key": "EDITOR_TOKEN", "value": "fixture-editor-value"})
ROLE["editor"] = "member"
before = len(CALLS)
ok("revoked edit permission blocks deletion even for a secret's original author", c.delete(base + "/EDITOR_TOKEN", headers=headers("editor")).status_code == 404 and len(CALLS) == before)
ROLE["editor"] = "developer"
ok("author with current edit permission can remove a secret", c.delete(base + "/EDITOR_TOKEN", headers=headers("editor")).status_code == 200 and not any(r["key"] == "EDITOR_TOKEN" for r in TABLES["app_secrets"]))

async def tools_using_secrets(app_id):
    return [{"name": "Lookup", "config": {"url": "https://api.example.test/{{secrets.token}}"}},
            {"name": "Notify", "config": {"headers": {"X-Key": "{{ secrets.WEBHOOK_KEY }}"}}}]
main.fetch_app_tools = tools_using_secrets
listing = c.get(base, headers=headers("owner")).json()
ok("each saved secret shows which tools use it", listing["secrets"][0]["key"] == "TOKEN" and listing["secrets"][0]["used_by"] == ["Lookup"])
ok("secrets a tool needs but the app lacks are listed (names only)", listing["missing"] == [{"key": "WEBHOOK_KEY", "used_by": ["Notify"]}])
encryption = main._fernet
main._fernet = None
ok("unavailable encryption is an error, not an empty secret list", c.get(base, headers=headers("owner")).status_code == 503)
main._fernet = encryption
main.SUPABASE_SERVICE_ROLE_KEY = ""
for method, path, body in [("GET", base, None), ("PUT", base, {"key": "TOKEN", "value": "synthetic"}), ("DELETE", base + "/TOKEN", None)]:
    ok(f"unavailable storage fails closed for {method}", c.request(method, path, headers=headers("owner"), json=body).status_code == 503)
main.SUPABASE_SERVICE_ROLE_KEY = "svc"

ok("earnings require sign-in", c.get("/stripe/earnings").status_code == 401)
owner = c.get("/stripe/earnings", headers=headers("owner"))
ok("recorded earnings aggregate the developer's purchases only", owner.status_code == 200 and owner.json()["total_gross"] == 100 and owner.json()["total_dev_share"] == 80 and owner.json()["total_pending"] == 80 and len(owner.json()["by_app"]) == 1)
other = c.get("/stripe/earnings", headers=headers("other"))
ok("another developer has an isolated ledger", other.status_code == 200 and other.json()["total_dev_share"] == 720 and other.json()["total_pending"] == 0)
main.SUPABASE_SERVICE_ROLE_KEY = ""
ok("earnings storage outage is not reported as zero", c.get("/stripe/earnings", headers=headers("owner")).status_code == 503)
finish()
