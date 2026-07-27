import asyncio
import ast
import ipaddress
import json
import math
import operator
import os
import re
import socket
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Optional
from urllib.parse import urlsplit

import anthropic
import httpx
import openai
import sentry_sdk
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from jose import jwt as jose_jwt
from pydantic import BaseModel, Field, field_validator
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from supabase import create_client, Client

load_dotenv()

# ─── Sentry ───────────────────────────────────────────────────────────────────
SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
        environment=os.getenv("ENVIRONMENT", "production"),
        before_send=lambda event, hint: event,  # filter here if needed
    )

app = FastAPI(title="Aistrix API", version="1.0.0")

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Narrowed from ["*"]/["*"] — only the methods/headers this API actually uses.
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret", "X-Schedule-Secret"],
)

SUPABASE_URL              = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY         = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
CRON_SECRET               = os.getenv("CRON_SECRET")
REQUEST_TIMEOUT           = int(os.getenv("REQUEST_TIMEOUT", "90"))
HOURLY_LIMIT              = int(os.getenv("RATE_LIMIT_PER_HOUR", "30"))
DAILY_LIMIT               = int(os.getenv("RATE_LIMIT_PER_DAY", "200"))
MAX_INPUT_LENGTH          = int(os.getenv("MAX_INPUT_LENGTH", "20000"))
MAX_SYSTEM_LENGTH         = int(os.getenv("MAX_SYSTEM_LENGTH", "10000"))

# Module-level anonymous client for public read operations (avoids recreating on every request)
_sb_anon: Optional[Client] = None

def get_anon_client() -> Client:
    global _sb_anon
    if _sb_anon is None:
        _sb_anon = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    return _sb_anon


# ─── Supabase helpers ─────────────────────────────────────────────────────────
def get_supabase_for_user(user_jwt: str) -> Client:
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(user_jwt)
    return client


async def db(query):
    """
    supabase-py's query.execute() is a blocking/synchronous call under the hood.
    Every call site in this file used to invoke it directly inside an `async def`
    handler with no `await`, which blocks the *entire* event loop for the duration
    of each DB round-trip — including every other in-flight streaming response.
    Running it in a worker thread keeps the loop free for concurrent requests.
    """
    return await asyncio.to_thread(query.execute)


async def _default(value):
    """Returns `value` — used so independent lookups can be scheduled uniformly
    with asyncio.gather() even when some of them are skipped (e.g. no app_id)."""
    return value


def extract_user_id(user_jwt: str) -> Optional[str]:
    """Extract user_id from a Supabase JWT WITHOUT verifying its signature or
    expiry. Only use this for non-security-sensitive purposes (e.g. metadata
    on a request that Supabase itself will separately authorize via RLS).
    Do NOT use this to gate access or rate limits — use `verify_user_jwt`."""
    try:
        claims = jose_jwt.get_unverified_claims(user_jwt)
        return claims.get("sub")
    except Exception:
        return None


async def verify_user_jwt(user_jwt: Optional[str]) -> Optional[str]:
    """Verify a Supabase JWT is genuinely valid (signature + expiry) by
    checking it against Supabase Auth, and return the verified user_id.

    Several endpoints used to only check `auth_header.startswith("Bearer ")`,
    which is not authentication at all — any client could send
    `Authorization: Bearer x` and pass. This performs a real check.
    """
    if not user_jwt:
        return None
    try:
        resp = await asyncio.to_thread(get_anon_client().auth.get_user, user_jwt)
        return resp.user.id if resp and resp.user else None
    except Exception:
        return None


async def require_verified_user(request: Request) -> str:
    """FastAPI-style dependency: extracts the bearer token, verifies it, and
    returns the verified user_id, or raises 401. Replaces the previous
    `auth_header.startswith("Bearer ")` checks that accepted any string."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.removeprefix("Bearer ").strip()
    user_id = await verify_user_jwt(token) if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user_id


# ─── SSRF protection for server-side outbound fetches ─────────────────────────
# Several endpoints/tools fetch a URL supplied by the caller (or by the model,
# whose input can be influenced by caller-controlled text). Without
# validation, that lets a client make the server issue requests to internal
# services, localhost, or cloud metadata endpoints (classic SSRF). These
# helpers resolve the hostname and reject anything that isn't a public address,
# and re-validate every redirect hop (a bare `follow_redirects=True` would
# otherwise let an attacker redirect from an allowed public URL to an internal
# one).
_BLOCKED_HOSTNAMES = {"metadata.google.internal"}


def _is_public_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    )


def assert_public_url(url: str) -> None:
    """Raise ValueError if `url` isn't a plain http(s) URL that resolves to a
    public IP address."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ValueError("URL must use http:// or https://")
    hostname = parts.hostname
    if not hostname:
        raise ValueError("URL has no hostname")
    if hostname.lower() in _BLOCKED_HOSTNAMES:
        raise ValueError("This host is not allowed")
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise ValueError("Could not resolve host")
    if not infos or not any(_is_public_ip(info[4][0]) for info in infos):
        raise ValueError("URL resolves to a non-public address, which is not allowed")


async def fetch_safely(method: str, url: str, *, timeout: float = 15, max_redirects: int = 5, **kwargs) -> httpx.Response:
    """httpx request wrapper that validates the target (and every redirect
    hop) with `assert_public_url` before following it. Use this instead of a
    bare `httpx.AsyncClient(follow_redirects=True)` for any caller-influenced
    URL."""
    assert_public_url(url)
    async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
        current = url
        for _ in range(max_redirects + 1):
            resp = await client.request(method, current, **kwargs)
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                current = str(httpx.URL(current).join(resp.headers["location"]))
                assert_public_url(current)
                continue
            return resp
    raise ValueError("Too many redirects")


# ─── Anonymous (unauthenticated) rate limiting ────────────────────────────────
# /run previously skipped rate limiting entirely whenever no Authorization
# header was present, meaning anyone could call it with no auth and no limit,
# burning the server's own Anthropic/OpenAI API key. This adds a per-IP
# sliding-window limit for that case. Note: this is in-memory and per-process
# — for a multi-worker/multi-instance deployment, back this with Redis or the
# same Supabase-backed approach used for authenticated users instead.
ANON_HOURLY_LIMIT = int(os.getenv("ANON_RATE_LIMIT_PER_HOUR", "10"))
_anon_hits: dict[str, deque] = defaultdict(deque)


