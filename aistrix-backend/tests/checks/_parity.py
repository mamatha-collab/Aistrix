"""Shared fakes for the legacy-vs-AEX parity checks: an in-memory Supabase,
two users, a recording model, and helpers to compare what a run sent,
streamed and wrote. Import after _harness.setup()."""
import asyncio
import copy
import json
import re
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import main

main.platform_key = lambda provider: None


class Res(SimpleNamespace):
    pass


class Q:
    def __init__(self, db, table):
        self.db, self.t, self.f, self.op, self.payload, self.one, self.lim = db, table, [], "select", None, None, None
    def select(self, *a, **k): return self
    def eq(self, k, v): self.f.append(lambda r: r.get(k) == v); return self
    def neq(self, k, v): self.f.append(lambda r: r.get(k) != v); return self
    def in_(self, k, vs): self.f.append(lambda r: r.get(k) in vs); return self
    def lt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) < v); return self
    def gt(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) > v); return self
    def gte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) >= v); return self
    def lte(self, k, v): self.f.append(lambda r: r.get(k) is not None and r.get(k) <= v); return self
    def is_(self, k, v): self.f.append(lambda r: r.get(k) is None if v == "null" else r.get(k) is not None); return self
    def or_(self, *a, **k): return self
    def ilike(self, *a, **k): return self
    def not_(self): return self
    def order(self, *a, **k): return self
    def range(self, *a, **k): return self
    def limit(self, n): self.lim = n; return self
    def maybe_single(self): self.one = True; return self
    def single(self): self.one = True; return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def upsert(self, rows, on_conflict=None, ignore_duplicates=False, **k):
        # Like Postgres: a row whose conflict key already exists is skipped
        # (ignore_duplicates) or updated, never stored twice. Run logs rely on
        # this when the telemetry outbox replays a delivery.
        self.op, self.payload, self.conflict, self.ignore = "upsert", rows, on_conflict, ignore_duplicates
        return self
    def update(self, patch): self.op, self.payload = "update", patch; return self
    def delete(self): self.op = "delete"; return self
    def execute(self):
        rows = self.db.setdefault(self.t, [])
        if self.op == "upsert":
            keys = [k for k in (self.conflict or "").split(",") if k]
            out = []
            for r in (self.payload if isinstance(self.payload, list) else [self.payload]):
                existing = next((x for x in rows if keys and all(x.get(k) == r.get(k) for k in keys)), None)
                if existing is not None:
                    if not self.ignore:
                        existing.update(json.loads(json.dumps(r)))
                        out.append(dict(existing))
                    continue
                r = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), **json.loads(json.dumps(r))}
                rows.append(r)
                out.append(dict(r))
            return Res(data=out, count=None)
        if self.op == "insert":
            out = []
            for r in (self.payload if isinstance(self.payload, list) else [self.payload]):
                r = {"id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat(), **json.loads(json.dumps(r))}
                rows.append(r)
                out.append(dict(r))
            return Res(data=out, count=None)
        match = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "update":
            for r in match:
                r.update(json.loads(json.dumps(self.payload)))
            return Res(data=[dict(r) for r in match], count=None)
        if self.op == "delete":
            self.db[self.t] = [r for r in rows if r not in match]
            return Res(data=match, count=None)
        if self.lim is not None:
            match = match[:self.lim]
        data = [dict(r) for r in match]
        return Res(data=(data[0] if data else None) if self.one else data, count=len(data))


class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)
    def rpc(self, *a, **k):
        return SimpleNamespace(execute=lambda: Res(data=None))


SB = FakeSB()
main._service_client = lambda: SB
main.create_client = lambda *a, **k: SB
main.get_anon_client = lambda: SB
OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
TOKENS = {"jwt-owner": OWNER, "jwt-other": OTHER}


async def _verify(tok): return TOKENS.get(tok)
async def _none(*a, **k): return None
async def _empty(*a, **k): return ""
async def _emptyl(*a, **k): return []
async def _emptyd(*a, **k): return {}
async def _zero(*a, **k): return 0
async def _key(user_id, provider): return f"sk-ant-{user_id[:6]}"
async def _key_jwt(jwt, provider): return f"sk-ant-{jwt[-5:]}"
main.verify_user_jwt = _verify
main.resolve_user_workspace = _none
main.personal_workspace_id = _none
main.workspace_role = _none
main.app_member_role = _none
main.fetch_app_knowledge = _empty
main.fetch_app_tools = _emptyl
main._load_app_secrets = _emptyd
main.dev_key_runs_today = _zero
main.fetch_user_api_key_by_id = _key
main.fetch_user_api_key = _key_jwt
main.HOURLY_LIMIT = main.DAILY_LIMIT = 10_000

BLUEPRINTS: dict = {}


async def _load_app_row(app_id):
    row = next((a for a in SB.db.get("apps", []) if a["id"] == app_id), None)
    return json.loads(json.dumps(row)) if row else None


