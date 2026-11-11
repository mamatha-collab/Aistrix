"""OpenAI- and Anthropic-compatible model API (/v1/gateway/...).

Code that already uses the official SDKs, or a framework built on them
(LangGraph, CrewAI, the OpenAI Agents SDK, LlamaIndex, ...), points its
base URL at Aistrix and authenticates with an Aistrix API key:

    OpenAI(base_url="https://<aistrix>/v1/gateway/openai", api_key="ak_live_...")
    Anthropic(base_url="https://<aistrix>/v1/gateway/anthropic", api_key="ak_live_...")

Every call then goes through the platform's model gateway: the developer's
stored provider keys (none in their code), spending limits with a reservation
before the call and settlement after it, and a call log (metadata only, never
prompt or answer text) grouped by the optional X-Aistrix-Trace header.

Code jobs with "models": true get a run token (ak_run_…) instead of an API
key: it acts for the job's owner, logs under the job's trace
(code-task:<task id>), stops at the run's model budget and expires with
the sandbox.

Models: "claude/<model>", "openai/<model>", "gemini/<model>", "policy:fast|
balanced|best", or a bare model id whose provider is clear from its name.
Text streams as it arrives; tool calls arrive whole at the end of a stream.
Not supported: images and other non-text input, n > 1, logprobs.
"""
import asyncio
import json
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from . import spec
from .errors import BudgetExceeded, NodeError, PolicyRefused
from .gateway import CallContext

PREFIX = "/v1/gateway"
MAX_BODY = 4 * 1024 * 1024
MAX_TOKENS = 8192
DEFAULT_OPENAI_TOKENS = 1024
TRACE = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
LIST_LIMIT = 200
RUN_TOKEN = "ak_run_"


class CompatError(Exception):
    def __init__(self, status: int, message: str, kind: str = "invalid_request_error", code: Optional[str] = None):
        super().__init__(message)
        self.status, self.message, self.kind, self.code = status, message, kind, code


# ── Models ───────────────────────────────────────────────────────────────────

def model_ref(model: Any) -> str:
    """The gateway's model reference for what a client sent."""
    if not isinstance(model, str) or not model.strip():
        raise CompatError(400, "Give a model, for example claude/claude-sonnet-5-5 or policy:balanced")
    model = model.strip()
    if re.fullmatch(spec.MODEL_REF, model):
        return model
    lower = model.lower()
    provider = ("claude" if lower.startswith("claude") else
                "openai" if re.match(r"^(gpt|o[0-9]|chatgpt)", lower) else
                "gemini" if lower.startswith("gemini") else None)
    ref = f"{provider}/{model}" if provider else None
    if not ref or not re.fullmatch(spec.MODEL_REF, ref):
        raise CompatError(400, f"Unknown model {model!r}. Prefix it with its provider (claude/, openai/, gemini/) "
                               "or use policy:fast, policy:balanced or policy:best")
    return ref


def _tokens(value: Any, default: int) -> int:
    if value is None:
        return default
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise CompatError(400, "max_tokens must be a positive integer")
    return min(value, MAX_TOKENS)


def _temperature(value: Any) -> float:
    if value is None:
        return 1.0
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 2:
        raise CompatError(400, "temperature must be between 0 and 2")
    return float(min(value, 1.0))      # every provider accepts 0..1