def check_anon_rate_limit(client_ip: str) -> tuple[bool, str]:
    now = time.monotonic()
    hits = _anon_hits[client_ip]
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= ANON_HOURLY_LIMIT:
        return False, f"Rate limit: {ANON_HOURLY_LIMIT} free runs/hour for anonymous use. Sign in or add your own API key for higher limits."
    hits.append(now)
    return True, ""


async def fetch_user_api_key(user_jwt: str, provider: str, sb: Optional[Client] = None) -> Optional[str]:
    try:
        sb = sb or get_supabase_for_user(user_jwt)
        query = (
            sb.table("user_api_keys")
            .select("encrypted_key")
            .eq("provider", provider)
            .eq("is_active", True)
            .maybe_single()
        )
        result = await db(query)
        return result.data["encrypted_key"] if result.data else None
    except Exception:
        return None


async def fetch_app_knowledge(app_id: str) -> str:
    try:
        query = get_anon_client().table("app_knowledge").select("title, content").eq("app_id", app_id)
        result = await db(query)
        if not result.data:
            return ""
        return "\n\n".join(f"## {i['title']}\n{i['content']}" for i in result.data)
    except Exception:
        return ""


async def fetch_app_tools(app_id: str) -> list:
    try:
        query = get_anon_client().table("app_tools").select("*").eq("app_id", app_id)
        result = await db(query)
        return result.data or []
    except Exception:
        return []


async def fetch_app_webhook(app_id: str) -> Optional[str]:
    try:
        query = get_anon_client().table("apps").select("webhook_url").eq("id", app_id).single()
        result = await db(query)
        return result.data.get("webhook_url") if result.data else None
    except Exception:
        return None


# ─── Rate limiting (Supabase-backed — works across all workers) ───────────────
async def get_usage_counts(sb: Client, user_id: str) -> tuple[int, int]:
    """Returns (hourly_count, daily_count), fetched concurrently instead of sequentially."""
    now = datetime.now(timezone.utc)
    one_hour_ago = (now - timedelta(hours=1)).isoformat()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    hourly_query = sb.table("run_history").select("id", count="exact", head=True).eq("user_id", user_id).gte("created_at", one_hour_ago)
    daily_query = sb.table("run_history").select("id", count="exact", head=True).eq("user_id", user_id).gte("created_at", day_start)

    hourly_res, daily_res = await asyncio.gather(db(hourly_query), db(daily_query))
    return hourly_res.count or 0, daily_res.count or 0


async def check_rate_limit(request: Request, user_jwt: Optional[str]) -> tuple[bool, str]:
    """Returns (is_allowed, error_message).

    Previously this trusted `extract_user_id`'s UNVERIFIED claim and, on any
    DB error (including the 401 Supabase itself returns for a forged/expired
    token), failed OPEN — i.e. any garbage bearer token bypassed rate limiting
    entirely. Now the token is verified first; anything that isn't a genuinely
    valid, current session falls back to the conservative per-IP anonymous
    limit instead of being let through unmetered.
    """
    user_id = await verify_user_jwt(user_jwt) if user_jwt else None
    if user_id:
        try:
            sb = get_supabase_for_user(user_jwt)
            hourly_count, daily_count = await get_usage_counts(sb, user_id)

            if hourly_count >= HOURLY_LIMIT:
                return False, f"Rate limit: {hourly_count}/{HOURLY_LIMIT} runs this hour. Try again in ~60 minutes."
            if daily_count >= DAILY_LIMIT:
                return False, f"Daily limit reached: {daily_count}/{DAILY_LIMIT} runs today. Resets at midnight UTC. Add your API key to bypass limits."

            return True, ""
        except Exception:
            pass  # DB error on a verified user — fall through to the conservative IP limit below

    client_ip = request.client.host if request.client else "unknown"
    return check_anon_rate_limit(client_ip)


# ─── Output format instructions ───────────────────────────────────────────────
OUTPUT_FORMAT_INSTRUCTIONS = {
    "table": (
        "CRITICAL OUTPUT RULE — YOU MUST FOLLOW THIS EXACTLY:\n"
        "Return ONLY a raw JSON array. No markdown, no explanation, no code fences, nothing else.\n"
        "Every element is an object where keys are column names and values are the cell data.\n"
        'Example: [{"Name":"Alice","Score":"95"},{"Name":"Bob","Score":"87"}]\n\n'
    ),
    "cards": (
        "CRITICAL OUTPUT RULE — YOU MUST FOLLOW THIS EXACTLY:\n"
        "Return ONLY a raw JSON array of card objects. No markdown, no explanation, nothing else.\n"
        'Each card: {"title":"...","subtitle":"...","fields":[{"label":"...","value":"..."}],"badge":"Status","badge_color":"green"}\n\n'
    ),
    "key_value": (
        "CRITICAL OUTPUT RULE — YOU MUST FOLLOW THIS EXACTLY:\n"
        "Return ONLY a raw JSON object of string key-value pairs. No markdown, no explanation, nothing else.\n"
        '{"Field1":"Value1","Field2":"Value2"}\n\n'
    ),
    "json": (
        "CRITICAL OUTPUT RULE — YOU MUST FOLLOW THIS EXACTLY:\n"
        "Return ONLY raw valid JSON. No markdown fences, no explanation, no surrounding text.\n\n"
    ),
    "chart": (
        "CRITICAL OUTPUT RULE — YOU MUST FOLLOW THIS EXACTLY:\n"
        "Return ONLY raw JSON: "
        '{"type":"bar","title":"...","labels":[...],"datasets":[{"label":"...","data":[...],"color":"#hex"}]}\n\n'
    ),
}


# ─── Tool execution ───────────────────────────────────────────────────────────
SERPAPI_KEY = os.getenv("SERPAPI_KEY", "")


_CALC_OPERATORS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv, ast.USub: operator.neg, ast.UAdd: operator.pos,
}
_CALC_NAMES = {"pi": math.pi, "e": math.e}
_CALC_FUNCS = {
    "abs": abs, "round": round, "min": min, "max": max,
    "sqrt": math.sqrt, "pow": math.pow,
    "sin": math.sin, "cos": math.cos, "tan": math.tan,
    "log": math.log, "log10": math.log10, "floor": math.floor, "ceil": math.ceil,
}