async def _blueprint(app_id):
    return copy.deepcopy(BLUEPRINTS.get(app_id, {}))
main.load_app_row = _load_app_row
main.fetch_app_blueprint = _blueprint


def make_app(app_type: str, **over) -> dict:
    row = {"id": str(uuid.uuid4()), "name": f"{app_type} app", "created_by": OWNER, "workspace_id": None,
           "is_published": True, "is_paid": False, "visibility": "public", "app_type": app_type,
           "system_prompt": f"You are the {app_type} app.", "ai_provider": "claude", "ai_model": "claude-haiku-5-5",
           "output_type": "markdown", "live_version": 1,
           "prod_snapshot": {"system_prompt": f"You are the {app_type} app.", "output_type": "markdown"}, **over}
    SB.db.setdefault("apps", []).append(row)
    return row


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(\+00:00|Z)?")
MS = re.compile(r'"(elapsed_ms|duration_ms|latency_ms)":\s*\d+')
VOLATILE = ("id", "created_at", "updated_at", "started_at", "finished_at", "elapsed_ms", "duration_ms", "latency_ms",
            "run_id", "event_id")


def mask(text: str) -> str:
    return MS.sub(r'"\1": 0', TIME.sub("<time>", UUID.sub("<id>", text)))


def written(before: dict) -> dict:
    """Rows added since `before`, per table, without volatile fields (AEX's own records excluded)."""
    out = {}
    for table, rows in SB.db.items():
        if table in ("apps", "platform_runs"):
            continue
        new = rows[len(before.get(table, [])):]
        if new:
            out[table] = [mask(json.dumps({k: v for k, v in r.items() if k not in VOLATILE}, sort_keys=True)) for r in new]
    return out


def clone_app(template: dict) -> dict:
    """A fresh copy of an app (new id) for one run, so rows that arrive late
    can be matched to the run that wrote them rather than to a time window."""
    row = {**copy.deepcopy(template), "id": str(uuid.uuid4())}
    SB.db.setdefault("apps", []).append(row)
    if template["id"] in BLUEPRINTS:
        BLUEPRINTS[row["id"]] = copy.deepcopy(BLUEPRINTS[template["id"]])
    return row


def rows_for(app_id: str, table: str) -> list:
    """A table's rows that belong to one app (by app_id, or a platform run's resource)."""
    key = f"app-{app_id}"
    return [r for r in SB.db.get(table, []) if r.get("app_id") == app_id or key in str(r.get("resource_key") or "")]


def wait_for(app_id: str, expect: dict, limit: float = 10.0) -> None:
    """Wait until each table has `expect[table]` rows for this app, then for
    the server's background work to go quiet."""
    import time
    from aistrix_platform import app_adapter
    waited = 0.0
    while waited < limit and not all(len(rows_for(app_id, t)) >= n for t, n in expect.items()):
        time.sleep(0.02)
        waited += 0.02
    quiet = 0
    while waited < limit and quiet < 3:
        time.sleep(0.02)
        waited += 0.02
        quiet = 0 if (main._telemetry_tasks or app_adapter._RECORD_TASKS) else quiet + 1


def written_for(app_id: str) -> dict:
    """Rows one app's run wrote, per table, without volatile fields (AEX's own records excluded)."""
    out = {}
    for table in SB.db:
        if table in ("apps", "platform_runs"):
            continue
        rows = rows_for(app_id, table)
        if rows:
            out[table] = sorted(mask(json.dumps({k: v for k, v in r.items() if k not in VOLATILE}, sort_keys=True))
                                for r in rows)
    return out


def snapshot() -> dict:
    return {t: list(rows) for t, rows in SB.db.items()}


def settle(before: dict = None, expect: dict = None, quiet_checks: int = 5, step: float = 0.02, limit: float = 10.0):
    """Wait until background work on the server's own event loop has landed.
    Run logs are delivered after the response ends (through a thread), so
    "nothing pending" alone can be true just before one starts: `expect`
    ({table: rows}) waits for the rows a case must write since `before`, then
    for pending tasks to finish and the fake database to stay quiet."""
    import time
    from aistrix_platform import app_adapter
    before, expect = before or {}, expect or {}
    def size():
        return sum(len(rows) for rows in SB.db.values())
    def arrived():
        return all(len(SB.db.get(t, [])) - len(before.get(t, [])) >= n for t, n in expect.items())
    last, quiet, waited = size(), 0, 0.0
    while waited < limit:
        time.sleep(step)
        waited += step
        busy = bool(main._telemetry_tasks) or bool(app_adapter._RECORD_TASKS) or not arrived()
        now = size()
        quiet = quiet + 1 if (now == last and not busy) else 0
        last = now
        if quiet >= quiet_checks:
            return
    if not arrived():
        return                    # reported by the caller's checks, with what did arrive
