"""Resource registry and releases (control plane).

A release is an immutable snapshot of a validated spec: its canonical
JSON, content hash and (for Applications) compiled plans. Environments
(dev, staging, production) point at releases; promoting moves a pointer,
never rebuilds. Production requires the release's eval suites to have
passed on that exact release. Rollback moves the pointer back.
"""
import time
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from . import compiler, spec
from .errors import Conflict
from .spec import Problem, SpecError
from .store import Store

HISTORY_LIMIT = 20


class GateRefused(Conflict):
    pass


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def public_release(row: dict) -> dict:
    return {k: row[k] for k in ("id", "resource_key", "kind", "version", "content_hash", "created_at", "created_by")
            if k in row} | {"ref": f"{row['resource_key']}@{row['version']}",
                            "workloads": sorted((row.get("plans") or {}).keys()),
                            "surfaces": row.get("surfaces") or {}}


class Registry:
    def __init__(self, store: Store, clock: Callable[[], float] = time.time):
        self.store = store
        self.clock = clock

    async def save_draft(self, doc: dict, *, owner_id: str, workspace_id: Optional[str]) -> dict:
        problems = spec.validate(doc)
        if problems:
            raise SpecError(problems)
        ref = spec.ref_of(doc)
        existing = await self.store.get_resource(ref.key, owner_id)
        now = _iso(self.clock())
        row = {"key": ref.key, "kind": ref.kind, "namespace": ref.namespace, "name": ref.name, "owner_id": owner_id,
               "workspace_id": workspace_id, "draft": doc, "draft_hash": spec.content_hash(doc),
               "latest_version": (existing or {}).get("latest_version"),
               "created_at": (existing or {}).get("created_at") or now, "updated_at": now}
        return await self.store.put_resource(row)

    async def release(self, doc: dict, *, owner_id: str, workspace_id: Optional[str], by: Optional[str]) -> dict:
        """Release a spec as its metadata.version. Releasing the same content
        again returns the existing release; different content under a used
        version is refused."""
        problems = spec.validate(doc)
        if problems:
            raise SpecError(problems)
        ref = spec.ref_of(doc)
        digest = spec.content_hash(doc)
        existing = await self.store.find_release(ref.key, ref.version, owner_id)
        if existing:
            if existing["content_hash"] == digest:
                return existing
            raise Conflict(f"{ref} is already released with different content. Releases can't change; "
                           "raise metadata.version")
        # Dependencies must exist first. Tests are checked at the production
        # gate instead: a suite targets the app release, so it comes after it.
        missing = []
        for i, text in enumerate(doc.get("dependencies") or []):
            dep = spec.parse_ref(text)
            if not await self.store.find_release(dep.key, dep.version, owner_id):
                missing.append(Problem(f"dependencies[{i}]", f"{dep} isn't released yet; release it first"))
        plans = {}
        surfaces = {}
        if doc["kind"] == "Application":
            plans, found = compiler.compile_all(doc)
            problems += found
            if plans:
                first = next(iter(plans.values()))
                surfaces = first["surfaces"]
        if doc["kind"] == "EvalSuite":
            target = spec.parse_ref(doc["spec"]["target"]["ref"])
            if target.kind != "Application":
                problems.append(Problem("spec.target.ref", "Eval suites target Application releases"))
        if problems or missing:
            raise SpecError(problems + missing)
        await self.save_draft(doc, owner_id=owner_id, workspace_id=workspace_id)
        row = {"id": str(uuid.uuid4()), "resource_key": ref.key, "kind": ref.kind, "version": ref.version,
               "owner_id": owner_id, "workspace_id": workspace_id, "spec": doc, "content_hash": digest,
               "plans": plans, "surfaces": surfaces, "created_by": by, "created_at": _iso(self.clock())}
        created = await self.store.create_release(row)
        resource = await self.store.get_resource(ref.key, owner_id)
        if resource:
            resource["latest_version"] = ref.version
            await self.store.put_resource(resource)
        return created

    async def promote(self, resource_key: str, version: str, stage: str, *, owner_id: str, by: Optional[str]) -> dict:
        if stage not in spec.ENVIRONMENTS:
            raise ValueError(f"Stage must be one of {', '.join(spec.ENVIRONMENTS)}")
        release = await self.store.find_release(resource_key, version, owner_id)
        if not release:
            raise KeyError(f"{resource_key}@{version} isn't released")
        if stage == "production":
            await self._check_gate(release)
        current = await self.store.get_environment(resource_key, stage, owner_id)
        if current and current["release_id"] == release["id"]:
            return current
        history = ([{"release_id": current["release_id"], "version": current["version"], "until": _iso(self.clock())}]
                   + (current.get("history") or []))[:HISTORY_LIMIT] if current else []
        row = {"resource_key": resource_key, "stage": stage, "owner_id": owner_id, "release_id": release["id"],
               "version": release["version"], "history": history, "updated_by": by, "updated_at": _iso(self.clock())}
        return await self.store.set_environment(row, (current or {}).get("release_id"))

    async def rollback(self, resource_key: str, stage: str, *, owner_id: str, by: Optional[str]) -> dict:
        current = await self.store.get_environment(resource_key, stage, owner_id)
        if not current or not current.get("history"):
            raise Conflict(f"{stage} has no earlier release to roll back to")
        previous, *rest = current["history"]
        row = {**current, "release_id": previous["release_id"], "version": previous["version"], "history": rest,
               "updated_by": by, "updated_at": _iso(self.clock())}
        return await self.store.set_environment(row, current["release_id"])

    async def resolve(self, resource_key: str, stage: str, *, owner_id: str) -> Optional[dict]:
        env = await self.store.get_environment(resource_key, stage, owner_id)
        return await self.store.get_release(env["release_id"]) if env else None

    async def _check_gate(self, release: dict) -> None:
        tests = release["spec"].get("tests") or []
        if not tests:
            return
        results = await self.store.eval_results(release["id"])
        failing = []
        for ref in tests:
            latest = next((r for r in results if r["suite"] == ref), None)
            if not latest:
                failing.append(f"{ref} hasn't been run on this release")
            elif not latest["passed"]:
                failing.append(f"{ref} failed ({latest['pass_rate']:.0%} passed, {latest['required']:.0%} needed)")
        if failing:
            raise GateRefused("Production needs passing evals: " + "; ".join(failing))