def _eval_calc_node(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _CALC_OPERATORS:
        return _CALC_OPERATORS[type(node.op)](_eval_calc_node(node.left), _eval_calc_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _CALC_OPERATORS:
        return _CALC_OPERATORS[type(node.op)](_eval_calc_node(node.operand))
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in _CALC_FUNCS or node.keywords:
            raise ValueError("Function not allowed")
        return _CALC_FUNCS[node.func.id](*(_eval_calc_node(a) for a in node.args))
    if isinstance(node, ast.Name):
        if node.id not in _CALC_NAMES:
            raise ValueError(f"Unknown name: {node.id}")
        return _CALC_NAMES[node.id]
    raise ValueError("Disallowed expression")


def safe_calculate(expression: str) -> str:
    """Evaluate a numeric expression via an AST whitelist — NOT via eval().

    A `restricted-builtins` eval() (the previous implementation) is a
    well-known, routinely-bypassable sandbox: an expression can still reach
    arbitrary objects/code through attribute traversal (e.g.
    `().__class__.__base__.__subclasses__()`) even with `__builtins__`
    stripped out. Parsing into an AST and only ever executing a fixed set of
    numeric operators/functions closes that off entirely.
    """
    try:
        tree = ast.parse(expression, mode="eval")
        return str(_eval_calc_node(tree.body))
    except Exception as ex:
        return f"Calculation error: {ex}"


async def execute_tool(tool: dict, tool_input: dict) -> str:
    tool_type = tool.get("type", "")
    config = tool.get("config", {})
    try:
        if tool_type == "calculator":
            return safe_calculate(tool_input.get("expression", ""))

        elif tool_type == "fetch":
            url = tool_input.get("url", "")
            try:
                r = await fetch_safely("GET", url, timeout=10, headers={"User-Agent": "Aistrix/1.0"})
            except ValueError as e:
                return f"Invalid URL: {e}"
            text = re.sub(r"<[^>]+>", " ", r.text)
            return re.sub(r"\s+", " ", text).strip()[:3000]

        elif tool_type == "search":
            query = tool_input.get("query", "")
            if SERPAPI_KEY:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.get("https://serpapi.com/search", params={"q": query, "api_key": SERPAPI_KEY, "num": 5})
                    data = r.json()
                    results = data.get("organic_results", [])
                    return "\n".join(f"{i+1}. {r.get('title','')}: {r.get('snippet','')}" for i, r in enumerate(results[:5])) or "No results"
            return f"Search for '{query}': No SerpAPI key. Add SERPAPI_KEY to use real web search."

        elif tool_type == "http":
            url = config.get("url") or tool_input.get("url", "")
            method = config.get("method", "POST").upper()
            headers = {**config.get("headers", {}), "Content-Type": "application/json"}
            body_fields = {k: v for k, v in tool_input.items() if k != "url"}
            try:
                if method == "GET":
                    r = await fetch_safely("GET", url, timeout=15, params=body_fields, headers=headers)
                else:
                    r = await fetch_safely(method, url, timeout=15, json=body_fields, headers=headers)
            except ValueError as e:
                return f"Invalid URL: {e}"
            return r.text[:2000]

        elif tool_type == "app":
            other_id = config.get("app_id", "")
            app_input = tool_input.get("input", "")
            if not other_id or not app_input:
                return "Missing app_id or input"
            res = await db(get_anon_client().table("apps").select("system_prompt, ai_provider, ai_model").eq("id", other_id).single())
            if not res.data:
                return "Referenced app not found"
            other = res.data
            collected = []
            fn = stream_openai if other.get("ai_provider") == "openai" else stream_claude
            async for token in fn(other.get("system_prompt", "You are helpful."), app_input, other.get("ai_model") or "claude-sonnet-4-6"):
                collected.append(token)
            return "".join(collected)

        elif tool_type == "pdf":
            url = tool_input.get("url", "") or config.get("url", "")
            if url:
                try:
                    r = await fetch_safely("GET", url, timeout=15)
                except ValueError as e:
                    return f"Invalid URL: {e}"
                try:
                    import io
                    import pypdf
                    reader = pypdf.PdfReader(io.BytesIO(r.content))
                    text = "\n".join(page.extract_text() or "" for page in reader.pages)
                    return text[:5000] or "No text found in PDF."
                except ImportError:
                    return "PDF parsing requires pypdf. Install with: pip install pypdf"
            return "Provide a 'url' pointing to the PDF file."

        elif tool_type == "ocr":
            url = tool_input.get("url", "") or config.get("url", "")
            if url:
                try:
                    r = await fetch_safely("GET", url, timeout=15)
                except ValueError as e:
                    return f"Invalid URL: {e}"
                try:
                    import io
                    import pytesseract
                    from PIL import Image
                    img = Image.open(io.BytesIO(r.content))
                    return pytesseract.image_to_string(img)[:3000]
                except ImportError:
                    return "OCR requires pytesseract + Pillow. Install with: pip install pytesseract Pillow"
            return "Provide a 'url' pointing to the image file."

        elif tool_type == "email":
            to = tool_input.get("to", "")
            subject = tool_input.get("subject", "Message from Aistrix")
            body = tool_input.get("body", "")
            if not to or not body:
                return "Missing 'to' or 'body' for email."
            api_key = config.get("api_key", "")
            if api_key and api_key.startswith("SG."):
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.post(
                        "https://api.sendgrid.com/v3/mail/send",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={"personalizations": [{"to": [{"email": to}]}],
                              "from": {"email": config.get("from", "noreply@aistrix.ai")},
                              "subject": subject, "content": [{"type": "text/plain", "value": body}]},
                    )
                return f"Email sent to {to} (status {r.status_code})"
            return f"Email tool configured — would send to {to}: {subject}. Add SendGrid API key to config to enable real sending."

        elif tool_type == "calendar":
            action = tool_input.get("action", "create")
            title = tool_input.get("title", "Event")
            start = tool_input.get("start", "")
            return f"Calendar tool: would {action} event '{title}' at {start}. Connect Google Calendar OAuth to enable real calendar operations."

        elif tool_type == "storage":
            action = tool_input.get("action", "list")
            bucket = config.get("bucket", "uploads")
            filename = tool_input.get("filename", "")
            sb = get_anon_client()
            if action == "list":
                res = await asyncio.to_thread(sb.storage.from_(bucket).list)
                files = [f.get("name") for f in (res or [])]
                return f"Files in {bucket}: {', '.join(files) or 'empty'}"
            elif action == "url" and filename:
                return sb.storage.from_(bucket).get_public_url(filename)
            return f"Storage action '{action}' on bucket '{bucket}'"

    except Exception as e:
        return f"Tool error: {e}"
    return "Unknown tool type"


# ─── Model streaming ──────────────────────────────────────────────────────────
ALLOWED_CLAUDE_MODELS = {"claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"}
ALLOWED_OPENAI_MODELS = {"gpt-4o-mini", "gpt-4o"}


def get_default_model(provider: str) -> str:
    return {"claude": "claude-sonnet-4-6", "openai": "gpt-4o-mini"}.get(provider, "claude-sonnet-4-6")


def validate_model(provider: str, model: str) -> str:
    allowed = ALLOWED_CLAUDE_MODELS if provider == "claude" else ALLOWED_OPENAI_MODELS
    return model if model in allowed else get_default_model(provider)


async def stream_claude(system: str, user_input: str, model: str, api_key: str = None, max_tokens: int = 4096, temperature: float = 1.0, usage_holder: dict = None):
    client = anthropic.AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
    async with client.messages.stream(model=model, max_tokens=max_tokens, system=system,
                                      messages=[{"role": "user", "content": user_input}],
                                      temperature=temperature) as stream:
        async for text in stream.text_stream:
            yield text
        if usage_holder is not None:
            final = await stream.get_final_message()
            usage_holder["input_tokens"] = final.usage.input_tokens
            usage_holder["output_tokens"] = final.usage.output_tokens


async def stream_openai(system: str, user_input: str, model: str, api_key: str = None, max_tokens: int = 4096, temperature: float = 1.0, usage_holder: dict = None):
    client = openai.AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
    stream = await client.chat.completions.create(
        model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": user_input}],
        max_tokens=max_tokens, stream=True, temperature=temperature,
        # Only ask the provider for a trailing usage-only chunk when a caller
        # actually wants it — some OpenAI-compatible endpoints choke on
        # unrecognized stream_options.
        stream_options={"include_usage": True} if usage_holder is not None else openai.NOT_GIVEN)
    async for chunk in stream:
        if usage_holder is not None and chunk.usage:
            usage_holder["input_tokens"] = chunk.usage.prompt_tokens
            usage_holder["output_tokens"] = chunk.usage.completion_tokens
        if not chunk.choices:
            continue
        c = chunk.choices[0].delta.content
        if c:
            yield c


# ─── Agentic loops ────────────────────────────────────────────────────────────
def tools_to_claude_format(tools):
    return [{"name": t["name"], "description": t["description"], "input_schema": t.get("input_schema", {"type": "object", "properties": {}, "required": []})} for t in tools]


def tools_to_openai_format(tools):
    return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t.get("input_schema", {"type": "object", "properties": {}, "required": []})}} for t in tools]


