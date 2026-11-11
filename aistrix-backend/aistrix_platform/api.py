"""Platform API, /v1/platform/... One set of endpoints for Studio, the CLI,
the SDKs and agents: validate and plan specs, release resources, promote
and roll back environments, run eval suites, invoke releases and follow
their runs.

register_routes(app, host) wires the AEX engine to main.py's real pieces:
the developer's own provider keys, spend reservations, the outbound HTTP
rules, document extractors, code workers and encrypted secrets.
"""
import asyncio
import functools
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

import outbound
import spend_guard

from . import compiler, evals, node_types, spec
from .errors import Conflict, InputError, LeaseHeld, NodeError
from .gateway import CallContext, ModelGateway
from .nodes import HttpResponse, Services
from .orchestrator import TERMINAL, Engine
from .registry import GateRefused, Registry, public_release
from .spec import SpecError
from .supabase_store import SupabaseStore

PREFIX = "/v1/platform"
MAX_BODY = spec.MAX_SPEC_BYTES * 2 + 20 * 1024 * 1024        # specs, plus run inputs with files
RESUME_SECONDS = float(os.getenv("PLATFORM_RESUME_SECONDS", "30"))
WAIT_SECONDS = 120
CODE_POLL_SECONDS = 1.0


class MainProviders:
    """The gateway's provider adapter: main.py's streaming functions."""

    def __init__(self, host):
        self.host = host

    async def stream(self, *, provider, model, api_key, system, prompt, max_tokens, temperature, usage):
        fn = self.host.stream_fn_for(provider)
        async for token in fn(system, prompt, model, api_key, max_tokens, temperature, usage):
            yield token


def _public_run(run: dict) -> dict:
    out = {k: v for k, v in run.items() if k not in ("plan", "mocks")}
    out["steps"] = {nid: {k: v for k, v in step.items() if k != "idempotencyKey"} for nid, step in run["steps"].items()}
    return out


def _problems(problems) -> list[dict]:
    return [p.as_dict() for p in problems]


