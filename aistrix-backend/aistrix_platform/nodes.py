"""Node runtimes (AEX data plane). Each node type from node_types.py has
one async function here. Outside access (documents, code workers, HTTP,
secrets) comes through Services, which main.py fills with the real
implementations and tests fill with fakes. human.approve is handled by the
orchestrator itself, since it pauses the run instead of computing a value.
"""
import base64
import binascii
import io
import json
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from . import spec
from .errors import NodeError
from .gateway import CallContext, ModelGateway

MAX_TEXT = 400_000
STRUCTURED_SYSTEM = ("Respond with one JSON value only, no prose and no code fences. "
                     "It must match this JSON Schema:\n{schema}")


def _plain_text(name: str, mime: str, data: bytes) -> str:
    """Fallback extraction for the local runner and tests: text formats and
    PDFs. The backend injects main.py's extractors (PDF with OCR, Word, Excel)."""
    lower = (name or "").lower()
    if lower.endswith(".pdf") or mime == "application/pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            raise NodeError("PDF support needs the pypdf package")
        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((page.extract_text() or "") for page in reader.pages)
        except Exception:
            raise NodeError("The PDF couldn't be read")
    if lower.endswith((".txt", ".md", ".csv", ".json", ".tsv", ".xml", ".html")) or (mime or "").startswith("text/"):
        return data.decode("utf-8", errors="replace")
    raise NodeError(f"Can't read {name or 'this file'} here; supported: PDF and text files")


@dataclass
class HttpResponse:
    status: int
    body: Any
    headers: dict = field(default_factory=dict)


@dataclass
class Services:
    # (name, mime, bytes) -> text
    document_text: Callable[[str, str, bytes], Awaitable[str]] = None
    # (code app id, owner id, input object, timeout seconds) -> result object
    run_code_app: Optional[Callable[[str, Optional[str], Any, int], Awaitable[Any]]] = None
    # (entry path, input object, timeout seconds) -> result object; local runner only
    run_local_code: Optional[Callable[[str, Any, int], Awaitable[Any]]] = None
    # (method, url, headers, json body or None, allowed hosts, timeout, owner_id=) -> HttpResponse.
    # aistrix-test://destinations/<name> URLs go to the owner's test destination.
    http: Optional[Callable[..., Awaitable[HttpResponse]]] = None
    # (model text, schema) -> (parsed value, problems, cleaned text): replaces
    # llm.structured's own JSON Schema check (adapters keep legacy messages).
    structured_check: Optional[Callable[[str, dict], tuple]] = None
    # (owner id, resource key, secret names) -> {name: value}
    secrets: Optional[Callable[[Optional[str], str, list], Awaitable[dict]]] = None
    sleep: Optional[Callable[[float], Awaitable[None]]] = None

    def __post_init__(self):
        if self.document_text is None:
            async def default(name, mime, data):
                return _plain_text(name, mime, data)
            self.document_text = default


@dataclass
class NodeContext:
    run: dict
    node_id: str
    node: dict                 # plan node: use, config (raw), sources, ...
    config: dict               # config with templates filled in
    value: Any                 # what the incoming edges carry
    gateway: ModelGateway
    services: Services
    call: CallContext
    idempotency_key: Optional[str] = None
    timeout: int = 120
    # Long-running steps (agents) keep their progress on the step:
    state: Optional[dict] = None                                   # saved progress, {} at the first attempt
    checkpoint: Optional[Callable[[dict, float], Awaitable[None]]] = None   # (state, cost since last save)
    trace: Optional[Callable[[str, dict], Awaitable[None]]] = None          # (event type, data)
    decision: Optional[dict] = None          # a person's answer to this step's last wait: {approved, by, note}
    secrets: Optional[dict] = None           # declared secrets, for steps that fill templates themselves


@dataclass
class NodeOutcome:
    output: Any
    cost_usd: float = 0.0
    detail: dict = field(default_factory=dict)
    skipped: Optional[str] = None     # the node decided not to run, and why
    wait: bool = False                # pause the run for a person's approval; output is what they review


def _as_prompt_value(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)


def _prompt(ctx: NodeContext) -> str:
    """The rendered prompt; when the author used no templates, the incoming
    value is appended so the model always sees its input."""
    raw = ctx.node["config"].get("prompt") or ""
    if "{{" in raw:
        return ctx.config["prompt"]
    return f"{ctx.config['prompt']}\n\n{_as_prompt_value(ctx.value)}"


async def parse_document(ctx: NodeContext) -> NodeOutcome:
    value = ctx.value
    if isinstance(value, str):
        text = value
    elif isinstance(value, dict) and "content_base64" in value:
        try:
            data = base64.b64decode(value["content_base64"], validate=True)
        except (binascii.Error, ValueError):
            raise NodeError("The file isn't valid base64")
        text = await ctx.services.document_text(value.get("name") or "", value.get("mime") or "", data)
    else:
        raise NodeError("parse.document needs a file or text")
    limit = ctx.config.get("maxChars") or MAX_TEXT
    return NodeOutcome(text[:limit], detail={"chars": len(text), "truncated": len(text) > limit})


async def llm_chat(ctx: NodeContext) -> NodeOutcome:
    result = await ctx.gateway.invoke(ctx.call, model_ref=ctx.config["model"], providers=ctx.run["plan"]["policies"]["providers"],
                                      system=ctx.config.get("system") or "You are a careful assistant.",
                                      prompt=_prompt(ctx), max_tokens=ctx.config.get("maxTokens") or 1024,
                                      temperature=ctx.config.get("temperature", 0.0))
    return NodeOutcome(result.text, cost_usd=result.cost_usd or 0.0,
                       detail={"provider": result.provider, "model": result.model, "usage": result.usage})