async def run_claude_with_tools(system, user_input, model, tools, api_key=None):
    client = anthropic.AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
    claude_tools = tools_to_claude_format(tools)
    messages = [{"role": "user", "content": user_input}]
    tool_map = {t["name"]: t for t in tools}
    # Multi-turn tool loop — every turn (including tool-result round-trips)
    # burns its own input/output tokens, so accumulate across the whole loop.
    input_tokens = output_tokens = 0

    for _ in range(10):
        response = await client.messages.create(model=model, max_tokens=4096, system=system, tools=claude_tools, messages=messages)
        input_tokens += response.usage.input_tokens
        output_tokens += response.usage.output_tokens
        if response.stop_reason == "end_turn":
            yield ("token", "".join(b.text for b in response.content if hasattr(b, "text")))
            yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})
            break
        elif response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for block in response.content:
                if block.type == "tool_use":
                    yield ("tool_call", {"name": block.name, "input": block.input})
                    result = await execute_tool(tool_map.get(block.name, {"type": "unknown", "config": {}}), block.input)
                    yield ("tool_result", {"name": block.name, "result": result[:500]})
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
            messages.append({"role": "user", "content": results})


async def run_openai_with_tools(system, user_input, model, tools, api_key=None):
    client = openai.AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
    oai_tools = tools_to_openai_format(tools)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_input}]
    tool_map = {t["name"]: t for t in tools}
    # Multi-turn tool loop — every turn (including tool-result round-trips)
    # burns its own input/output tokens, so accumulate across the whole loop.
    input_tokens = output_tokens = 0

    for _ in range(10):
        response = await client.chat.completions.create(model=model, max_tokens=4096, tools=oai_tools, tool_choice="auto", messages=messages)
        if response.usage:
            input_tokens += response.usage.prompt_tokens
            output_tokens += response.usage.completion_tokens
        msg = response.choices[0].message
        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                tool_input = json.loads(tc.function.arguments or "{}")
                yield ("tool_call", {"name": tc.function.name, "input": tool_input})
                result = await execute_tool(tool_map.get(tc.function.name, {"type": "unknown", "config": {}}), tool_input)
                yield ("tool_result", {"name": tc.function.name, "result": result[:500]})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        else:
            yield ("token", msg.content or "")
            yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})
            break