def build(host):
    """(engine, registry) on Supabase, with main.py's providers and services."""
    store = SupabaseStore(host._service_client, host.db, time.time)

    async def key_for(ctx: CallContext, provider: str) -> Optional[str]:
        key = await host.fetch_user_api_key_by_id(ctx.owner_id, provider) if ctx.owner_id else None
        if not key and host.PLATFORM_KEYS_FOR_DEVELOPER_APPS:
            key = host.platform_key(provider)
        return key

    async def reserve(ctx: CallContext, provider: str, model: str, amount: Optional[float]):
        rid, refusal = await host.reserve_run_spend(payer="own", key_owner=ctx.owner_id, workspace_id=ctx.workspace_id,
                                                    app_id=None, model=model, amount=amount)
        if refusal:
            if refusal.get("code") == "spend_unavailable":
                return None, {"message": "Spending controls are unavailable right now; try again shortly"}
            return None, {"message": spend_guard.refusal_message(refusal, payer="own", label=ctx.resource)}
        return rid, None

    async def settle(rid, actual, outcome):
        host.settle_run_spend(rid, actual, outcome)

    gateway = ModelGateway(MainProviders(host), prices=host.MODEL_PRICES, key_for=key_for, reserve=reserve, settle=settle)

    async def document_text(name: str, mime: str, data: bytes) -> str:
        lower = (name or "").lower()
        if lower.endswith(".pdf") or mime == "application/pdf":
            return await asyncio.to_thread(host._extract_pdf, data)
        if lower.endswith(".docx"):
            return await asyncio.to_thread(host._extract_docx, data)
        if lower.endswith(".xlsx"):
            return await asyncio.to_thread(host._extract_xlsx, data)
        from .nodes import _plain_text
        return _plain_text(name, mime, data)

    async def http(method, url, headers, body, allowed_hosts, timeout, owner_id=None):
        if url.startswith(node_types.TEST_DESTINATION):
            # The owner's private test destination, handled in-process like
            # workflow API steps: the body is captured, headers are not kept.
            if not owner_id:
                raise NodeError("Test destinations need a signed-in owner")
            name = url[len(node_types.TEST_DESTINATION):]
            status, payload = await host.handle_test_destination(
                method, owner_id, host.test_destination_token(owner_id), name,
                body=json.dumps(body if body is not None else {}).encode("utf-8"), content_type="application/json")
            return HttpResponse(status, payload)
        kwargs = {"json": body} if body is not None else {}
        resp = await outbound.fetch_safely(method, url, timeout=min(timeout, 60), max_redirects=0 if method != "GET" else 3,
                                           allowed_hosts=allowed_hosts, headers=headers, **kwargs)
        try:
            parsed = resp.json()
        except ValueError:
            parsed = resp.text[:20000]
        return HttpResponse(resp.status_code, parsed, dict(resp.headers))

    async def secrets(owner_id, resource_key, names):
        if not owner_id or not names:
            return {}
        rows = (await host.db(host._service_client().table("platform_secrets").select("key,encrypted_value")
                              .eq("owner_id", owner_id).eq("resource_key", resource_key).in_("key", names))).data or []
        found = {}
        for r in rows:
            try:
                found[r["key"]] = host._decrypt(r["encrypted_value"])
            except Exception:
                print(f"platform secret {r.get('key')} could not be decrypted")
        return found

    run_code_app = None
    if os.getenv("CODE_APPS_ENABLED") == "1":
        async def run_code_app(app_id, owner_id, payload, timeout):
            sb = host._service_client()
            try:
                params = {"p_app": app_id, "p_user": owner_id, "p_kind": "run", "p_source": None, "p_input": payload}
                managed = os.getenv("CODE_EXECUTION_PROVIDER", "dedicated") == "e2b"
                if managed:
                    allowance = int(os.getenv("E2B_DAILY_RUNTIME_SECONDS", "3600"))
                    if not 1 <= allowance <= 86400:
                        raise ValueError("Invalid managed runtime allowance")
                    params["p_daily_seconds"] = allowance
                rows = (await host.db(sb.rpc("enqueue_e2b_task" if managed else "enqueue_code_task", params))).data
            except Exception as e:
                raise NodeError(f"The code job couldn't be queued: {str(e)[:200]}")
            task_id = rows[0]["id"]
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                await asyncio.sleep(CODE_POLL_SECONDS)
                task = ((await host.db(sb.table("code_tasks").select("status,result,error").eq("id", task_id).limit(1))).data or [{}])[0]
                if task.get("status") == "succeeded":
                    return task.get("result")
                if task.get("status") in ("failed", "cancelled"):
                    raise NodeError(f"The code job {task['status']}: {(task.get('error') or '')[:300]}")
                if task.get("status") == "interrupted":
                    # Code jobs have no network access, so running again is safe.
                    raise NodeError("The code worker stopped during the job", transient=True)
            raise NodeError(f"The code job didn't finish within {timeout}s", transient=True)

    services = Services(document_text=document_text, http=http, secrets=secrets, run_code_app=run_code_app)
    engine = Engine(store, gateway, services)
    return engine, Registry(store)