_FENCE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.S)


def _check_json(text: str, schema: dict) -> tuple[Any, list[str], str]:
    """llm.structured's own check: (parsed, problems, cleaned text)."""
    m = _FENCE.match(text)
    cleaned = m.group(1) if m else text
    try:
        data = json.loads(cleaned)
    except ValueError:
        return None, ["The answer wasn't valid JSON."], cleaned
    return data, [f"{p.path or '(root)'}: {p.message}" for p in spec.validate_value(schema, data)[:5]], cleaned


async def llm_structured(ctx: NodeContext) -> NodeOutcome:
    schema = ctx.config["schema"]
    system = ctx.config.get("system") or "You extract structured data."
    if ctx.config.get("instructions", True):
        system += "\n\n" + STRUCTURED_SYSTEM.format(schema=json.dumps(schema, ensure_ascii=False))
    first = _prompt(ctx)
    prompt = first
    providers = ctx.run["plan"]["policies"]["providers"]
    max_tokens = ctx.config.get("maxTokens") or 1024
    check = ctx.services.structured_check or _check_json
    total = 0.0
    detail: dict = {}
    for attempt in (1, 2):
        result = await ctx.gateway.invoke(ctx.call, model_ref=ctx.config["model"], providers=providers, system=system,
                                          prompt=prompt, max_tokens=max_tokens, temperature=ctx.config.get("temperature", 0.0))
        total += result.cost_usd or 0.0
        if ctx.call.budget_remaining is not None:
            ctx.call.budget_remaining -= result.cost_usd or 0.0
        detail = {"provider": result.provider, "model": result.model, "usage": result.usage, "attempts": attempt}
        data, problems, cleaned = check(result.text, schema)
        if not problems:
            return NodeOutcome(data, cost_usd=total, detail={**detail, "text": cleaned})
        if attempt == 2:
            break
        # One repair attempt, telling the model what was wrong.
        if ctx.call.on_status:
            await ctx.call.on_status({"status": "repairing_output", "errors": problems})
        template = ctx.config.get("repair")
        if template:
            prompt = template.format(input=first, previous=cleaned[:ctx.config.get("repairMaxChars") or 6000],
                                     errors="; ".join(problems))
        else:
            prompt = f"{first}\n\nYour previous answer was rejected: {'; '.join(problems)}\nAnswer again with valid JSON only."
    raise NodeError(f"The model's answer didn't match the schema after 2 tries: {'; '.join(problems)}",
                    code="schema_mismatch", detail={**detail, "errors": problems})


def _code_input(ctx: NodeContext) -> Any:
    if "input" in ctx.config:
        return ctx.config["input"]
    return ctx.value if isinstance(ctx.value, dict) else {"value": ctx.value}


async def code_python(ctx: NodeContext) -> NodeOutcome:
    payload = _code_input(ctx)
    if "app" in ctx.config:
        if not ctx.services.run_code_app:
            raise NodeError("Code hosting isn't enabled on this server, so code.python nodes can't run here", code="code_unavailable")
        result = await ctx.services.run_code_app(ctx.config["app"], ctx.run.get("owner_id"), payload, ctx.timeout)
    else:
        if not ctx.services.run_local_code:
            raise NodeError("entry files only run in the local runner", code="code_unavailable")
        result = await ctx.services.run_local_code(ctx.config["entry"], payload, ctx.timeout)
    return NodeOutcome(result)


async def http(ctx: NodeContext) -> NodeOutcome:
    if not ctx.services.http:
        raise NodeError("Outbound HTTP isn't configured", code="http_unavailable")
    cfg = ctx.config
    method = cfg["method"]
    headers = dict(cfg.get("headers") or {})
    if ctx.idempotency_key:
        headers["Idempotency-Key"] = ctx.idempotency_key
    body = None
    if method != "GET":
        body = cfg["body"] if "body" in cfg else ctx.value
    write = method != "GET"
    try:
        resp = await ctx.services.http(method, cfg["url"], headers, body, ctx.run["plan"]["policies"]["outboundHosts"],
                                       ctx.timeout, owner_id=ctx.run.get("owner_id"))
    except NodeError:
        raise
    except ValueError as e:
        # Refused before anything was sent (address or host rules).
        raise NodeError(f"Request refused: {e}", code="http_refused")
    except Exception as e:
        # A write may have reached the server; the idempotency key makes a retry safe.
        raise NodeError(f"The request failed ({type(e).__name__})", transient=True, uncertain=write, code="http_error")
    if resp.status in (408, 425, 429) or resp.status >= 500:
        raise NodeError(f"The API answered {resp.status}", transient=True, uncertain=write, code="http_status")
    if resp.status >= 400:
        raise NodeError(f"The API answered {resp.status}: {str(resp.body)[:300]}", code="http_status")
    return NodeOutcome({"status": resp.status, "body": resp.body})


async def data_template(ctx: NodeContext) -> NodeOutcome:
    return NodeOutcome(ctx.config["value"])


RUNTIMES: dict[str, Callable[[NodeContext], Awaitable[NodeOutcome]]] = {
    "parse.document": parse_document,
    "llm.chat": llm_chat,
    "llm.structured": llm_structured,
    "code.python": code_python,
    "http": http,
    "data.template": data_template,
}