# ─── Request model with validation ────────────────────────────────────────────
class RunRequest(BaseModel):
    app_id: Optional[str] = None
    input: str
    system_prompt: Optional[str] = None
    ai_provider: Optional[str] = "claude"
    ai_model: Optional[str] = None
    user_context: Optional[str] = None
    output_type: Optional[str] = "markdown"
    custom_model_url: Optional[str] = None
    custom_model_name: Optional[str] = None
    temperature: Optional[float] = None
    prior_responses: Optional[list[str]] = None   # recent answers to avoid repeating

    @field_validator("input")
    @classmethod
    def validate_input(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Input cannot be empty")
        if len(v) > MAX_INPUT_LENGTH:
            raise ValueError(f"Input too long: {len(v):,} chars (max {MAX_INPUT_LENGTH:,}). Split into smaller requests.")
        return v

    @field_validator("system_prompt")
    @classmethod
    def validate_system_prompt(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > MAX_SYSTEM_LENGTH:
            raise ValueError(f"System prompt too long: {len(v):,} chars (max {MAX_SYSTEM_LENGTH:,})")
        return v

    @field_validator("user_context")
    @classmethod
    def validate_user_context(cls, v: Optional[str]) -> Optional[str]:
        if v and len(v) > 30000:
            return v[:30000]  # Silently truncate context rather than error
        return v


# ─── Main /run endpoint ────────────────────────────────────────────────────────
@app.post("/run")
async def run_app(req: RunRequest, request: Request):
    # Auth
    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip() or None

    # Rate limit — applies to every request, authenticated or not (previously
    # anonymous requests were never rate limited at all).
    allowed, rate_msg = await check_rate_limit(request, user_jwt)
    if not allowed:
        return JSONResponse(status_code=429, content={"error": rate_msg})

    # Build system prompt
    base_system = req.system_prompt or "You are a helpful AI assistant."
    fmt_instruction = OUTPUT_FORMAT_INSTRUCTIONS.get(req.output_type or "markdown", "")

    # Inject prior responses so the model never repeats itself
    variation_block = ""
    if req.prior_responses:
        recent = req.prior_responses[-3:]  # last 3 max
        formatted = "\n---\n".join(f"Previous response {i+1}:\n{r}" for i, r in enumerate(recent))
        variation_block = (
            f"\n\n<prior_responses>\n{formatted}\n</prior_responses>\n"
            "IMPORTANT: You have answered this or a similar question before (shown above). "
            "Do NOT repeat the same wording, structure, examples, or angle. "
            "Approach it fresh — use a different perspective, tone, or examples this time. "
            "Humans never answer the same way twice."
        )

    if req.user_context and req.user_context.strip():
        system = f"{fmt_instruction}<user_context>\n{req.user_context.strip()}\n</user_context>\n\n{base_system}{variation_block}"
    else:
        system = (fmt_instruction + base_system if fmt_instruction else base_system) + variation_block

    # Provider + model (pure logic — resolve before firing off any I/O)
    if req.custom_model_url and req.custom_model_name:
        provider = "custom"
        model = req.custom_model_name
    else:
        provider = req.ai_provider or "claude"
        model = validate_model(provider, req.ai_model or get_default_model(provider))

    # Knowledge base + API key + tools + webhook are all independent Supabase
    # lookups — run them concurrently instead of one after another, since each
    # is a separate network round-trip.
    knowledge, user_api_key, tools, webhook_url = await asyncio.gather(
        fetch_app_knowledge(req.app_id) if req.app_id else _default(""),
        fetch_user_api_key(user_jwt, provider) if user_jwt else _default(None),
        fetch_app_tools(req.app_id) if req.app_id else _default([]),
        fetch_app_webhook(req.app_id) if req.app_id else _default(None),
    )

    if knowledge:
        system = f"<knowledge_base>\n{knowledge}\n</knowledge_base>\n\n{system}"

    collected: list[str] = []
    usage: dict = {}

    async def generate():
        try:
            # ── Custom model ──
            if req.custom_model_url and req.custom_model_name:
                client = openai.AsyncOpenAI(base_url=req.custom_model_url, api_key=user_api_key or "sk-placeholder")
                stream = await client.chat.completions.create(
                    model=req.custom_model_name,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": req.input}],
                    max_tokens=4096, stream=True)
                async for chunk in stream:
                    c = chunk.choices[0].delta.content
                    if c:
                        collected.append(c)
                        yield f"data: {json.dumps({'token': c})}\n\n"
                yield f"data: {json.dumps({'done': True, 'provider': 'custom', 'model': req.custom_model_name})}\n\n"
                return

            # ── Tool-enabled agentic loop ──
            if tools:
                run_fn = run_claude_with_tools if provider != "openai" else run_openai_with_tools
                async for event_type, data in run_fn(system, req.input, model, tools, user_api_key):
                    if event_type == "token":
                        # run_claude_with_tools / run_openai_with_tools hand back the
                        # whole final answer in one piece (they call the non-streaming
                        # completion API under the hood). Splitting it into a separate
                        # SSE frame per character used to multiply a ~1-2k char answer
                        # into thousands of JSON-encoded network writes for no benefit —
                        # the frontend already batches its re-renders via rAF, so it
                        # can't tell the difference. Chunk it instead.
                        collected.append(data)
                        chunk_size = 40
                        for i in range(0, len(data), chunk_size):
                            yield f"data: {json.dumps({'token': data[i:i + chunk_size]})}\n\n"
                    elif event_type == "tool_call":
                        yield f"data: {json.dumps({'tool_call': data})}\n\n"
                    elif event_type == "tool_result":
                        yield f"data: {json.dumps({'tool_result': data})}\n\n"
                    elif event_type == "usage":
                        usage.update(data)
            else:
                # ── Standard streaming ──
                raw_temp = req.temperature if req.temperature is not None else 1.0
                # Claude max is 1.0; OpenAI allows up to 2.0
                temp = min(raw_temp, 1.0) if provider != "openai" else raw_temp
                stream_fn = stream_openai if provider == "openai" else stream_claude
                async for token in stream_fn(system, req.input, model, user_api_key, temperature=temp, usage_holder=usage):
                    collected.append(token)
                    yield f"data: {json.dumps({'token': token})}\n\n"

            full_result = "".join(collected)
            yield f"data: {json.dumps({'done': True, 'provider': provider, 'model': model, 'usage': usage or None})}\n\n"

            # Fire webhook
            if webhook_url:
                asyncio.create_task(_fire_webhook(webhook_url, req.app_id, req.input, full_result, provider, model))

        except (anthropic.AuthenticationError, openai.AuthenticationError):
            yield f"data: {json.dumps({'error': f'Invalid {provider} API key — check Settings → Keys and make sure the key is active.'})}\n\n"
        except (anthropic.PermissionDeniedError,):
            yield f"data: {json.dumps({'error': f'API key does not have permission for this model. Check your {provider} account.'})}\n\n"
        except (anthropic.RateLimitError, openai.RateLimitError):
            yield f"data: {json.dumps({'error': 'Rate limit reached. Add your own API key in Settings → Keys for unlimited runs, or wait a moment and try again.'})}\n\n"
        except (anthropic.BadRequestError, openai.BadRequestError) as e:
            yield f"data: {json.dumps({'error': f'Prompt config error: {str(e)[:200]}'})}\n\n"
        except (anthropic.InternalServerError, openai.InternalServerError):
            yield f"data: {json.dumps({'error': f'{provider.capitalize()} service error — try again in a moment.'})}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'error': 'Request timed out after 90 seconds. Try a shorter input or switch to a faster model (e.g. Haiku).'})}\n\n"
        except Exception as e:
            # Full detail goes to Sentry/logs only — the raw exception string
            # (which can include internal paths, DB/service details, etc.)
            # used to be sent straight to the client.
            sentry_sdk.capture_exception(e)
            print(f"Streaming error [{type(e).__name__}]: {e}")
            yield f"data: {json.dumps({'error': 'Unexpected backend error. This has been logged — please try again.'})}\n\n"

    async def generate_with_timeout():
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                async for chunk in generate():
                    yield chunk
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'error': f'Request timed out after {REQUEST_TIMEOUT}s. Try a shorter input or faster model.'})}\n\n"

    return StreamingResponse(
        generate_with_timeout(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/credits")
async def get_credits(request: Request):
    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip() or None
    user_id = await verify_user_jwt(user_jwt)
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    # One client, reused for every query below, instead of spinning up a fresh
    # Supabase client (and re-authing it) for each of the four lookups.
    sb = get_supabase_for_user(user_jwt)

    key_results, usage_counts = await asyncio.gather(
        asyncio.gather(
            fetch_user_api_key(user_jwt, "claude", sb=sb),
            fetch_user_api_key(user_jwt, "openai", sb=sb),
        ),
        get_usage_counts(sb, user_id),
        return_exceptions=True,
    )

    if isinstance(key_results, Exception):
        has_own_key = False
    else:
        has_own_key = bool(key_results[0] or key_results[1])

    if isinstance(usage_counts, Exception):
        hourly_used, daily_used = 0, 0
    else:
        hourly_used, daily_used = usage_counts

    return {
        "has_own_key": has_own_key,
        "daily_used": daily_used,
        "daily_limit": DAILY_LIMIT,
        "hourly_used": hourly_used,
        "hourly_limit": HOURLY_LIMIT,
        "daily_remaining": max(0, DAILY_LIMIT - daily_used),
        "unlimited": has_own_key,
    }


async def _fire_webhook(webhook_url: str, app_id: str, user_input: str, result: str, provider: str, model: str):
    payload = {
        "event": "run.completed",
        "app_id": app_id,
        "input": user_input,
        "result": result,
        "provider": provider,
        "model": model,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(webhook_url, json=payload, headers={"Content-Type": "application/json", "User-Agent": "Aistrix-Webhook/1.0"})
    except Exception as e:
        print(f"Webhook failed: {e}")


# ─── Scheduled / recurring workspace runs ─────────────────────────────────────
FACT_EXTRACT_PROMPT = (
    'Extract durable facts about the person/subject discussed: skills, accessibility needs or '
    'disabilities, identity, constraints, preferences, goals. Return ONLY a flat JSON object of '
    'short key:value pairs (use arrays for multi-value keys, e.g. "skills":["C++","Python"]). '
    'No prose, no markdown fences. If nothing durable is found, return {}.'
)


def merge_memory(prev: dict, fresh: dict) -> dict:
    next_mem = dict(prev or {})
    for k, v in (fresh or {}).items():
        if isinstance(v, list):
            existing = next_mem.get(k) if isinstance(next_mem.get(k), list) else ([next_mem[k]] if next_mem.get(k) else [])
            next_mem[k] = list(dict.fromkeys([*existing, *[str(x) for x in v]]))
        elif v not in (None, ""):
            next_mem[k] = v
    return next_mem


async def run_text(system: str, user_input: str, provider: str, model: str) -> str:
    fn = stream_openai if provider == "openai" else stream_claude
    chunks = []
    async for tok in fn(system, user_input, model):
        chunks.append(tok)
    return "".join(chunks)


async def extract_facts_headless(text: str) -> dict:
    try:
        full = await run_text(FACT_EXTRACT_PROMPT, text[:8000], "claude", get_default_model("claude"))
        match = re.search(r"\{[\s\S]*\}", full)
        return json.loads(match.group(0)) if match else {}
    except Exception:
        return {}


def compute_next_run_at(now: datetime, frequency: str, hour_utc: int, day_of_week: Optional[int]) -> datetime:
    candidate = now.replace(hour=hour_utc, minute=0, second=0, microsecond=0)
    if frequency == "weekly" and day_of_week is not None:
        # Python weekday(): Mon=0..Sun=6; day_of_week here: Sun=0..Sat=6
        target_py_wd = (day_of_week - 1) % 7
        days_ahead = (target_py_wd - candidate.weekday()) % 7
        candidate = candidate + timedelta(days=days_ahead)
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


async def run_scheduled_workspace(sb_service: Client, schedule: dict):
    flow_id = schedule["flow_id"]
    flow_res = await db(sb_service.table("flows").select("*").eq("id", flow_id).single())
    flow = flow_res.data
    if not flow:
        return

    steps = flow.get("steps") or []
    if not steps:
        return

    memory = flow.get("memory") or {}
    provenance = flow.get("memory_provenance") or {}
    results = []
    current_input = schedule.get("seed_input") or ""

    for idx, step in enumerate(steps):
        app_res = await db(sb_service.table("apps").select("system_prompt, ai_provider, ai_model").eq("id", step["app_id"]).single())
        app_data = app_res.data or {}
        provider = app_data.get("ai_provider") or "claude"
        model = validate_model(provider, app_data.get("ai_model") or get_default_model(provider))

        blocks = []
        if flow.get("gpt_instructions"):
            gpt_name = flow.get("gpt_name") or "this workflow's dedicated assistant"
            blocks.append(
                f'You are acting as part of "{gpt_name}" — '
                f"a standing intelligence that governs every app in this workflow. Follow these standing instructions "
                f"for every response, in addition to your normal role:\n{flow['gpt_instructions']}"
            )
        if memory:
            mem_lines = "\n".join(f"- {k}: {', '.join(v) if isinstance(v, list) else v}" for k, v in memory.items())
            blocks.append(
                "Known facts about the user/subject, learned across this workflow over time — keep these "
                f"actively in mind even if not repeated in the current input:\n{mem_lines}"
            )
        if results:
            hist = "\n\n".join(f"### Step {i+1} — {steps[i]['app_name']} output:\n{r}" for i, r in enumerate(results))
            blocks.append(
                "This app is one step in a multi-app workflow. Here is everything produced by earlier steps, in "
                f"order — use it as context, and if your role is to compare/score/decide between them, do so "
                f"explicitly:\n\n{hist}"
            )

        system = app_data.get("system_prompt") or "You are a helpful AI assistant."
        if blocks:
            system = f"<user_context>\n{chr(10).join(blocks)}\n</user_context>\n\n{system}"

        full = await run_text(system, current_input, provider, model)
        results.append(full)

        await db(sb_service.table("run_history").insert({
            "user_id": schedule["user_id"], "app_id": step["app_id"], "app_name": step["app_name"],
            "input": current_input, "result": full,
        }))

        facts = await extract_facts_headless(full)
        if facts:
            memory = merge_memory(memory, facts)
            now_iso = datetime.now(timezone.utc).isoformat()
            for key in facts:
                provenance[key] = {"step_name": step["app_name"], "step_index": idx, "updated_at": now_iso}

        current_input = full

    await db(sb_service.table("flows").update({"memory": memory, "memory_provenance": provenance}).eq("id", flow_id))

    webhook_url = flow.get("integration_webhook_url")
    if webhook_url:
        text = f"*{flow.get('emoji','')} {flow['name']}* — scheduled run complete\n\n" + "\n\n".join(
            f"*{i+1}. {steps[i]['app_name']}*\n{(r or '')[:1500]}" for i, r in enumerate(results)
        )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(webhook_url, headers={"Content-Type": "text/plain"}, content=json.dumps({
                    "text": text, "workspace": flow["name"],
                    "steps": [{"app_name": steps[i]["app_name"], "result": results[i]} for i in range(len(steps))],
                }))
        except Exception as e:
            print(f"Scheduled-run webhook failed: {e}")


async def _execute_due_schedules() -> tuple[list, list]:
    """Shared by both schedule-trigger endpoints below (previously duplicated in full)."""
    sb_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    now = datetime.now(timezone.utc)
    due = await db(sb_service.table("flow_schedules").select("*").eq("enabled", True).lte("next_run_at", now.isoformat()))

    ran, failed = [], []
    for schedule in due.data or []:
        try:
            await run_scheduled_workspace(sb_service, schedule)
            next_run = compute_next_run_at(now, schedule["frequency"], schedule["hour_utc"], schedule.get("day_of_week"))
            await db(sb_service.table("flow_schedules").update({
                "last_run_at": now.isoformat(), "next_run_at": next_run.isoformat(),
            }).eq("id", schedule["id"]))
            ran.append(schedule["id"])
        except Exception as e:
            sentry_sdk.capture_exception(e)
            print(f"Scheduled run failed for {schedule['id']}: {e}")
            failed.append(schedule["id"])

    return ran, failed


@app.post("/cron/run-schedules")
async def run_due_schedules(request: Request):
    if not CRON_SECRET or request.headers.get("X-Cron-Secret") != CRON_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="SUPABASE_SERVICE_ROLE_KEY not configured")

    ran, failed = await _execute_due_schedules()
    return {"ran": ran, "failed": failed}


SCHEDULE_SECRET = os.getenv("SCHEDULE_SECRET")  # No hardcoded default — see check below.


@app.post("/run-schedules")
async def run_schedules_endpoint(request: Request):
    """Alternative schedule executor protected by X-Schedule-Secret header."""
    # Was: `os.getenv("SCHEDULE_SECRET", "aistrix-schedule")` — a hardcoded
    # fallback secret that's sitting right here in the source. Anyone reading
    # this file (or its history) could trigger this endpoint on any
    # deployment that forgot to set SCHEDULE_SECRET.
    if not SCHEDULE_SECRET or request.headers.get("X-Schedule-Secret") != SCHEDULE_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="SUPABASE_SERVICE_ROLE_KEY not configured")

    ran, failed = await _execute_due_schedules()
    return {"ran": len(ran), "failed": len(failed), "schedule_ids": ran}


@app.get("/schedule-status/{flow_id}")
async def schedule_status(flow_id: str, request: Request):
    """Return the schedule row for a given flow_id (used to show next run time in UI)."""
    await require_verified_user(request)
    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip()
    sb = get_supabase_for_user(user_jwt)
    result = await db(sb.table("flow_schedules").select("*").eq("flow_id", flow_id).maybe_single())
    return result.data or {}


# ─── Health + info endpoints ──────────────────────────────────────────────────
class PaymentIntentRequest(BaseModel):
    app_id: str
    amount: int = Field(..., gt=0, le=100000)  # in cents, max $1000
    currency: str = "usd"


@app.post("/create-payment-intent")
async def create_payment_intent(req: PaymentIntentRequest, request: Request):
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured on this server")

    stripe.api_key = secret_key
    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip() or None
    user_id = extract_user_id(user_jwt) if user_jwt else None

    try:
        # stripe's SDK is synchronous/blocking — offload it so it doesn't stall
        # the event loop (and every concurrent streaming /run request) while it
        # waits on Stripe's API.
        intent = await asyncio.to_thread(
            stripe.PaymentIntent.create,
            amount=req.amount,
            currency=req.currency,
            metadata={"app_id": req.app_id, "user_id": user_id or "anonymous"},
            automatic_payment_methods={"enabled": True},
        )
        return {"client_secret": intent.client_secret}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e.user_message))


