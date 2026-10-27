"""Store on Supabase (tables from migration 20261027010000_platform_v1.sql),
through the backend's service client. Every query names the owner, so one
developer's rows never reach another's.

Atomic steps use single conditional UPDATEs, which Postgres applies
atomically: a run is saved only if its version still matches, and a lease is
claimed only if it is free, expired or already ours.
"""
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from .errors import Conflict

Db = Callable[[Any], Awaitable[Any]]      # runs a postgrest query builder off the event loop


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _rows(res) -> list:
    data = getattr(res, "data", None)
    return data if isinstance(data, list) else ([data] if data else [])


_RUN_COLUMNS = ("id", "owner_id", "workspace_id", "resource_key", "workload", "release_id", "environment",
                "trigger", "status", "version", "created_at", "updated_at")


class SupabaseStore:
    def __init__(self, client_factory: Callable[[], Any], db: Db, clock: Callable[[], float]):
        self.client = client_factory
        self.db = db
        self.clock = clock

    def _t(self, name: str):
        sb = self.client()
        if not sb:
            raise RuntimeError("Platform storage isn't configured")
        return sb.table(name)

    # ── Runs ──────────────────────────────────────────────────────────────────

    def _run_row(self, run: dict) -> dict:
        return {"id": run["id"], "owner_id": run.get("owner_id"), "workspace_id": run.get("workspace_id"),
                "resource_key": run["resource_key"], "workload": run["workload"], "release_id": run.get("release_id"),
                "environment": run.get("environment"), "trigger": run["trigger"], "status": run["status"],
                "record": run, "version": run["version"], "updated_at": _iso(self.clock())}

    async def create_run(self, run: dict) -> None:
        run["version"] = 1
        await self.db(self._t("platform_runs").insert({**self._run_row(run), "created_at": run["created_at"]}))

    async def get_run(self, run_id: str) -> Optional[dict]:
        rows = _rows(await self.db(self._t("platform_runs").select("record,version").eq("id", run_id).limit(1)))
        if not rows:
            return None
        return {**rows[0]["record"], "version": rows[0]["version"]}

    async def save_run(self, run: dict) -> None:
        expected = run["version"]
        run["version"] = expected + 1
        rows = _rows(await self.db(self._t("platform_runs").update(self._run_row(run))
                                   .eq("id", run["id"]).eq("version", expected)))
        if not rows:
            run["version"] = expected
            raise Conflict("The run changed since it was read")

    async def claim(self, run_id: str, worker: str, seconds: float) -> bool:
        now = self.clock()
        until = _iso(now + seconds)
        table = "platform_runs"
        free = _rows(await self.db(self._t(table).update({"lease_owner": worker, "lease_expires_at": until})
                                   .eq("id", run_id).lt("lease_expires_at", _iso(now))))
        if free:
            return True
        mine = _rows(await self.db(self._t(table).update({"lease_owner": worker, "lease_expires_at": until})
                                   .eq("id", run_id).eq("lease_owner", worker)))
        return bool(mine)

    async def renew(self, run_id: str, worker: str, seconds: float) -> bool:
        now = self.clock()
        rows = _rows(await self.db(self._t("platform_runs").update({"lease_expires_at": _iso(now + seconds)})
                                   .eq("id", run_id).eq("lease_owner", worker).gt("lease_expires_at", _iso(now))))
        return bool(rows)

    async def release(self, run_id: str, worker: str) -> None:
        await self.db(self._t("platform_runs").update({"lease_owner": None, "lease_expires_at": _iso(0)})
                      .eq("id", run_id).eq("lease_owner", worker))

    async def append_event(self, run_id: str, event: dict) -> None:
        await self.db(self._t("platform_run_events").insert({"run_id": run_id, "event": event}))

    async def events(self, run_id: str, after: int = 0) -> list[dict]:
        rows = _rows(await self.db(self._t("platform_run_events").select("seq,event").eq("run_id", run_id)
                                   .gt("seq", after).order("seq").limit(500)))
        return [{**r["event"], "seq": r["seq"]} for r in rows]

    async def resumable_runs(self, limit: int = 20) -> list[str]:
        rows = _rows(await self.db(self._t("platform_runs").select("id").in_("status", ["queued", "running"])
                                   .lt("lease_expires_at", _iso(self.clock())).order("updated_at").limit(limit)))
        return [r["id"] for r in rows]

    async def list_runs(self, *, owner_id: str, resource: Optional[str] = None, limit: int = 50) -> list[dict]:
        q = self._t("platform_runs").select(",".join(_RUN_COLUMNS)).eq("owner_id", owner_id)
        if resource:
            q = q.eq("resource_key", resource)
        return _rows(await self.db(q.order("created_at", desc=True).limit(limit)))

    # ── Control plane ─────────────────────────────────────────────────────────

    async def put_resource(self, row: dict) -> dict:
        rows = _rows(await self.db(self._t("platform_resources").upsert(row, on_conflict="owner_id,key")))
        return rows[0] if rows else row

    async def get_resource(self, key: str, owner_id: str) -> Optional[dict]:
        rows = _rows(await self.db(self._t("platform_resources").select("*").eq("owner_id", owner_id).eq("key", key).limit(1)))
        return rows[0] if rows else None

    async def list_resources(self, owner_id: str) -> list[dict]:
        return _rows(await self.db(self._t("platform_resources")
                                   .select("key,kind,namespace,name,latest_version,draft_hash,created_at,updated_at")
                                   .eq("owner_id", owner_id).order("updated_at", desc=True).limit(200)))

    async def create_release(self, row: dict) -> dict:
        try:
            rows = _rows(await self.db(self._t("platform_releases").insert(row)))
        except Exception as e:
            if "duplicate key" in str(e) or "23505" in str(e):
                raise Conflict(f"Version {row['version']} is already released; releases can't change")
            raise
        return rows[0] if rows else row

    async def get_release(self, release_id: str) -> Optional[dict]:
        rows = _rows(await self.db(self._t("platform_releases").select("*").eq("id", release_id).limit(1)))
        return rows[0] if rows else None

    async def find_release(self, resource_key: str, version: str, owner_id: str) -> Optional[dict]:
        rows = _rows(await self.db(self._t("platform_releases").select("*").eq("owner_id", owner_id)
                                   .eq("resource_key", resource_key).eq("version", version).limit(1)))
        return rows[0] if rows else None

    async def list_releases(self, resource_key: str, owner_id: str) -> list[dict]:
        return _rows(await self.db(self._t("platform_releases")
                                   .select("id,resource_key,kind,version,content_hash,surfaces,plans,created_at,created_by")
                                   .eq("owner_id", owner_id).eq("resource_key", resource_key)
                                   .order("created_at", desc=True).limit(100)))

    async def get_environment(self, resource_key: str, stage: str, owner_id: str) -> Optional[dict]:
        rows = _rows(await self.db(self._t("platform_environments").select("*").eq("owner_id", owner_id)
                                   .eq("resource_key", resource_key).eq("stage", stage).limit(1)))
        return rows[0] if rows else None

    async def set_environment(self, row: dict, expected_release: Optional[str]) -> dict:
        table = "platform_environments"
        if expected_release is None:
            try:
                rows = _rows(await self.db(self._t(table).insert(row)))
            except Exception as e:
                if "duplicate key" in str(e) or "23505" in str(e):
                    raise Conflict("The environment changed since it was read")
                raise
        else:
            rows = _rows(await self.db(self._t(table).update(row).eq("owner_id", row["owner_id"])
                                       .eq("resource_key", row["resource_key"]).eq("stage", row["stage"])
                                       .eq("release_id", expected_release)))
            if not rows:
                raise Conflict("The environment changed since it was read")
        return rows[0] if rows else row

    async def put_eval_result(self, row: dict) -> dict:
        rows = _rows(await self.db(self._t("platform_eval_results").insert(row)))
        return rows[0] if rows else row

    async def eval_results(self, release_id: str) -> list[dict]:
        return _rows(await self.db(self._t("platform_eval_results").select("*").eq("release_id", release_id)
                                   .order("created_at", desc=True).limit(50)))