def register_routes(app, host):
    state: dict[str, Any] = {}
    tasks: set = set()

    def parts():
        if "engine" not in state:
            state["engine"], state["registry"] = build(host)
        return state["engine"], state["registry"]

    def background(coro):
        task = asyncio.create_task(coro)
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    async def execute_quietly(run_id: str):
        engine, _ = parts()
        try:
            await engine.execute(run_id)
        except LeaseHeld:
            pass
        except Exception as e:
            host.sentry_sdk.capture_exception(e)
            print(f"platform run {run_id} stopped: {type(e).__name__}")

    async def caller_of(request: Request):
        caller = await host.resolve_api_caller(request, required=True)
        if not caller.user_id:
            raise HTTPException(401, "Sign in or pass an API key")
        if caller.app_ids:
            raise HTTPException(403, "This API key is limited to specific apps; platform resources need an unrestricted key")
        if not host._service_client():
            raise HTTPException(503, "Platform storage isn't configured on this server")
        return caller

    async def body_of(request: Request) -> dict:
        raw = await request.body()
        if len(raw) > MAX_BODY:
            raise HTTPException(413, "Request too large")
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            raise HTTPException(422, "Send a JSON body")
        if not isinstance(data, dict):
            raise HTTPException(422, "Send a JSON object")
        return data

    def doc_of(body: dict) -> dict:
        source = body.get("spec")
        if isinstance(source, dict):
            return source
        if isinstance(source, str):
            try:
                return spec.parse_text(source, body.get("format"))
            except Exception as e:
                raise SpecError([spec.Problem("", f"Could not read the spec: {str(e)[:300]}")])
        raise HTTPException(422, "Send the spec as text (YAML or JSON) or as an object in \"spec\"")

    def errors(fn):
        @functools.wraps(fn)          # FastAPI reads the endpoint's own signature through __wrapped__
        async def wrapped(*args, **kwargs):
            try:
                return await fn(*args, **kwargs)
            except SpecError as e:
                return JSONResponse(status_code=422, content={"detail": "The spec has problems", "problems": _problems(e.problems)})
            except InputError as e:
                return JSONResponse(status_code=422, content={"detail": "The input doesn't match the workload's input schema",
                                                              "problems": _problems(e.problems)})
            except GateRefused as e:
                return JSONResponse(status_code=409, content={"detail": str(e), "code": "gate_refused"})
            except (Conflict, LeaseHeld) as e:
                return JSONResponse(status_code=409, content={"detail": str(e)})
            except evals.EvalRefused as e:
                return JSONResponse(status_code=422, content={"detail": str(e)})
            except KeyError as e:
                return JSONResponse(status_code=404, content={"detail": str(e.args[0]) if e.args else "Not found"})
        return wrapped

    def key_of(kind: str, namespace: str, name: str) -> str:
        key = f"{kind}/{namespace}/{name}"
        try:
            spec.parse_ref(key + "@1")
        except ValueError:
            raise HTTPException(404, "Not a resource")
        return key

    async def owned_run(run_id: str, caller) -> dict:
        engine, _ = parts()
        try:
            run = await engine.store.get_run(run_id)
        except Exception:
            run = None
        if not run or run.get("owner_id") != caller.user_id:
            raise HTTPException(404, "Run not found")
        return run

    # ── Catalog and specs ─────────────────────────────────────────────────────

    @app.get(f"{PREFIX}/nodes")
    async def platform_nodes():
        return {"nodes": node_types.describe(), "kinds": {"implemented": list(spec.IMPLEMENTED_KINDS), "all": list(spec.KINDS)},
                "apiVersion": spec.API_VERSION}

    @app.post(f"{PREFIX}/specs/validate")
    async def platform_validate(request: Request):
        await host.resolve_api_caller(request, required=True)
        body = await body_of(request)
        try:
            doc = doc_of(body)
        except SpecError as e:
            return {"valid": False, "problems": _problems(e.problems)}
        problems = spec.validate(doc)
        out = {"valid": not problems, "problems": _problems(problems)}
        if not problems:
            out.update(ref=str(spec.ref_of(doc)), contentHash=spec.content_hash(doc))
        return out

    @app.post(f"{PREFIX}/specs/plan")
    async def platform_plan(request: Request):
        await host.resolve_api_caller(request, required=True)
        body = await body_of(request)
        target = body.get("target") or "hosted"
        if target not in ("hosted", "local"):
            raise HTTPException(422, "target is hosted or local")
        try:
            doc = doc_of(body)
        except SpecError as e:
            return {"plans": {}, "problems": _problems(e.problems)}
        if body.get("workload"):
            plan, problems = compiler.compile_workload(doc, body["workload"], target=target)
            plans = {plan["workload"]: plan} if plan else {}
        else:
            plans, problems = compiler.compile_all(doc, target=target)
        return {"plans": plans, "problems": _problems(problems)}

    # ── Resources, releases, environments ─────────────────────────────────────

    @app.get(f"{PREFIX}/resources")
    @errors
    async def platform_resources(request: Request):
        caller = await caller_of(request)
        _, registry = parts()
        return {"resources": await registry.store.list_resources(caller.user_id)}

    @app.get(PREFIX + "/resources/{kind}/{namespace}/{name}")
    @errors
    async def platform_resource(kind: str, namespace: str, name: str, request: Request):
        caller = await caller_of(request)
        _, registry = parts()
        key = key_of(kind, namespace, name)
        resource = await registry.store.get_resource(key, caller.user_id)
        if not resource:
            raise HTTPException(404, "Resource not found")
        releases = await registry.store.list_releases(key, caller.user_id)
        envs = {}
        for stage in spec.ENVIRONMENTS:
            env = await registry.store.get_environment(key, stage, caller.user_id)
            if env:
                envs[stage] = {k: env[k] for k in ("release_id", "version", "history", "updated_at", "updated_by") if k in env}
        return {"resource": resource, "releases": [public_release(r) for r in releases], "environments": envs}

    @app.post(f"{PREFIX}/releases", status_code=201)
    @errors
    async def platform_release(request: Request):
        """Release a spec at its metadata.version, optionally promoting it."""
        caller = await caller_of(request)
        _, registry = parts()
        body = await body_of(request)
        doc = doc_of(body)
        release = await registry.release(doc, owner_id=caller.user_id, workspace_id=caller.workspace_id, by=caller.user_id)
        out = {"release": public_release(release)}
        if body.get("promote"):
            env = await registry.promote(release["resource_key"], release["version"], body["promote"],
                                         owner_id=caller.user_id, by=caller.user_id)
            out["environment"] = {"stage": env["stage"], "version": env["version"]}
        return out

    @app.post(PREFIX + "/resources/{kind}/{namespace}/{name}/environments/{stage}/promote")
    @errors
    async def platform_promote(kind: str, namespace: str, name: str, stage: str, request: Request):
        caller = await caller_of(request)
        _, registry = parts()
        body = await body_of(request)
        if not isinstance(body.get("version"), str):
            raise HTTPException(422, "Give the version to promote")
        try:
            env = await registry.promote(key_of(kind, namespace, name), body["version"], stage,
                                         owner_id=caller.user_id, by=caller.user_id)
        except ValueError as e:
            raise HTTPException(422, str(e))
        return {"environment": env}

    @app.post(PREFIX + "/resources/{kind}/{namespace}/{name}/environments/{stage}/rollback")
    @errors
    async def platform_rollback(kind: str, namespace: str, name: str, stage: str, request: Request):
        caller = await caller_of(request)
        _, registry = parts()
        return {"environment": await registry.rollback(key_of(kind, namespace, name), stage,
                                                       owner_id=caller.user_id, by=caller.user_id)}

    # ── Secrets ───────────────────────────────────────────────────────────────

    @app.get(PREFIX + "/resources/{kind}/{namespace}/{name}/secrets")
    @errors
    async def platform_secret_names(kind: str, namespace: str, name: str, request: Request):
        caller = await caller_of(request)
        rows = (await host.db(host._service_client().table("platform_secrets").select("key,last4,updated_at")
                              .eq("owner_id", caller.user_id).eq("resource_key", key_of(kind, namespace, name)))).data or []
        return {"secrets": rows}

    @app.put(PREFIX + "/resources/{kind}/{namespace}/{name}/secrets/{secret}")
    @errors
    async def platform_put_secret(kind: str, namespace: str, name: str, secret: str, request: Request):
        caller = await caller_of(request)
        if not host._fernet:
            raise HTTPException(503, "Secret storage needs the server's encryption key")
        if not re.fullmatch(spec.SECRET_NAME, secret):
            raise HTTPException(422, "Secret names are UPPER_CASE letters, digits and _")
        body = await body_of(request)
        value = body.get("value")
        if not isinstance(value, str) or not value or len(value) > 8000:
            raise HTTPException(422, "Give the secret's value (at most 8000 characters)")
        row = {"owner_id": caller.user_id, "resource_key": key_of(kind, namespace, name), "key": secret,
               "encrypted_value": host._encrypt(value), "last4": value[-4:], "updated_at": datetime.now(timezone.utc).isoformat()}
        await host.db(host._service_client().table("platform_secrets").upsert(row, on_conflict="owner_id,resource_key,key"))
        return {"secret": {"key": secret, "last4": row["last4"]}}

    @app.delete(PREFIX + "/resources/{kind}/{namespace}/{name}/secrets/{secret}")
    @errors
    async def platform_delete_secret(kind: str, namespace: str, name: str, secret: str, request: Request):
        caller = await caller_of(request)
        await host.db(host._service_client().table("platform_secrets").delete().eq("owner_id", caller.user_id)
                      .eq("resource_key", key_of(kind, namespace, name)).eq("key", secret))
        return {"ok": True}

    # ── Evals ─────────────────────────────────────────────────────────────────

    @app.post(f"{PREFIX}/evals")
    @errors
    async def platform_run_eval(request: Request):
        """Run a released eval suite against its target release (real model calls)."""
        caller = await caller_of(request)
        engine, registry = parts()
        body = await body_of(request)
        try:
            ref = spec.parse_ref(body.get("suite") or "")
        except ValueError as e:
            raise HTTPException(422, str(e))
        suite = await registry.store.find_release(ref.key, ref.version, caller.user_id)
        if not suite or suite["kind"] != "EvalSuite":
            raise HTTPException(404, f"{ref} isn't a released eval suite")
        result = await evals.run_suite(engine, registry, suite, owner_id=caller.user_id, workspace_id=caller.workspace_id)
        return {"result": result}

    @app.get(PREFIX + "/releases/{release_id}/evals")
    @errors
    async def platform_eval_results(release_id: str, request: Request):
        caller = await caller_of(request)
        _, registry = parts()
        release = await registry.store.get_release(release_id)
        if not release or release["owner_id"] != caller.user_id:
            raise HTTPException(404, "Release not found")
        return {"results": await registry.store.eval_results(release_id)}

    # ── Runs ──────────────────────────────────────────────────────────────────

    @app.post(PREFIX + "/apps/{namespace}/{name}/runs")
    @errors
    async def platform_invoke(namespace: str, name: str, request: Request):
        """Run an Application release. Picks the environment's release (default
        production) or an exact version. wait=true returns the finished run;
        Accept: text/event-stream streams its events."""
        caller = await caller_of(request)
        engine, registry = parts()
        body = await body_of(request)
        key = key_of("Application", namespace, name)
        stage = body.get("environment") or "production"
        if body.get("version"):
            release = await registry.store.find_release(key, str(body["version"]), caller.user_id)
        else:
            release = await registry.resolve(key, stage, owner_id=caller.user_id)
        if not release:
            raise HTTPException(404, f"Nothing is deployed to {stage} for {key}" if not body.get("version")
                                else f"{key}@{body['version']} isn't released")
        plans = release.get("plans") or {}
        workload = body.get("workload") or (next(iter(plans)) if len(plans) == 1 else None)
        if workload not in plans:
            raise HTTPException(422, f"Pick a workload: {', '.join(sorted(plans))}")
        granted = (release.get("surfaces") or {}).get("granted") or []
        if not ({"rest", "sdk"} & set(granted)):
            raise HTTPException(403, "This release doesn't expose the REST API or SDK surface")
        limit = (release["spec"].get("policies") or {}).get("maxConcurrentRuns")
        if limit:
            active = [r for r in await engine.store.list_runs(owner_id=caller.user_id, resource=key, limit=200)
                      if r["status"] in ("queued", "running")]
            if len(active) >= limit:
                raise HTTPException(429, f"{key} already has {len(active)} runs in progress (limit {limit})")
        run = await engine.start(plans[workload], body.get("input"), owner_id=caller.user_id,
                                 workspace_id=caller.workspace_id, release_id=release["id"],
                                 environment=None if body.get("version") else stage,
                                 trigger="sdk" if request.headers.get("x-aistrix-client") == "sdk" else "api")
        if "text/event-stream" in (request.headers.get("accept") or ""):
            queue: asyncio.Queue = asyncio.Queue()

            async def sink(event):
                await queue.put(event)

            async def drive():
                try:
                    final = await engine.execute(run["id"], on_event=sink)
                    await queue.put({"type": "run.state", "data": _public_run(final)})
                except Exception as e:
                    await queue.put({"type": "run.error", "data": {"error": type(e).__name__}})
                finally:
                    await queue.put(None)

            background(drive())

            async def stream():
                while True:
                    event = await queue.get()
                    if event is None:
                        return
                    yield f"data: {json.dumps(event, default=str)}\n\n"
            return StreamingResponse(stream(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-store", "X-Run-Id": run["id"]})
        if body.get("wait"):
            try:
                final = await asyncio.wait_for(engine.execute(run["id"]), timeout=WAIT_SECONDS)
            except asyncio.TimeoutError:
                final = await engine.store.get_run(run["id"])
            return {"run": _public_run(final)}
        background(execute_quietly(run["id"]))
        return JSONResponse(status_code=202, content={"run": _public_run(run)})

    @app.get(f"{PREFIX}/runs")
    @errors
    async def platform_runs(request: Request, resource: Optional[str] = None, limit: int = 50):
        caller = await caller_of(request)
        engine, _ = parts()
        return {"runs": await engine.store.list_runs(owner_id=caller.user_id, resource=resource, limit=max(1, min(limit, 200)))}

    @app.get(PREFIX + "/runs/{run_id}")
    @errors
    async def platform_run(run_id: str, request: Request):
        caller = await caller_of(request)
        return {"run": _public_run(await owned_run(run_id, caller))}

    @app.get(PREFIX + "/runs/{run_id}/events")
    @errors
    async def platform_run_events(run_id: str, request: Request, after: int = 0):
        caller = await caller_of(request)
        await owned_run(run_id, caller)
        engine, _ = parts()
        return {"events": await engine.store.events(run_id, after=max(0, after))}

    @app.post(PREFIX + "/runs/{run_id}/approvals/{node_id}")
    @errors
    async def platform_approve(run_id: str, node_id: str, request: Request):
        caller = await caller_of(request)
        await owned_run(run_id, caller)
        engine, _ = parts()
        body = await body_of(request)
        if not isinstance(body.get("approved"), bool):
            raise HTTPException(422, "Send approved: true or false")
        run = await engine.approve(run_id, node_id, approved=body["approved"], by=caller.user_id,
                                   note=str(body.get("note") or ""))
        if body.get("wait"):
            run = await asyncio.wait_for(engine.execute(run_id), timeout=WAIT_SECONDS)
        else:
            background(execute_quietly(run_id))
        return {"run": _public_run(run)}

    @app.post(PREFIX + "/runs/{run_id}/cancel")
    @errors
    async def platform_cancel(run_id: str, request: Request):
        caller = await caller_of(request)
        await owned_run(run_id, caller)
        engine, _ = parts()
        return {"run": _public_run(await engine.cancel(run_id))}

    @app.post(PREFIX + "/runs/{run_id}/resume")
    @errors
    async def platform_resume(run_id: str, request: Request):
        """Continue a run whose worker stopped. Finished steps aren't repeated."""
        caller = await caller_of(request)
        run = await owned_run(run_id, caller)
        if run["status"] in TERMINAL or run["status"] == "waiting_approval":
            return {"run": _public_run(run)}
        engine, _ = parts()
        return {"run": _public_run(await asyncio.wait_for(engine.execute(run_id), timeout=WAIT_SECONDS))}

    async def supervisor():
        """Resume runs whose worker stopped (restart, crash, lost lease)."""
        if RESUME_SECONDS <= 0:
            return
        while True:
            await asyncio.sleep(RESUME_SECONDS)
            if not host._service_client():
                continue
            try:
                engine, _ = parts()
                for run_id in await engine.store.resumable_runs():
                    background(execute_quietly(run_id))
            except Exception as e:
                print(f"platform resume sweep failed: {type(e).__name__}")

    app.state.platform_supervisor = supervisor
    app.state.platform_parts = parts
    return supervisor