@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe payment webhooks."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    stripe.api_key = secret_key
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        if webhook_secret:
            event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        else:
            event = stripe.Event.construct_from({"data": {"object": {}}}, secret_key)

        if event["type"] == "payment_intent.succeeded":
            pi = event["data"]["object"]
            print(f"Payment succeeded: {pi['id']} for app {pi.get('metadata', {}).get('app_id')}")

        return {"received": True}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")


@app.get("/sentry-test")
def sentry_test():
    """Trigger a test Sentry event to verify the integration is working."""
    try:
        raise ValueError("Sentry test error — if you see this in Sentry, the integration is working!")
    except ValueError as e:
        sentry_sdk.capture_exception(e)
    return {"message": "Test error sent to Sentry. Check your Sentry dashboard in ~30 seconds."}


class ModelSelectRequest(BaseModel):
    system_prompt: Optional[str] = None
    input: str
    provider: Optional[str] = "claude"

@app.post("/select-model")
async def select_model(body: ModelSelectRequest, request: Request):
    """Analyse task complexity and return the best model to use."""
    # Real verification instead of a bare "Bearer " prefix check — this
    # endpoint triggers a billed Anthropic API call per request.
    await require_verified_user(request)

    provider = body.provider or "claude"

    CLAUDE_MODELS = {
        "simple":  "claude-haiku-4-5-20251001",
        "medium":  "claude-sonnet-4-6",
        "complex": "claude-opus-4-8",
    }
    OPENAI_MODELS = {
        "simple":  "gpt-4o-mini",
        "medium":  "gpt-4o-mini",
        "complex": "gpt-4o",
    }

    classifier_prompt = (
        "You are a task complexity classifier. Given a task description and optional system prompt, "
        "classify the complexity as one of: simple, medium, complex.\n\n"
        "Rules:\n"
        "- simple: factual lookup, basic math, short text, single clear question (e.g. '1+1', 'what is the capital of France')\n"
        "- medium: writing, summarising, analysis, multi-step reasoning, coding tasks\n"
        "- complex: deep research, long-form content, multi-perspective analysis, legal/medical reasoning, comparing many options\n\n"
        "Return ONLY one word: simple, medium, or complex."
    )

    task_desc = f"System prompt: {body.system_prompt or 'none'}\nUser input: {body.input}"

    try:
        client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=10,
            system=classifier_prompt,
            messages=[{"role": "user", "content": task_desc}],
            temperature=0,
        )
        tier = response.content[0].text.strip().lower()
        if tier not in ("simple", "medium", "complex"):
            tier = "medium"
    except Exception:
        tier = "medium"

    models = CLAUDE_MODELS if provider != "openai" else OPENAI_MODELS
    selected = models[tier]

    tier_labels = {
        "simple":  "Fast — simple task detected",
        "medium":  "Balanced — standard reasoning",
        "complex": "Powerful — complex task detected",
    }

    return {"model": selected, "tier": tier, "label": tier_labels[tier], "provider": provider}


