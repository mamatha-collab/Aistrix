"""Storage for the platform: resources, releases, environments, runs and
run events. One interface, two implementations: MemoryStore (tests and the
local runner) and SupabaseStore (the backend, tables from migration
20261027010000_platform_v1.sql).

Runs are saved whole with a version number; a save whose version doesn't
match the stored one raises Conflict, so two workers can't both advance a
run. Leases are claimed atomically for the same reason.
"""
import asyncio
import copy
import time
from typing import Any, Awaitable, Callable, Optional, Protocol

from .errors import Conflict


def _now() -> float:
    return time.time()


class Store(Protocol):
    # Runs
    async def create_run(self, run: dict) -> None: ...
    async def get_run(self, run_id: str) -> Optional[dict]: ...
    async def save_run(self, run: dict) -> None: ...
    async def claim(self, run_id: str, worker: str, seconds: float) -> bool: ...
    async def renew(self, run_id: str, worker: str, seconds: float) -> bool: ...
    async def release(self, run_id: str, worker: str) -> None: ...
    async def append_event(self, run_id: str, event: dict) -> None: ...
    async def events(self, run_id: str, after: int = 0) -> list[dict]: ...
    async def list_runs(self, *, owner_id: str, resource: Optional[str] = None, limit: int = 50) -> list[dict]: ...
    # Control plane
    async def put_resource(self, row: dict) -> dict: ...
    async def get_resource(self, key: str, owner_id: str) -> Optional[dict]: ...
    async def list_resources(self, owner_id: str) -> list[dict]: ...
    async def create_release(self, row: dict) -> dict: ...
    async def get_release(self, release_id: str) -> Optional[dict]: ...
    async def find_release(self, resource_key: str, version: str, owner_id: str) -> Optional[dict]: ...
    async def list_releases(self, resource_key: str, owner_id: str) -> list[dict]: ...
    async def get_environment(self, resource_key: str, stage: str, owner_id: str) -> Optional[dict]: ...
    async def set_environment(self, row: dict, expected_release: Optional[str]) -> dict: ...
    async def put_eval_result(self, row: dict) -> dict: ...
    async def eval_results(self, release_id: str) -> list[dict]: ...


class MemoryStore:
    """In-process store. Copies on the way in and out, like a database."""

    def __init__(self, clock: Callable[[], float] = _now):
        self.clock = clock
        self.runs: dict[str, dict] = {}
        self.leases: dict[str, tuple[str, float]] = {}
        self._events: dict[str, list[dict]] = {}
        self.resources: dict[tuple, dict] = {}
        self.releases: dict[str, dict] = {}
        self.environments: dict[tuple, dict] = {}
        self.evals: list[dict] = []
        self._lock = asyncio.Lock()

    async def create_run(self, run: dict) -> None:
        async with self._lock:
            if run["id"] in self.runs:
                raise Conflict("Run exists")
            run["version"] = 1
            self.runs[run["id"]] = copy.deepcopy(run)
            self._events[run["id"]] = []

    async def get_run(self, run_id: str) -> Optional[dict]:
        run = self.runs.get(run_id)
        return copy.deepcopy(run) if run else None

    async def save_run(self, run: dict) -> None:
        async with self._lock:
            stored = self.runs.get(run["id"])
            if not stored or stored["version"] != run["version"]:
                raise Conflict("The run changed since it was read")
            run["version"] += 1
            self.runs[run["id"]] = copy.deepcopy(run)

    async def claim(self, run_id: str, worker: str, seconds: float) -> bool:
        async with self._lock:
            owner, until = self.leases.get(run_id, (None, 0.0))
            if owner not in (None, worker) and until > self.clock():
                return False
            self.leases[run_id] = (worker, self.clock() + seconds)
            return True

    async def renew(self, run_id: str, worker: str, seconds: float) -> bool:
        async with self._lock:
            owner, until = self.leases.get(run_id, (None, 0.0))
            if owner != worker or until <= self.clock():
                return False
            self.leases[run_id] = (worker, self.clock() + seconds)
            return True

    async def release(self, run_id: str, worker: str) -> None:
        async with self._lock:
            if self.leases.get(run_id, (None, 0))[0] == worker:
                del self.leases[run_id]

    async def append_event(self, run_id: str, event: dict) -> None:
        events = self._events.setdefault(run_id, [])
        events.append({**copy.deepcopy(event), "seq": len(events) + 1})

    async def events(self, run_id: str, after: int = 0) -> list[dict]:
        return [copy.deepcopy(e) for e in self._events.get(run_id, []) if e["seq"] > after]

    async def list_runs(self, *, owner_id: str, resource: Optional[str] = None, limit: int = 50) -> list[dict]:
        rows = [r for r in self.runs.values() if r.get("owner_id") == owner_id
                and (resource is None or r.get("resource_key") == resource)]
        rows.sort(key=lambda r: r.get("created_at") or 0, reverse=True)
        return copy.deepcopy(rows[:limit])

    async def put_resource(self, row: dict) -> dict:
        self.resources[(row["key"], row["owner_id"])] = copy.deepcopy(row)
        return copy.deepcopy(row)

    async def get_resource(self, key: str, owner_id: str) -> Optional[dict]:
        row = self.resources.get((key, owner_id))
        return copy.deepcopy(row) if row else None

    async def list_resources(self, owner_id: str) -> list[dict]:
        return [copy.deepcopy(r) for (k, o), r in self.resources.items() if o == owner_id]

    async def create_release(self, row: dict) -> dict:
        async with self._lock:
            if any(r["resource_key"] == row["resource_key"] and r["version"] == row["version"]
                   and r["owner_id"] == row["owner_id"] for r in self.releases.values()):
                raise Conflict(f"Version {row['version']} is already released; releases can't change")
            self.releases[row["id"]] = copy.deepcopy(row)
            return copy.deepcopy(row)

    async def get_release(self, release_id: str) -> Optional[dict]:
        row = self.releases.get(release_id)
        return copy.deepcopy(row) if row else None

    async def find_release(self, resource_key: str, version: str, owner_id: str) -> Optional[dict]:
        for r in self.releases.values():
            if r["resource_key"] == resource_key and r["version"] == version and r["owner_id"] == owner_id:
                return copy.deepcopy(r)
        return None

    async def list_releases(self, resource_key: str, owner_id: str) -> list[dict]:
        rows = [copy.deepcopy(r) for r in self.releases.values()
                if r["resource_key"] == resource_key and r["owner_id"] == owner_id]
        return sorted(rows, key=lambda r: r["created_at"], reverse=True)

    async def get_environment(self, resource_key: str, stage: str, owner_id: str) -> Optional[dict]:
        row = self.environments.get((resource_key, stage, owner_id))
        return copy.deepcopy(row) if row else None

    async def set_environment(self, row: dict, expected_release: Optional[str]) -> dict:
        async with self._lock:
            key = (row["resource_key"], row["stage"], row["owner_id"])
            current = self.environments.get(key)
            if (current or {}).get("release_id") != expected_release:
                raise Conflict("The environment changed since it was read")
            self.environments[key] = copy.deepcopy(row)
            return copy.deepcopy(row)

    async def put_eval_result(self, row: dict) -> dict:
        self.evals.append(copy.deepcopy(row))
        return copy.deepcopy(row)

    async def eval_results(self, release_id: str) -> list[dict]:
        rows = [copy.deepcopy(r) for r in self.evals if r["release_id"] == release_id]
        return sorted(rows, key=lambda r: r["created_at"], reverse=True)