def _text_of(content: Any, where: str) -> str:
    """Text content: a string or a list of text parts."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") in ("text", "input_text") and isinstance(part.get("text"), str):
                parts.append(part["text"])
            else:
                raise CompatError(400, f"{where}: only text content is supported through the gateway")
        return "".join(parts)
    raise CompatError(400, f"{where}: content must be text")


# ── OpenAI Chat Completions ──────────────────────────────────────────────────

def from_openai(body: dict) -> dict:
    """An OpenAI chat.completions request → the gateway's neutral turn."""
    if body.get("n") not in (None, 1):
        raise CompatError(400, "n > 1 isn't supported")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise CompatError(400, "messages must be a non-empty list")
    system, neutral = [], []
    for i, m in enumerate(messages):
        if not isinstance(m, dict):
            raise CompatError(400, f"messages[{i}] must be an object")
        role = m.get("role")
        if role in ("system", "developer"):
            system.append(_text_of(m.get("content"), f"messages[{i}]"))
        elif role == "user":
            neutral.append({"role": "user", "content": _text_of(m.get("content"), f"messages[{i}]")})
        elif role == "assistant":
            calls = []
            for c in m.get("tool_calls") or []:
                fn = c.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except ValueError:
                    args = {}
                calls.append({"id": str(c.get("id") or f"call_{i}_{len(calls)}"), "name": str(fn.get("name") or ""),
                              "arguments": args if isinstance(args, dict) else {}})
            neutral.append({"role": "assistant", "text": _text_of(m.get("content"), f"messages[{i}]"), "tool_calls": calls})
        elif role == "tool":
            result = {"id": str(m.get("tool_call_id") or ""), "name": "", "is_error": False,
                      "content": _text_of(m.get("content"), f"messages[{i}]")}
            if neutral and neutral[-1]["role"] == "tool":
                neutral[-1]["results"].append(result)
            else:
                neutral.append({"role": "tool", "results": [result]})
        else:
            raise CompatError(400, f"messages[{i}].role {role!r} isn't supported")
    if not any(m["role"] == "user" for m in neutral):
        raise CompatError(400, "Include at least one user message")
    tools = []
    if body.get("tool_choice") != "none":
        for t in body.get("tools") or []:
            fn = (t or {}).get("function") or {}
            if (t or {}).get("type") != "function" or not isinstance(fn.get("name"), str):
                raise CompatError(400, "Only function tools are supported")
            tools.append({"name": fn["name"], "description": fn.get("description") or "",
                          "parameters": fn.get("parameters") or {"type": "object", "properties": {}}})
    return {"model": model_ref(body.get("model")), "system": "\n\n".join(s for s in system if s),
            "messages": neutral, "tools": tools,
            "max_tokens": _tokens(body.get("max_completion_tokens", body.get("max_tokens")), DEFAULT_OPENAI_TOKENS),
            "temperature": _temperature(body.get("temperature")), "stream": bool(body.get("stream")),
            "usage_chunk": bool((body.get("stream_options") or {}).get("include_usage"))}


_OPENAI_FINISH = {"tool_use": "tool_calls", "tool_calls": "tool_calls", "max_tokens": "length", "length": "length",
                  "content_filter": "content_filter", "refusal": "content_filter"}


def openai_finish(stop: Optional[str], has_calls: bool) -> str:
    return "tool_calls" if has_calls else _OPENAI_FINISH.get(stop or "", "stop")