class ProxyRequest(BaseModel):
    method: str = "GET"
    url: str
    body: Optional[str] = None
    headers: Optional[dict] = None

@app.post("/proxy")
async def proxy_request(body: ProxyRequest, request: Request):
    """Server-side HTTP proxy — lets workspace API Call steps hit external URLs without CORS issues."""
    # Was: `if not auth_header.startswith("Bearer "):` — that's not
    # authentication, it accepts any string. This endpoint lets a caller make
    # the server issue arbitrary outbound requests, so it needs a real check.
    await require_verified_user(request)

    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    method = body.method.upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
        raise HTTPException(status_code=400, detail=f"Unsupported method: {method}")

    req_headers = {
        "User-Agent": "Aistrix-Workspace/1.0",
        "Accept": "application/json, text/plain, */*",
    }
    if body.headers:
        req_headers.update(body.headers)

    req_body = body.body.encode() if body.body else None
    if req_body and "Content-Type" not in req_headers:
        req_headers["Content-Type"] = "application/json"

    try:
        # fetch_safely rejects URLs (and redirect hops) that resolve to
        # internal/private addresses — previously this was a plain httpx call
        # with follow_redirects=True, i.e. an open SSRF-capable proxy for
        # anyone who could send an `Authorization: Bearer x` header.
        resp = await fetch_safely(method, url, timeout=20, content=req_body, headers=req_headers)

        # Try to parse as JSON, fall back to text
        try:
            resp_body = resp.json()
        except Exception:
            resp_body = resp.text

        return {"status": resp.status_code, "body": resp_body, "url": str(resp.url)}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request timed out (20s)")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=502, detail="Could not complete the proxied request.")


