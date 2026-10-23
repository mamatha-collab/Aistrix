"""Build's developer-only endpoints must not expose or mutate other workspaces."""
import asyncio
from types import SimpleNamespace as NS
import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
from fastapi.testclient import TestClient

APP = {"id": "app-build", "created_by": "creator", "workspace_id": "workspace-a"}
ROLE = {"workspace": None, "app": None}
CALLER = main.ApiCaller(user_id="outsider", workspace_id="workspace-b")

async def load(app_id): return dict(APP) if app_id == APP["id"] else None
async def workspace_role(workspace_id, user_id):
    return ROLE["workspace"] if workspace_id == "workspace-a" else None
async def app_role(app_id, user_id): return ROLE["app"]
async def caller(*args, **kwargs): return CALLER
main.load_app_row = load
main.workspace_role = workspace_role
main.app_member_role = app_role
main.resolve_api_caller = caller

for role in ("owner", "admin", "developer", "member", "viewer", "billing", None):
    ROLE["workspace"] = role
    ok(f"Build access: workspace role {role}",
       asyncio.run(main.can_edit_app(APP, CALLER)) == (role in main.BUILD_ROLES))
ROLE["workspace"] = None
for role in ("owner", "editor", "viewer", None):
    ROLE["app"] = role
    ok(f"Build access: app collaborator {role}",
       asyncio.run(main.can_edit_app(APP, CALLER)) == (role in ("owner", "editor")))
ROLE["app"] = None

c = TestClient(main.app)
routes = [
    ("GET", "/release", None), ("GET", "/tests/status", None),
    ("GET", "/versions", None), ("GET", "/live-preview", None),
    ("POST", "/promote", None), ("POST", "/versions/1/rollback", None),
    ("POST", "/tests/run", {"input": "secret", "case_ref": "cross-workspace", "checks": []}),
]
for identity in ("outsider", "cross-workspace-key", "viewer"):
    CALLER = main.ApiCaller(user_id="creator" if identity == "cross-workspace-key" else "outsider",
                            workspace_id="workspace-b", via_key=identity == "cross-workspace-key")
    ROLE["workspace"] = "viewer" if identity == "viewer" else None
    for method, path, body in routes:
        response = c.request(method, f"/v1/apps/{APP['id']}{path}", json=body)
        ok(f"{identity}: {method} {path} denied without leaking data", response.status_code == 404)

finish()