def openai_calls(turn) -> list:
    return [{"id": c["id"], "type": "function",
             "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}}
            for c in turn.tool_calls]


def openai_usage(turn) -> dict:
    i, o = turn.usage.get("input_tokens") or 0, turn.usage.get("output_tokens") or 0
    return {"prompt_tokens": i, "completion_tokens": o, "total_tokens": i + o}


def openai_response(turn, rid: str, model: str, created: int) -> dict:
    message = {"role": "assistant", "content": turn.text or None}
    if turn.tool_calls:
        message["tool_calls"] = openai_calls(turn)
    return {"id": rid, "object": "chat.completion", "created": created, "model": model,
            "choices": [{"index": 0, "message": message, "finish_reason": openai_finish(turn.stop, bool(turn.tool_calls))}],
            "usage": openai_usage(turn)}


# ── Anthropic Messages ───────────────────────────────────────────────────────

def from_anthropic(body: dict) -> dict:
    """An Anthropic messages request → the gateway's neutral turn."""
    if not isinstance(body.get("max_tokens"), int):
        raise CompatError(400, "max_tokens is required")
    system = body.get("system")
    if isinstance(system, list):
        system = _text_of(system, "system")
    elif system is not None and not isinstance(system, str):
        raise CompatError(400, "system must be text")
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise CompatError(400, "messages must be a non-empty list")
    neutral = []
    for i, m in enumerate(messages):
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant"):
            raise CompatError(400, f"messages[{i}].role must be user or assistant")
        content = m.get("content")
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content
        if not isinstance(blocks, list):
            raise CompatError(400, f"messages[{i}].content must be text or a list of blocks")
        texts, calls, results = [], [], []
        for b in blocks:
            kind = (b or {}).get("type")
            if kind == "text":
                texts.append(str(b.get("text") or ""))
            elif kind == "tool_use" and m["role"] == "assistant":
                calls.append({"id": str(b.get("id") or ""), "name": str(b.get("name") or ""),
                              "arguments": b.get("input") if isinstance(b.get("input"), dict) else {}})
            elif kind == "tool_result" and m["role"] == "user":
                results.append({"id": str(b.get("tool_use_id") or ""), "name": "", "is_error": bool(b.get("is_error")),
                                "content": _text_of(b.get("content"), f"messages[{i}] tool_result")})
            else:
                raise CompatError(400, f"messages[{i}]: {kind!r} blocks aren't supported through the gateway")
        if m["role"] == "assistant":
            neutral.append({"role": "assistant", "text": "".join(texts), "tool_calls": calls})
        else:
            if results:
                neutral.append({"role": "tool", "results": results})
            if texts:
                neutral.append({"role": "user", "content": "".join(texts)})
    tools = []
    choice = body.get("tool_choice") or {}
    if not (isinstance(choice, dict) and choice.get("type") == "none"):
        for t in body.get("tools") or []:
            if not isinstance(t, dict) or not isinstance(t.get("name"), str) or "input_schema" not in t:
                raise CompatError(400, "Only custom tools with a name and input_schema are supported")
            tools.append({"name": t["name"], "description": t.get("description") or "", "parameters": t["input_schema"]})
    return {"model": model_ref(body.get("model")), "system": system or "", "messages": neutral, "tools": tools,
            "max_tokens": _tokens(body["max_tokens"], MAX_TOKENS), "temperature": _temperature(body.get("temperature")),
            "stream": bool(body.get("stream"))}


_ANTHROPIC_STOP = {"tool_calls": "tool_use", "tool_use": "tool_use", "length": "max_tokens", "max_tokens": "max_tokens"}


def anthropic_stop(stop: Optional[str], has_calls: bool) -> str:
    return "tool_use" if has_calls else _ANTHROPIC_STOP.get(stop or "", "end_turn")


def anthropic_content(turn) -> list:
    content = [{"type": "text", "text": turn.text}] if turn.text else []
    return content + [{"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["arguments"]} for c in turn.tool_calls]


def anthropic_response(turn, rid: str, model: str) -> dict:
    return {"id": rid, "type": "message", "role": "assistant", "model": model, "content": anthropic_content(turn),
            "stop_reason": anthropic_stop(turn.stop, bool(turn.tool_calls)), "stop_sequence": None,
            "usage": {"input_tokens": turn.usage.get("input_tokens") or 0, "output_tokens": turn.usage.get("output_tokens") or 0}}


# ── Routes ───────────────────────────────────────────────────────────────────

def register_routes(app, host, gateway_of):
    """gateway_of() -> the platform's ModelGateway (shared with AEX runs)."""
    tasks: set = set()

    def later(coro):
        task = asyncio.create_task(coro)
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    def run_claims(raw: str) -> dict:
        if not host._fernet:
            raise CompatError(401, "Run tokens can't be checked on this server", "authentication_error")
        try:
            claims = json.loads(host._fernet.decrypt(raw[len(RUN_TOKEN):].encode("ascii")))
            assert isinstance(claims, dict) and {"o", "t", "b", "exp"} <= set(claims)
        except Exception:
            raise CompatError(401, "Invalid run token", "authentication_error")
        if claims["exp"] < time.time():
            raise CompatError(401, "This job's gateway token has expired", "authentication_error")
        return claims

    async def caller_of(request: Request):
        """(caller, run claims or None)."""
        auth = request.headers.get("authorization", "")
        key = request.headers.get("x-api-key", "").strip()        # what the Anthropic SDKs send
        bearer = auth.removeprefix("Bearer ").strip()
        token = bearer if bearer.startswith(RUN_TOKEN) else key if key.startswith(RUN_TOKEN) else None
        if token:
            claims = run_claims(token)
            return host.ApiCaller(user_id=claims["o"], via_key=True), claims
        if key and not auth:
            info = await host.resolve_developer_key(key) if key.startswith("ak_live_") else None
            if not info:
                raise CompatError(401, "Invalid or revoked API key", "authentication_error")
            ws = info["workspace_id"] or await host.personal_workspace_id(info["user_id"])
            caller = host.ApiCaller(user_id=info["user_id"], workspace_id=ws, app_ids=info["app_ids"], via_key=True)
        else:
            try:
                caller = await host.resolve_api_caller(request, required=True)
            except HTTPException as e:
                raise CompatError(e.status_code, str(e.detail), "authentication_error")
        if not caller.user_id:
            raise CompatError(401, "Pass an Aistrix API key", "authentication_error")
        if caller.app_ids:
            raise CompatError(403, "This API key is limited to specific apps; the model gateway needs an unrestricted key",
                              "permission_error")
        return caller, None

    async def scope_of(request: Request, run: Optional[dict], caller) -> Optional[str]:
        """The call's trace; for a job's run token, its own trace within its budget."""
        if not run:
            return trace_of(request)
        trace = f"code-task:{run['t']}"
        sb = host._service_client()
        if sb:
            rows = (await host.db(sb.table("gateway_calls").select("cost_usd").eq("owner_id", caller.user_id)
                                  .eq("trace", trace).limit(LIST_LIMIT))).data or []
            spent = sum(float(r.get("cost_usd") or 0) for r in rows)
            if spent >= float(run["b"]):
                raise CompatError(429, f"This job has used its ${float(run['b']):.2f} model budget", "rate_limit_error",
                                  "run_budget")
        return trace

    async def body_of(request: Request) -> dict:
        raw = await request.body()
        if len(raw) > MAX_BODY:
            raise CompatError(413, "Request too large")
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            raise CompatError(400, "Send a JSON body")
        if not isinstance(data, dict):
            raise CompatError(400, "Send a JSON object")
        return data

    def trace_of(request: Request) -> Optional[str]:
        value = request.headers.get("x-aistrix-trace")
        if value and not TRACE.fullmatch(value):
            raise CompatError(400, "X-Aistrix-Trace may use letters, digits and _ . : - (at most 100)")
        return value

    def failure(e: Exception) -> CompatError:
        if isinstance(e, CompatError):
            return e
        if isinstance(e, BudgetExceeded):
            return CompatError(429, e.message, "rate_limit_error", "spend_limit")
        if isinstance(e, PolicyRefused):
            return CompatError(400, e.message, "invalid_request_error", "policy_refused")
        if isinstance(e, NodeError):
            if e.code == "no_key":
                return CompatError(400, e.message, "invalid_request_error", "no_provider_key")
            if e.code in ("model_timeout", "model_unavailable"):
                return CompatError(503, e.message, "api_error", e.code)
            if e.code == "model_rate_limit":
                return CompatError(429, e.message, "rate_limit_error", e.code)
            if e.code == "model_bad_request":
                return CompatError(400, e.message, "invalid_request_error", e.code)
            return CompatError(502, e.message, "api_error", e.code)
        host.sentry_sdk.capture_exception(e)
        return CompatError(500, "The gateway failed unexpectedly", "api_error")

    async def log_call(caller, surface: str, req: dict, turn, started: float, error: Optional[CompatError], trace: Optional[str]):
        """Metadata only: never the prompt, the answer or tool arguments.
        Written before the response ends, so a job's budget sees every call."""
        sb = host._service_client()
        if not sb:
            return
        row = {"id": str(uuid.uuid4()), "owner_id": caller.user_id, "workspace_id": caller.workspace_id,
               "surface": surface, "trace": trace, "model_ref": req.get("model"),
               "provider": getattr(turn, "provider", None), "model": getattr(turn, "model", None),
               "input_tokens": (turn.usage.get("input_tokens") if turn else None),
               "output_tokens": (turn.usage.get("output_tokens") if turn else None),
               "cost_usd": getattr(turn, "cost_usd", None), "tool_calls": len(turn.tool_calls) if turn else 0,
               "stream": bool(req.get("stream")), "status": "error" if error else "ok",
               "error_code": (error.code or error.kind) if error else None,
               "latency_ms": int((time.monotonic() - started) * 1000),
               "created_at": datetime.now(timezone.utc).isoformat()}

        try:
            await host.db(sb.table("gateway_calls").insert(row))
        except Exception as e:
            print(f"gateway call log failed: {type(e).__name__}")

    async def call(caller, req: dict, on_token=None):
        ctx = CallContext(owner_id=caller.user_id, workspace_id=caller.workspace_id, resource="the model gateway",
                          budget_remaining=None, on_token=on_token)
        return await gateway_of().converse(ctx, model_ref=req["model"], providers=None, system=req["system"],
                                           messages=req["messages"], tools=req["tools"], max_tokens=req["max_tokens"],
                                           temperature=req["temperature"], stream=on_token is not None)

    def openai_error(e: CompatError) -> JSONResponse:
        return JSONResponse(status_code=e.status, content={"error": {"message": e.message, "type": e.kind, "code": e.code}})

    def anthropic_error(e: CompatError) -> JSONResponse:
        return JSONResponse(status_code=e.status, content={"type": "error", "error": {"type": e.kind, "message": e.message}})

    def sse(data) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    def streamed(caller, surface, req, trace, started, events):
        """Run the call in the background; events(queue item) renders SSE."""
        queue: asyncio.Queue = asyncio.Queue()

        async def on_token(text):
            await queue.put(("text", text))

        async def drive():
            turn, error = None, None
            try:
                turn = await call(caller, req, on_token)
                await queue.put(("done", turn))
            except Exception as e:
                error = failure(e)
                await queue.put(("error", error))
            finally:
                await log_call(caller, surface, req, turn, started, error, trace)
                await queue.put(None)
        later(drive())

        async def body():
            state: dict = {}
            while True:
                item = await queue.get()
                if item is None:
                    return
                for chunk in events(item, state):
                    yield chunk
        return StreamingResponse(body(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})

    # OpenAI ──────────────────────────────────────────────────────────────────

    @app.get(f"{PREFIX}/openai/models")
    async def compat_openai_models(request: Request):
        try:
            await caller_of(request)
        except CompatError as e:
            return openai_error(e)
        from .gateway import POLICY_MODELS
        ids = sorted({f"{p}/{m}" for p, tiers in POLICY_MODELS.items() for m in tiers.values()}
                     | {f"policy:{t}" for t in ("fast", "balanced", "best")})
        return {"object": "list", "data": [{"id": i, "object": "model", "created": 0, "owned_by": "aistrix"} for i in ids]}

    @app.post(f"{PREFIX}/openai/chat/completions")
    async def compat_openai_chat(request: Request):
        started = time.monotonic()
        try:
            caller, run = await caller_of(request)
            trace = await scope_of(request, run, caller)
            req = from_openai(await body_of(request))
        except CompatError as e:
            return openai_error(e)
        rid, created = f"chatcmpl-{uuid.uuid4().hex}", int(time.time())
        model = req["model"]
        if not req["stream"]:
            turn, error = None, None
            try:
                turn = await call(caller, req)
            except Exception as e:
                error = failure(e)
            await log_call(caller, "openai", req, turn, started, error, trace)
            return openai_error(error) if error else openai_response(turn, rid, model, created)

        def chunk(delta: dict, finish=None) -> dict:
            return {"id": rid, "object": "chat.completion.chunk", "created": created, "model": model,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}

        def events(item, state):
            kind, value = item
            if not state.get("started"):
                state["started"] = True
                yield sse(chunk({"role": "assistant", "content": ""}))
            if kind == "text":
                yield sse(chunk({"content": value}))
            elif kind == "done":
                if value.tool_calls:
                    yield sse(chunk({"tool_calls": [{"index": i, **c} for i, c in enumerate(openai_calls(value))]}))
                yield sse(chunk({}, openai_finish(value.stop, bool(value.tool_calls))))
                if req["usage_chunk"]:
                    yield sse({"id": rid, "object": "chat.completion.chunk", "created": created, "model": model,
                               "choices": [], "usage": openai_usage(value)})
                yield "data: [DONE]\n\n"
            else:
                yield sse({"error": {"message": value.message, "type": value.kind, "code": value.code}})
                yield "data: [DONE]\n\n"
        return streamed(caller, "openai", req, trace, started, events)

    # Anthropic ───────────────────────────────────────────────────────────────

    @app.post(f"{PREFIX}/anthropic/v1/messages")
    async def compat_anthropic_messages(request: Request):
        started = time.monotonic()
        try:
            caller, run = await caller_of(request)
            trace = await scope_of(request, run, caller)
            req = from_anthropic(await body_of(request))
        except CompatError as e:
            return anthropic_error(e)
        rid, model = f"msg_{uuid.uuid4().hex}", req["model"]
        if not req["stream"]:
            turn, error = None, None
            try:
                turn = await call(caller, req)
            except Exception as e:
                error = failure(e)
            await log_call(caller, "anthropic", req, turn, started, error, trace)
            return anthropic_error(error) if error else anthropic_response(turn, rid, model)

        def event(name: str, data: dict) -> str:
            return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

        def events(item, state):
            kind, value = item
            if not state.get("started"):
                state.update(started=True, index=0, text_open=False)
                yield event("message_start", {"type": "message_start", "message": {
                    "id": rid, "type": "message", "role": "assistant", "model": model, "content": [],
                    "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 0, "output_tokens": 0}}})
            if kind == "text":
                if not state["text_open"]:
                    state["text_open"] = True
                    yield event("content_block_start", {"type": "content_block_start", "index": state["index"],
                                                        "content_block": {"type": "text", "text": ""}})
                yield event("content_block_delta", {"type": "content_block_delta", "index": state["index"],
                                                    "delta": {"type": "text_delta", "text": value}})
            elif kind == "done":
                if state["text_open"]:
                    yield event("content_block_stop", {"type": "content_block_stop", "index": state["index"]})
                    state["index"] += 1
                for c in value.tool_calls:
                    i = state["index"]
                    yield event("content_block_start", {"type": "content_block_start", "index": i, "content_block":
                                                        {"type": "tool_use", "id": c["id"], "name": c["name"], "input": {}}})
                    yield event("content_block_delta", {"type": "content_block_delta", "index": i, "delta":
                                                        {"type": "input_json_delta",
                                                         "partial_json": json.dumps(c["arguments"], ensure_ascii=False)}})
                    yield event("content_block_stop", {"type": "content_block_stop", "index": i})
                    state["index"] += 1
                yield event("message_delta", {"type": "message_delta",
                                              "delta": {"stop_reason": anthropic_stop(value.stop, bool(value.tool_calls)),
                                                        "stop_sequence": None},
                                              "usage": {"input_tokens": value.usage.get("input_tokens") or 0,
                                                        "output_tokens": value.usage.get("output_tokens") or 0}})
                yield event("message_stop", {"type": "message_stop"})
            else:
                yield event("error", {"type": "error", "error": {"type": value.kind, "message": value.message}})
        return streamed(caller, "anthropic", req, trace, started, events)

    # Call log ────────────────────────────────────────────────────────────────

    @app.get(f"{PREFIX}/calls")
    async def compat_calls(request: Request, trace: Optional[str] = None, limit: int = 50):
        """The caller's gateway calls, newest first; ?trace= for one agent run."""
        try:
            caller, run = await caller_of(request)
            if run:
                raise CompatError(403, "Run tokens can only call models", "permission_error")
            if trace and not TRACE.fullmatch(trace):
                raise CompatError(400, "Not a trace id")
        except CompatError as e:
            return openai_error(e)
        sb = host._service_client()
        if not sb:
            raise HTTPException(503, "Gateway storage isn't configured on this server")
        q = sb.table("gateway_calls").select("*").eq("owner_id", caller.user_id)
        if trace:
            q = q.eq("trace", trace)
        rows = (await host.db(q.order("created_at", desc=True).limit(max(1, min(limit, LIST_LIMIT))))).data or []
        total = round(sum(r.get("cost_usd") or 0 for r in rows), 6)
        return {"calls": rows, "cost_usd": total}

    return tasks