class ScrapeRequest(BaseModel):
    url: str

@app.post("/scrape")
async def scrape_website(body: ScrapeRequest, request: Request):
    """Fetch a URL server-side and return its visible text content."""
    # Real verification instead of a bare "Bearer " prefix check (see
    # require_verified_user) — this endpoint fetches arbitrary caller-supplied
    # URLs server-side, so it needs actual auth plus SSRF protection.
    await require_verified_user(request)
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; Aistrix/1.0; +https://aistrix.app)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        resp = await fetch_safely("GET", url, timeout=15, headers=headers)
        resp.raise_for_status()
        html = resp.text

        # Strip tags and collapse whitespace to get clean readable text
        # (re is already imported at module level — no need to re-import per request)
        text = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"&[a-z]+;", " ", text)
        text = re.sub(r"\s{2,}", " ", text).strip()

        return {"text": text[:8000], "url": str(resp.url)}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Site returned {e.response.status_code}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=502, detail="Could not fetch that URL.")


@app.post("/webhooks/{token}")
async def trigger_via_webhook(token: str, request: Request):
    """Trigger a workflow via its unique webhook token. No user auth required — the token IS the credential."""
    if not token or len(token) < 16:
        raise HTTPException(status_code=400, detail="Invalid token")

    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Server not configured for webhook triggers")

    sb_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    result = await db(sb_service.table("flows").select("*").eq("webhook_token", token).maybe_single())
    flow = result.data
    if not flow:
        raise HTTPException(status_code=404, detail="Workflow not found or webhook not enabled")

    # Parse seed input from request body
    seed_input = ""
    try:
        body_bytes = await request.body()
        if body_bytes:
            try:
                parsed = json.loads(body_bytes)
                if isinstance(parsed, dict):
                    seed_input = parsed.get("input") or parsed.get("text") or json.dumps(parsed)
                else:
                    seed_input = str(parsed)
            except json.JSONDecodeError:
                seed_input = body_bytes.decode("utf-8", errors="replace")
    except Exception:
        pass

    steps = flow.get("steps") or []
    if not steps:
        raise HTTPException(status_code=422, detail="Workflow has no steps")

    # Filter out human_approval steps for headless webhook runs
    runnable_steps = [s for s in steps if s.get("step_type") != "human_approval"]
    if not runnable_steps:
        raise HTTPException(status_code=422, detail="Workflow has no runnable steps (only approval gates)")

    # Run headless — reuse the same logic as scheduled runs
    fake_schedule = {
        "flow_id": flow["id"],
        "user_id": flow["user_id"],
        "seed_input": seed_input,
    }

    try:
        await run_scheduled_workspace(sb_service, fake_schedule)
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=500, detail=f"Workflow run failed: {str(e)}")

    return {
        "ok": True,
        "flow": flow["name"],
        "steps_run": len(runnable_steps),
        "message": "Workflow triggered successfully. Results saved to run history.",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "providers": ["claude", "openai"],
        "limits": {"hourly": HOURLY_LIMIT, "daily": DAILY_LIMIT},
        "timeout": REQUEST_TIMEOUT,
    }


@app.get("/")
def root():
    return {"message": "Aistrix API", "version": "1.0.0", "docs": "/docs"}
