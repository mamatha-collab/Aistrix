import asyncio
import contextvars
import ast
import csv
import html as html_lib
import hashlib
import hmac
from functools import partial
import io
import ipaddress
import json
from urllib.parse import urlencode
from html import escape as html_escape
import math
import operator
import os
import random
import re
import secrets
import socket
import time
import uuid
from collections import Counter, defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator, Optional
from urllib.parse import urlsplit

import anthropic
import httpx
import openai
import sentry_sdk
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from jose import jwt as jose_jwt
from pydantic import BaseModel, Field, field_validator
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions
from telemetry import configured_outbox
import flow_plan
import outbound
import reference_workflows
import spend_guard
import tool_contracts
from outbound import assert_public_url, fetch_safely

load_dotenv()

# The product's name and domain, in one place (a rename is BRAND_NAME /
# BRAND_DOMAIN; the frontend has VITE_BRAND_NAME / VITE_BRAND_DOMAIN).
# Protocol names developers rely on (the X-Aistrix-Signature webhook header,
# the SDK) stay fixed.
BRAND_NAME = os.getenv("BRAND_NAME", "Aistrix")
BRAND_DOMAIN = os.getenv("BRAND_DOMAIN", "aistrix.ai")
_telemetry_outbox = configured_outbox()
_telemetry_client = None

# ─── Sentry ───────────────────────────────────────────────────────────────────
# Anything that looks like a credential is masked before an error report
# leaves the server (provider keys, Fernet ciphertext, Aistrix API keys,
# SendGrid/GitHub tokens, bearer headers).
_KEY_LIKE = re.compile(
    r"(sk-ant-[\w-]{8,}|sk-(?:proj-)?[\w-]{16,}|AIza[\w-]{20,}|gAAAA[\w=-]{20,}|ak_live_\w{8,}"
    r"|SG\.[\w.-]{16,}|gh[pousr]_\w{20,}|Bearer\s+[\w.~+/-]{16,}=*)")


def _scrub_keys(value):
    if isinstance(value, str):
        return _KEY_LIKE.sub("[redacted]", value)
    if isinstance(value, dict):
        return {k: _scrub_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_keys(v) for v in value]
    return value


def _scrub_event(event, hint):
    return _scrub_keys(event)


SENTRY_DSN = os.getenv("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
        environment=os.getenv("ENVIRONMENT", "production"),
        # Stack-frame locals would include decrypted keys (user_api_key,
        # dev_key, …), which Sentry's name-based scrubbing doesn't catch.
        include_local_variables=False,
        send_default_pii=False,
        before_send=_scrub_event,
        before_send_transaction=_scrub_event,
    )

@asynccontextmanager
async def lifespan(_app):
    # Resume batch jobs left queued/interrupted by a restart, and keep sweeping
    # so another worker picks up jobs whose worker died (stale heartbeat).
    supervisor = asyncio.create_task(_batch_supervisor())
    telemetry_worker = asyncio.create_task(_telemetry_supervisor())
    scheduler = asyncio.create_task(_scheduler_loop())
    developer_jobs = asyncio.create_task(_developer_jobs_supervisor())
    try:
        report_production_config()
    except Exception as e:                  # a report, never a reason not to start
        print(f"startup config report failed: {type(e).__name__}")
    try:
        yield
    finally:
        for task in (supervisor, telemetry_worker, scheduler, developer_jobs, *_FLOW_TASKS):
            task.cancel()
        await asyncio.gather(supervisor, telemetry_worker, scheduler, developer_jobs, *_FLOW_TASKS, return_exceptions=True)


app = FastAPI(title=f"{BRAND_NAME} API", version="1.0.0", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def readable_validation_error(request: Request, exc: RequestValidationError):
    """422s used to reach the browser as a list of objects ("[object Object]").
    Keep FastAPI's `detail` list and add one readable `error` sentence."""
    errors = exc.errors()
    first = errors[0] if errors else {}
    msg = str(first.get("msg") or "Invalid request").removeprefix("Value error, ")
    field = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    readable = msg if not field or field in msg.lower() else f"{field}: {msg}"
    return JSONResponse(status_code=422, content={"detail": jsonable_errors(errors), "error": readable})


def jsonable_errors(errors: list) -> list:
    return [{k: (v if isinstance(v, (str, int, float, bool, list, type(None))) else str(v))
             for k, v in e.items() if k != "ctx"} for e in errors]

class CatchServerErrors:
    """Turns an unexpected exception into a readable JSON 500.

    Added before CORSMiddleware so CORS wraps it: without this, Starlette's
    outermost error handler answers with no CORS headers and the browser only
    says "Failed to fetch". Errors after a response has started (mid-stream)
    can't be replaced and are re-raised."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as e:
            if started:
                raise
            sentry_sdk.capture_exception(e)
            print(f"Unhandled error on {scope.get('method')} {scope.get('path')}: {type(e).__name__}: {e}")
            await JSONResponse(status_code=500, content={
                "error": "Server error — something went wrong on our side. Please try again.",
                "type": type(e).__name__})(scope, receive, send)


app.add_middleware(CatchServerErrors)

# ALLOWED_CLIENT_IPS: a private deployment (e.g. hosted staging before launch)
# answers only these addresses or ranges ("203.0.113.7, 198.51.100.0/24").
# Empty = open to everyone. /health stays open for the host's health check.
# Behind the host's proxy, set TRUST_PROXY_HEADERS=1 so the real address is seen.
ALLOWED_CLIENT_IPS = [ipaddress.ip_network(x.strip(), strict=False)
                      for x in os.getenv("ALLOWED_CLIENT_IPS", "").split(",") if x.strip()]


class OnlyAllowedClients:
    def __init__(self, app_): self.app = app_

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not ALLOWED_CLIENT_IPS or scope.get("path") in ("/health", "/health/ready"):
            return await self.app(scope, receive, send)
        ip = (scope.get("client") or ("", 0))[0]
        if os.getenv("TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes"):
            fwd = dict(scope.get("headers") or []).get(b"x-forwarded-for", b"").decode()
            ip = fwd.split(",")[0].strip() or ip
        try:
            allowed = any(ipaddress.ip_address(ip) in net for net in ALLOWED_CLIENT_IPS)
        except ValueError:
            allowed = False
        if not allowed:
            return await JSONResponse(status_code=403, content={"error": f"This {BRAND_NAME} server isn't open to your network."})(scope, receive, send)
        return await self.app(scope, receive, send)


app.add_middleware(OnlyAllowedClients)

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Narrowed from ["*"]/["*"] — only the methods/headers this API actually uses.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret", "X-Schedule-Secret", "X-Workspace-Id"],
)

SUPABASE_URL              = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY         = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
RESEND_API_KEY            = os.getenv("RESEND_API_KEY")
EMAIL_FROM                = os.getenv("EMAIL_FROM", f"{BRAND_NAME} <noreply@{BRAND_DOMAIN}>")
STRIPE_PLATFORM_FEE_PCT   = float(os.getenv("STRIPE_PLATFORM_FEE_PCT", "20"))  # % Aistrix keeps
FRONTEND_URL              = os.getenv("FRONTEND_URL", "http://localhost:3000")
# This API's own public address (test destination URLs point here).
API_PUBLIC_URL            = (os.getenv("API_PUBLIC_URL") or "http://localhost:8001").rstrip("/")
GITHUB_CLIENT_ID          = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET      = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_REDIRECT_URI       = os.getenv("GITHUB_REDIRECT_URI")  # e.g. https://api.aistrix.ai/auth/github/callback

# Short-lived nonce store for GitHub OAuth CSRF protection: nonce → (user_id, expiry_ts)
OAUTH_STATE_SECONDS = 600   # how long a "Connect GitHub" link stays valid


async def use_once(key: str) -> bool:
    """True the first time any server sees `key`, False after (server_once)."""
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="This isn't available on this server right now")
    try:
        await db(sb.table("server_once").insert({"key": key[:300]}))
        return True
    except Exception as e:
        if "23505" in str(e) or "duplicate" in str(e).lower():
            return False
        raise
CRON_SECRET               = os.getenv("CRON_SECRET")
SECRET_ENCRYPTION_KEY     = os.getenv("SECRET_ENCRYPTION_KEY")  # Fernet key (base64, 32 bytes)
_fernet: "Fernet | None" = Fernet(SECRET_ENCRYPTION_KEY.encode()) if SECRET_ENCRYPTION_KEY else None

def _encrypt(value: str) -> str:
    if not _fernet:
        raise HTTPException(status_code=503, detail="Secret encryption not configured (set SECRET_ENCRYPTION_KEY)")
    return _fernet.encrypt(value.encode()).decode()

def _decrypt(token: str) -> str:
    if not _fernet:
        raise HTTPException(status_code=503, detail="Secret encryption not configured")
    return _fernet.decrypt(token.encode()).decode()


def _open_key(stored: Optional[str]) -> Optional[str]:
    """A saved provider key. Keys are Fernet-encrypted by /v1/provider-keys;
    rows saved before that are plaintext and returned as-is (and re-encrypted
    on their next read by fetch_user_api_key_by_id)."""
    if not stored:
        return None
    if stored.startswith("gAAAA") and _fernet:
        try:
            return _fernet.decrypt(stored.encode()).decode()
        except InvalidToken:
            return None
    return stored
REQUEST_TIMEOUT           = int(os.getenv("REQUEST_TIMEOUT", "180"))
HOURLY_LIMIT              = int(os.getenv("RATE_LIMIT_PER_HOUR", "30"))
DAILY_LIMIT               = int(os.getenv("RATE_LIMIT_PER_DAY", "200"))
MAX_INPUT_LENGTH          = int(os.getenv("MAX_INPUT_LENGTH", "20000"))
# Hosts of self-run models an operator has approved for private-only work.
PRIVATE_MODEL_HOSTS       = frozenset(h.strip().lower() for h in os.getenv("PRIVATE_MODEL_HOSTS", "").split(",") if h.strip())
MAX_SYSTEM_LENGTH         = int(os.getenv("MAX_SYSTEM_LENGTH", "10000"))

# Ops-facing failure-rate alerting — pings a generic webhook (Slack incoming
# webhooks accept this exact {"text": ...} shape; any other receiver can just
# read the field) when /run is failing at an elevated rate. Unset URL disables
# it entirely — no default, matching CRON_SECRET/SCHEDULE_SECRET's fail-closed
# pattern rather than silently alerting nowhere.
OPS_ALERT_WEBHOOK_URL       = os.getenv("OPS_ALERT_WEBHOOK_URL")
OPS_ALERT_FAILURE_THRESHOLD = float(os.getenv("OPS_ALERT_FAILURE_THRESHOLD", "0.3"))
OPS_ALERT_MIN_SAMPLES       = int(os.getenv("OPS_ALERT_MIN_SAMPLES", "10"))
OPS_ALERT_WINDOW_SECONDS    = int(os.getenv("OPS_ALERT_WINDOW_SECONDS", "900"))
OPS_ALERT_COOLDOWN_SECONDS  = int(os.getenv("OPS_ALERT_COOLDOWN_SECONDS", "1800"))

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


WRONG_ENVIRONMENT = ("This sign-in is for a different environment than this server (for example production "
                     "instead of staging). Sign out and sign in again here; if it keeps happening, the app and the "
                     "server are set up for different projects.")


def _token_issuer(user_jwt: str) -> Optional[str]:
    """The token's issuer, read without verifying. Used only to explain a
    refusal (a token from another Supabase project), never to accept one."""
    try:
        import base64
        payload = user_jwt.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("iss")
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
    issuer = _token_issuer(user_jwt)
    expected = f"{(SUPABASE_URL or '').rstrip('/')}/auth/v1"
    if issuer and SUPABASE_URL and issuer.rstrip("/") != expected:
        # e.g. the frontend runs against production while this server uses staging.
        print(f"sign-in from another project refused: token issuer {issuer}, this server {expected}")
        raise HTTPException(status_code=401, detail=WRONG_ENVIRONMENT)
    try:
        resp = await asyncio.to_thread(get_anon_client().auth.get_user, user_jwt)
        return resp.user.id if resp and resp.user else None
    except Exception as e:
        # Supabase Auth said no (bad, expired or revoked token): not signed in.
        # Anything else (network, timeout, misconfiguration) is our outage,
        # not the caller's fault, so it isn't reported as "Unauthorized".
        status = getattr(e, "status", None)
        if type(e).__name__ in ("AuthApiError", "AuthInvalidJwtError", "AuthSessionMissingError") and (status is None or 400 <= int(status) < 500):
            print(f"sign-in check refused: {type(e).__name__} {status}: {str(e)[:160]}")
            return None
        print(f"sign-in check unavailable: {type(e).__name__}: {str(e)[:200]}")
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=503, detail="Sign-in can't be checked right now. Try again shortly.")


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
# The checks themselves live in outbound.py (DNS pinning, allow/block lists,
# credential-safe redirects); assert_public_url and fetch_safely are imported
# from there.


# ─── Anonymous (unauthenticated) rate limiting ────────────────────────────────
# Atomic, sliding-hour visitor limits shared by every API process/replica.
# Buckets contain a keyed hash of scope/IP; the database stores no raw IP.
ANON_HOURLY_LIMIT = int(os.getenv("ANON_RATE_LIMIT_PER_HOUR", "10"))


TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes")
EMBED_VISITOR_HOURLY_LIMIT = int(os.getenv("EMBED_VISITOR_RATE_LIMIT_PER_HOUR", "20"))
# Default daily runs per end user on apps whose developer's key pays (apps can set their own).
DEV_KEY_RUNS_PER_USER_DAY = int(os.getenv("DEV_KEY_RUNS_PER_USER_DAY", "20"))


def client_ip(request: Request) -> str:
    """Real client IP. Behind a load balancer request.client.host is the
    proxy, which would put every anonymous user in one shared bucket — set
    TRUST_PROXY_HEADERS=1 when the backend sits behind a trusted proxy."""
    if TRUST_PROXY_HEADERS:
        fwd = request.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


_sb_visitor_limits = None


def _visitor_limit_client():
    global _sb_visitor_limits
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    if _sb_visitor_limits is None:
        _sb_visitor_limits = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, options=SyncClientOptions(
            httpx_client=httpx.Client(http2=False, timeout=3,
                                      limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))))
    return _sb_visitor_limits


async def consume_visitor_limit(scope: str, ip: str, limit: int) -> bool:
    if limit <= 0:
        return False
    key = os.getenv("RATE_LIMIT_HASH_KEY") or SUPABASE_SERVICE_ROLE_KEY
    if not key:
        raise HTTPException(status_code=503, detail="Visitor access is temporarily unavailable. Please try again later.")
    bucket = hmac.new(key.encode(), f"{scope}:{ip}".encode(), hashlib.sha256).hexdigest()
    try:
        sb = _visitor_limit_client()
        if not sb:
            raise ValueError("Visitor limit storage is unavailable")
        result = await asyncio.wait_for(db(sb.rpc("consume_visitor_limit", {"p_bucket": bucket, "p_limit": limit})), timeout=4)
        if not isinstance(result.data, bool):
            raise ValueError("Invalid visitor limit response")
        return result.data
    except Exception:
        # Never fall back to a fresh per-process bucket on an outage/restart.
        raise HTTPException(status_code=503, detail="Visitor access is temporarily unavailable. Please try again later.") from None


async def check_embed_visitor_rate_limit(ip: str, app_id: str) -> tuple[bool, str]:
    allowed = await consume_visitor_limit(f"embed:{app_id}", ip, EMBED_VISITOR_HOURLY_LIMIT)
    return allowed, "" if allowed else "You've reached the hourly limit for this assistant. Please try again later."


async def check_anon_rate_limit(ip: str) -> tuple[bool, str]:
    allowed = await consume_visitor_limit("anonymous", ip, ANON_HOURLY_LIMIT)
    return allowed, "" if allowed else f"Rate limit: {ANON_HOURLY_LIMIT} free runs/hour for anonymous use. Sign in or add your own API key for higher limits."


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
        return _open_key(result.data["encrypted_key"]) if result and result.data else None
    except Exception:
        return None


async def fetch_app_knowledge(app_id: str) -> str:
    try:
        query = (_service_client() or get_anon_client()).table("app_knowledge").select("title, content").eq("app_id", app_id)
        result = await db(query)
        if not result.data:
            return ""
        return "\n\n".join(f"## {i['title']}\n{i['content']}" for i in result.data)
    except Exception:
        return ""


async def fetch_app_tools(app_id: str) -> list:
    try:
        query = (_service_client() or get_anon_client()).table("app_tools").select("*").eq("app_id", app_id)
        result = await db(query)
        return result.data or []
    except Exception:
        return []


# ─── App access helpers (service role — server is the source of truth) ───────
# One shared service-role client: creating one per query cost ~0.5s each
# (new client + new TLS connection), and a single request makes several.
_sb_service: Optional[Client] = None


def _service_client() -> Optional[Client]:
    global _sb_service
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    if _sb_service is None:
        # Shared by every request, and db() runs queries in worker threads:
        # one HTTP/2 connection used from several threads at once gets torn
        # down (ConnectionTerminated). HTTP/1.1's pool is safe across threads.
        _sb_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, options=SyncClientOptions(
            httpx_client=httpx.Client(http2=False, timeout=120,
                                      limits=httpx.Limits(max_connections=50, max_keepalive_connections=20))))
    return _sb_service


async def load_app_row(app_id: Optional[str]) -> Optional[dict]:
    sb = _service_client()
    if not (app_id and sb):
        return None
    try:
        res = await db(sb.table("apps").select("*").eq("id", app_id).maybe_single())
        return res.data if res and res.data else None
    except Exception as e:
        if "22P02" in str(e):   # not a valid id → no such app
            return None
        # A failed lookup must not read as "App not found".
        print(f"load_app_row error: {type(e).__name__}: {str(e)[:200]}")
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=503, detail="Couldn't load the app right now. Please try again.")


async def app_member_role(app_id: str, user_id: Optional[str]) -> Optional[str]:
    sb = _service_client()
    if not (sb and user_id):
        return None
    try:
        res = await db(sb.table("app_members").select("role").eq("app_id", app_id).eq("user_id", user_id).limit(1))
        return res.data[0]["role"] if res and res.data else None
    except Exception as e:
        if _missing_table(e):
            return None   # table may not exist on older deployments
        raise _access_check_failed(e)


BUILD_ROLES = ("owner", "admin", "developer")     # build/edit apps, tools, keys
MANAGE_ROLES = ("owner", "admin")                 # people, settings, everyone's activity
BILLING_ROLES = ("owner", "admin", "billing")     # purchases
_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def _missing_table(e: Exception) -> bool:
    """Table/column not migrated yet (older deployments) — as opposed to a
    real failure (network, timeout), which must not read as "no access"."""
    text = str(e)
    return any(code in text for code in ("PGRST205", "42P01", "42703", "PGRST204")) or "does not exist" in text


def _access_check_failed(e: Exception):
    print(f"access check failed: {type(e).__name__}: {str(e)[:200]}")
    sentry_sdk.capture_exception(e)
    return HTTPException(status_code=503, detail="Couldn't check your access right now. Please try again.")


async def workspace_role(workspace_id: Optional[str], user_id: Optional[str]) -> Optional[str]:
    sb = _service_client()
    if not (sb and workspace_id and user_id):
        return None
    try:
        res = await db(sb.table("workspace_members").select("role")
                       .eq("workspace_id", workspace_id).eq("user_id", user_id).limit(1))
        return res.data[0]["role"] if res and res.data else None
    except Exception as e:
        if _missing_table(e):
            return None   # workspaces not migrated yet
        raise _access_check_failed(e)


async def personal_workspace_id(user_id: Optional[str]) -> Optional[str]:
    sb = _service_client()
    if not (sb and user_id):
        return None
    try:
        res = await db(sb.table("workspaces").select("id").eq("personal_owner_id", user_id).limit(1))
        return res.data[0]["id"] if res and res.data else None
    except Exception as e:
        if _missing_table(e):
            return None
        raise _access_check_failed(e)


async def resolve_user_workspace(user_id: str, requested: Optional[str]) -> Optional[str]:
    """The workspace a signed-in request acts in: X-Workspace-Id when the user
    is a member of it, otherwise their Personal workspace."""
    if requested:
        if not _UUID_RE.fullmatch(requested):
            raise HTTPException(status_code=400, detail="X-Workspace-Id is not a valid id")
        if not await workspace_role(requested, user_id):
            raise HTTPException(status_code=403, detail="You're not a member of that workspace")
        return requested
    return await personal_workspace_id(user_id)


async def can_edit_app(app_row: Optional[dict], caller) -> bool:
    """May run unsaved drafts, skip the paywall and see the prompt.

    API keys act for their workspace only: any app in that workspace, nothing
    else — even if the key's creator belongs to other workspaces too."""
    if not (app_row and caller and caller.user_id):
        return False
    ws = app_row.get("workspace_id")
    if caller.via_key:
        return bool(ws) and ws == caller.workspace_id
    if app_row.get("created_by") == caller.user_id:
        return True
    if ws and (await workspace_role(ws, caller.user_id)) in BUILD_ROLES:
        return True
    return (await app_member_role(app_row["id"], caller.user_id)) in ("editor", "owner")


async def can_view_app(app_row: Optional[dict], caller) -> bool:
    """May run this app even when it isn't published (any workspace member)."""
    if await can_edit_app(app_row, caller):
        return True
    if not (app_row and caller and caller.user_id) or caller.via_key:
        return False
    ws = app_row.get("workspace_id")
    if ws and await workspace_role(ws, caller.user_id):
        return True
    return bool(await app_member_role(app_row["id"], caller.user_id))


async def find_active_entitlement(app_id: str, caller) -> Optional[dict]:
    """A purchase covers the buying workspace: any member (or a key of that
    workspace) can use it. Purchases made before workspaces match by user."""
    sb = _service_client()
    if not (sb and caller and caller.user_id):
        return None
    conds = []
    if caller.workspace_id:
        conds.append(f"workspace_id.eq.{caller.workspace_id}")
    if not caller.via_key:
        conds.append(f"user_id.eq.{caller.user_id}")
    if not conds:
        return None
    try:
        res = await db(sb.table("app_entitlements").select("*")
                       .eq("app_id", app_id).eq("status", "active").or_(",".join(conds))
                       .order("created_at", desc=True).limit(1))
        return res.data[0] if res and res.data else None
    except Exception as e:
        print(f"find_active_entitlement error: {e}")
        return None


def entitlement_block_reason(ent: dict) -> Optional[str]:
    end = ent.get("current_period_end")
    if end:
        try:
            if datetime.fromisoformat(str(end).replace("Z", "+00:00")) < datetime.now(timezone.utc):
                return "Your access period has ended — renew to keep running this app"
        except ValueError:
            pass
    quota = ent.get("run_quota")
    if quota is not None and (ent.get("runs_this_period") or 0) >= quota:
        if ent.get("plan") == "pay_per_run":
            return "You've used the runs you bought — buy another run to keep using this app"
        return f"You've used all {quota} runs in this period — top up to keep running this app"
    return None


async def reserve_entitlement_run(ent: dict) -> Optional[int]:
    """Take one run from the buyer's access before the model is called.
    Atomic in the database, so two runs started together can't both use the
    last purchased run. Returns runs used (including this one), or None when
    none are left. Server-side only (buyers can't write app_entitlements)."""
    sb = _service_client()
    if not sb:
        return None
    res = await db(sb.rpc("reserve_entitlement_run", {"p_entitlement_id": ent["id"]}))
    data = res.data[0] if isinstance(res.data, list) and res.data else res.data
    if isinstance(data, dict):
        data = next(iter(data.values()), None)
    return data if isinstance(data, int) else None


async def release_entitlement_run(ent: dict) -> None:
    """Give a reserved run back: the run failed or was cancelled."""
    try:
        await db(_service_client().rpc("release_entitlement_run", {"p_entitlement_id": ent["id"]}))
    except Exception as e:
        print(f"release_entitlement_run error: {type(e).__name__}")
        sentry_sdk.capture_exception(e)


async def notify_low_runs(ent: dict, used: int, app_name: str) -> None:
    """Email a subscriber once they've used 80% of their period's runs."""
    quota = ent.get("run_quota")
    if ent.get("plan") == "pay_per_run" or not quota or used != math.floor(quota * 0.8) or used >= quota:
        return
    email = await _lookup_email(ent["user_id"])
    if email:
        remaining = quota - used
        await send_email(
            to=email,
            subject=f"You've used 80% of your runs for {app_name}",
            html=_email_base(
                title=f"Running low on {html_escape(app_name)}",
                body=f"You've used <strong style='color:#fff'>{used} of {quota} runs</strong>. "
                     f"You have <strong style='color:#fff'>{remaining} run{'s' if remaining != 1 else ''}</strong> left in this period.",
                cta_url=FRONTEND_URL, cta_label="Top up →",
            ),
        )


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def resolve_developer_key(raw_key: str) -> Optional[dict]:
    """ak_live_ key → {"user_id", "app_ids", "key_id"} (and bump usage counters).

    Keys are looked up by their SHA-256 hash; the raw key is never stored."""
    sb = _service_client()
    if not (sb and raw_key.startswith("ak_live_")):
        return None
    try:
        res = await db(sb.table("developer_api_keys").select("id, user_id, workspace_id, app_ids, total_calls")
                       .eq("key_hash", hash_api_key(raw_key)).eq("is_active", True).limit(1))
    except Exception as e:
        print(f"resolve_developer_key error: {e}")
        return None
    row = res.data[0] if res and res.data else None
    if row is None:
        return None
    asyncio.create_task(db(sb.table("developer_api_keys").update({
        "last_used_at": datetime.now(timezone.utc).isoformat(),
        "total_calls": (row.get("total_calls") or 0) + 1,
    }).eq("id", row["id"])))
    return {"user_id": row["user_id"], "workspace_id": row.get("workspace_id"),
            "app_ids": row.get("app_ids") or [], "key_id": row["id"]}


@dataclass
class ApiCaller:
    user_id: Optional[str] = None
    user_jwt: Optional[str] = None
    workspace_id: Optional[str] = None             # active workspace (key's, or X-Workspace-Id)
    app_ids: list = field(default_factory=list)   # non-empty = key restricted to these apps
    via_key: bool = False
    live: bool = False                             # run the live version even if it can edit (inbound triggers)


async def resolve_api_caller(request: Request, *, required: bool = False) -> ApiCaller:
    """Authenticate a public-API request: `Bearer ak_live_…` or a Supabase JWT."""
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if token.startswith("ak_live_"):
        info = await resolve_developer_key(token)
        if not info:
            raise HTTPException(status_code=401, detail="Invalid or revoked API key")
        ws = info["workspace_id"] or await personal_workspace_id(info["user_id"])
        return ApiCaller(user_id=info["user_id"], workspace_id=ws, app_ids=info["app_ids"], via_key=True)
    if token:
        uid = await verify_user_jwt(token)
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid or expired session token")
        ws = await resolve_user_workspace(uid, request.headers.get("X-Workspace-Id"))
        return ApiCaller(user_id=uid, user_jwt=token, workspace_id=ws)
    if required:
        raise HTTPException(status_code=401, detail="Pass an API key: Authorization: Bearer ak_live_…")
    return ApiCaller()


def assert_key_scope(caller: ApiCaller, app_id: str) -> None:
    if caller.app_ids and app_id not in caller.app_ids:
        raise HTTPException(status_code=403, detail="This API key is restricted to other apps")


async def fetch_user_api_key_by_id(user_id: str, provider: str) -> Optional[str]:
    sb = _service_client()
    if not sb:
        return None
    try:
        res = await db(sb.table("user_api_keys").select("id, encrypted_key")
                       .eq("user_id", user_id).eq("provider", provider).eq("is_active", True).limit(1))
        if not (res and res.data):
            return None
        row = res.data[0]
        key = _open_key(row["encrypted_key"])
        if key and key == row["encrypted_key"] and _fernet:
            # Saved before keys were encrypted: encrypt it now.
            asyncio.create_task(db(sb.table("user_api_keys").update(
                {"encrypted_key": _encrypt(key), "last4": key[-4:]}).eq("id", row["id"])))
        return key
    except Exception:
        return None


# ─── Rate limiting (Supabase-backed — works across all workers) ───────────────
async def get_usage_counts(sb: Client, user_id: str) -> tuple[int, int]:
    """Returns (hourly_count, daily_count) of platform-metered runs.

    Counts run_events, which only the backend writes. run_history used to be
    the source, but browsers write (and users can delete) those rows, so
    skipping the insert or clearing history reset the limit."""
    now = datetime.now(timezone.utc)
    one_hour_ago = (now - timedelta(hours=1)).isoformat()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    svc = _service_client() or sb

    async def counts(table: str) -> tuple[int, int]:
        def q(since):
            query = svc.table(table).select("id", count="exact", head=True).eq("user_id", user_id).gte("created_at", since)
            # Runs paid by an app developer's key have their own per-app limit.
            return query.neq("source", "dev_key") if table == "run_events" else query
        h, d = await asyncio.gather(db(q(one_hour_ago)), db(q(day_start)))
        return h.count or 0, d.count or 0

    try:
        return await counts("run_events")
    except Exception:
        return await counts("run_history")   # run_events not migrated yet


async def dev_key_runs_today(user_id: str, app_id: str) -> int:
    """Runs this user made today on an app whose developer's key paid."""
    sb = _service_client()
    if not sb:
        return 0
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    res = await db(sb.table("run_events").select("id", count="exact", head=True)
                   .eq("user_id", user_id).eq("app_id", app_id).eq("source", "dev_key").gte("created_at", day_start))
    return res.count or 0


async def claim_app_daily_run(app_id: str, limit: int) -> bool:
    """Counts an end-user run against the app's daily quota; False once it's used up."""
    sb = _service_client()
    if not sb:
        return True
    try:
        res = await db(sb.rpc("claim_app_daily_run", {"p_app_id": app_id, "p_limit": limit}))
        return bool(res.data)
    except Exception as e:
        print(f"app quota check failed: {e}")   # migration not applied yet: don't block runs
        return True


async def _log_app_run(app_id: str, user_id: Optional[str], source: str, usage: Optional[dict], *,
                       status: str = "ok", error_kind: Optional[str] = None, latency_ms: Optional[int] = None,
                       live_version: Optional[int] = None, model: Optional[str] = None,
                       event_id: Optional[str] = None, created_at: Optional[str] = None) -> None:
    """One row per real run (failures too) for Monitor: outcome, time, cost, version."""
    usage = usage or {}
    try:
        cost = model_cost_usd(model, usage) if model and usage.get("input_tokens") else None
    except Exception:
        cost = None
    row = {
            "app_id": app_id, "user_id": user_id, "source": source,
            "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
            "status": status, "error_kind": error_kind, "latency_ms": latency_ms,
            "live_version": live_version, "model": model, "cost_usd": cost,
            "event_id": event_id or str(uuid.uuid4()), "created_at": created_at or datetime.now(timezone.utc).isoformat()}
    # Saved locally first (off the event loop), so a timed-out delivery can be
    # replayed with the same event ID after a restart. If local storage is
    # unavailable the run is still served and the outcome is sent directly.
    durable = True
    try:
        await asyncio.to_thread(_telemetry_outbox.finish, row)
    except Exception:
        durable = False
        print("Telemetry recovery storage unavailable; delivering this outcome directly")
    if durable:
        # The customer's run doesn't wait for the database write; the local
        # copy is replayed if this delivery is lost.
        _spawn_telemetry(_deliver_telemetry(row, 0, True))
    else:
        # No local copy: a background send lost at shutdown would lose the
        # outcome for good, so this rare case finishes it first.
        await _deliver_telemetry(row, 0, False)


_telemetry_tasks: set = set()


def _spawn_telemetry(coro) -> None:
    task = asyncio.create_task(coro)
    _telemetry_tasks.add(task)
    task.add_done_callback(_telemetry_tasks.discard)


async def _deliver_telemetry(row, attempts, durable=True):
    try:
        sb = _telemetry_service_client()
        if not sb:
            raise RuntimeError("Telemetry database unavailable")
        await asyncio.wait_for(db(sb.table("app_runs").upsert(row, on_conflict="event_id", ignore_duplicates=True)), timeout=3)
        if durable:
            await asyncio.to_thread(_telemetry_outbox.acknowledged, row["event_id"])
    except Exception:
        # Don't print payloads, provider errors, identifiers or credentials.
        if not durable:
            print("Telemetry delivery failed and no recovery storage is available; one outcome was not recorded")
            return
        try:
            await asyncio.to_thread(_telemetry_outbox.failed, row["event_id"], attempts)
            print("Telemetry delivery delayed; outcome retained for retry")
        except Exception:
            print("Telemetry recovery storage unavailable; check persistent volume")


def _telemetry_service_client():
    global _telemetry_client
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    if _telemetry_client is None:
        # Keep an outage from exhausting the ordinary database thread pool:
        # timed-out to_thread work keeps running until its HTTP timeout ends.
        _telemetry_client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, options=SyncClientOptions(
            httpx_client=httpx.Client(http2=False, timeout=2, limits=httpx.Limits(max_connections=4, max_keepalive_connections=2))))
    return _telemetry_client


async def _flush_telemetry():
    for _, row, attempts in await asyncio.to_thread(_telemetry_outbox.due, REQUEST_TIMEOUT + 60):
        await _deliver_telemetry(row, attempts)


async def _telemetry_supervisor():
    while True:
        try:
            await _flush_telemetry()
        except Exception:
            print("Telemetry recovery storage unavailable; check persistent volume")
        await asyncio.sleep(5)


async def _telemetry_health(app_ids):
    try:
        return {**(await asyncio.to_thread(_telemetry_outbox.health, app_ids, REQUEST_TIMEOUT + 60)),
                "recovery_path_configured": bool(os.getenv("TELEMETRY_OUTBOX_PATH"))}
    except Exception:
        return {"status": "unavailable", "pending": None, "failed": None,
                "recovery_path_configured": bool(os.getenv("TELEMETRY_OUTBOX_PATH"))}


async def record_metered_run(user_id: str, app_id: Optional[str], source: str, workspace_id: Optional[str] = None) -> None:
    sb = _service_client()
    if not sb:
        return
    row = {"user_id": user_id, "app_id": app_id, "source": source}
    if workspace_id:
        row["workspace_id"] = workspace_id
    try:
        await db(sb.table("run_events").insert(row))
    except Exception as e:
        print(f"record_metered_run error: {e}")


async def check_rate_limit(request: Request, user_jwt: Optional[str], user_id: Optional[str] = None) -> tuple[bool, str]:
    """Returns (is_allowed, error_message).

    Previously this trusted `extract_user_id`'s UNVERIFIED claim and, on any
    DB error (including the 401 Supabase itself returns for a forged/expired
    token), failed OPEN — i.e. any garbage bearer token bypassed rate limiting
    entirely. Now the token is verified first; anything that isn't a genuinely
    valid, current session falls back to the conservative per-IP anonymous
    limit instead of being let through unmetered.
    """
    if not user_id:
        user_id = await verify_user_jwt(user_jwt) if user_jwt else None
    if user_id:
        try:
            # Service role when available so API-key callers (no JWT) are
            # metered the same way as signed-in browser sessions.
            sb = _service_client() if SUPABASE_SERVICE_ROLE_KEY else get_supabase_for_user(user_jwt)
            hourly_count, daily_count = await get_usage_counts(sb, user_id)

            if hourly_count >= HOURLY_LIMIT:
                return False, f"Rate limit: {hourly_count}/{HOURLY_LIMIT} runs this hour. Try again in ~60 minutes."
            if daily_count >= DAILY_LIMIT:
                return False, f"Daily limit reached: {daily_count}/{DAILY_LIMIT} runs today. Resets at midnight UTC. Add your API key to bypass limits."

            return True, ""
        except Exception:
            pass  # DB error on a verified user — fall through to the conservative IP limit below

    return await check_anon_rate_limit(client_ip(request))


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


_SECRET_REF = re.compile(r"\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}")


async def required_secrets(app_id: str) -> dict[str, list[str]]:
    """Secret names the app's tools refer to ({{secrets.NAME}}), with the
    tools that use each one."""
    used: dict[str, list[str]] = {}
    for tool in await fetch_app_tools(app_id):
        for name in sorted({m.upper() for m in _SECRET_REF.findall(json.dumps(tool.get("config") or {}, default=str))}):
            used.setdefault(name, []).append(tool.get("name") or "a tool")
    return used


async def _missing_secret_checks(app_id: str) -> list[str]:
    """Publish problems for secrets the tools need but the app doesn't have:
    a missing secret is sent as an empty value and the tool fails."""
    used = await required_secrets(app_id)
    if not used:
        return []
    res = await db(_service_client().table("app_secrets").select("key").eq("app_id", app_id))
    saved = {r["key"] for r in (res.data or [])}
    return [f"Add the secret {name} in Manage → Secrets (used by {', '.join(tools)})"
            for name, tools in used.items() if name not in saved]


def resolve_secret_refs(value: Any, secrets_map: dict[str, str]) -> Any:
    """Replace {{secrets.KEY}} placeholders in a tool config with decrypted
    secret values. Secrets only ever reach outbound tool calls — never the
    model's context, where a user could simply ask the model to print them."""
    if isinstance(value, str):
        return _SECRET_REF.sub(lambda m: secrets_map.get(m.group(1).upper(), ""), value)
    if isinstance(value, dict):
        return {k: resolve_secret_refs(v, secrets_map) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve_secret_refs(v, secrets_map) for v in value]
    return value


def redact_secrets(text: str, secrets_map: dict[str, str]) -> str:
    """Blank out any secret value a tool result or error repeats (an API
    echoing its headers, an error quoting the URL), so it never reaches the
    model, the run log or the person running the app."""
    for value in sorted({v for v in secrets_map.values() if v and len(v) >= 4}, key=len, reverse=True):
        text = text.replace(value, "••••")
    return text


MAX_APP_CALL_DEPTH = 3
_APP_CALL_DEPTH: contextvars.ContextVar[int] = contextvars.ContextVar("app_call_depth", default=0)


def _internal_request() -> Request:
    """A stand-in request for runs the server starts itself (schedules,
    webhooks, workflow steps, apps called by agents): no Origin header, so
    nothing can pass as a website visitor."""
    return Request({"type": "http", "method": "POST", "path": "/internal", "headers": [],
                    "query_string": b"", "client": ("127.0.0.1", 0)})


def _tool_allowed_hosts(config: dict) -> Optional[list[str]]:
    """A tool's own destination list ("allowed_hosts" in its config), so a
    model can't be talked into sending its data anywhere else."""
    hosts = config.get("allowed_hosts") if isinstance(config, dict) else None
    if isinstance(hosts, str):
        hosts = [h for h in hosts.split(",")]
    return [str(h).strip() for h in hosts if str(h).strip()] if isinstance(hosts, list) and hosts else None


async def execute_tool(tool: dict, tool_input: dict, ctx: Optional[dict] = None) -> str:
    """ctx carries run-scoped server data: {"secrets", "caller_id", "api_key", "provider"}.
    A tool whose secret is missing fails clearly instead of calling out with
    an empty credential; secret values are blanked out of whatever it returns."""
    ctx = ctx or {}
    secrets_map = ctx.get("secrets") or {}
    needed = {m.upper() for m in _SECRET_REF.findall(json.dumps(tool.get("config") or {}, default=str))}
    missing = sorted(needed - set(secrets_map))
    if missing:
        return (f"This tool can't run: the secret {', '.join(missing)} isn't set for this app. "
                "Tell the user the tool is unavailable; the app's developer must add it in Manage → Secrets.")
    result = await _execute_tool(tool, tool_input, ctx)
    return redact_secrets(result, secrets_map) if isinstance(result, str) else result


async def _execute_tool(tool: dict, tool_input: dict, ctx: dict) -> str:
    tool_type = tool.get("type", "")
    config = resolve_secret_refs(tool.get("config") or {}, ctx.get("secrets") or {})
    if not isinstance(tool_input, dict):
        tool_input = {}
    try:
        if tool_type == "calculator":
            return safe_calculate(tool_input.get("expression", ""))

        elif tool_type == "fetch":
            url = tool_input.get("url", "")
            try:
                r = await fetch_safely("GET", url, timeout=10, headers={"User-Agent": f"{BRAND_NAME}/1.0"},
                                       allowed_hosts=_tool_allowed_hosts(config))
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
            return "Web search is not available on this server (SERPAPI_KEY not configured). Do not claim to have searched; tell the user search is unavailable."

        elif tool_type == "http":
            url = config.get("url") or tool_input.get("url", "")
            method = (config.get("method") or "POST").upper()
            if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                return f"Unsupported HTTP method: {method}"
            raw_headers = config.get("headers") or {}
            if isinstance(raw_headers, str):
                try:
                    raw_headers = json.loads(raw_headers) if raw_headers.strip() else {}
                except json.JSONDecodeError:
                    return "Tool misconfigured: headers must be a JSON object."
            headers = {**{str(k): str(v) for k, v in (raw_headers or {}).items()}, "Content-Type": "application/json"}
            body_fields = {k: v for k, v in tool_input.items() if k != "url"}
            try:
                if method == "GET":
                    r = await fetch_safely("GET", url, timeout=15, params=body_fields, headers=headers,
                                           allowed_hosts=_tool_allowed_hosts(config))
                else:
                    r = await fetch_safely(method, url, timeout=15, json=body_fields, headers=headers,
                                           allowed_hosts=_tool_allowed_hosts(config))
            except ValueError as e:
                return f"Invalid URL: {e}"
            return f"HTTP {r.status_code}: {r.text[:2000]}"

        elif tool_type == "app":
            other_id = config.get("app_id", "")
            app_input = tool_input.get("input", "")
            if not other_id or not app_input:
                return "Missing app_id or input"
            # Service-role load + the same publish/paid gates as /run. The old
            # anon read let an agent chain into any paid app for free, on the
            # platform's API key.
            other = await load_app_row(other_id)
            if not other:
                return "Referenced app not found"
            caller = ctx.get("caller")
            if not (await can_edit_app(other, caller)):
                if not (other.get("is_published") or await can_view_app(other, caller)):
                    return "Referenced app is not published"
                if other.get("is_paid"):
                    if not (await find_active_entitlement(other_id, caller)):
                        return "Referenced app requires a purchase the caller does not have"
            # The same run pipeline as opening the app: its live release (the
            # draft for its editors), output contract, tools and key rules.
            # It used to run the draft prompt directly, on the calling app's
            # key or, across providers, on no key at all.
            depth = _APP_CALL_DEPTH.get()
            if depth >= MAX_APP_CALL_DEPTH:
                return f"Apps can call other apps at most {MAX_APP_CALL_DEPTH} levels deep"
            token = _APP_CALL_DEPTH.set(depth + 1)
            try:
                result = await _drain_run(await execute_run(
                    _api_run_request(other_id, other, str(app_input)[:MAX_INPUT_LENGTH]),
                    _internal_request(), caller=caller or ApiCaller()))
            finally:
                _APP_CALL_DEPTH.reset(token)
            return result.get("output") or "" if result.get("ok") else f"The app couldn't run: {result.get('error')}"

        elif tool_type == "pdf":
            url = tool_input.get("url", "") or config.get("url", "")
            if url:
                try:
                    r = await fetch_safely("GET", url, timeout=15)
                except ValueError as e:
                    return f"Invalid URL: {e}"
                if len(r.content) > MAX_EXTRACT_BYTES:
                    return f"PDF is larger than {MAX_EXTRACT_BYTES // (1024 * 1024)} MB."

                async def run_key():
                    # The run's own key (the caller's, when they saved one).
                    return ctx.get("api_key") if ctx.get("provider") == "claude" else None
                try:
                    text, _ = await extract_pdf_text(r.content, run_key)   # OCRs scanned pages
                    return text[:8000]
                except (OcrError, ValueError) as e:
                    return f"Could not read the PDF: {e}"
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
            to = tool_input.get("to", "").strip()
            subject = tool_input.get("subject", f"Message from {BRAND_NAME}")
            body = tool_input.get("body", "")
            if not to or not body:
                return "Missing 'to' or 'body' for email."
            if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$', to):
                return "Invalid recipient email address."
            allowed = config.get("allowed_recipients", [])
            if allowed and to not in allowed:
                return f"Recipient not permitted by this tool's configuration."
            api_key = config.get("api_key", "")
            if api_key and api_key.startswith("SG."):
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.post(
                        "https://api.sendgrid.com/v3/mail/send",
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                        json={"personalizations": [{"to": [{"email": to}]}],
                              "from": {"email": config.get("from", f"noreply@{BRAND_DOMAIN}")},
                              "subject": subject, "content": [{"type": "text/plain", "value": body}]},
                    )
                if r.status_code >= 400:
                    return f"Email NOT sent (SendGrid status {r.status_code}): {r.text[:300]}"
                return f"Email sent to {to}"
            return "Email NOT sent: this tool has no SendGrid API key configured. Tell the user the email could not be sent."

        elif tool_type == "calendar":
            action = tool_input.get("action", "create")
            title = tool_input.get("title", "Event")
            start = tool_input.get("start", "")
            return f"Calendar is not connected, so the event '{title}' ({action} at {start}) was NOT created. Tell the user calendar actions are unavailable."

        elif tool_type == "storage":
            action = tool_input.get("action", "list")
            if action not in ("list", "url"):
                return f"Storage action '{action}' is not supported."
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
ALLOWED_CLAUDE_MODELS = {
    "claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5",
    # Older ids kept so apps saved with them keep working.
    "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8",
}
ALLOWED_OPENAI_MODELS = {"gpt-4o-mini", "gpt-4o"}

# AI providers developers can build with. "models" is the short list offered
# (and allowed) on the platform's own keys; with their own key a developer
# can pick any model the provider lists for that key (list_provider_models).
# Gemini is reached through Google's OpenAI-compatible API.
PROVIDERS: dict[str, dict] = {
    "claude": {"label": "Claude", "company": "Anthropic", "kind": "anthropic", "env_key": "ANTHROPIC_API_KEY",
               "keys_url": "https://console.anthropic.com/settings/keys", "key_prefix": "sk-ant-",
               "models": [("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-haiku-5-5", "Claude Haiku 5.5"),
                          ("claude-opus-5-5", "Claude Opus 5.5")]},
    "openai": {"label": "OpenAI", "company": "OpenAI", "kind": "openai", "env_key": "OPENAI_API_KEY",
               "keys_url": "https://platform.openai.com/api-keys", "key_prefix": "sk-",
               "models": [("gpt-4o-mini", "GPT-4o mini"), ("gpt-4o", "GPT-4o")]},
    "gemini": {"label": "Gemini", "company": "Google", "kind": "openai", "env_key": "GEMINI_API_KEY",
               "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
               "keys_url": "https://aistudio.google.com/apikey", "key_prefix": "",
               "models": [("gemini-3.8-flash", "Gemini 3.8 Flash")]},
}
ALLOWED_GEMINI_MODELS = {m for m, _ in PROVIDERS["gemini"]["models"]}
_MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}")


def get_default_model(provider: str) -> str:
    return {"claude": "claude-sonnet-5-5", "openai": "gpt-4o-mini", "gemini": "gemini-3.8-flash"}.get(provider, "claude-sonnet-5-5")


def platform_key(provider: str) -> Optional[str]:
    """Aistrix's own key for a provider (env), if configured."""
    return os.getenv(PROVIDERS.get(provider, {}).get("env_key", "")) or None


# Developers always use their own AI keys, never Aistrix's: their apps (tests,
# previews, end users' runs, scheduled flows, AI-graded checks) and the
# developer tools (Build with AI, Create App, Prompt Studio, Design copilot,
# Improve). Aistrix's keys serve only Aistrix's own apps and business-user
# features. AISTRIX_TESTS_ALLOW_PLATFORM_KEYS exists for the older test
# suites only; it isn't a deployment setting.
PLATFORM_KEYS_FOR_DEVELOPER_APPS = os.getenv("AISTRIX_TESTS_ALLOW_PLATFORM_KEYS", "") == "1"

# ─── Developer tiers (both free) ──────────────────────────────────────────────
# Free and Verified (staff mark a developer verified). The limits live in the
# developer_limits table; these defaults apply when it can't be read. Staff
# have no limits.
DEFAULT_TIER_LIMITS = {
    "free": {"draft_apps": 5, "published_apps": 3, "tests_per_day": 20, "concurrent_tests": 1, "analytics": "basic"},
    "verified": {"draft_apps": 10, "published_apps": 6, "tests_per_day": 100, "concurrent_tests": 3, "analytics": "standard"},
}
TIER_LABELS = {"free": "Free developer", "verified": "Verified developer", "staff": f"{BRAND_NAME} staff"}
# DEVELOPER_TIERS=0 turns tiers off (no limits, no first-publish review, full
# analytics) — e.g. for a private deployment.
DEVELOPER_TIERS = os.getenv("DEVELOPER_TIERS", "1").lower() not in ("0", "false", "no")
TIER_CACHE_SECONDS = 30
_tier_cache: dict = {}


async def tier_limits() -> dict:
    hit = _tier_cache.get("__limits__")
    if hit and time.monotonic() - hit[0] < TIER_CACHE_SECONDS:
        return hit[1]
    limits = {tier: dict(values) for tier, values in DEFAULT_TIER_LIMITS.items()}
    sb = _service_client()
    try:
        for row in ((await db(sb.table("developer_limits").select("*"))).data or []) if sb else []:
            if row.get("tier") in limits:
                limits[row["tier"]].update({k: row[k] for k in limits[row["tier"]] if row.get(k) is not None})
    except Exception as e:
        print(f"developer limits unreadable, using defaults: {type(e).__name__}")
    _tier_cache["__limits__"] = (time.monotonic(), limits)
    return limits


async def developer_tier(user_id: Optional[str]) -> str:
    """'staff' | 'verified' | 'free' (unknown → 'free')."""
    if not user_id:
        return "free"
    hit = _tier_cache.get(user_id)
    if hit and time.monotonic() - hit[0] < TIER_CACHE_SECONDS:
        return hit[1]
    tier = "free"
    sb = _service_client()
    try:
        res = await db(sb.rpc("developer_tier", {"p_user": user_id}))
        value = res.data[0] if isinstance(res.data, list) and res.data else res.data
        if isinstance(value, dict):
            value = next(iter(value.values()), None)
        if value in ("staff", "verified", "free"):
            tier = value
    except Exception as e:
        print(f"developer tier unreadable for {user_id}: {type(e).__name__}")
    if len(_tier_cache) > 5000:
        _tier_cache.clear()
    _tier_cache[user_id] = (time.monotonic(), tier)
    return tier


async def developer_limits_for(user_id: Optional[str]) -> tuple[str, Optional[dict]]:
    """(tier, limits); limits is None for staff (no limits) or with tiers off."""
    if not DEVELOPER_TIERS:
        return "staff", None
    tier = await developer_tier(user_id)
    return tier, (None if tier == "staff" else (await tier_limits())[tier])


async def published_app_count(user_id: str, excluding: Optional[str] = None) -> int:
    """Apps this developer has live or waiting for review."""
    sb = _service_client()
    rows = (await db(sb.table("apps").select("id, is_published, status").eq("created_by", user_id))).data or []
    return sum(1 for r in rows if r.get("id") != excluding and (r.get("is_published") or r.get("status") == "pending"))


async def published_limit_problem(app_row: dict) -> Optional[str]:
    """Why this app can't go live under its owner's tier (None = fine)."""
    owner = app_row.get("created_by")
    if not owner or app_row.get("is_published"):
        return None
    tier, limits = await developer_limits_for(owner)
    if limits is None:
        return None
    if await published_app_count(owner, excluding=app_row.get("id")) >= limits["published_apps"]:
        n = limits["published_apps"]
        more = f" Verified developers can publish {(await tier_limits())['verified']['published_apps']}." if tier == "free" else ""
        return f"{TIER_LABELS[tier]}s can have {n} published app{'s' if n != 1 else ''}. Unpublish one first.{more}"
    return None


def stream_fn_for(provider: str):
    """Streaming function for a provider (looked up at call time so tests can
    swap stream_claude / stream_openai)."""
    if PROVIDERS.get(provider, {}).get("kind") != "openai":
        return stream_claude
    return stream_openai if provider == "openai" else partial(stream_openai, provider=provider)


def tools_fn_for(provider: str):
    if PROVIDERS.get(provider, {}).get("kind") != "openai":
        return run_claude_with_tools
    return run_openai_with_tools if provider == "openai" else partial(run_openai_with_tools, provider=provider)


def _openai_client(provider: str, api_key: Optional[str]):
    return openai.AsyncOpenAI(api_key=api_key or platform_key(provider),
                              base_url=PROVIDERS.get(provider, {}).get("base_url"))


_CHAT_MODEL = {"openai": re.compile(r"^(gpt-|o\d|chatgpt-)"), "gemini": re.compile(r"^gemini-")}
_NOT_CHAT = re.compile(r"(audio|realtime|transcribe|tts|image|imagen|veo|search|embedding|moderation|instruct|live|dall-e|whisper)")
_model_cache: dict[tuple, tuple[float, list]] = {}


async def list_provider_models(provider: str, api_key: str) -> list[dict]:
    """Chat models this key can use, newest first: [{"id", "label"}]. Also
    how a key is checked when saved (raises the provider's auth error)."""
    cache_key = (provider, hashlib.sha256(api_key.encode()).hexdigest())
    hit = _model_cache.get(cache_key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    if PROVIDERS[provider]["kind"] == "anthropic":
        page = await anthropic.AsyncAnthropic(api_key=api_key).models.list(limit=100)
        models = [{"id": m.id, "label": getattr(m, "display_name", None) or m.id} for m in page.data]
    else:
        page = await _openai_client(provider, api_key).models.list()
        ids = sorted({m.id.removeprefix("models/") for m in page.data}, reverse=True)
        chat = _CHAT_MODEL.get(provider)
        models = [{"id": i, "label": i} for i in ids if (not chat or chat.match(i)) and not _NOT_CHAT.search(i)]
    _model_cache[cache_key] = (time.time(), models)
    return models


def validate_model(provider: str, model: str, any_model: bool = False) -> str:
    """Platform-key runs are limited to the short list; runs on someone's own
    key may use any model id the provider accepts."""
    allowed = {"claude": ALLOWED_CLAUDE_MODELS, "openai": ALLOWED_OPENAI_MODELS,
               "gemini": ALLOWED_GEMINI_MODELS}.get(provider, ALLOWED_CLAUDE_MODELS)
    if model in allowed:
        return model
    if any_model and model and _MODEL_ID.fullmatch(model):
        return model
    return get_default_model(provider)


# Shown when the model stops early (stop_reason / finish_reason).
REFUSAL_MESSAGE = "The AI declined to answer this request. Try rephrasing it, or check the app's instructions."
TRUNCATED_NOTE = "\n\n_(Answer cut off: it reached the maximum length. Ask for a shorter answer, or split the request.)_"


# Claude 4.5/4.6 and the older Claude 4 models still take a temperature.
# Newer models reject it (Opus 4.7+ any value; Sonnet 5/5.5 and Haiku 5.5 any
# value but the default), so for them it's left out and the prompt steers.
_CLAUDE_TAKES_TEMPERATURE = re.compile(r"^claude-(opus|sonnet|haiku)-4(-[56])?(-\d{8})?$|^claude-(opus|sonnet)-4-\d{8}$")


def claude_sampling(model: str, temperature: Optional[float]) -> dict:
    return {"temperature": temperature} if temperature is not None and _CLAUDE_TAKES_TEMPERATURE.match(model or "") else {}


def _claude_content(user_input: str, images: Optional[list] = None):
    if not images:
        return user_input
    return [*({"type": "image", "source": {"type": "base64", "media_type": i.media_type, "data": i.data}} for i in images),
            {"type": "text", "text": user_input}]


def _openai_content(user_input: str, images: Optional[list] = None):
    if not images:
        return user_input
    return [*({"type": "image_url", "image_url": {"url": f"data:{i.media_type};base64,{i.data}"}} for i in images),
            {"type": "text", "text": user_input}]


async def stream_claude(system: str, user_input: str, model: str, api_key: str = None, max_tokens: int = 4096, temperature: float = 1.0, usage_holder: dict = None, images: Optional[list] = None):
    client = anthropic.AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
    async with client.messages.stream(model=model, max_tokens=max_tokens, system=system,
                                      messages=[{"role": "user", "content": _claude_content(user_input, images)}],
                                      **claude_sampling(model, temperature)) as stream:
        async for text in stream.text_stream:
            yield text
        if usage_holder is not None:
            final = await stream.get_final_message()
            usage_holder["input_tokens"] = final.usage.input_tokens
            usage_holder["output_tokens"] = final.usage.output_tokens
            usage_holder["_stop"] = final.stop_reason   # popped by execute_run


async def stream_openai(system: str, user_input: str, model: str, api_key: str = None, max_tokens: int = 4096, temperature: float = 1.0, usage_holder: dict = None, provider: str = "openai", images: Optional[list] = None):
    client = _openai_client(provider, api_key)
    stream = await client.chat.completions.create(
        model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": _openai_content(user_input, images)}],
        max_tokens=max_tokens, stream=True, temperature=temperature,
        # Only ask the provider for a trailing usage-only chunk when a caller
        # actually wants it — some OpenAI-compatible endpoints choke on
        # unrecognized stream_options.
        stream_options={"include_usage": True} if usage_holder is not None else openai.NOT_GIVEN)
    finish_reason = None
    async for chunk in stream:
        if usage_holder is not None and chunk.usage:
            usage_holder["input_tokens"] = chunk.usage.prompt_tokens
            usage_holder["output_tokens"] = chunk.usage.completion_tokens
        if not chunk.choices:
            continue
        finish_reason = chunk.choices[0].finish_reason or finish_reason
        c = chunk.choices[0].delta.content
        if c:
            yield c
    if usage_holder is not None:
        # Same vocabulary as Claude's stop_reason; popped by execute_run.
        usage_holder["_stop"] = {"length": "max_tokens", "content_filter": "refusal"}.get(finish_reason, finish_reason)


# ─── Agentic loops ────────────────────────────────────────────────────────────
def tools_to_claude_format(tools):
    return [{"name": t["name"], "description": t["description"], "input_schema": t.get("input_schema", {"type": "object", "properties": {}, "required": []})} for t in tools]


def tools_to_openai_format(tools):
    return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t.get("input_schema", {"type": "object", "properties": {}, "required": []})}} for t in tools]


async def run_claude_with_tools(system, user_input, model, tools, api_key=None, max_steps: int = 10, ctx: Optional[dict] = None):
    client = anthropic.AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
    claude_tools = tools_to_claude_format(tools)
    messages = [{"role": "user", "content": user_input}]
    tool_map = {t["name"]: t for t in tools}
    # Multi-turn tool loop — every turn (including tool-result round-trips)
    # burns its own input/output tokens, so accumulate across the whole loop.
    input_tokens = output_tokens = 0

    for _ in range(max(1, min(max_steps, 20))):
        response = await client.messages.create(model=model, max_tokens=4096, system=system, tools=claude_tools, messages=messages)
        input_tokens += response.usage.input_tokens
        output_tokens += response.usage.output_tokens
        if response.stop_reason != "tool_use":
            # end_turn, max_tokens, stop_sequence, refusal… are all terminal.
            # Previously only end_turn ended the loop, so e.g. a max_tokens
            # stop re-sent the same messages until the step budget ran out.
            text = "".join(b.text for b in response.content if hasattr(b, "text"))
            if response.stop_reason == "max_tokens":
                text += "\n\n_(Response truncated: model hit its output limit.)_"
            yield ("token", text)
            yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})
            return
        else:
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for block in response.content:
                if block.type == "tool_use":
                    yield ("tool_call", {"name": block.name, "input": block.input})
                    result = await execute_tool(tool_map.get(block.name, {"type": "unknown", "config": {}}), block.input, ctx)
                    yield ("tool_result", {"name": block.name, "result": result[:500]})
                    results.append({"type": "tool_result", "tool_use_id": block.id, "content": result})
            messages.append({"role": "user", "content": results})
    yield ("token", "The agent reached its step limit before finishing. Increase max steps or narrow the goal.")
    yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})


async def run_openai_with_tools(system, user_input, model, tools, api_key=None, max_steps: int = 10, ctx: Optional[dict] = None, provider: str = "openai"):
    client = _openai_client(provider, api_key)
    oai_tools = tools_to_openai_format(tools)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_input}]
    tool_map = {t["name"]: t for t in tools}
    # Multi-turn tool loop — every turn (including tool-result round-trips)
    # burns its own input/output tokens, so accumulate across the whole loop.
    input_tokens = output_tokens = 0

    for _ in range(max(1, min(max_steps, 20))):
        response = await client.chat.completions.create(model=model, max_tokens=4096, tools=oai_tools, tool_choice="auto", messages=messages)
        if response.usage:
            input_tokens += response.usage.prompt_tokens
            output_tokens += response.usage.completion_tokens
        msg = response.choices[0].message
        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                try:
                    tool_input = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    tool_input = {}
                yield ("tool_call", {"name": tc.function.name, "input": tool_input})
                result = await execute_tool(tool_map.get(tc.function.name, {"type": "unknown", "config": {}}), tool_input, ctx)
                yield ("tool_result", {"name": tc.function.name, "result": result[:500]})
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
        else:
            yield ("token", msg.content or "")
            yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})
            return
    yield ("token", "The agent reached its step limit before finishing. Increase max steps or narrow the goal.")
    yield ("usage", {"input_tokens": input_tokens, "output_tokens": output_tokens})


# ─── Request model with validation ────────────────────────────────────────────
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")
MAX_RUN_IMAGES = int(os.getenv("MAX_RUN_IMAGES", "4"))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(5 * 1024 * 1024)))


class RunImage(BaseModel):
    """One image sent with a run (Vision apps): base64 data, no data: prefix."""
    media_type: str
    data: str

    @field_validator("media_type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in IMAGE_TYPES:
            raise ValueError("Images must be PNG, JPEG, WebP or GIF")
        return v

    @field_validator("data")
    @classmethod
    def _size(cls, v: str) -> str:
        if len(v) * 3 // 4 > MAX_IMAGE_BYTES:
            raise ValueError(f"Each image must be under {MAX_IMAGE_BYTES // (1024 * 1024)} MB")
        return v


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
    max_tool_steps: Optional[int] = Field(default=10, ge=1, le=20)
    prior_responses: Optional[list[str]] = None   # recent answers to avoid repeating
    # How the runner frames the app's prompt. The server appends the matching
    # instruction itself, so non-owners never need (or get to send) a prompt.
    run_mode: Optional[str] = Field(default=None, pattern="^(agent|conversation)$")
    # "build": a developer tool (Build with AI, Create App, Prompt Studio, the
    # Design copilot, Improve) — always the developer's own AI key.
    purpose: Optional[str] = Field(default=None, pattern="^build$")
    page_index: Optional[int] = Field(default=None, ge=0, le=50)   # multi-page apps
    # Form apps: field values for {{Field Name}} placeholders in the prompt.
    field_values: Optional[dict[str, Any]] = None
    # Vision apps: images the model looks at with the input.
    images: Optional[list[RunImage]] = Field(default=None, max_length=MAX_RUN_IMAGES)

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


class ApiFileInput(BaseModel):
    file_name: str = Field(..., max_length=255)
    content_b64: str


class ApiRunRequest(BaseModel):
    input: Optional[str] = None
    fields: Optional[dict[str, Any]] = None
    file: Optional[ApiFileInput] = None      # PDF / XLSX / DOCX / CSV / TXT / JSON / MD
    stream: bool = True
    user_context: Optional[str] = None
    temperature: Optional[float] = None


class BatchRowIn(BaseModel):
    input: Optional[str] = None
    fields: Optional[dict[str, Any]] = None


class BatchCreateRequest(BaseModel):
    rows: Optional[list[BatchRowIn]] = None
    csv: Optional[str] = None                  # header row + data rows
    webhook_url: Optional[str] = None          # POSTed a summary when the job finishes


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    app_ids: list[str] = Field(default_factory=list, max_length=50)
    workspace_id: Optional[str] = None     # default: the active workspace


class WorkspaceInviteRequest(BaseModel):
    email: str = Field(..., max_length=254)
    role: str = Field(default="member", pattern="^(admin|developer|member|billing)$")


class AppFileRegisterRequest(BaseModel):
    app_id: str
    run_id: Optional[str] = None
    file_kind: str = Field(..., pattern="^(input|output)$")
    bucket: str = Field(..., pattern="^(aistrix-input-files|aistrix-output-files)$")
    storage_path: str
    file_name: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = Field(default=None, ge=0)
    retention_days: Optional[int] = Field(default=30, ge=1, le=365)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("storage_path")
    @classmethod
    def validate_storage_path(cls, v: str) -> str:
        value = v.strip().lstrip("/")
        if not value or ".." in value.split("/"):
            raise ValueError("Invalid storage path")
        return value


def _strip_json_fences(raw: str) -> str:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _schema_fields(blueprint: dict[str, Any], key: str) -> list[dict[str, Any]]:
    node = blueprint.get(key) or {}
    if isinstance(node, dict) and isinstance(node.get("fields"), list):
        return node["fields"]
    if key == "output_schema":
        contract = blueprint.get("output_contract") or {}
        if isinstance(contract, dict):
            return contract.get("fields") or contract.get("required_fields") or []
    return []


def _validate_schema_value(value: Any, fields: list[dict[str, Any]], path: str = "") -> list[str]:
    errors: list[str] = []
    if not isinstance(value, dict) or isinstance(value, list):
        return [f"{path or 'value'} must be an object"]

    for field in fields:
        name = field.get("field") or field.get("name")
        if not name:
            continue
        label = f"{path}.{name}" if path else str(name)
        if name not in value or value[name] == "":
            if field.get("required") is not False:
                errors.append(f'"{label}" is required')
            continue
        if value[name] is None:
            continue   # present but unknown ("never guess" extraction) is a valid answer

        val = value[name]
        ftype = field.get("type") or "string"
        if ftype in ("string", "enum"):
            if not isinstance(val, str):
                errors.append(f'"{label}" must be text')
            elif ftype == "enum" and field.get("enum_values") and val not in field["enum_values"]:
                errors.append(f'"{label}" must be one of: {", ".join(field["enum_values"])}')
        elif ftype == "number":
            if not isinstance(val, (int, float)) or isinstance(val, bool) or math.isnan(float(val)):
                errors.append(f'"{label}" must be a number')
        elif ftype == "boolean":
            if not isinstance(val, bool):
                errors.append(f'"{label}" must be true or false')
        elif ftype == "string_array":
            if not isinstance(val, list) or any(not isinstance(x, str) for x in val):
                errors.append(f'"{label}" must be a list of text values')
        elif ftype == "number_array":
            if not isinstance(val, list) or any(not isinstance(x, (int, float)) or isinstance(x, bool) for x in val):
                errors.append(f'"{label}" must be a list of numbers')
        elif ftype == "object":
            if not isinstance(val, dict) or isinstance(val, list):
                errors.append(f'"{label}" must be an object')
            elif field.get("nested_fields"):
                errors.extend(_validate_schema_value(val, field["nested_fields"], label))
    return errors


def _parse_json_output(raw: str) -> tuple[Optional[Any], list[str]]:
    cleaned = _strip_json_fences(raw)
    try:
        return json.loads(cleaned), []
    except json.JSONDecodeError as exc:
        return None, [f"Output is not valid JSON: {exc.msg}"]


async def fetch_app_blueprint(app_id: str) -> dict[str, Any]:
    if not (app_id and SUPABASE_SERVICE_ROLE_KEY):
        return {}
    try:
        sb = _service_client()
        row = await asyncio.to_thread(
            lambda: sb.table("app_blueprints").select("blueprint").eq("app_id", app_id).maybe_single().execute()
        )
        return row.data.get("blueprint") if row and row.data and isinstance(row.data.get("blueprint"), dict) else {}
    except Exception as e:
        print(f"fetch_app_blueprint error: {e}")
        return {}


def release_contract(app_row: dict, snapshot: dict) -> dict:
    """The contract of one release (or the draft), with the model route as the
    app is set up now: the route is checked when the step runs, not trusted
    from publish time."""
    contract = tool_contracts.contract_for_release(
        snapshot, custom_model_url=app_row.get("custom_model_url"), max_timeout=REQUEST_TIMEOUT,
        private_hosts=PRIVATE_MODEL_HOSTS, secret_ref=_SECRET_REF)
    route = tool_contracts.model_route(app_row.get("custom_model_url"), PRIVATE_MODEL_HOSTS)
    if route == "private" and not app_row.get("custom_model_name"):
        route = "external"          # without a model name the run falls back to the app's provider
    return {**contract, "privacy": {**(contract.get("privacy") or {}), "model_route": route,
                                    "output_webhook": bool(app_row.get("webhook_url"))}}


def _fields_to_input(fields: dict[str, Any]) -> str:
    lines = []
    for key, value in fields.items():
        if isinstance(value, (dict, list)):
            rendered = json.dumps(value, ensure_ascii=False)
        else:
            rendered = "" if value is None else str(value)
        lines.append(f"{key}: {rendered}")
    return "\n".join(lines)


_PLACEHOLDER = re.compile(r"\{\{\s*([^{}]{1,80}?)\s*\}\}")


def _field_key(name: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")


def fill_field_placeholders(prompt: str, values: dict[str, Any]) -> str:
    """Replace {{Field Name}} / {{field_name}} in a Form app's prompt with
    the submitted values (labels and API keys both match). Unknown
    placeholders are left as they are; empty fields read "(not provided)"."""
    lookup = {_field_key(k): v for k, v in (values or {}).items()}

    def sub(m):
        key = _field_key(m.group(1))
        if key not in lookup:
            return m.group(0)
        v = lookup[key]
        if v is None or v == "":
            return "(not provided)"
        return json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else str(v)[:5000]

    return _PLACEHOLDER.sub(sub, prompt)


TONE_INSTRUCTIONS = {
    "friendly": "Tone: warm, friendly and approachable. Use plain language and a positive voice.",
    "professional": "Tone: professional and precise. Courteous, clear, no slang or emoji.",
    "concise": "Tone: concise. Short, direct answers; use bullet points when listing; no filler.",
    "playful": "Tone: playful and upbeat, with light humour where it fits — but stay accurate and helpful.",
    "empathetic": "Tone: empathetic and patient. Acknowledge the person's situation before answering.",
}

RUN_MODE_SUFFIX = {
    "agent": ("\n\nYou are operating in autonomous agent mode. Think through the problem step by step. "
              "Use available tools to gather information and take actions. Continue working until you have a "
              "complete, accurate answer. When finished, provide a clear, comprehensive final response."),
    "conversation": ("\n\nYou are in a conversation. Respond naturally to the latest message, "
                     "maintaining context from the conversation history."),
}


def _describe_fields(fields: list[dict[str, Any]], indent: str = "") -> str:
    lines = []
    for f in fields:
        field_name = f.get("field") or f.get("name")
        if not field_name:
            continue
        req = "required" if f.get("required") is not False else "optional"
        extra = f" one of {f['enum_values']}" if f.get("enum_values") else ""
        desc = f" — {f.get('description') or f.get('label')}" if (f.get("description") or f.get("label")) else ""
        lines.append(f"{indent}- {field_name} ({f.get('type') or 'string'}, {req}){extra}{desc}")
        if f.get("nested_fields"):
            lines.append(_describe_fields(f["nested_fields"], indent + "  "))
    return "\n".join(lines)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


# ─── Main /run endpoint ────────────────────────────────────────────────────────
@app.post("/run")
async def run_app(req: RunRequest, request: Request):
    caller = await resolve_api_caller(request)
    return await execute_run(req, request, caller=caller)


async def execute_run(req: RunRequest, request: Request, *, caller: "ApiCaller", on_complete=None, track: bool = True,
                      release: Optional[tuple[int, dict]] = None, private_only: bool = False):
    """Shared run pipeline for /run (browser) and /v1/apps/{id}/run (API).

    `caller` is already authenticated and carries the active workspace. For
    any app the caller can't edit, the prompt, model and provider come from
    the database — never from the request — so paid/private prompts can't be
    swapped or bypassed. `release` = (version number, snapshot) runs that
    fixed release for everyone, editors included (workflow steps pinned to
    "Published · vN"). `private_only` runs only on the app's approved private
    model, with no outside tools or webhook, and never falls back to a provider.
    """
    user_jwt, caller_id = caller.user_jwt, caller.user_id
    # ── App resolution + access ──────────────────────────────────────────────
    app_row = await load_app_row(req.app_id) if req.app_id else None
    if req.app_id and SUPABASE_SERVICE_ROLE_KEY and not app_row:
        return JSONResponse(status_code=404, content={"error": "App not found"})
    is_editor = await can_edit_app(app_row, caller) if app_row else False
    # End users run the app's production version (set by promoting); editors
    # run the draft. Apps never promoted run as they are.
    prod = app_row.get("prod_snapshot") if (app_row and (not is_editor or caller.live) and isinstance(app_row.get("prod_snapshot"), dict)) else None
    if app_row and release:
        prod = release[1]
    if prod:
        app_row = {**app_row, **{k: prod[k] for k in DRAFT_FIELDS if k in prod}}

    if app_row and not is_editor:
        if not app_row.get("is_published") and not (await can_view_app(app_row, caller)):
            return JSONResponse(status_code=404, content={"error": "App not found or not published"})
        if app_row.get("visibility") == "private" and not caller_id:
            return JSONResponse(status_code=401, content={"error": "Sign in to run this app"})
        base_prompt = app_row.get("system_prompt")
        pages = app_row.get("pages")
        if req.page_index is not None and isinstance(pages, list) and req.page_index < len(pages):
            page = pages[req.page_index] or {}
            base_prompt = page.get("system_prompt") or base_prompt
        req.system_prompt = base_prompt
        req.ai_provider = app_row.get("ai_provider") or "claude"
        req.ai_model = app_row.get("ai_model")
        req.custom_model_url = None
        req.custom_model_name = None
    elif app_row and not (req.system_prompt or "").strip():
        # Editors running their app from a screen that doesn't load prompts
        # (prompts are private columns: app grid, app page, flows): run the
        # saved draft instead of an empty prompt.
        base_prompt = app_row.get("system_prompt")
        pages = app_row.get("pages")
        if req.page_index is not None and isinstance(pages, list) and req.page_index < len(pages):
            base_prompt = (pages[req.page_index] or {}).get("system_prompt") or base_prompt
        req.system_prompt = base_prompt
        if not req.custom_model_url and app_row.get("custom_model_url"):
            req.custom_model_url = app_row.get("custom_model_url")
            req.custom_model_name = app_row.get("custom_model_name")
    elif not caller_id:
        # Anonymous callers with no app context can't pick custom endpoints.
        req.custom_model_url = None
        req.custom_model_name = None

    # Form apps: required fields are checked here too, not only in the
    # browser. Applies when form values are sent (the app's form, the embed
    # widget, API "fields"); plain-text input (flows, API "input") is
    # accepted as before.
    if app_row and app_row.get("app_type") == "native" and req.field_values is not None:
        given = {_field_key(k): v for k, v in req.field_values.items()}
        missing = [f.get("label") for f in (app_row.get("form_schema") or [])
                   if f.get("required") and f.get("label")
                   and not str(given.get(_field_key(f["label"])) or "").strip()]
        if missing:
            return JSONResponse(status_code=422, content={
                "error": f"Fill in the required field{'s' if len(missing) > 1 else ''}: {', '.join(missing)}"})

    private_host = None
    if private_only:
        req.custom_model_url = (app_row or {}).get("custom_model_url")
        req.custom_model_name = (app_row or {}).get("custom_model_name")
        if not (app_row and req.custom_model_name
                and tool_contracts.model_route(req.custom_model_url, PRIVATE_MODEL_HOSTS) == "private"):
            return JSONResponse(status_code=409, content={"code": "private_only", "error":
                "This app isn't set up for private-only work: it needs a custom model on a host the operator has approved."})
        if app_row.get("webhook_url"):
            return JSONResponse(status_code=409, content={"code": "private_only", "error":
                "This app sends its results to a webhook, so it can't run in a private-only workflow."})
        private_host = (urlsplit(req.custom_model_url).hostname or "").lower()

    if req.custom_model_url and not private_host:
        try:
            assert_public_url(req.custom_model_url)
        except ValueError as e:
            return JSONResponse(status_code=400, content={"error": f"Custom model URL rejected: {e}"})

    # ── Paid-app entitlement (verified caller only) ───────────────────────────
    entitlement = None
    entitlement_used = None
    run_state = {"finished": False}      # a reserved paid run is given back unless the run finishes
    if app_row and app_row.get("is_paid") and not is_editor:
        if not caller_id:
            return JSONResponse(status_code=401, content={"error": "Sign in to run this app"})
        entitlement = await find_active_entitlement(app_row["id"], caller)
        if not entitlement:
            return JSONResponse(status_code=402, content={"error": "Purchase access to run this app"})
        reason = entitlement_block_reason(entitlement)
        if reason:
            return JSONResponse(status_code=402, content={"error": reason})

    # ── Provider + model ─────────────────────────────────────────────────────
    custom = bool(req.custom_model_url and req.custom_model_name)
    provider = "custom" if custom else (req.ai_provider if req.ai_provider in PROVIDERS else "claude")
    label = PROVIDERS.get(provider, {}).get("label", "AI")

    # ── Whose key pays. Owners/editors (building, testing) and runs with no
    # app use their own key, else the platform's. For end users the app
    # decides (apps.billing_mode):
    #   free — the developer's key pays (per-user daily limit set on the app);
    #          without a developer key: the user's own key, else the platform.
    #   byok — end users must use their own key for the app's provider.
    # Website visitors (embed widget with visitor access) are end users with
    # a per-visitor, per-app limit. ──────────────────────────────────────────
    embed_visitor = bool(app_row and not caller_id and app_row.get("embed_public") and not app_row.get("is_paid"))
    billing = (app_row.get("billing_mode") or "free") if (app_row and not is_editor) else None
    owner_id = app_row.get("created_by") if app_row else None
    if custom:
        own_key = None
    elif caller_id and user_jwt:
        own_key = await fetch_user_api_key(user_jwt, provider)
    elif caller_id:
        own_key = await fetch_user_api_key_by_id(caller_id, provider)
    else:
        own_key = None

    if billing == "byok" and not custom:
        if not own_key:
            return JSONResponse(status_code=401 if not caller_id else 403, content={
                "code": "needs_own_key", "provider": provider,
                "error": (f"This app runs on your own {label} API key. "
                          + (f"Sign in to {BRAND_NAME} and add it in Settings → Keys." if not caller_id else "Add it in Settings → Keys to run it."))})
        user_api_key, key_source = own_key, "own"
    else:
        dev_key = (await fetch_user_api_key_by_id(owner_id, provider)
                   if billing == "free" and owner_id and (caller_id or embed_visitor) and not custom else None)
        if dev_key:
            user_api_key, key_source = dev_key, "developer"
        elif own_key:
            user_api_key, key_source = own_key, "own"
        else:
            user_api_key, key_source = None, "platform"

    # Developer tools never run on Aistrix's key.
    if req.purpose == "build" and not app_row and key_source == "platform" and not custom and not PLATFORM_KEYS_FOR_DEVELOPER_APPS:
        return JSONResponse(status_code=409, content={
            "code": "needs_own_key", "provider": provider,
            "error": f"Developer tools run on your own {label} API key. Add it in Settings → Keys to use them."})

    # Bring your own key: a developer's app never runs on Aistrix's key. A
    # teammate building it uses their own key, else the owner's.
    if app_row and key_source == "platform" and not custom and not PLATFORM_KEYS_FOR_DEVELOPER_APPS:
        owner_key = (await fetch_user_api_key_by_id(owner_id, provider)
                     if is_editor and owner_id and owner_id != caller_id else None)
        if owner_key:
            user_api_key, key_source = owner_key, "owner"
        # Building or testing always needs a developer's key (staff too); only
        # customers of Aistrix's own apps run on Aistrix's key.
        elif is_editor or await developer_tier(owner_id) != "staff":
            if is_editor:
                return JSONResponse(status_code=409, content={
                    "code": "needs_own_key", "provider": provider,
                    "error": f"This app runs on your own {label} API key. Add it in Settings → Keys to build and test it."})
            return JSONResponse(status_code=503, content={
                "code": "app_needs_developer_key", "provider": provider,
                "error": "This app isn't available right now: its developer hasn't connected an AI key. Try again later."})

    if custom:
        model = req.custom_model_name
    else:
        model = validate_model(provider, req.ai_model or get_default_model(provider), any_model=bool(user_api_key))
        if not (user_api_key or platform_key(provider)):
            return JSONResponse(status_code=400, content={
                "code": "needs_own_key", "provider": provider,
                "error": f"No {label} API key is available for this run. Add your own {label} key in Settings → Keys."})

    if embed_visitor:
        # Visitor runs come from the Aistrix embed page (the iframe checks the
        # host website against the app's allowed list). Browsers always send
        # Origin, so other websites can't call the app directly as a visitor.
        if (request.headers.get("origin") or "").rstrip("/") not in [o.rstrip("/") for o in ALLOWED_ORIGINS]:
            return JSONResponse(status_code=403, content={
                "error": f"Website visitors can use this app only through its {BRAND_NAME} embed. Sign in to run it here."})
        allowed, rate_msg = await check_embed_visitor_rate_limit(client_ip(request), app_row["id"])
        if not allowed:
            return JSONResponse(status_code=429, content={"error": rate_msg})
    elif key_source == "developer":
        limit = app_row.get("free_runs_per_user_day")
        limit = DEV_KEY_RUNS_PER_USER_DAY if limit is None else int(limit)
        if await dev_key_runs_today(caller_id, app_row["id"]) >= limit:
            return JSONResponse(status_code=429, content={"error": (
                f"You've used today's {limit} free run{'s' if limit != 1 else ''} of this app. "
                f"Add your own {label} key in Settings → Keys to keep going, or try again tomorrow.")})
        await record_metered_run(caller_id, app_row["id"], "dev_key", caller.workspace_id)
    elif key_source == "platform":
        allowed, rate_msg = await check_rate_limit(request, user_jwt, caller_id)
        if not allowed:
            return JSONResponse(status_code=429, content={"error": rate_msg})
        if caller_id:
            # Counted when the run starts: failed runs still spend platform tokens.
            await record_metered_run(caller_id, req.app_id, "api" if not user_jwt else "app", caller.workspace_id)

    # ── App's daily run quota (apps.max_runs_per_day), across all end users
    # and visitors; the developer's own runs don't count. ──────────────────
    if app_row and (not is_editor or caller.live) and app_row.get("max_runs_per_day"):
        if not await claim_app_daily_run(app_row["id"], int(app_row["max_runs_per_day"])):
            return JSONResponse(status_code=429, content={"code": "app_quota", "error": (
                "This app has reached its run limit for today. Try again tomorrow (resets at midnight UTC).")})

    # ── System prompt ────────────────────────────────────────────────────────
    base_system = (req.system_prompt or "You are a helpful AI assistant.") + RUN_MODE_SUFFIX.get(req.run_mode or "", "")
    if req.field_values:
        base_system = fill_field_placeholders(base_system, req.field_values)
    tone = TONE_INSTRUCTIONS.get((app_row or {}).get("tone") or "")
    if tone:
        base_system += "\n\n" + tone
    fmt_instruction = OUTPUT_FORMAT_INSTRUCTIONS.get(req.output_type or "markdown", "")

    variation_block = ""
    if req.prior_responses:
        recent = req.prior_responses[-3:]
        formatted = "\n---\n".join(f"Previous response {i+1}:\n{r[:4000]}" for i, r in enumerate(recent))
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

    owner_id = app_row.get("created_by") if app_row else None
    knowledge, tools, app_secrets, blueprint = await asyncio.gather(
        fetch_app_knowledge(req.app_id) if req.app_id else _default(""),
        _default(prod.get("tools") or []) if prod else fetch_app_tools(req.app_id) if req.app_id else _default([]),
        _load_app_secrets(req.app_id) if (req.app_id and owner_id) else _default({}),
        _default(prod.get("blueprint") or {}) if prod else fetch_app_blueprint(req.app_id) if req.app_id else _default({}),
    )
    webhook_url = app_row.get("webhook_url") if (app_row and not private_only) else None

    if private_only and any(tool_contracts.tool_effect(t) != "none" for t in tools):
        return JSONResponse(status_code=409, content={"code": "private_only", "error":
            "This app has tools that reach outside services, so it can't run in a private-only workflow."})

    if req.images and (tools or custom):
        return JSONResponse(status_code=400, content={"code": "images_not_supported", "error": (
            "Images can't be sent to apps that use tools or a custom model yet. Remove the images, "
            "or use an app without tools." if tools else "Images can't be sent to a custom model yet.")})

    if knowledge:
        system = f"<knowledge_base>\n{knowledge}\n</knowledge_base>\n\n{system}"

    output_fields = _schema_fields(blueprint or {}, "output_schema")
    output_contract = (blueprint or {}).get("output_contract") or {}
    expects_json_contract = (req.output_type == "json") or (isinstance(output_contract, dict) and output_contract.get("format") == "json")
    contract_fields = output_fields if expects_json_contract else []
    if contract_fields:
        system += (
            "\n\n<output_contract>\nReturn ONLY a JSON object (no markdown fences, no prose) with these fields:\n"
            f"{_describe_fields(contract_fields)}\n</output_contract>"
        )

    # Secrets never enter the model context — tools resolve {{secrets.KEY}}.
    tool_ctx = {"secrets": app_secrets, "caller": caller, "api_key": user_api_key, "provider": provider}
    app_name = (app_row or {}).get("name") or "app"

    collected: list[str] = []
    usage: dict = {}
    # Deploy's run log: real use of the app, not the developer trying their
    # draft in the browser (or test runs: track=False).
    log_source = None
    if app_row and track and (not is_editor or caller.via_key or caller.live):
        log_source = ("trigger" if caller.live else "embed" if embed_visitor
                      else "api" if (caller.via_key or not user_jwt) else "app")

    started = time.monotonic()
    run_version = (release[0] if release else app_row.get("live_version")) if (app_row and prod) else None   # None: the draft answered
    telemetry_id = str(uuid.uuid4())
    telemetry_created = datetime.now(timezone.utc).isoformat()

    spend = {"id": None, "failure": None, "settled": False}

    def settle_spend(finished: bool) -> None:
        if not spend["id"] or spend["settled"]:
            return
        spend["settled"] = True
        actual = model_cost_usd(model, usage)
        has_usage = bool(usage.get("input_tokens") or usage.get("output_tokens"))
        settle_run_spend(spend["id"], actual, spend_guard.settle_outcome(
            finished=finished, failure_kind=spend["failure"], actual=actual, has_usage=has_usage))

    async def outcome(success: bool, kind: Optional[str] = None):
        """Final outcome of this run: ops alerting, plus the app's run log
        (failures included) so Monitor shows error rates and response times."""
        if not success and not spend["failure"]:
            spend["failure"] = kind
        _record_run_outcome(success, kind)
        if success or not log_source or run_state.get("logged"):
            return
        run_state["logged"] = True
        await _log_app_run(app_row["id"], None if caller.live else caller_id, log_source, usage,
                                         status="error", error_kind=kind, latency_ms=int((time.monotonic() - started) * 1000),
                                         live_version=run_version, model=model, event_id=telemetry_id, created_at=telemetry_created)

    async def finish(full_result: str):
        # Side effects first: consumers (stream=false, batches, clients that
        # disconnect on "done") stop reading at the done event, so anything
        # after that yield would never run.
        await outcome(True)
        run_state["finished"] = True
        settle_spend(True)
        if entitlement and entitlement_used:
            asyncio.create_task(notify_low_runs(entitlement, entitlement_used, app_name))
        if webhook_url:
            asyncio.create_task(_fire_webhook(webhook_url, req.app_id, req.input, full_result, provider, model))
        if log_source:
            # Trigger runs act as the developer: not a person using the app.
            run_state["logged"] = True
            await _log_app_run(app_row["id"], None if caller.live else caller_id, log_source, usage,
                                             latency_ms=int((time.monotonic() - started) * 1000),
                                             live_version=run_version, model=model, event_id=telemetry_id, created_at=telemetry_created)
        if on_complete:
            # Awaited (not a task) so server-side history is written before the
            # caller's next run is rate-limit checked against it.
            await on_complete(full_result, usage, provider, model)
        yield _sse({"done": True, "provider": provider, "model": model, "usage": usage or None})

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
                    c = chunk.choices[0].delta.content if chunk.choices else None
                    if c:
                        collected.append(c)
                        yield _sse({"token": c})
                async for ev in finish("".join(collected)):
                    yield ev
                return

            raw_temp = req.temperature if req.temperature is not None else 1.0
            temp = min(raw_temp, 1.0) if provider != "openai" else raw_temp
            stream_fn = stream_fn_for(provider)

            # ── Tool-enabled agentic loop ──
            if tools:
                run_fn = tools_fn_for(provider)
                async for event_type, data in run_fn(system, req.input, model, tools, user_api_key, req.max_tool_steps or 10, tool_ctx):
                    if event_type == "token":
                        # The tool loops return the final answer in one piece; chunk it
                        # rather than emitting one SSE frame per character.
                        collected.append(data)
                        for i in range(0, len(data), 40):
                            yield _sse({"token": data[i:i + 40]})
                    elif event_type == "tool_call":
                        yield _sse({"tool_call": data})
                    elif event_type == "tool_result":
                        yield _sse({"tool_result": data})
                    elif event_type == "usage":
                        usage.update(data)
                full_result = "".join(collected)
                if contract_fields:
                    parsed, errs = _parse_json_output(full_result)
                    errs = errs or _validate_schema_value(parsed, contract_fields)
                    if errs:
                        yield _sse({"contract_error": errs})
                        await outcome(False, "contract")
                        return

            # ── Structured output: buffer, validate, one self-repair retry ──
            elif contract_fields:
                attempt_input = req.input
                text, errs = "", []
                for attempt in range(2):
                    attempt_usage: dict = {}
                    parts = [t async for t in stream_fn(system, attempt_input, model, user_api_key,
                                                        temperature=min(temp, 0.3), usage_holder=attempt_usage,
                                                        **({"images": req.images} if req.images else {}))]
                    if attempt_usage.pop("_stop", None) == "refusal":
                        await outcome(False, "refusal")
                        yield _sse({"kind": "refusal", "error": REFUSAL_MESSAGE})
                        return
                    for k, v in attempt_usage.items():
                        usage[k] = usage.get(k, 0) + v
                    text = _strip_json_fences("".join(parts))
                    parsed, errs = _parse_json_output(text)
                    errs = errs or _validate_schema_value(parsed, contract_fields)
                    if not errs:
                        break
                    yield _sse({"status": "repairing_output", "errors": errs})
                    attempt_input = (
                        f"{req.input}\n\n<previous_attempt>\n{text[:6000]}\n</previous_attempt>\n"
                        f"That output failed validation: {'; '.join(errs)}. Return ONLY the corrected JSON object."
                    )
                if errs:
                    yield _sse({"contract_error": errs})
                    await outcome(False, "contract")
                    return
                collected.append(text)
                for i in range(0, len(text), 200):
                    yield _sse({"token": text[i:i + 200]})

            # ── Standard streaming ──
            else:
                async for token in stream_fn(system, req.input, model, user_api_key, temperature=temp, usage_holder=usage,
                                             **({"images": req.images} if req.images else {})):
                    collected.append(token)
                    yield _sse({"token": token})
                stop = usage.pop("_stop", None)
                if stop == "refusal":
                    await outcome(False, "refusal")
                    yield _sse({"kind": "refusal", "error": REFUSAL_MESSAGE})
                    return
                if stop == "max_tokens":
                    # Without this the answer just stops mid-sentence.
                    collected.append(TRUNCATED_NOTE)
                    yield _sse({"token": TRUNCATED_NOTE})

            async for ev in finish("".join(collected)):
                yield ev

        except (anthropic.AuthenticationError, openai.AuthenticationError):
            await outcome(False, "auth")
            yield _sse({"kind": "auth", "error": f"Invalid {provider} API key — check Settings → Keys and make sure the key is active."})
        except (anthropic.PermissionDeniedError,):
            await outcome(False, "permission")
            yield _sse({"kind": "permission", "error": f"API key does not have permission for this model. Check your {provider} account."})
        except (anthropic.RateLimitError, openai.RateLimitError) as e:
            await outcome(False, "rate_limit")
            # OpenAI answers 429 both for "too many requests" and for "no credit left".
            out_of_credit = "insufficient_quota" in (getattr(e, "code", None), getattr(e, "type", None))
            if key_source == "platform":
                yield _sse({"kind": "rate_limit", "error": "Rate limit reached. Add your own API key in Settings → Keys for unlimited runs, or wait a moment and try again."})
            elif out_of_credit:
                whose = "Your" if key_source == "own" else "The app developer's"
                yield _sse({"kind": "out_of_credit", "error": f"{whose} {label} account is out of credit, so {label} refused this run. "
                                     f"Add credit in the {label} billing settings, then try again."})
            else:
                whose = "your" if key_source == "own" else "the app developer's"
                yield _sse({"kind": "rate_limit", "error": f"{label} turned this run away: {whose} {label} account hit its rate limit or is out of credit. "
                                     f"Check the account's usage and billing, or wait a moment and try again."})
        except (anthropic.BadRequestError, openai.BadRequestError) as e:
            await outcome(False, "bad_request")
            yield _sse({"kind": "bad_request", "error": f"Prompt config error: {str(e)[:200]}"})
        except (anthropic.InternalServerError, openai.InternalServerError):
            await outcome(False, "provider_error")
            yield _sse({"kind": "provider_error", "error": f"{provider.capitalize()} service error — try again in a moment."})
        except asyncio.TimeoutError:
            await outcome(False, "timeout")
            yield _sse({"kind": "timeout", "error": f"Request timed out after {REQUEST_TIMEOUT} seconds. Try a shorter input or switch to a faster model (e.g. Haiku)."})
        except Exception as e:
            # Full detail goes to Sentry/logs only — never to the client.
            await outcome(False, "unexpected")
            sentry_sdk.capture_exception(e)
            print(f"Streaming error [{type(e).__name__}]: {e}")
            yield _sse({"kind": "unexpected", "error": "Unexpected backend error. This has been logged — please try again."})

    async def generate_with_timeout():
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                async for chunk in generate():
                    yield chunk
        except asyncio.TimeoutError:
            await outcome(False, "timeout")
            yield _sse({"kind": "timeout", "error": f"Request timed out after {REQUEST_TIMEOUT}s. Try a shorter input or faster model."})
        finally:
            if log_source and not run_state.get("logged"):
                await outcome(False, "cancelled")
            settle_spend(run_state["finished"])
            if entitlement and not run_state["finished"]:
                asyncio.create_task(release_entitlement_run(entitlement))

    # Hold the run's worst-case cost before any provider is called. Custom
    # models are paid by whoever runs them, outside the platform.
    if not custom:
        payer = {"own": "own", "developer": "developer", "owner": "owner"}.get(key_source, "platform")
        key_owner = caller_id if payer == "own" else owner_id if payer in ("developer", "owner") else None
        amount = spend_guard.estimate_usd(
            MODEL_PRICES.get(model), prompt_chars=len(system) + len(req.input or ""), images=len(req.images or []),
            calls=spend_guard.calls_for(tools=bool(tools), max_tool_steps=req.max_tool_steps or 10, structured=bool(contract_fields)))
        spend["id"], refusal = await reserve_run_spend(payer=payer, key_owner=key_owner, workspace_id=caller.workspace_id,
                                                       app_id=(app_row or {}).get("id"), model=model, amount=amount)
        if refusal:
            if refusal.get("code") == "spend_unavailable":
                return JSONResponse(status_code=503, content={"code": "spend_unavailable",
                    "error": "Spending limits couldn't be checked right now, so the run didn't start. Try again in a moment."})
            return JSONResponse(status_code=429, content={"code": "spend_limit", "scope": refusal.get("scope"),
                "error": spend_guard.refusal_message(refusal, payer=payer, label=label)})

    # Take the paid run last, after every check that can still refuse the
    # request, so a refused request never uses up a purchased run.
    if entitlement:
        entitlement_used = await reserve_entitlement_run(entitlement)
        if entitlement_used is None:
            settle_run_spend(spend["id"], None, "released")
            return JSONResponse(status_code=402, content={"error": entitlement_block_reason(
                {**entitlement, "runs_this_period": entitlement.get("run_quota") or 0}) or "Purchase access to run this app"})

    if log_source:
        # Mark the run as in flight so a crash is recovered as "interrupted".
        # Run tracking must never take the app down: if local storage is
        # unavailable, the run is still served and its outcome sent directly.
        try:
            await asyncio.to_thread(_telemetry_outbox.begin, {"event_id": telemetry_id, "app_id": app_row["id"],
                                    "user_id": None if caller.live else caller_id, "source": log_source,
                                    "live_version": run_version, "model": model, "created_at": telemetry_created})
        except Exception:
            print("Telemetry recovery storage unavailable; serving the run without crash recovery")
    return StreamingResponse(
        generate_with_timeout(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Developer API (v1) ──────────────────────────────────────────────────────
API_MAX_CHUNKS = int(os.getenv("API_MAX_CHUNKS", "12"))
BATCH_MAX_ROWS = int(os.getenv("BATCH_MAX_ROWS", "1000"))
BATCH_CONCURRENCY = int(os.getenv("BATCH_CONCURRENCY", "3"))
BATCH_STALE_SECONDS = int(os.getenv("BATCH_STALE_SECONDS", "180"))
_TEXT_EXTS = {"txt", "csv", "json", "md", "tsv"}


async def _drain_run(response) -> dict:
    """Consume an execute_run result into {"ok", "status", "output", "usage", ...}."""
    if not isinstance(response, StreamingResponse):
        try:
            body = json.loads(response.body)
        except Exception:
            body = {}
        return {"ok": False, "status": response.status_code, "error": body.get("error") or body.get("detail") or "Run failed",
                "kind": body.get("code"), "streamed": False}
    parts: list[str] = []
    async for chunk in response.body_iterator:
        text = chunk.decode() if isinstance(chunk, bytes) else chunk
        for raw in text.split("\n"):
            if not raw.startswith("data: "):
                continue
            ev = json.loads(raw[6:])
            if "token" in ev:
                parts.append(ev["token"])
            elif ev.get("done"):
                return {"ok": True, "status": 200, "output": "".join(parts), "usage": ev.get("usage"),
                        "provider": ev.get("provider"), "model": ev.get("model")}
            elif "contract_error" in ev:
                return {"ok": False, "status": 422, "error": "Output contract failed", "errors": ev["contract_error"],
                        "kind": "contract", "streamed": True}
            elif "error" in ev:
                status = 429 if "rate limit" in ev["error"].lower() else 504 if "timed out" in ev["error"].lower() else 502
                return {"ok": False, "status": status, "error": ev["error"], "kind": ev.get("kind"), "streamed": True}
    return {"ok": False, "status": 502, "error": "Run ended without a result", "kind": "unexpected", "streamed": True}


def _run_error_response(r: dict) -> JSONResponse:
    content = {"error": r.get("error")}
    if r.get("errors"):
        content["errors"] = r["errors"]
    return JSONResponse(status_code=r.get("status") or 502, content=content)


def _parsed_output(app_data: dict, output: str):
    if (app_data.get("output_type") or "markdown") == "markdown":
        return None
    parsed, _ = _parse_json_output(output)
    return parsed


def _chunk_text(text: str, limit: int, is_csv: bool = False) -> list[str]:
    """Line-boundary chunks under `limit` chars; CSV chunks repeat the header."""
    if len(text) <= limit:
        return [text]
    lines = text.split("\n")
    header = lines.pop(0) + "\n" if is_csv and lines else ""
    max_piece = max(1, limit - len(header) - 1)
    chunks, cur = [], header
    for line in lines:
        for i in range(0, max(len(line), 1), max_piece):
            piece = line[i:i + max_piece]
            if len(cur) + len(piece) + 1 > limit and len(cur) > len(header):
                chunks.append(cur)
                cur = header
            cur += piece + "\n"
    if len(cur) > len(header):
        chunks.append(cur)
    return chunks


async def _extract_api_file(f: ApiFileInput, request: Optional[Request] = None,
                            caller: Optional["ApiCaller"] = None) -> tuple[str, bool]:
    """Decode + extract an inline API file → (text, is_csv)."""
    import base64
    try:
        data = base64.b64decode(f.content_b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="file.content_b64 is not valid base64")
    if len(data) > MAX_EXTRACT_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_EXTRACT_BYTES // (1024 * 1024)} MB)")
    ext = f.file_name.lower().rsplit(".", 1)[-1] if "." in f.file_name else ""
    if ext in _TEXT_EXTS:
        try:
            return data.decode("utf-8-sig"), ext in ("csv", "tsv")
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="Text files must be UTF-8")
    extractor = {"pdf": _extract_pdf, "xlsx": _extract_xlsx, "xlsm": _extract_xlsx, "docx": _extract_docx}.get(ext)
    if not extractor:
        raise HTTPException(status_code=415, detail="Supported files: .pdf, .xlsx, .docx, .csv, .txt, .json, .md")
    try:
        if ext == "pdf":
            text, _ = await extract_pdf_text(
                data, (lambda: ocr_key_for(request, caller.user_jwt, caller.user_id)) if request and caller else None)
        else:
            text = await asyncio.to_thread(extractor, data)
    except OcrError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=422, detail="Could not read this file — it may be corrupted or in an older format")
    return text[:MAX_EXTRACT_CHARS], ext in ("xlsx", "xlsm")


async def live_view(app_row: dict, caller: "ApiCaller") -> tuple[dict, dict]:
    """(app, blueprint) as this caller runs it: editors the draft, everyone
    else the production version (when the app has been promoted)."""
    prod = app_row.get("prod_snapshot")
    if not isinstance(prod, dict) or (not caller.live and await can_edit_app(app_row, caller)):
        return app_row, await fetch_app_blueprint(app_row["id"])
    return {**app_row, **{k: prod[k] for k in DRAFT_FIELDS if k in prod}}, prod.get("blueprint") or {}


async def _load_api_app(app_id: str, caller: ApiCaller) -> dict:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="API gateway is not configured")
    assert_key_scope(caller, app_id)
    app_data = await load_app_row(app_id)
    if not app_data or not (app_data.get("is_published") or await can_view_app(app_data, caller)):
        raise HTTPException(status_code=404, detail="App not found or not published")
    if app_data.get("visibility") == "private" and not caller.user_id:
        raise HTTPException(status_code=401, detail="This app requires an API key")
    return app_data


def _validated_fields_input(fields: dict, input_fields: list, where: str = "") -> str:
    if input_fields:
        errors = _validate_schema_value(fields, input_fields)
        if errors:
            raise HTTPException(status_code=422, detail={"message": f"Input contract failed{where}", "errors": errors})
    return _fields_to_input(fields)


def _api_run_request(app_id: str, app_data: dict, input_text: str, *, output_type: Optional[str] = None,
                     user_context: Optional[str] = None, temperature: Optional[float] = None,
                     field_values: Optional[dict] = None) -> RunRequest:
    return RunRequest(
        app_id=app_id, input=input_text, field_values=field_values,
        system_prompt=app_data.get("system_prompt") or "You are a helpful AI assistant.",
        ai_provider=app_data.get("ai_provider") or "claude",
        ai_model=app_data.get("ai_model"),
        output_type=output_type or app_data.get("output_type") or "markdown",
        user_context=user_context, temperature=temperature,
    )


def _history_recorder(caller_id: Optional[str], app_id: str, app_name: Optional[str], input_text: str,
                      workspace_id: Optional[str] = None):
    async def record(output: str, usage: dict, provider: str, model: str):
        # Server-side runs have no browser to write run_history, so the server
        # does — this also makes them count toward the caller's rate limits.
        if not caller_id:
            return
        try:
            await db(_service_client().table("run_history").insert({
                "user_id": caller_id, "app_id": app_id, "app_name": app_name, "workspace_id": workspace_id,
                "input": input_text[:20000], "output": output[:50000],
                "input_tokens": (usage or {}).get("input_tokens"), "output_tokens": (usage or {}).get("output_tokens"),
            }))
            await db(_service_client().rpc("increment_app_runs", {"p_app_id": app_id}))
        except Exception as e:
            print(f"record run error: {e}")
    return record


async def run_collect(run_req: RunRequest, request, caller: ApiCaller, record=None) -> dict:
    response = await execute_run(run_req, request, caller=caller, on_complete=record)
    return await _drain_run(response)


@app.post("/v1/apps/{app_id}/run")
async def run_published_app_api(app_id: str, req: ApiRunRequest, request: Request):
    """Run a published app.

    Auth: `Authorization: Bearer ak_live_…` (or a Supabase session JWT). Public
    free apps also accept anonymous calls (IP rate-limited).
    Body: {"input": "..."} and/or {"fields": {...}}, optionally {"file":
    {"file_name", "content_b64"}}. Inputs larger than one model call are split
    into parts, analysed, and combined. "stream": false returns one JSON body.
    """
    caller = await resolve_api_caller(request)
    return await _run_app_api(app_id, req, request, caller)


async def _run_app_api(app_id: str, req: ApiRunRequest, request: Request, caller: ApiCaller):
    app_data = await _load_api_app(app_id, caller)
    app_data, blueprint = await live_view(app_data, caller)

    pieces = []
    if req.fields is not None:
        pieces.append(_validated_fields_input(req.fields, _schema_fields(blueprint, "input_schema")))
    if (req.input or "").strip():
        pieces.append(req.input.strip())
    file_text, is_csv = "", False
    if req.file is not None:
        file_text, is_csv = await _extract_api_file(req.file, request, caller)
        if not file_text.strip():
            raise HTTPException(status_code=422, detail="The file contains no readable text")
    if not pieces and not file_text:
        raise HTTPException(status_code=422, detail="Pass 'input', 'fields' or 'file'")

    instructions = "\n\n".join(pieces)
    header = f"{instructions}\n\nFile: {req.file.file_name}\n\n" if req.file else ""
    input_text = header + file_text if req.file else instructions
    record = _history_recorder(caller.user_id, app_id, app_data.get("name"), input_text, caller.workspace_id)
    kwargs = {"user_context": req.user_context, "temperature": req.temperature}

    if len(input_text) > MAX_INPUT_LENGTH:
        if not req.file:
            raise HTTPException(status_code=413, detail=f"Input too long ({len(input_text):,} chars, max {MAX_INPUT_LENGTH:,}). Send large content as a file.")
        budget = MAX_INPUT_LENGTH - len(header) - 400
        chunks = _chunk_text(file_text, budget, is_csv)
        if len(chunks) > API_MAX_CHUNKS:
            raise HTTPException(status_code=413, detail=f"File too large: {len(chunks)} parts (max {API_MAX_CHUNKS}). Trim or split it.")
        # Map: analyse each part. Reduce: merge with the app's own format.
        notes = []
        for i, chunk in enumerate(chunks):
            part_input = (f"{header}This is part {i + 1} of {len(chunks)} of a larger file. Extract every finding, figure and "
                          f"row-level detail relevant to the task as concise notes; a later step will merge all parts.\n\n{chunk}")
            r = await run_collect(_api_run_request(app_id, app_data, part_input, output_type="markdown", **kwargs),
                                  request, caller, _history_recorder(caller.user_id, app_id, app_data.get("name"), part_input, caller.workspace_id))
            if not r["ok"]:
                return _run_error_response(r)
            notes.append(f"## Part {i + 1}\n{r['output']}")
        combine = (f"{instructions}\n\nThe file '{req.file.file_name}' was too large for one pass, so it was analysed in "
                   f"{len(chunks)} parts. Combine these partial results into one complete answer to the task above. "
                   f"Totals and counts must cover ALL parts.\n\n")
        input_text = combine + "\n\n".join(notes)[: MAX_INPUT_LENGTH - len(combine)]

    try:
        run_req = _api_run_request(app_id, app_data, input_text, field_values=req.fields, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    response = await execute_run(run_req, request, caller=caller, on_complete=record)
    if req.stream or not isinstance(response, StreamingResponse):
        return response
    r = await _drain_run(response)
    if not r["ok"]:
        return _run_error_response(r)
    return {"output": r["output"], "data": _parsed_output(app_data, r["output"]), "provider": r["provider"],
            "model": r["model"], "usage": r["usage"]}


# ── App discovery ────────────────────────────────────────────────────────────
def _public_app_view(app_data: dict, blueprint: dict, include_prompt: bool) -> dict:
    view = {k: app_data.get(k) for k in (
        "id", "name", "description", "app_type", "output_type", "ai_provider", "ai_model",
        "is_paid", "price_per_run", "visibility", "is_published", "created_at", "updated_at")}
    view["input_schema"] = _schema_fields(blueprint, "input_schema")
    view["output_schema"] = _schema_fields(blueprint, "output_schema")
    view["parameters"] = [
        {"name": re.sub(r"[^a-z0-9]+", "_", (f.get("label") or "").lower()).strip("_"), "label": f.get("label"),
         "type": f.get("type"), "required": bool(f.get("required"))}
        for f in (app_data.get("form_schema") or []) if f.get("label")
    ]
    if include_prompt:
        view["system_prompt"] = app_data.get("system_prompt")
    return view


@app.get("/apps")
@app.get("/v1/apps")
async def list_apps(request: Request):
    """Apps owned by the caller (API key or session)."""
    caller = await resolve_api_caller(request, required=True)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Service not configured")
    q = sb.table("apps").select("id, name, description, app_type, output_type, ai_model, ai_provider, is_paid, "
                                "price_per_run, is_published, visibility, workspace_id, created_at, updated_at") \
        .order("updated_at", desc=True)
    q = q.eq("workspace_id", caller.workspace_id) if caller.workspace_id else q.eq("created_by", caller.user_id)
    if caller.app_ids:
        q = q.in_("id", caller.app_ids)
    result = await db(q)
    return {"apps": result.data or []}


@app.get("/apps/{app_id}")
@app.get("/v1/apps/{app_id}")
async def get_app(app_id: str, request: Request):
    """App metadata plus its input/output contract. The prompt is only
    returned to the app's owner or editors."""
    caller = await resolve_api_caller(request)
    app_data = await _load_api_app(app_id, caller)
    app_data, blueprint = await live_view(app_data, caller)
    return _public_app_view(app_data, blueprint, await can_edit_app(app_data, caller))


# ── Usage + keys ─────────────────────────────────────────────────────────────
async def usage_snapshot(user_id: str) -> dict:
    sb = _service_client()
    hourly, daily = await get_usage_counts(sb, user_id)
    keys = await db(sb.table("user_api_keys").select("provider").eq("user_id", user_id).eq("is_active", True))
    own = sorted({r["provider"] for r in (keys.data or [])})
    return {"own_provider_keys": own,
            "hourly": {"used": hourly, "limit": HOURLY_LIMIT, "remaining": max(0, HOURLY_LIMIT - hourly)},
            "daily": {"used": daily, "limit": DAILY_LIMIT, "remaining": max(0, DAILY_LIMIT - daily)},
            "note": "Runs on apps whose provider you have your own key for are not limited."}


# ─── Build cost estimates ────────────────────────────────────────────────────
# USD per 1M tokens (input, output). Claude prices from Anthropic's price list;
# OpenAI prices are approximate — update here if providers change pricing.
MODEL_PRICES = {
    "claude-opus-5-5": (4.00, 20.00), "claude-sonnet-5-5": (2.00, 10.00), "claude-haiku-5-5": (0.10, 0.50),
    "claude-opus-4-8": (5.00, 25.00), "claude-sonnet-4-6": (3.00, 15.00), "claude-haiku-4-5-20251001": (1.00, 5.00),
    "gpt-4o-mini": (0.15, 0.60), "gpt-4o": (2.50, 10.00),
}
MODEL_LABELS = {
    "claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-haiku-5-5": "Claude Haiku 5.5",
    "claude-opus-4-8": "Claude Opus 4.8", "claude-sonnet-4-6": "Claude Sonnet 4.6", "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "gpt-4o-mini": "GPT-4o mini", "gpt-4o": "GPT-4o",
}
BUILDER_MODEL = "claude-sonnet-5-5"     # what the Build with AI / website generators call
DETAILS_MODEL = "claude-haiku-5-5"      # "AI-generate name & description"


def estimate_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = MODEL_PRICES.get(model, MODEL_PRICES[BUILDER_MODEL])
    return (input_tokens * pin + output_tokens * pout) / 1_000_000


def _step(label: str, model: str, inp: tuple[int, int], out: tuple[int, int], *, optional=False, per=None) -> dict:
    return {
        "label": label, "model": model, "model_label": MODEL_LABELS.get(model, model),
        "tokens": [inp[0] + out[0], inp[1] + out[1]],
        "usd": [round(estimate_usd(model, inp[0], out[0]), 4), round(estimate_usd(model, inp[1], out[1]), 4)],
        "optional": optional, "per": per,
    }


def build_estimate_steps(app_type: str) -> list[dict]:
    """Typical token ranges per AI step (output ranges include the model's
    thinking). Ranges, not quotes: real usage depends on what the user types."""
    run = _step("Each preview / test run", BUILDER_MODEL, (400, 2500), (300, 1500), optional=True, per="run")
    if app_type == "ai_builder":
        return [
            _step("Analyse your idea and ask questions", BUILDER_MODEL, (500, 1000), (400, 1500)),   # measured: 547 in / 481 out
            _step("Generate the app", BUILDER_MODEL, (1200, 2200), (1200, 3500)),           # measured: 1,313 in / 1,447 out
            run,
        ]
    if app_type == "website":
        return [
            _step("Read the website", BUILDER_MODEL, (0, 0), (0, 0)),
            _step("Generate the app from the page", BUILDER_MODEL, (1500, 4000), (600, 2000)),
            run,
        ]
    steps = [
        _step("AI-generate name & description", DETAILS_MODEL, (200, 800), (100, 400), optional=True),
        run,
    ]
    if app_type == "data":
        steps.append(_step("Each scanned PDF page read with OCR", OCR_MODEL, (1500, 2500), (200, 800), optional=True, per="page"))
    return steps


@app.get("/v1/build-estimate")
async def build_estimate(request: Request, type: str = "prompt"):
    """What starting to build an app of this type will use: AI calls, tokens,
    approximate cost, and who pays (the caller's own key or the platform)."""
    caller = await resolve_api_caller(request, required=True)
    steps = build_estimate_steps(type)
    required = [st for st in steps if not st["optional"] and st["tokens"][1] > 0]
    total = {
        "tokens": [sum(st["tokens"][0] for st in required), sum(st["tokens"][1] for st in required)],
        "usd": [round(sum(st["usd"][0] for st in required), 4), round(sum(st["usd"][1] for st in required), 4)],
        "runs": len(required),
    }
    own_key = (await fetch_user_api_key(caller.user_jwt, "claude") if caller.user_jwt
               else await fetch_user_api_key_by_id(caller.user_id, "claude"))
    billing = {"billed_to": "your_key" if own_key else "platform", "provider": "claude",
               "runs_left": None, "enough_runs": True}
    if not own_key and SUPABASE_SERVICE_ROLE_KEY:
        try:
            usage = await usage_snapshot(caller.user_id)
            left = min(usage["hourly"]["remaining"], usage["daily"]["remaining"])
            billing.update(runs_left=left, enough_runs=left >= total["runs"])
        except Exception as e:
            print(f"build_estimate usage error: {e}")
    return {"type": type, "uses_ai_to_create": total["runs"] > 0, "steps": steps, "total": total,
            "billing": billing, "prices_per_million": {m: list(v) for m, v in MODEL_PRICES.items()}}


@app.get("/v1/usage")
async def get_usage(request: Request):
    caller = await resolve_api_caller(request, required=True)
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Service not configured")
    return await usage_snapshot(caller.user_id)


@app.post("/v1/keys")
async def create_api_key(body: ApiKeyCreateRequest, request: Request):
    """Create a developer key. The raw key is returned ONCE; only its SHA-256
    hash is stored. Optional app_ids restricts the key to those apps."""
    caller = await resolve_api_caller(request, required=True)
    if caller.via_key:
        raise HTTPException(status_code=403, detail="Create keys from a signed-in session, not with another key")
    ws = body.workspace_id or caller.workspace_id
    if not ws or (await workspace_role(ws, caller.user_id)) not in BUILD_ROLES:
        raise HTTPException(status_code=403, detail="Only workspace owners, admins and developers can create API keys")
    for a in body.app_ids:
        if not _UUID_RE.fullmatch(a):
            raise HTTPException(status_code=422, detail=f"Invalid app id: {a}")
    if body.app_ids:
        found = await db(_service_client().table("apps").select("id").in_("id", body.app_ids).eq("workspace_id", ws))
        outside = set(body.app_ids) - {r["id"] for r in (found.data or [])}
        if outside:
            raise HTTPException(status_code=422, detail=f"These apps aren't in this workspace: {', '.join(sorted(outside))}")
    raw = "ak_live_" + secrets.token_hex(24)
    try:
        res = await db(_service_client().table("developer_api_keys").insert({
            "user_id": caller.user_id, "workspace_id": ws, "name": body.name.strip(),
            "key_hash": hash_api_key(raw), "key_prefix": raw[:14], "app_ids": body.app_ids or None,
            "is_active": True,
        }))
    except Exception as e:
        print(f"create_api_key error: {e}")
        raise HTTPException(status_code=503, detail="Key storage isn't set up — apply the database migrations (npm run db:push)")
    row = res.data[0]
    return {"id": row["id"], "name": row["name"], "key": raw, "key_prefix": row["key_prefix"],
            "workspace_id": ws, "app_ids": row.get("app_ids") or [], "created_at": row.get("created_at")}


# ── Workspaces ───────────────────────────────────────────────────────────────
@app.get("/v1/workspaces")
async def list_workspaces(request: Request):
    """Workspaces the caller belongs to (for an API key: its own workspace)."""
    caller = await resolve_api_caller(request, required=True)
    sb = _service_client()
    if caller.via_key:
        res = await db(sb.table("workspaces").select("id, name, slug, is_personal, plan").eq("id", caller.workspace_id))
        return {"workspaces": [{**w, "role": None} for w in (res.data or [])], "active": caller.workspace_id}
    mem = await db(sb.table("workspace_members").select("workspace_id, role").eq("user_id", caller.user_id))
    roles = {m["workspace_id"]: m["role"] for m in (mem.data or [])}
    if not roles:
        return {"workspaces": [], "active": caller.workspace_id}
    res = await db(sb.table("workspaces").select("id, name, slug, is_personal, plan")
                   .in_("id", list(roles)).order("is_personal", desc=True).order("name"))
    return {"workspaces": [{**w, "role": roles.get(w["id"])} for w in (res.data or [])], "active": caller.workspace_id}


@app.post("/v1/workspaces/{workspace_id}/invites", status_code=201)
async def invite_to_workspace(workspace_id: str, body: WorkspaceInviteRequest, request: Request):
    """Invite someone by email (owners/admins). Sends the email when Resend is
    configured; the invite link is returned either way."""
    caller = await resolve_api_caller(request, required=True)
    if caller.via_key:
        raise HTTPException(status_code=403, detail="Invite people from a signed-in session")
    if (await workspace_role(workspace_id, caller.user_id)) not in MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Only workspace owners and admins can invite people")
    email = body.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    sb = _service_client()
    ws = (await db(sb.table("workspaces").select("name, is_personal").eq("id", workspace_id).limit(1))).data
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if ws[0]["is_personal"]:
        raise HTTPException(status_code=422, detail="Personal workspaces can't have other members — create a team workspace")
    # One open invite per email: replace any earlier one.
    await db(sb.table("workspace_invites").delete().eq("workspace_id", workspace_id)
             .ilike("email", email).is_("accepted_at", "null"))
    inv = (await db(sb.table("workspace_invites").insert({
        "workspace_id": workspace_id, "email": email, "role": body.role, "invited_by": caller.user_id,
        "token": str(uuid.uuid4()),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }))).data[0]
    invite_url = f"{FRONTEND_URL.rstrip('/')}/invite/{inv['token']}"
    sent = await send_email(
        to=email,
        subject=f"You're invited to {ws[0]['name']} on {BRAND_NAME}",
        html=_email_base(
            title=f"Join {ws[0]['name']}",
            body=f"You've been invited to the <strong style='color:#fff'>{ws[0]['name']}</strong> workspace "
                 f"as <strong style='color:#fff'>{body.role}</strong>. The invite expires in 7 days.",
            cta_url=invite_url, cta_label="Accept invite →",
        ),
    )
    return {"id": inv["id"], "email": email, "role": body.role, "invite_url": invite_url,
            "expires_at": inv["expires_at"], "email_sent": bool(sent)}


# ── Batch jobs ───────────────────────────────────────────────────────────────
_batch_tasks: dict[str, asyncio.Task] = {}


def _rows_from_csv(text: str) -> list[str]:
    reader = list(csv.reader(io.StringIO(text.lstrip("\ufeff"))))
    reader = [r for r in reader if any(c.strip() for c in r)]
    if len(reader) < 2:
        raise HTTPException(status_code=422, detail="csv needs a header row and at least one data row")
    names = [h.strip() or f"column_{i + 1}" for i, h in enumerate(reader[0])]
    return ["\n".join(f"{n}: {(r[i] if i < len(r) else '').strip()}" for i, n in enumerate(names)) for r in reader[1:]]


async def _job_for_caller(job_id: str, caller: ApiCaller) -> dict:
    res = await db(_service_client().table("batch_jobs").select("*").eq("id", job_id).limit(1))
    job = res.data[0] if res and res.data else None
    allowed = bool(job) and (
        (caller.via_key and job.get("workspace_id") and job["workspace_id"] == caller.workspace_id)
        or (not caller.via_key and (job["user_id"] == caller.user_id
                                    or (await workspace_role(job.get("workspace_id"), caller.user_id)) in MANAGE_ROLES)))
    if not allowed:
        raise HTTPException(status_code=404, detail="Batch not found")
    assert_key_scope(caller, job["app_id"])
    return job


def _job_view(job: dict) -> dict:
    total = job.get("total") or 0
    done = (job.get("completed") or 0) + (job.get("failed") or 0)
    return {**{k: job.get(k) for k in ("id", "app_id", "status", "total", "completed", "failed", "stop_reason",
                                         "created_at", "started_at", "finished_at")},
            "progress": round(done / total, 4) if total else 0,
            "results_url": f"/v1/batches/{job['id']}/results"}


@app.post("/v1/apps/{app_id}/batches", status_code=202)
async def create_batch(app_id: str, body: BatchCreateRequest, request: Request):
    """Queue many inputs for one app; runs server-side (survives the caller
    disconnecting). Poll GET /v1/batches/{id} or pass webhook_url."""
    caller = await resolve_api_caller(request, required=True)
    app_data = await _load_api_app(app_id, caller)
    app_data, blueprint = await live_view(app_data, caller)
    input_fields = _schema_fields(blueprint, "input_schema")

    inputs: list[str] = []
    if body.csv:
        inputs.extend(_rows_from_csv(body.csv))
    for i, row in enumerate(body.rows or []):
        if row.fields is not None:
            text = _validated_fields_input(row.fields, input_fields, f" in row {i}")
            inputs.append(f"{text}\n\n{row.input.strip()}" if (row.input or "").strip() else text)
        elif (row.input or "").strip():
            inputs.append(row.input.strip())
        else:
            raise HTTPException(status_code=422, detail=f"Row {i} needs 'input' or 'fields'")
    if not inputs:
        raise HTTPException(status_code=422, detail="Pass 'rows' or 'csv'")
    if len(inputs) > BATCH_MAX_ROWS:
        raise HTTPException(status_code=413, detail=f"{len(inputs)} rows — max {BATCH_MAX_ROWS} per batch")
    too_long = next((i for i, t in enumerate(inputs) if len(t) > MAX_INPUT_LENGTH), None)
    if too_long is not None:
        raise HTTPException(status_code=413, detail=f"Row {too_long} is longer than {MAX_INPUT_LENGTH:,} chars")
    if body.webhook_url:
        try:
            assert_public_url(body.webhook_url)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=f"webhook_url rejected: {e}")

    warnings: list[str] = []
    if app_data.get("is_paid") and not await can_edit_app(app_data, caller):
        ent = await find_active_entitlement(app_id, caller)
        if not ent or entitlement_block_reason(ent):
            raise HTTPException(status_code=402, detail=(entitlement_block_reason(ent) if ent else "Purchase access to run this app"))
        if ent.get("run_quota") is not None:
            left = ent["run_quota"] - (ent.get("runs_this_period") or 0)
            if left < len(inputs):
                warnings.append(f"Your plan has {left} runs left this period; the batch will stop after that.")
    usage = await usage_snapshot(caller.user_id)
    if (app_data.get("ai_provider") or "claude") not in usage["own_provider_keys"]:
        left = min(usage["hourly"]["remaining"], usage["daily"]["remaining"])
        if left < len(inputs):
            warnings.append(f"Platform limits allow {left} more runs right now; the batch will stop after that "
                            f"(resume later with POST /v1/batches/{{id}}/retry, or add your own API key for no limit).")

    sb = _service_client()
    try:
        job = (await db(sb.table("batch_jobs").insert({
            "app_id": app_id, "user_id": caller.user_id, "workspace_id": caller.workspace_id,
            "status": "queued", "total": len(inputs),
            "completed": 0, "failed": 0, "webhook_url": body.webhook_url,
        }))).data[0]
    except Exception as e:
        print(f"create_batch error: {e}")
        raise HTTPException(status_code=503, detail="Batch storage isn't set up — apply the database migrations (npm run db:push)")
    rows = [{"job_id": job["id"], "idx": i, "input": t, "status": "pending"} for i, t in enumerate(inputs)]
    for i in range(0, len(rows), 500):
        await db(sb.table("batch_job_rows").insert(rows[i:i + 500]))
    spawn_batch(job["id"])
    return {**_job_view(job), "warnings": warnings}


@app.get("/v1/batches")
async def list_batches(request: Request, limit: int = 20):
    caller = await resolve_api_caller(request, required=True)
    q = _service_client().table("batch_jobs").select("*") \
        .order("created_at", desc=True).limit(max(1, min(limit, 100)))
    # keys and workspace admins see the workspace's batches; others their own
    if caller.via_key or (await workspace_role(caller.workspace_id, caller.user_id)) in MANAGE_ROLES:
        q = q.eq("workspace_id", caller.workspace_id)
    else:
        q = q.eq("user_id", caller.user_id)
    if caller.app_ids:
        q = q.in_("app_id", caller.app_ids)
    res = await db(q)
    return {"batches": [_job_view(j) for j in (res.data or [])]}


@app.get("/v1/batches/{job_id}")
async def get_batch(job_id: str, request: Request):
    caller = await resolve_api_caller(request, required=True)
    return _job_view(await _job_for_caller(job_id, caller))


@app.get("/v1/batches/{job_id}/results")
async def get_batch_results(job_id: str, request: Request, format: str = "json", offset: int = 0, limit: int = 200):
    caller = await resolve_api_caller(request, required=True)
    job = await _job_for_caller(job_id, caller)
    q = _service_client().table("batch_job_rows") \
        .select("idx, input, status, output, data, error, input_tokens, output_tokens").eq("job_id", job_id).order("idx")
    if format == "csv":
        res = await db(q.limit(BATCH_MAX_ROWS))
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["idx", "input", "status", "output", "error", "input_tokens", "output_tokens"])
        for r in res.data or []:
            w.writerow([r["idx"], r["input"], r["status"], r.get("output") or "", r.get("error") or "",
                        r.get("input_tokens") or "", r.get("output_tokens") or ""])
        return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="batch-{job_id}.csv"'})
    limit = max(1, min(limit, 500))
    res = await db(q.range(max(0, offset), max(0, offset) + limit - 1))
    return {"batch": _job_view(job), "offset": offset, "rows": res.data or []}


@app.post("/v1/batches/{job_id}/cancel")
async def cancel_batch(job_id: str, request: Request):
    caller = await resolve_api_caller(request, required=True)
    job = await _job_for_caller(job_id, caller)
    if job["status"] in ("queued", "running"):
        await db(_service_client().table("batch_jobs").update({
            "status": "cancelled", "finished_at": datetime.now(timezone.utc).isoformat()}).eq("id", job_id))
        task = _batch_tasks.get(job_id)
        if task and not task.done():
            task.cancel()
    return _job_view(await _job_for_caller(job_id, caller))


@app.post("/v1/batches/{job_id}/retry", status_code=202)
async def retry_batch(job_id: str, request: Request):
    """Re-queue every row that failed or never ran (e.g. after a rate-limit stop)."""
    caller = await resolve_api_caller(request, required=True)
    job = await _job_for_caller(job_id, caller)
    if job["status"] in ("queued", "running"):
        raise HTTPException(status_code=409, detail="Batch is still running")
    sb = _service_client()
    await db(sb.table("batch_job_rows").update({"status": "pending", "error": None})
             .eq("job_id", job_id).in_("status", ["error", "running", "pending"]))
    await db(sb.table("batch_jobs").update({"status": "queued", "stop_reason": None, "finished_at": None}).eq("id", job_id))
    spawn_batch(job_id)
    return _job_view(await _job_for_caller(job_id, caller))


def spawn_batch(job_id: str) -> None:
    task = _batch_tasks.get(job_id)
    if task and not task.done():
        return
    _batch_tasks[job_id] = asyncio.create_task(_run_batch_job(job_id))


async def _claim_batch_job(sb, job_id: str) -> Optional[dict]:
    now = datetime.now(timezone.utc)
    res = await db(sb.table("batch_jobs").update({
        "status": "running", "heartbeat_at": now.isoformat(), "started_at": now.isoformat(),
    }).eq("id", job_id).eq("status", "queued"))
    if res.data:
        return res.data[0]
    stale = (now - timedelta(seconds=BATCH_STALE_SECONDS)).isoformat()
    res = await db(sb.table("batch_jobs").update({"heartbeat_at": now.isoformat()})
                   .eq("id", job_id).eq("status", "running").lt("heartbeat_at", stale))
    return res.data[0] if res.data else None


async def _refresh_batch_counts(sb, job_id: str) -> tuple[int, int]:
    done, failed = await asyncio.gather(
        db(sb.table("batch_job_rows").select("idx", count="exact", head=True).eq("job_id", job_id).eq("status", "done")),
        db(sb.table("batch_job_rows").select("idx", count="exact", head=True).eq("job_id", job_id).eq("status", "error")),
    )
    completed, n_failed = done.count or 0, failed.count or 0
    await db(sb.table("batch_jobs").update({
        "completed": completed, "failed": n_failed, "heartbeat_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id))
    return completed, n_failed


async def _run_batch_job(job_id: str) -> None:
    sb = _service_client()
    if not sb:
        return
    job = None
    try:
        job = await _claim_batch_job(sb, job_id)
        if not job:
            return
        # A batch acts for its workspace (like an API key), so it keeps
        # running even if the person who started it leaves the team.
        caller = ApiCaller(user_id=job["user_id"], workspace_id=job.get("workspace_id"),
                           via_key=bool(job.get("workspace_id")))
        app_data = await load_app_row(job["app_id"])
        if not app_data:
            raise RuntimeError("app deleted")
        rows = (await db(sb.table("batch_job_rows").select("idx, input").eq("job_id", job_id)
                         .in_("status", ["pending", "running"]).order("idx"))).data or []
        shim = SimpleNamespace(headers={}, client=SimpleNamespace(host=f"batch:{job_id}"))
        sem = asyncio.Semaphore(max(1, BATCH_CONCURRENCY))
        stop: dict = {"reason": None, "cancelled": False}

        async def process(row: dict):
            if stop["reason"] or stop["cancelled"]:
                return
            async with sem:
                if stop["reason"] or stop["cancelled"]:
                    return
                st = await db(sb.table("batch_jobs").select("status").eq("id", job_id).limit(1))
                if st.data and st.data[0]["status"] == "cancelled":
                    stop["cancelled"] = True
                    return
                await db(sb.table("batch_job_rows").update({"status": "running"}).eq("job_id", job_id).eq("idx", row["idx"]))
                r = await run_collect(_api_run_request(job["app_id"], app_data, row["input"]), shim, caller,
                                      _history_recorder(caller.user_id, job["app_id"], app_data.get("name"), row["input"],
                                                        caller.workspace_id))
                now = datetime.now(timezone.utc).isoformat()
                if r["ok"]:
                    usage = r.get("usage") or {}
                    await db(sb.table("batch_job_rows").update({
                        "status": "done", "output": r["output"], "data": _parsed_output(app_data, r["output"]),
                        "error": None, "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
                        "updated_at": now,
                    }).eq("job_id", job_id).eq("idx", row["idx"]))
                elif r["status"] in (401, 402, 403, 429):
                    # Account-level problem: every remaining row would fail the
                    # same way. Leave it pending so /retry can resume.
                    stop["reason"] = r["error"]
                    await db(sb.table("batch_job_rows").update({"status": "pending", "updated_at": now})
                             .eq("job_id", job_id).eq("idx", row["idx"]))
                else:
                    err = r["error"] + (f": {'; '.join(r['errors'])}" if r.get("errors") else "")
                    await db(sb.table("batch_job_rows").update({"status": "error", "error": err[:2000], "updated_at": now})
                             .eq("job_id", job_id).eq("idx", row["idx"]))
                await _refresh_batch_counts(sb, job_id)

        await asyncio.gather(*(process(r) for r in rows))
        completed, failed = await _refresh_batch_counts(sb, job_id)
        if stop["cancelled"]:
            return
        status = "stopped" if stop["reason"] else ("completed_with_errors" if failed else "completed")
        await db(sb.table("batch_jobs").update({
            "status": status, "stop_reason": stop["reason"], "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).neq("status", "cancelled"))
        if job.get("webhook_url"):
            try:
                await fetch_safely("POST", job["webhook_url"], timeout=10, json={
                    "event": "batch.finished", "batch_id": job_id, "app_id": job["app_id"], "status": status,
                    "total": job["total"], "completed": completed, "failed": failed, "stop_reason": stop["reason"],
                    "results_url": f"/v1/batches/{job_id}/results",
                })
            except Exception as e:
                print(f"batch webhook error: {e}")
    except asyncio.CancelledError:
        raise
    except Exception as e:
        sentry_sdk.capture_exception(e)
        print(f"batch job {job_id} failed: {e}")
        if job:
            await db(sb.table("batch_jobs").update({
                "status": "failed", "stop_reason": "Internal error — retry the batch",
                "finished_at": datetime.now(timezone.utc).isoformat()}).eq("id", job_id))
    finally:
        _batch_tasks.pop(job_id, None)


async def _batch_supervisor() -> None:
    while True:
        try:
            sb = _service_client()
            if sb:
                stale = (datetime.now(timezone.utc) - timedelta(seconds=BATCH_STALE_SECONDS)).isoformat()
                queued, dead = await asyncio.gather(
                    db(sb.table("batch_jobs").select("id").eq("status", "queued").limit(50)),
                    db(sb.table("batch_jobs").select("id").eq("status", "running").lt("heartbeat_at", stale).limit(50)),
                )
                for j in (queued.data or []) + (dead.data or []):
                    spawn_batch(j["id"])
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"batch supervisor: {e}")   # e.g. tables not migrated yet
        await asyncio.sleep(60)


# ─── File text extraction (Data apps) ────────────────────────────────────────
MAX_EXTRACT_BYTES = int(os.getenv("MAX_EXTRACT_BYTES", str(10 * 1024 * 1024)))
MAX_EXTRACT_CHARS = int(os.getenv("MAX_EXTRACT_CHARS", "400000"))


class ExtractRequest(BaseModel):
    file_name: str = Field(..., max_length=255)
    content_b64: str
    # Signed-out website visitors of an embedded Data app (visitor access).
    app_id: Optional[str] = None


def _extract_pdf(data: bytes) -> str:
    import io
    import pypdf
    reader = pypdf.PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ValueError("PDF is password-protected")
    pages = []
    for i, page in enumerate(reader.pages):
        pages.append(f"--- Page {i + 1} ---\n{page.extract_text() or ''}")
    text = "\n\n".join(pages)
    if not re.sub(r"--- Page \d+ ---|\s", "", text):
        raise ValueError("No selectable text found — this looks like a scanned PDF")
    return text


# ─── OCR for scanned PDF pages (Claude reads the page images) ──────────────
# Pages with a text layer are read locally with pypdf; only image-only pages
# are sent to Claude, OCR_PAGES_PER_REQUEST at a time, as PDF document
# blocks (limits: 32 MB per request, up to 600 pages on 1M-context models).
OCR_MODEL = os.getenv("OCR_MODEL", "claude-opus-5-5")
OCR_PAGES_PER_REQUEST = int(os.getenv("OCR_PAGES_PER_REQUEST", "20"))
OCR_MAX_PAGES = int(os.getenv("OCR_MAX_PAGES", "200"))
OCR_CONCURRENCY = int(os.getenv("OCR_CONCURRENCY", "3"))
_OCR_MAX_CHUNK_BYTES = 22 * 1024 * 1024     # base64 grows ~33%; stays under 32 MB
_OCR_MIN_TEXT_CHARS = 25                     # fewer real characters → treat page as scanned
_OCR_PAGE_MARK = re.compile(r"^\s*-{3}\s*Page\s+(\d+)\s*-{3}\s*$", re.MULTILINE)
_OCR_INSTRUCTIONS = (
    "Transcribe all text in this PDF exactly as written — this is OCR, not a summary.\n"
    "- Keep the reading order, headings, lists and paragraph breaks.\n"
    "- Render tables as Markdown tables; keep numbers, dates and currency exactly as printed.\n"
    "- Include handwriting, stamps and form labels/values when legible.\n"
    "- Write [illegible] for text you cannot read and [no text] for a blank page.\n"
    "- Do not translate, correct, summarise or add any commentary.\n"
)


class OcrError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _pdf_reader(data: bytes):
    import io
    import pypdf
    reader = pypdf.PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ValueError("PDF is password-protected")
    return reader


def _pdf_subset(reader, indices: list[int]) -> bytes:
    import io
    import pypdf
    writer = pypdf.PdfWriter()
    for i in indices:
        writer.add_page(reader.pages[i])
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _ocr_chunks(reader, indices: list[int]) -> list[tuple[list[int], bytes]]:
    """Group pages into sub-PDFs of ≤ OCR_PAGES_PER_REQUEST pages and
    ≤ _OCR_MAX_CHUNK_BYTES, halving any group that is too large."""
    out: list[tuple[list[int], bytes]] = []
    pending = [indices[i:i + OCR_PAGES_PER_REQUEST] for i in range(0, len(indices), OCR_PAGES_PER_REQUEST)]
    while pending:
        group = pending.pop(0)
        data = _pdf_subset(reader, group)
        if len(data) <= _OCR_MAX_CHUNK_BYTES:
            out.append((group, data))
        elif len(group) == 1:
            raise ValueError(f"Page {group[0] + 1} is too large to read (over {_OCR_MAX_CHUNK_BYTES // (1024 * 1024)} MB)")
        else:
            mid = len(group) // 2
            pending[:0] = [group[:mid], group[mid:]]
    return out


async def _ocr_chunk(client, pdf_bytes: bytes, page_numbers: list[int]) -> dict[int, str]:
    import base64
    numbers = ", ".join(str(n) for n in page_numbers)
    prompt = (_OCR_INSTRUCTIONS +
              f"\nThis file holds pages {numbers} of a larger document, in that order. "
              "Start each page with a line '--- Page N ---' using those page numbers.")
    async with client.beta.messages.stream(
        model=OCR_MODEL,
        max_tokens=64000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",                     # retry on another model if declined
        output_config={"effort": "low"},         # transcription, not reasoning
        messages=[{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                            "data": base64.b64encode(pdf_bytes).decode()}},
            {"type": "text", "text": prompt},
        ]}],
    ) as stream:
        msg = await stream.get_final_message()
    if msg.stop_reason == "refusal":
        raise OcrError(f"The text on page(s) {numbers} could not be transcribed.", 422)
    text = "".join(getattr(b, "text", "") for b in msg.content if getattr(b, "type", "") == "text")
    if msg.stop_reason == "max_tokens":
        text += "\n[transcription cut off: page text too long]"

    pieces = _OCR_PAGE_MARK.split(text)
    found: dict[int, str] = {}
    for k in range(1, len(pieces) - 1, 2):
        found[int(pieces[k])] = pieces[k + 1].strip()
    if not found:                                  # model skipped the markers
        found[page_numbers[0]] = text.strip()
    return {n: found.get(n, "") for n in page_numbers}


async def extract_pdf_text(data: bytes, get_ocr_key=None, max_pages: Optional[int] = None) -> tuple[str, int]:
    """Text of a PDF as '--- Page N ---' sections. Scanned (image-only) pages
    are OCR'd with Claude. Returns (text, number_of_pages_OCRd).
    get_ocr_key: async () -> Optional[str] API key, called only if OCR is
    needed (lets callers apply their own key / rate limits lazily)."""
    reader = await asyncio.to_thread(_pdf_reader, data)
    texts = await asyncio.to_thread(lambda: [(pg.extract_text() or "") for pg in reader.pages])
    scanned = [i for i, t in enumerate(texts) if len(re.sub(r"\s", "", t)) < _OCR_MIN_TEXT_CHARS]

    if scanned:
        limit = max_pages or OCR_MAX_PAGES
        if len(scanned) > limit:
            raise ValueError(f"This PDF has {len(scanned)} scanned pages; up to {limit} can be read per file. "
                             "Split it into smaller files.")
        key = await get_ocr_key() if get_ocr_key else None
        if not (key or os.getenv("ANTHROPIC_API_KEY")):
            raise OcrError("Reading scanned pages isn't configured on this server (no Claude API key).", 503)
        chunks = await asyncio.to_thread(_ocr_chunks, reader, scanned)
        client = anthropic.AsyncAnthropic(api_key=key or os.getenv("ANTHROPIC_API_KEY"))
        sem = asyncio.Semaphore(max(1, OCR_CONCURRENCY))

        async def run(group: list[int], pdf_bytes: bytes) -> dict[int, str]:
            async with sem:
                return await _ocr_chunk(client, pdf_bytes, [i + 1 for i in group])

        try:
            results = await asyncio.gather(*(run(g, b) for g, b in chunks))
        except anthropic.AuthenticationError:
            raise OcrError("Reading scanned pages failed: the Claude API key was rejected. Check Settings → Keys.", 502)
        except anthropic.RateLimitError:
            raise OcrError("Reading scanned pages is rate-limited right now. Try again in a minute.", 429)
        except (anthropic.APIConnectionError, anthropic.InternalServerError):
            raise OcrError("The OCR service is temporarily unavailable. Try again in a moment.", 502)
        except anthropic.APIStatusError as e:
            raise OcrError(f"Reading scanned pages failed ({e.status_code}).", 502)
        for result in results:
            for page_no, page_text in result.items():
                texts[page_no - 1] = page_text

    out = "\n\n".join(f"--- Page {i + 1} ---\n{t}" for i, t in enumerate(texts))
    if not re.sub(r"--- Page \d+ ---|\[no text\]|\s", "", out):
        raise ValueError("No readable text was found in this PDF.")
    return out, len(scanned)


EMBED_VISITOR_OCR_MAX_PAGES = int(os.getenv("EMBED_VISITOR_OCR_MAX_PAGES", "20"))


async def file_caller(request: Request, app_id: Optional[str]) -> tuple[Optional[str], Optional[str], Optional[dict]]:
    """Who is reading a file or URL: (user_id, user_jwt, None) for a signed-in
    user, or (None, None, app_row) for a signed-out visitor of an embedded
    app with visitor access (per-visitor, per-app limit applied)."""
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if token or not app_id:
        return await require_verified_user(request), token or None, None
    app_row = await load_app_row(app_id)
    if not (app_row and app_row.get("is_published") and app_row.get("embed_public")
            and not app_row.get("is_paid") and app_row.get("visibility") != "private"):
        raise HTTPException(status_code=401, detail="Sign in to use this app")
    allowed, msg = await check_embed_visitor_rate_limit(client_ip(request), app_row["id"])
    if not allowed:
        raise HTTPException(status_code=429, detail=msg)
    return None, None, app_row


def pdf_reader_for(request: Request, user_id: Optional[str], user_jwt: Optional[str], visitor_app: Optional[dict],
                   app_row: Optional[dict] = None):
    """(get_ocr_key, max_pages) for extract_pdf_text. Visitors use the app
    owner's Claude key when saved, and a smaller scanned-page cap. A signed-in
    user of a developer's app (app_row) uses their own Claude key, else the
    developer's — never Aistrix's."""
    if user_id and app_row and not visitor_app:
        async def app_key():
            key = (await fetch_user_api_key(user_jwt, "claude") if user_jwt else None) or                   await fetch_user_api_key_by_id(app_row.get("created_by"), "claude")
            if not key and not PLATFORM_KEYS_FOR_DEVELOPER_APPS and await developer_tier(app_row.get("created_by")) != "staff":
                raise OcrError("This app can't read scanned pages right now: add your own Claude key in Settings → Keys, "
                               "or ask the app's developer to connect one.", 503)
            return key
        return app_key, None
    if visitor_app:
        async def owner_key():
            owner = visitor_app.get("created_by")
            key = await fetch_user_api_key_by_id(owner, "claude") if owner else None
            # A developer's app reads scanned pages on the developer's key only.
            if not key and not PLATFORM_KEYS_FOR_DEVELOPER_APPS and await developer_tier(owner) != "staff":
                raise OcrError("This app can't read scanned pages right now: its developer hasn't connected a Claude key.", 503)
            return key
        return owner_key, EMBED_VISITOR_OCR_MAX_PAGES
    return (lambda: ocr_key_for(request, user_jwt, user_id)), None


async def ocr_key_for(request: Request, user_jwt: Optional[str], caller_id: Optional[str]) -> Optional[str]:
    """API key for OCR: the caller's own Claude key when saved (not metered);
    otherwise the platform key, counted against the caller's run limits."""
    if user_jwt:
        key = await fetch_user_api_key(user_jwt, "claude")
    elif caller_id:
        key = await fetch_user_api_key_by_id(caller_id, "claude")
    else:
        key = None
    if key:
        return key
    allowed, msg = await check_rate_limit(request, user_jwt, caller_id)
    if not allowed:
        raise OcrError(msg, 429)
    if caller_id:
        await record_metered_run(caller_id, None, "ocr")
    return None


def _extract_xlsx(data: bytes) -> str:
    import csv
    import io
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        buf = io.StringIO()
        writer = csv.writer(buf)
        rows = 0
        for row in ws.iter_rows(values_only=True):
            if row is None or all(v is None for v in row):
                continue
            writer.writerow(["" if v is None else v for v in row])
            rows += 1
        if rows:
            out.append(f"# Sheet: {ws.title}\n{buf.getvalue()}" if len(wb.worksheets) > 1 else buf.getvalue())
    wb.close()
    return "\n\n".join(out)


def _extract_docx(data: bytes) -> str:
    import io
    import zipfile
    from xml.etree import ElementTree
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        info = z.getinfo("word/document.xml")
        if info.file_size > 50 * 1024 * 1024:
            raise ValueError("Document is too large to extract")
        root = ElementTree.fromstring(z.read(info))
    paras = []
    for p in root.iter(f"{ns}p"):
        text = "".join(t.text or "" for t in p.iter(f"{ns}t"))
        if text.strip():
            paras.append(text)
    return "\n".join(paras)


AUDIO_EXTS = ("mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "flac")
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(25 * 1024 * 1024)))     # OpenAI's limit per file
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")


class TranscribeRequest(BaseModel):
    file_name: str = Field(..., max_length=255)
    content_b64: str
    app_id: str


async def transcribe_key_for(user_id: Optional[str], user_jwt: Optional[str], app_row: dict) -> Optional[str]:
    """OpenAI key for transcription: the person's own, else the app developer's.
    Aistrix's key only for Aistrix's own apps (and the older test suites)."""
    own = (await fetch_user_api_key(user_jwt, "openai") if user_jwt
           else await fetch_user_api_key_by_id(user_id, "openai") if user_id else None)
    key = own or await fetch_user_api_key_by_id(app_row.get("created_by"), "openai")
    if key:
        return key
    if PLATFORM_KEYS_FOR_DEVELOPER_APPS or await developer_tier(app_row.get("created_by")) == "staff":
        return platform_key("openai")
    return None


@app.post("/v1/files/transcribe")
async def transcribe_audio(req: TranscribeRequest, request: Request):
    """Turn an audio file into text for a Voice app (then the app's prompt
    runs on the transcript). Uses an OpenAI key: the person's own, else the
    app developer's."""
    import base64
    user_id, user_jwt, visitor_app = await file_caller(request, req.app_id)
    app_row = visitor_app or await load_app_row(req.app_id)
    if not app_row:
        raise HTTPException(status_code=404, detail="App not found")
    # Transcription spends the developer's (or the person's) OpenAI credit:
    # only for people who can use this Voice app, within their run limits.
    if not visitor_app:
        caller = ApiCaller(user_id=user_id, user_jwt=user_jwt)
        editor = await can_edit_app(app_row, caller)
        if not editor:
            if not (app_row.get("is_published") or await can_view_app(app_row, caller)):
                raise HTTPException(status_code=404, detail="App not found")
            if app_row.get("app_type") != "voice":
                raise HTTPException(status_code=400, detail="Audio is transcribed for Voice apps only")
            if app_row.get("is_paid") and not await find_active_entitlement(app_row["id"], caller):
                raise HTTPException(status_code=402, detail="Purchase access to use this app")
            allowed, msg = await check_rate_limit(request, user_jwt, user_id)
            if not allowed:
                raise HTTPException(status_code=429, detail=msg)
    elif app_row.get("app_type") != "voice":
        raise HTTPException(status_code=400, detail="Audio is transcribed for Voice apps only")
    ext = req.file_name.lower().rsplit(".", 1)[-1] if "." in req.file_name else ""
    if ext not in AUDIO_EXTS:
        raise HTTPException(status_code=415, detail="Supported audio: " + ", ".join(f".{e}" for e in AUDIO_EXTS))
    try:
        data = base64.b64decode(req.content_b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="content_b64 is not valid base64")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail=f"Audio too large (max {MAX_AUDIO_BYTES // (1024 * 1024)} MB). Split longer recordings.")
    key = await transcribe_key_for(user_id, user_jwt, app_row)
    if not key:
        raise HTTPException(status_code=409, detail=(
            "Transcribing audio needs an OpenAI key. Add yours in Settings → Keys, or ask the app's developer to add one."))
    try:
        client = _openai_client("openai", key)
        result = await client.audio.transcriptions.create(model=TRANSCRIBE_MODEL, file=(req.file_name, data))
    except openai.AuthenticationError:
        raise HTTPException(status_code=502, detail="The OpenAI key was rejected while transcribing. Check it in Settings → Keys.")
    except openai.RateLimitError:
        raise HTTPException(status_code=429, detail="OpenAI turned the transcription away (rate limit or no credit). Try again later.")
    except openai.APIError as e:
        print(f"transcription failed: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=502, detail="The audio couldn't be transcribed. Check the file and try again.")
    text = (getattr(result, "text", None) or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="No speech was found in this recording.")
    return {"text": text[:MAX_EXTRACT_CHARS], "truncated": len(text) > MAX_EXTRACT_CHARS, "model": TRANSCRIBE_MODEL}


@app.post("/v1/files/extract")
async def extract_file_text(req: ExtractRequest, request: Request):
    """Turn an uploaded PDF / XLSX / DOCX into plain text (CSV for sheets).
    Scanned PDF pages are read with OCR."""
    user_id, user_jwt, visitor_app = await file_caller(request, req.app_id)
    import base64
    try:
        data = base64.b64decode(req.content_b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="content_b64 is not valid base64")
    if len(data) > MAX_EXTRACT_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_EXTRACT_BYTES // (1024 * 1024)} MB)")
    ext = req.file_name.lower().rsplit(".", 1)[-1] if "." in req.file_name else ""
    extractor = {"pdf": _extract_pdf, "xlsx": _extract_xlsx, "xlsm": _extract_xlsx, "docx": _extract_docx}.get(ext)
    if not extractor:
        raise HTTPException(status_code=415, detail="Supported types: .pdf, .xlsx, .docx")
    ocr_pages = 0
    try:
        if ext == "pdf":
            app_row = await load_app_row(req.app_id) if (user_id and req.app_id) else None
            get_key, max_pages = pdf_reader_for(request, user_id, user_jwt, visitor_app, app_row)
            text, ocr_pages = await extract_pdf_text(data, get_key, max_pages)
        else:
            text = await asyncio.to_thread(extractor, data)
    except OcrError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    except ImportError as e:
        raise HTTPException(status_code=503, detail=f"Server is missing a parser: {e.name}")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=422, detail="Could not read this file — it may be corrupted or in an older format")
    truncated = len(text) > MAX_EXTRACT_CHARS
    return {
        "text": text[:MAX_EXTRACT_CHARS],
        "kind": "csv" if ext in ("xlsx", "xlsm") else "text",
        "chars": len(text),
        "truncated": truncated,
        "ocr_pages": ocr_pages,
    }


@app.post("/v1/files/register")
async def register_app_file(req: AppFileRegisterRequest, request: Request):
    user_id = await require_verified_user(request)
    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip()
    sb = get_supabase_for_user(user_jwt)
    expires_at = None
    if req.retention_days:
        expires_at = (datetime.now(timezone.utc) + timedelta(days=req.retention_days)).isoformat()

    row = {
        "app_id": req.app_id,
        "run_id": req.run_id,
        "owner_id": user_id,
        "file_kind": req.file_kind,
        "bucket": req.bucket,
        "storage_path": req.storage_path,
        "file_name": req.file_name,
        "mime_type": req.mime_type,
        "size_bytes": req.size_bytes,
        "metadata": req.metadata,
        "expires_at": expires_at,
    }
    # insert() already returns the inserted row; supabase-py's insert builder
    # has no .single(), so the old chained call raised on every request.
    result = await db(sb.table("app_files").insert(row))
    if not result.data:
        raise HTTPException(status_code=500, detail="File was uploaded but could not be registered")
    return result.data[0]


@app.get("/v1/files/{file_id}/download-url")
async def get_file_download_url(file_id: str, request: Request, expires_in: int = 600):
    await require_verified_user(request)
    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip()
    sb_user = get_supabase_for_user(user_jwt)
    visible = await db(sb_user.table("app_files").select("bucket, storage_path").eq("id", file_id).maybe_single())
    if not visible or not visible.data:
        raise HTTPException(status_code=404, detail="File not found")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Storage signer is not configured")
    sb_service = _service_client()
    signed = await asyncio.to_thread(
        lambda: sb_service.storage.from_(visible.data["bucket"]).create_signed_url(
            visible.data["storage_path"],
            min(max(expires_in, 60), 3600),
        )
    )
    if isinstance(signed, dict):
        url = signed.get("signedURL") or signed.get("signed_url") or signed.get("signedUrl")
    else:
        url = getattr(signed, "signed_url", None) or getattr(signed, "signedURL", None)
    if not url:
        raise HTTPException(status_code=500, detail="Could not create signed URL")
    return {"url": url, "expires_in": min(max(expires_in, 60), 3600)}


# ─── Spending limits: usage and caps ─────────────────────────────────────────
class SpendCapRequest(BaseModel):
    limit_usd: Optional[float] = Field(default=None, ge=0, le=1_000_000)    # null removes the limit
    period: str = "month"


async def _spend_scope(scope: str, scope_id: str) -> dict:
    sb = _service_client()
    cap_res = await db(sb.table("spend_caps").select("period, limit_usd").eq("scope", scope).eq("scope_id", scope_id).limit(1))
    cap = (cap_res.data or [None])[0] if cap_res else None
    period = (cap or {}).get("period") or "month"
    used = await db(sb.rpc("spend_used", {"p_scope": scope, "p_scope_id": scope_id,
                                          "p_since": spend_period_start(period).isoformat()}))
    value = used.data[0] if isinstance(used.data, list) and used.data else used.data
    return {"period": period, "limit_usd": float(cap["limit_usd"]) if cap else None,
            "used_usd": round(float(value or 0), 4), "since": spend_period_start(period).isoformat()}


async def _spend_caller(request: Request) -> ApiCaller:
    caller = await resolve_api_caller(request, required=True)
    if caller.via_key:
        raise HTTPException(status_code=403, detail="Sign in to manage spending limits; API keys can't change them.")
    if not await spend_controls_ready():
        raise HTTPException(status_code=503, detail="Spending limits aren't set up on this server yet (database migration pending).")
    return caller


async def _save_spend_cap(scope: str, scope_id: str, body: SpendCapRequest, user_id: str) -> None:
    if body.period not in SPEND_PERIODS:
        raise HTTPException(status_code=422, detail='period must be "day" or "month"')
    table = _service_client().table("spend_caps")
    if body.limit_usd is None:
        await db(table.delete().eq("scope", scope).eq("scope_id", scope_id))
    else:
        await db(table.upsert({"scope": scope, "scope_id": scope_id, "period": body.period,
                               "limit_usd": round(body.limit_usd, 4), "updated_by": user_id,
                               "updated_at": datetime.now(timezone.utc).isoformat()}, on_conflict="scope,scope_id"))


@app.get("/v1/spend")
async def get_spend(request: Request):
    """AI spending on your own keys (all your apps' end users included), and
    your active workspace's when you manage its billing."""
    caller = await _spend_caller(request)
    out = {"key": await _spend_scope("key", caller.user_id), "workspace": None}
    if caller.workspace_id and await workspace_role(caller.workspace_id, caller.user_id) in BILLING_ROLES:
        out["workspace"] = {"id": caller.workspace_id, **await _spend_scope("workspace", caller.workspace_id)}
    return out


@app.put("/v1/spend/caps/key")
async def put_key_spend_cap(body: SpendCapRequest, request: Request):
    """Limit what runs may spend on your AI keys per day or month."""
    caller = await _spend_caller(request)
    await _save_spend_cap("key", caller.user_id, body, caller.user_id)
    return {"key": await _spend_scope("key", caller.user_id)}


@app.put("/v1/workspaces/{workspace_id}/spend-cap")
async def put_workspace_spend_cap(workspace_id: str, body: SpendCapRequest, request: Request):
    """Limit what runs in a workspace may spend, whoever's key pays."""
    caller = await _spend_caller(request)
    if not _UUID_RE.fullmatch(workspace_id or "") or await workspace_role(workspace_id, caller.user_id) not in BILLING_ROLES:
        raise HTTPException(status_code=404, detail="Workspace not found")
    await _save_spend_cap("workspace", workspace_id, body, caller.user_id)
    return {"workspace": {"id": workspace_id, **await _spend_scope("workspace", workspace_id)}}


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


def webhook_secret(app_id: str) -> str:
    """The app's webhook signing secret. Derived, not stored: same app, same
    secret, and nothing in a table end users can read."""
    master = os.getenv("WEBHOOK_SIGNING_KEY") or SUPABASE_SERVICE_ROLE_KEY or ""
    return "whsec_" + hmac.new(master.encode(), f"app-webhook:{app_id}".encode(), hashlib.sha256).hexdigest()[:40]


async def _post_webhook(webhook_url: str, app_id: str, payload: dict) -> int:
    """POSTs the payload signed with the app's secret: header
    X-Aistrix-Signature = "t=<unix time>,v1=<hex HMAC-SHA256 of '<t>.<body>'>"."""
    body = json.dumps(payload, ensure_ascii=False).encode()
    ts = str(int(time.time()))
    sig = hmac.new(webhook_secret(app_id).encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    # Redirects aren't followed: a signed delivery goes to the saved address only.
    res = await fetch_safely("POST", webhook_url, timeout=10, max_redirects=0, content=body, headers={
        "Content-Type": "application/json", "User-Agent": f"{BRAND_NAME}-Webhook/1.0",
        "X-Aistrix-Signature": f"t={ts},v1={sig}"})
    return res.status_code


def _webhook_payload(event: str, app_id: str, user_input: str, result: str, provider: str, model: str) -> dict:
    return {"event": event, "app_id": app_id, "input": user_input, "result": result,
            "provider": provider, "model": model, "timestamp": datetime.now(timezone.utc).isoformat()}


async def _fire_webhook(webhook_url: str, app_id: str, user_input: str, result: str, provider: str, model: str):
    try:
        await _post_webhook(webhook_url, app_id, _webhook_payload("run.completed", app_id, user_input, result, provider, model))
    except Exception as e:
        print(f"Webhook failed: {e}")


# ─── Ops failure-rate alerting ─────────────────────────────────────────────────
# Rolling window of recent /run outcomes, in-memory only (resets on restart —
# fine for "is something on fire right now", not meant as durable metrics).
_run_outcomes: deque = deque()
_last_ops_alert_at: float = 0.0


def _record_run_outcome(success: bool, error_kind: Optional[str] = None):
    """Call once per /run request with its final outcome. Fires an ops alert
    (fire-and-forget, cooldown-limited) if the recent failure rate crosses
    OPS_ALERT_FAILURE_THRESHOLD. No-ops entirely if OPS_ALERT_WEBHOOK_URL isn't set."""
    now = time.time()
    _run_outcomes.append((now, success, error_kind))
    cutoff = now - OPS_ALERT_WINDOW_SECONDS
    while _run_outcomes and _run_outcomes[0][0] < cutoff:
        _run_outcomes.popleft()

    if not OPS_ALERT_WEBHOOK_URL:
        return
    total = len(_run_outcomes)
    if total < OPS_ALERT_MIN_SAMPLES:
        return
    failures = [kind for _, ok, kind in _run_outcomes if not ok]
    rate = len(failures) / total
    if rate < OPS_ALERT_FAILURE_THRESHOLD:
        return

    global _last_ops_alert_at
    if now - _last_ops_alert_at < OPS_ALERT_COOLDOWN_SECONDS:
        return
    _last_ops_alert_at = now

    top_kinds = ", ".join(f"{kind} ×{count}" for kind, count in Counter(failures).most_common(3)) or "unknown"
    asyncio.create_task(_fire_ops_alert(len(failures), total, rate, top_kinds))


async def _fire_ops_alert(failures: int, total: int, rate: float, top_kinds: str):
    window_min = OPS_ALERT_WINDOW_SECONDS // 60
    text = (
        f":rotating_light: {BRAND_NAME}: {rate:.0%} of /run requests failed in the last {window_min} min "
        f"({failures}/{total}). Top error types: {top_kinds}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # {"text": ...} is a Slack incoming-webhook payload; any other
            # receiver can read the same field, so no receiver-specific branching.
            await client.post(OPS_ALERT_WEBHOOK_URL, json={"text": text}, headers={"Content-Type": "application/json", "User-Agent": f"{BRAND_NAME}-OpsAlert/1.0"})
    except Exception as e:
        print(f"Ops alert webhook failed: {e}")


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


async def run_text(system: str, user_input: str, provider: str, model: str, api_key: Optional[str] = None) -> str:
    fn = stream_fn_for(provider)            # Gemini apps used to be sent to Claude
    chunks = []
    async for tok in fn(system, user_input, model, api_key):
        chunks.append(tok)
    return "".join(chunks)


async def scheduled_step_key(app_row: dict, runner_id: Optional[str], provider: str) -> tuple[Optional[str], Optional[str]]:
    """(key, problem) for one scheduled flow step: the person who scheduled
    it pays with their own key, else the app's developer; Aistrix's key only
    for staff's own apps."""
    key = await fetch_user_api_key_by_id(runner_id, provider) if runner_id else None
    key = key or await fetch_user_api_key_by_id(app_row.get("created_by"), provider)
    if key or PLATFORM_KEYS_FOR_DEVELOPER_APPS or await developer_tier(app_row.get("created_by")) == "staff":
        return key, None
    label = PROVIDERS.get(provider, {}).get("label", "AI")
    return None, f"needs a {label} API key: add yours in Settings → Keys"


async def extract_facts_headless(text: str, api_key: Optional[str]) -> dict:
    """Facts for a workflow's memory, on the runner's own Claude key (none:
    the workflow just doesn't learn from this run)."""
    if not api_key:
        return {}
    try:
        full = await run_text(FACT_EXTRACT_PROMPT, text[:8000], "claude", get_default_model("claude"), api_key)
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


# ─── Workflow engine ─────────────────────────────────────────────────────────
# One engine for every way a workflow runs: on a schedule, from its webhook,
# and interactively (POST /v1/flows/{id}/runs). App steps go through
# execute_run, so a step runs exactly as the app does when opened: its
# release, tools, knowledge, output contract and key rules. Each run is kept
# in flow_runs; a run stops at an approval step and continues on resume.
FLOW_TRIGGERS = ("interactive", "schedule", "webhook")
FLOW_OUTPUT_LIMIT = 50000
FLOW_API_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD")
# Temporary failures a step may be retried for, when repeating it is harmless
# (no outside writes). Waits grow and are randomised so retries don't stampede.
FLOW_TRANSIENT_KINDS = ("provider_error", "rate_limit", "timeout", "spend_unavailable")
# Failures that happen before the provider does anything.
FLOW_NOT_DISPATCHED_KINDS = ("auth", "permission", "bad_request", "refusal")
FLOW_STEP_MAX_ATTEMPTS = 3
FLOW_RETRY_BASE_SECONDS = float(os.getenv("FLOW_RETRY_BASE_SECONDS", "2"))
FLOW_RETRY_MAX_SECONDS = float(os.getenv("FLOW_RETRY_MAX_SECONDS", "30"))


def flow_retry_delay(attempt: int) -> float:
    """Wait before attempt `attempt + 1`: exponential, capped, with jitter."""
    return min(FLOW_RETRY_MAX_SECONDS, FLOW_RETRY_BASE_SECONDS * 2 ** (attempt - 1)) * random.uniform(0.5, 1.0)


def flow_step_attempts(step: dict) -> int:
    try:
        return max(1, min(int(step.get("max_attempts") or FLOW_STEP_MAX_ATTEMPTS), 5))
    except (TypeError, ValueError):
        return FLOW_STEP_MAX_ATTEMPTS


def api_step_repeat_safe(step: dict) -> bool:
    return (step.get("api_method") or "GET").upper() in ("GET", "HEAD")


def _step_number(flow: dict, idx: int) -> int:
    """How the builder numbers a step: Dev Studio shows the trigger as step 1."""
    return idx + 2 if flow.get("kind") == "developer" else idx + 1


def _step_name(steps: list, idx: int) -> str:
    return (steps[idx] or {}).get("app_name") or f"Step {idx + 1}"


def _flow_context(flow: dict, memory: dict, steps: list, results: list) -> str:
    """What every app step sees besides its input: the workflow's standing
    instructions, what it has learned, and the earlier steps' outputs."""
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
        hist = "\n\n".join(f"### Step {i+1} — {_step_name(steps, i)} output:\n{r}" for i, r in enumerate(results))
        blocks.append(
            "This app is one step in a multi-app workflow. Here is everything produced by earlier steps, in "
            f"order — use it as context, and if your role is to compare/score/decide between them, do so "
            f"explicitly:\n\n{hist}"
        )
    return "\n\n".join(blocks)


async def _step_release(app_row: dict, step: dict, caller: "ApiCaller", trigger: str) -> tuple[Optional[tuple], Optional[str]]:
    """The app version a workflow step runs: (release, problem). release is
    (version number, snapshot), or None for the app's draft.

    "Published · vN" runs that fixed release. "Draft" runs the editable
    configuration, for authorized testing only: someone who can edit the
    app, running the workflow themselves — never on a schedule or webhook."""
    if step.get("version") == "draft":
        if trigger != "interactive" or caller.live:
            return None, ("uses the app's draft. Drafts only run when someone who can edit the app tests "
                          "the workflow; switch the step to a published release.")
        if not await can_edit_app(app_row, caller):
            return None, "uses a draft of an app you can't edit. Switch the step to a published release."
        return None, None
    live_num = app_row.get("live_version")
    prod = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) else None
    pinned = step.get("pinned_version")
    if pinned and pinned != live_num:
        sb = _service_client()
        res = await db(sb.table("app_versions").select("version_data")
                       .eq("app_id", app_row["id"]).eq("version_num", pinned).limit(1))
        data = (res.data or [{}])[0].get("version_data") if res else None
        if not isinstance(data, dict):
            return None, f"uses release v{pinned}, which no longer exists. Pick another release."
        return (int(pinned), data), None
    if prod:
        return (live_num, prod), None
    # Workflows saved before steps had a version ran the draft for its editors.
    if trigger == "interactive" and not caller.live and not step.get("version") and await can_edit_app(app_row, caller):
        return None, None
    return None, "uses an app that isn't published yet"


async def _step_snapshot(app_row: dict, step: dict) -> tuple[Optional[int], Optional[dict]]:
    """The release a step would run, for compiling: (version number, snapshot).
    Access rules are checked when the step runs (_step_release)."""
    if step.get("version") == "draft":
        return None, await app_draft_state(app_row)
    live_num = app_row.get("live_version")
    prod = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) else None
    pinned = step.get("pinned_version")
    if pinned and pinned != live_num:
        res = await db(_service_client().table("app_versions").select("version_data")
                       .eq("app_id", app_row["id"]).eq("version_num", pinned).limit(1))
        data = (res.data or [{}])[0].get("version_data") if res else None
        return (int(pinned), data) if isinstance(data, dict) else (None, None)
    return (live_num, prod) if prod else (None, None)


async def compile_flow_definition(flow: dict) -> tuple[dict, list[dict]]:
    """Check a workflow before it runs and fix what it will run: published
    steps are pinned to the release that is live now, so a release made
    mid-run can't change it. Returns (definition with "_plan", problems)."""
    steps = [dict(s) if isinstance(s, dict) else s for s in (flow.get("steps") or [])]
    contracts: dict[int, Optional[dict]] = {}
    for i, step in enumerate(steps):
        if not isinstance(step, dict) or flow_plan.step_type(step) != "app" or not step.get("app_id"):
            continue
        app_row = await load_app_row(step["app_id"])
        if not app_row:
            continue                     # reported when the step runs
        num, snapshot = await _step_snapshot(app_row, step)
        if snapshot is None:
            continue
        contracts[i] = release_contract(app_row, snapshot)
        if step.get("version") != "draft" and num and not step.get("pinned_version"):
            step["pinned_version"] = num
    definition = {**flow, "steps": steps}
    plan, problems = flow_plan.compile_flow(definition, contracts)
    if plan:
        definition["_plan"] = plan
    return definition, problems


def flow_problem_text(flow: dict, problems: list[dict]) -> str:
    """Compiler problems as one line, numbered the way the builder shows steps."""
    steps = flow.get("steps") or []
    return "; ".join(f"the workflow {p['text']}" if p["step"] is None
                     else f"step {_step_number(flow, p['step'])} ({_step_name(steps, p['step'])}): {p['text']}"
                     for p in problems[:10])


async def _run_api_step(step: dict, previous: str, sources: Optional[dict] = None) -> dict:
    """An API Call step, server side (same checks as /proxy). With
    api_body_map the JSON body is built from wired fields, like an app step's
    inputs; otherwise api_body is text with {{previous_output}} filled in."""
    def fill(t):
        return re.sub(r"\{\{previous_output\}\}", lambda _m: previous, t or "", flags=re.IGNORECASE)
    method = (step.get("api_method") or "GET").upper()
    url = fill(step.get("api_url")).strip()
    safe = api_step_repeat_safe(step)
    if method not in FLOW_API_METHODS:
        return {"status": "failed", "error": f"uses an unsupported method: {method}"}
    if not url.startswith(("http://", "https://")):
        return {"status": "failed", "error": "needs a URL starting with http:// or https://"}
    # Earlier output may fill the path or query, never choose the server.
    designed = flow_plan.api_url_origin(step.get("api_url"))
    if not designed or designed != flow_plan.api_url_origin(url):
        return {"status": "failed", "error": "has an address whose server would come from earlier output; fix the server part of the URL"}
    headers = {"User-Agent": f"{BRAND_NAME}-Workflow/1.0", "Accept": "application/json, text/plain, */*"}
    raw = step.get("api_headers")
    if raw:
        try:
            extra = json.loads(raw) if isinstance(raw, str) else raw
            headers.update({str(k): str(v) for k, v in (extra or {}).items()})
        except (ValueError, AttributeError):
            return {"status": "failed", "error": "has headers that aren't valid JSON"}
    if isinstance(step.get("api_body_map"), dict) and step["api_body_map"]:
        body = json.dumps(resolve_input_map(step["api_body_map"], sources or {}), ensure_ascii=False, default=str)
        headers = {k: v for k, v in headers.items() if k.lower() != "content-type"}
        headers["Content-Type"] = "application/json"
    else:
        body = fill(step.get("api_body")) or None
        if body and not any(k.lower() == "content-type" for k in headers):
            headers["Content-Type"] = "application/json"
    own = own_test_destination(url)
    if own:
        status, payload = await handle_test_destination(method, *own, body=(body or "").encode(),
                                                        content_type=headers.get("Content-Type"))
        if status >= 400:
            return {"status": "failed", "error": f"got HTTP {status} from the test destination: {payload.get('error')}",
                    "dispatched": True, "transient": status == 503, "repeat_safe": safe, "uncertain": False}
        return {"status": "ok", "output": json.dumps(payload, ensure_ascii=False, indent=2), "version": None}
    try:
        resp = await fetch_safely(method, url, timeout=20, content=body.encode() if body else None, headers=headers)
    except ValueError as e:
        return {"status": "failed", "error": f"URL rejected: {e}"}
    except Exception as e:
        # The request may have arrived even though no answer came back.
        return {"status": "failed", "error": f"request failed ({type(e).__name__})", "dispatched": True,
                "transient": True, "repeat_safe": safe, "uncertain": not safe}
    try:
        out = json.dumps(resp.json(), ensure_ascii=False, indent=2)
    except Exception:
        out = resp.text
    if resp.status_code >= 400:
        busy = resp.status_code == 429 or resp.status_code >= 500
        return {"status": "failed", "error": f"got HTTP {resp.status_code} from {httpx.URL(url).host}", "dispatched": True,
                "transient": busy, "repeat_safe": safe, "uncertain": resp.status_code >= 500 and not safe}
    return {"status": "ok", "output": out, "version": None}


def _flow_history_recorder(caller: "ApiCaller", flow: dict, app_id: str, app_name: str, input_text: str):
    async def record(output: str, usage: dict, provider: str, model: str):
        if not caller.user_id:
            return
        try:
            await db(_service_client().table("run_history").insert({
                "user_id": caller.user_id, "app_id": app_id, "app_name": app_name,
                "workspace_id": caller.workspace_id, "flow_id": flow.get("id"), "flow_name": flow.get("name"),
                "input": input_text[:20000], "output": output[:FLOW_OUTPUT_LIMIT],
                "input_tokens": (usage or {}).get("input_tokens"), "output_tokens": (usage or {}).get("output_tokens"),
            }))
        except Exception as e:
            print(f"workflow run history not saved: {type(e).__name__}: {str(e)[:200]}")
    return record


FLOW_TRANSFORMS = ("to_text", "to_number", "to_boolean", "json")


def _flow_data(text: str) -> dict:
    """A step's output (or the trigger's input) as fields other steps can
    wire from: a JSON object's own fields, plus "text" (the whole output)."""
    parsed, errs = _parse_json_output(_strip_json_fences(text or ""))
    data = dict(parsed) if not errs and isinstance(parsed, dict) else {}
    data.setdefault("text", text or "")
    return data


def _flow_path(value: Any, path: list[str]) -> Any:
    for part in path:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def _flow_transform(value: Any, name: Optional[str]) -> Any:
    """The fixed list of conversions a wire can apply (no code)."""
    if value is None or not name:
        return value
    if name == "to_text":
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if name == "to_number" and not isinstance(value, bool):
        try:
            num = float(str(value).replace(",", "").strip())
            return int(num) if num.is_integer() else num
        except ValueError:
            return value          # the input check reports it
    if name == "to_boolean" and isinstance(value, str):
        low = value.strip().lower()
        return True if low in ("true", "yes", "1") else False if low in ("false", "no", "0") else value
    if name == "json" and isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


def resolve_input_map(input_map: dict, sources: dict) -> dict:
    """A step's input fields from its wiring. Each target field takes
    {"from": "trigger.email" | "<step id>.<path>", "transform"?} or {"value": ...}."""
    fields: dict[str, Any] = {}
    for target, spec in (input_map or {}).items():
        if not isinstance(spec, dict):
            continue
        if "value" in spec:
            value = spec["value"]
        else:
            head, _, rest = str(spec.get("from") or "").partition(".")
            value = _flow_path(sources[head], [p for p in rest.split(".") if p]) if head in sources else None
        value = _flow_transform(value, spec.get("transform"))
        if value is not None and value != "":
            fields[target] = value
    return fields


FLOW_CONDITION_OPS = ("equals", "not_equals", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty")


def flow_condition_met(cond: Optional[dict], sources: dict) -> bool:
    """A step's "run only if" check: {"from": "s1.score", "op": "gte", "value": "7"}.
    Steps whose check fails are skipped; that is how a workflow branches."""
    if not isinstance(cond, dict) or not cond.get("from"):
        return True
    head, _, rest = str(cond["from"]).partition(".")
    value = _flow_path(sources[head], [p for p in rest.split(".") if p]) if head in sources else None
    op, target = cond.get("op") or "equals", cond.get("value")
    if op == "empty":
        return value in (None, "", [], {})
    if op == "not_empty":
        return value not in (None, "", [], {})
    if op in ("gt", "gte", "lt", "lte"):
        try:
            a, b = float(str(value).replace(",", "").strip()), float(str(target).replace(",", "").strip())
        except (TypeError, ValueError):
            return False
        return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
    text = value if isinstance(value, str) else ("" if value is None else json.dumps(value, ensure_ascii=False))
    want = str("" if target is None else target).strip().lower()
    if op == "contains":
        return want in text.lower()
    same = text.strip().lower() == want
    return not same if op == "not_equals" else same


async def _ai_fill_fields(input_fields: list, wired: dict, sources: dict, caller: "ApiCaller", app_view: dict) -> tuple[dict, Optional[str]]:
    """Fill a step's unconnected input fields from everything the run has so
    far, with a small call on the runner's own key. Returns (fields, problem)."""
    provider = app_view.get("ai_provider") or "claude"
    if provider not in PROVIDERS:
        provider = "claude"
    label = PROVIDERS.get(provider, {}).get("label", "AI")
    key = await fetch_user_api_key_by_id(caller.user_id, provider) if caller.user_id else None
    if not key and caller.user_jwt:
        key = await fetch_user_api_key(caller.user_jwt, provider)
    if not key:
        return {}, f"needs your {label} API key to fill its inputs with AI. Add it in Settings → Keys."
    names = [f.get("field") or f.get("name") for f in input_fields if f.get("field") or f.get("name")]
    system = (
        "You move data between apps in a workflow. From the data below, return ONLY a JSON object (no prose, "
        "no markdown) with these fields:\n" + _describe_fields(input_fields) + "\n"
        "Use only facts present in the data. Use null for anything the data doesn't contain. Never invent values."
    )
    data = json.dumps({"already_connected": wired, "available": sources}, ensure_ascii=False, default=str)[:12000]
    attempt_input = data
    for _ in range(2):
        try:
            raw = await run_text(system, attempt_input, provider, get_default_model(provider), key)
        except Exception as e:
            return {}, f"couldn't fill its inputs with AI ({type(e).__name__})"
        parsed, errs = _parse_json_output(_strip_json_fences(raw))
        if not errs and isinstance(parsed, dict):
            return {k: v for k, v in parsed.items() if k in names and v not in (None, "")}, None
        attempt_input = f"{data}\n\nYour previous answer wasn't a JSON object ({'; '.join(errs[:3])}). Return only the JSON object."
    return {}, "couldn't fill its inputs with AI (the answer wasn't valid JSON)"


async def run_flow_step(flow: dict, idx: int, *, caller: "ApiCaller", trigger: str, step_input: str,
                        results: list, memory: dict, sources: Optional[dict] = None) -> dict:
    """One step: {"status": ok | failed | waiting_approval, "output", "version", "error"}.

    A step with an input_map gets exactly its wired fields, checked against
    the input schema of the version it runs; other steps get the previous
    output as text (Business flows, older workflows)."""
    steps = flow.get("steps") or []
    step = steps[idx] or {}
    kind = step.get("step_type")
    private = flow.get("privacy") == "private_only"
    if kind == "human_approval":
        return {"status": "waiting_approval"}
    if kind == "api_call":
        if private:
            return {"status": "failed", "error": flow_plan.private_step_problems(step, None)[0]}
        return await _run_api_step(step, step_input, sources)
    app_row = await load_app_row(step.get("app_id")) if step.get("app_id") else None
    if not app_row:
        return {"status": "failed", "error": "uses an app that no longer exists"}
    release, problem = await _step_release(app_row, step, caller, trigger)
    if problem:
        return {"status": "failed", "error": problem}
    if private:
        # Checked again here: the app may have changed since the run started.
        snapshot = release[1] if release else await app_draft_state(app_row)
        reasons = flow_plan.private_step_problems(step, release_contract(app_row, snapshot))
        if reasons:
            return {"status": "failed", "error": f"can't run privately: {'; '.join(reasons)}. Nothing was sent."}
    version = "draft" if not release else (f"v{release[0]}" if release[0] else "live")
    view = {**app_row, **{k: release[1][k] for k in DRAFT_FIELDS if k in release[1]}} if release else app_row
    ai_filled: list = []
    if step.get("input_map") or step.get("ai_fill"):
        fields = resolve_input_map(step.get("input_map") or {}, sources or {})
        blueprint = (release[1].get("blueprint") or {}) if release else await fetch_app_blueprint(app_row["id"])
        input_fields = _schema_fields(blueprint, "input_schema")
        errors = _validate_schema_value(fields, input_fields) if input_fields else []
        if errors and step.get("ai_fill") and input_fields:
            filled, problem = await _ai_fill_fields(input_fields, fields, sources or {}, caller, view)
            if problem:
                return {"status": "failed", "version": version, "error": problem}
            ai_filled = [k for k in filled if k not in fields]
            merged = {**filled, **fields}          # what's wired wins over what AI suggests
            order = [f.get("field") or f.get("name") for f in input_fields]
            fields = {**{k: merged[k] for k in order if k in merged}, **{k: v for k, v in merged.items() if k not in order}}
            errors = _validate_schema_value(fields, input_fields)
        if errors:
            return {"status": "failed", "version": version,
                    "error": f"got input that doesn't fit the app: {'; '.join(errors[:5])}. Check the step's input mapping."}
        if fields or not step_input:
            step_input = _fields_to_input(fields)
    text = ((step_input or "").strip() or "(no input)")[:MAX_INPUT_LENGTH]
    # Developer workflows pass data only through their wiring; Business
    # flows also show every step the earlier outputs and learned facts.
    context = None if flow.get("kind") == "developer" else (_flow_context(flow, memory, steps, results) or None)
    req = _api_run_request(app_row["id"], view, text, user_context=context)
    contract = release_contract(app_row, release[1] if release else await app_draft_state(app_row))
    limit = contract["execution"]["timeout_seconds"]
    writes = contract["side_effects"] == "external_write"
    try:
        result = await asyncio.wait_for(_drain_run(await execute_run(
            req, _internal_request(), caller=caller, release=release, private_only=private,
            on_complete=_flow_history_recorder(caller, flow, app_row["id"], _step_name(steps, idx), text))), limit)
    except asyncio.TimeoutError:
        return {"status": "failed", "error": f"took longer than its {limit}-second limit", "version": version,
                "dispatched": True, "transient": True, "repeat_safe": not writes, "uncertain": writes}
    if not result.get("ok"):
        kind, streamed = result.get("kind"), bool(result.get("streamed"))
        return {"status": "failed", "error": f"failed: {result.get('error') or 'run failed'}", "version": version,
                "dispatched": streamed, "transient": kind in FLOW_TRANSIENT_KINDS, "repeat_safe": not writes,
                "uncertain": writes and streamed and kind not in FLOW_NOT_DISPATCHED_KINDS}
    return {"status": "ok", "output": result.get("output") or "", "version": version, "ai_filled": ai_filled}


async def _save_flow_run(run: dict, *, new: bool = False) -> None:
    """Durable checkpoint and ownership fence before another step may run."""
    try:
        sb = _service_client()
        row = {k: run.get(k) for k in ("id", "flow_id", "user_id", "trigger", "status", "seed_input",
                                       "current_step", "steps", "error", "finished_at")}
        if "needs_review" in run:          # column from the run-review migration
            row["needs_review"] = bool(run["needs_review"])
        if new:
            run["lease_token"] = str(uuid.uuid4())
            row.update(lease_token=run["lease_token"],
                       lease_expires_at=(datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat(),
                       definition=run.get("definition"))
            result = await db(sb.table("flow_runs").insert(row))
        else:
            result = await db(sb.table("flow_runs").update(row).eq("id", run["id"])
                              .eq("lease_token", run.get("lease_token"))
                              .gte("lease_expires_at", datetime.now(timezone.utc).isoformat())
                              .eq("status", "running"))
        if not result.data:
            raise HTTPException(status_code=409, detail="Workflow ownership changed or the run was stopped. Reload its history.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail="Workflow progress could not be saved. Execution stopped; check run history before retrying.") from e


async def _flow_run_cancelled(run_id: str) -> bool:
    try:
        res = await db(_service_client().table("flow_runs").select("status").eq("id", run_id).maybe_single())
        return bool(res and res.data and res.data.get("status") == "cancelled")
    except Exception as e:
        raise HTTPException(status_code=503, detail="Workflow status is unavailable. Execution stopped.") from e


async def _notify_flow_waiting(flow: dict, run: dict, step_name: str) -> None:
    """A webhook or scheduled run is waiting at an approval step: tell the
    workflow's owner in the app and by email (once per run). Never raises."""
    owner = flow.get("user_id")
    if not owner:
        return
    name = html_lib.escape(flow.get("name") or "A workflow")
    try:
        await db(_service_client().table("notifications").insert({
            "user_id": owner, "type": "workflow_approval", "title": f"{flow.get('name') or 'A workflow'} needs your approval",
            "message": f"A run is waiting at “{step_name}”. Open Dev Studio → Workflows → Runs to approve or reject it.",
            "link_view": "developer",
        }))
    except Exception as e:
        print(f"workflow approval notice not saved: {type(e).__name__}: {str(e)[:200]}")
    await notify_developer(owner, "flow_approval", run["id"], subject=f"{flow.get('name') or 'A workflow'} needs your approval",
                           title=f"{name} is waiting for approval",
                           body=f"A run reached the step “{html_lib.escape(step_name)}” and is waiting for you. "
                                "Open Dev Studio → Workflows → Runs to approve or reject it.")


async def _save_flow_memory(flow: dict, memory: dict, provenance: dict) -> None:
    try:
        await db(_service_client().table("flows").update({"memory": memory, "memory_provenance": provenance}).eq("id", flow["id"]))
    except Exception as e:
        print(f"workflow memory not saved: {type(e).__name__}: {str(e)[:200]}")


async def _post_flow_integration(flow: dict, steps: list, results: list) -> None:
    webhook_url = flow.get("integration_webhook_url")
    if not webhook_url:
        return
    text = f"*{flow.get('emoji','')} {flow['name']}* — run complete\n\n" + "\n\n".join(
        f"*{i+1}. {_step_name(steps, i)}*\n{(r or '')[:1500]}" for i, r in enumerate(results))
    try:
        # Same outbound checks as API Call steps: a workflow's integration
        # URL can't point the server at internal addresses.
        await fetch_safely("POST", webhook_url, timeout=10, headers={"Content-Type": "text/plain"}, content=json.dumps({
            "text": text, "workspace": flow["name"],
            "steps": [{"app_name": _step_name(steps, i), "result": results[i]} for i in range(len(results))],
        }).encode())
    except Exception as e:
        print(f"Workflow integration webhook failed: {type(e).__name__}: {str(e)[:200]}")


def _public_flow_run(run: dict) -> dict:
    plan = (run.get("definition") or {}).get("_plan") if isinstance(run.get("definition"), dict) else None
    return {**{k: v for k, v in run.items() if k not in ("lease_token", "lease_expires_at", "definition")},
            "plan_id": (plan or {}).get("id")}


async def _heartbeat_flow_run(run: dict) -> None:
    while True:
        await asyncio.sleep(20)
        result = await db(_service_client().rpc("heartbeat_flow_run", {"p_id": run["id"], "p_token": run["lease_token"]}))
        if result.data is not True:
            raise RuntimeError("Workflow lease lost")


async def run_flow(flow: dict, *, caller: "ApiCaller", trigger: str, seed_input: str = "", run: Optional[dict] = None) -> dict:
    if run is None:
        flow, problems = await compile_flow_definition(flow)
        run = {"id": str(uuid.uuid4()), "flow_id": flow["id"], "user_id": caller.user_id, "trigger": trigger,
               "status": "running", "seed_input": (seed_input or "")[:FLOW_OUTPUT_LIMIT],
               "current_step": 0, "steps": [], "error": None, "finished_at": None, "definition": flow}
        await _save_flow_run(run, new=True)
        if problems:
            # Recorded so a schedule's or webhook's owner sees why nothing ran.
            run.update(status="failed", error=f"Not run: {flow_problem_text(flow, problems)}",
                       finished_at=datetime.now(timezone.utc).isoformat())
            await _save_flow_run(run)
            return run
    # Approvals continue the definition that started the run, even if edited.
    flow = run.get("definition") or flow
    execution = asyncio.create_task(_execute_flow(flow, caller=caller, trigger=trigger, run=run))
    heartbeat = asyncio.create_task(_heartbeat_flow_run(run))
    try:
        done, _ = await asyncio.wait((execution, heartbeat), return_when=asyncio.FIRST_COMPLETED)
        if execution in done:
            return await execution
        # No further step may execute after losing the database/lease.
        await heartbeat
        raise RuntimeError("Workflow heartbeat stopped")
    except BaseException:
        execution.cancel()
        await asyncio.gather(execution, return_exceptions=True)
        # Leave the last durable checkpoint for the recovery sweep. Never
        # automatically replay a step whose external effect is uncertain.
        raise
    finally:
        heartbeat.cancel()
        await asyncio.gather(heartbeat, return_exceptions=True)


async def _execute_flow(flow: dict, *, caller: "ApiCaller", trigger: str, run: dict) -> dict:
    """Run a workflow from its first step, or continue `run` (paused at an
    approval step) from its current_step. Returns the run record."""
    steps = flow.get("steps") or []
    memory = dict(flow.get("memory") or {})
    provenance = dict(flow.get("memory_provenance") or {})
    run["status"] = "running"
    records = run["steps"]
    results = [r.get("output") or "" for r in records]
    # The text a step gets when it isn't wired: the last step that ran.
    current_input = next((r.get("output") or "" for r in reversed(records) if r.get("status") != "skipped"),
                         run.get("seed_input") or "")
    # What wired steps can read: the trigger's input and each finished step.
    sources = {"trigger": _flow_data(run.get("seed_input") or "")}
    for r in records:
        step_id = (steps[r["index"]] or {}).get("id") if r.get("index") is not None and r["index"] < len(steps) else None
        if step_id and r.get("status") != "skipped":
            sources[step_id] = _flow_data(r.get("output") or "")
    # Learning facts for the workflow's memory (Business flows) runs on the
    # runner's own key.
    learns = flow.get("kind") != "developer" and flow.get("privacy") != "private_only"
    fact_key = await fetch_user_api_key_by_id(caller.user_id, "claude") if (learns and caller.user_id) else None

    for idx in range(run["current_step"], len(steps)):
        name = _step_name(steps, idx)
        if await _flow_run_cancelled(run["id"]):
            run.update(status="cancelled")
            return run
        run["current_step"] = idx
        # A missing checkpoint/expired owner stops before external work.
        await _save_flow_run(run)
        cond = (steps[idx] or {}).get("run_if")
        if cond and not flow_condition_met(cond, sources):
            records.append({"index": idx, "name": name, "status": "skipped",
                            "error": None, "output": "", "reason": cond.get("label") or "Its condition wasn't met"})
            results.append("")
            await _save_flow_run(run)
            continue
        attempt = 0
        while True:
            attempt += 1
            try:
                out = await run_flow_step(flow, idx, caller=caller, trigger=trigger, step_input=current_input,
                                          results=results, memory=memory, sources=sources)
            except Exception as e:
                sentry_sdk.capture_exception(e)
                out = {"status": "failed", "error": f"failed unexpectedly ({type(e).__name__})"}
            if not (out["status"] == "failed" and out.get("transient") and out.get("repeat_safe")
                    and attempt < flow_step_attempts(steps[idx] or {})):
                break
            # Still the owner and not stopped, before trying again.
            if await _flow_run_cancelled(run["id"]):
                run.update(status="cancelled")
                return run
            await _save_flow_run(run)
            await asyncio.sleep(flow_retry_delay(attempt))
        if out["status"] == "waiting_approval":
            records.append({"index": idx, "name": name, "status": "waiting_approval",
                            "output": current_input[:FLOW_OUTPUT_LIMIT]})
            run["status"] = "waiting_approval"
            await _save_flow_run(run)
            if trigger != "interactive":
                await _notify_flow_waiting(flow, run, name)
            return run
        records.append({"index": idx, "name": name, "status": out["status"], "version": out.get("version"),
                        "output": (out.get("output") or "")[:FLOW_OUTPUT_LIMIT], "error": out.get("error"),
                        **({"ai_filled": out["ai_filled"]} if out.get("ai_filled") else {}),
                        **({"attempts": attempt} if attempt > 1 else {}),
                        **({"sent": bool(out.get("dispatched"))} if out["status"] == "failed" else {}),
                        **({"uncertain": True} if out.get("uncertain") else {})})
        if out["status"] != "ok":
            error = f"Step {_step_number(flow, idx)} ({name}) {out.get('error')}"
            if out.get("uncertain"):
                # Never repeated automatically: a person checks the destination.
                run["needs_review"] = True
                error += (". It may have reached an outside service before failing, so it wasn't repeated. "
                          "Check the destination, then continue the run or dismiss it.")
            elif attempt > 1:
                error += f" (tried {attempt} times)"
            run.update(status="failed", error=error, finished_at=datetime.now(timezone.utc).isoformat())
            await _save_flow_run(run)
            return run
        current_input = out.get("output") or ""
        results.append(current_input)
        if (steps[idx] or {}).get("id"):
            sources[steps[idx]["id"]] = _flow_data(current_input)
        facts = await extract_facts_headless(current_input, fact_key) if learns else {}
        if facts:
            memory = merge_memory(memory, facts)
            now_iso = datetime.now(timezone.utc).isoformat()
            for key in facts:
                provenance[key] = {"step_name": name, "step_index": idx, "updated_at": now_iso}
            await _save_flow_memory(flow, memory, provenance)
        await _save_flow_run(run)

    if await _flow_run_cancelled(run["id"]):
        run.update(status="cancelled")
        return run
    run.update(status="done", current_step=len(steps), finished_at=datetime.now(timezone.utc).isoformat())
    await _save_flow_run(run)
    if flow.get("privacy") != "private_only":
        await _post_flow_integration(flow, steps, results)
    return run


async def run_scheduled_workspace(sb_service: Client, schedule: dict):
    """A schedule (or the workflow's webhook) runs the workflow as the person
    who set it up. Raises when the run fails, so the scheduler counts it."""
    flow_res = await db(sb_service.table("flows").select("*").eq("id", schedule["flow_id"]).single())
    flow = flow_res.data
    if not flow or not (flow.get("steps") or []):
        return None
    owner = schedule.get("user_id")
    caller = ApiCaller(user_id=owner, workspace_id=flow.get("workspace_id") or await personal_workspace_id(owner), live=True)
    run = await run_flow(flow, caller=caller, trigger=schedule.get("trigger") or "schedule",
                         seed_input=schedule.get("seed_input") or "")
    if run["status"] == "failed":
        raise RuntimeError(run.get("error") or "Workflow run failed")
    return run


async def _claim_schedule(sb, schedule: dict, now: datetime) -> bool:
    """Move a due schedule to its next slot before running it. The update only
    matches the slot that was read, so when servers (or the cron endpoint and
    the built-in scheduler) overlap, exactly one of them runs it; and a run
    that fails waits for its next slot instead of retrying (and spending AI
    credits) every minute."""
    next_run = compute_next_run_at(now, schedule["frequency"], schedule["hour_utc"], schedule.get("day_of_week"))
    res = await db(sb.table("flow_schedules").update({
        "last_run_at": now.isoformat(), "next_run_at": next_run.isoformat(),
    }).eq("id", schedule["id"]).eq("next_run_at", schedule["next_run_at"]))
    return bool(res.data)


async def _execute_due_schedules() -> tuple[list, list]:
    """Shared by the schedule-trigger endpoints and the built-in scheduler."""
    sb_service = _service_client()
    now = datetime.now(timezone.utc)
    due = await db(sb_service.table("flow_schedules").select("*").eq("enabled", True).lte("next_run_at", now.isoformat()))

    ran, failed = [], []
    for schedule in due.data or []:
        if not await _claim_schedule(sb_service, schedule, now):
            continue                                   # another server took it
        try:
            await run_scheduled_workspace(sb_service, schedule)
            ran.append(schedule["id"])
        except Exception as e:
            sentry_sdk.capture_exception(e)
            print(f"Scheduled run failed for {schedule['id']}: {e}")
            failed.append(schedule["id"])

    return ran, failed


SCHEDULER_INTERVAL_SECONDS = float(os.getenv("SCHEDULER_INTERVAL_SECONDS", "60"))


async def _scheduler_tick() -> None:
    """One pass of the built-in scheduler: due scheduled flows, then
    Monitor alert emails. Every server runs it; claims keep work single."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        return
    for job in (_execute_due_schedules, _send_monitor_alert_emails):
        try:
            await job()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"scheduler: {job.__name__} failed: {type(e).__name__}: {str(e)[:200]}")
            sentry_sdk.capture_exception(e)


async def _scheduler_loop() -> None:
    """Scheduled flows run without an outside cron (the /cron endpoints still
    work too). SCHEDULER_INTERVAL_SECONDS=0 turns it off."""
    if SCHEDULER_INTERVAL_SECONDS <= 0:
        return
    while True:
        await asyncio.sleep(SCHEDULER_INTERVAL_SECONDS)
        await _scheduler_tick()


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
    return (result.data if result else None) or {}       # maybe_single() returns None when there's no row


# ─── Health + info endpoints ──────────────────────────────────────────────────
async def _refuse_if_subscribed(app_id: str, user_id: str) -> None:
    """A subscriber already has access; a single run would be wasted money."""
    sb = _service_client()
    if not sb:
        return
    res = await db(sb.table("app_entitlements").select("plan, status").eq("app_id", app_id)
                   .eq("user_id", user_id).limit(1))
    ent = (res.data or [None])[0] or {}
    if ent.get("plan") == "subscription" and ent.get("status") == "active":
        raise HTTPException(status_code=409, detail="You already subscribe to this app — no need to buy single runs")


class PaymentIntentRequest(BaseModel):
    app_id: str
    amount: Optional[int] = None   # ignored: the server charges the app's own price
    currency: str = "usd"


@app.post("/create-payment-intent")
async def create_payment_intent(req: PaymentIntentRequest, request: Request):
    """Card payment for one paid app. The amount always comes from the app's
    price on the server, never from the browser."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured on this server")
    user_id = await require_verified_user(request)
    stripe.api_key = secret_key
    app_row = await db(get_anon_client().table("apps").select("price_per_run, is_paid")
                       .eq("id", req.app_id).limit(1))
    app_data = (app_row.data or [None])[0]
    if not app_data:
        raise HTTPException(status_code=404, detail="App not found")
    if not app_data.get("is_paid") or not app_data.get("price_per_run"):
        raise HTTPException(status_code=400, detail="App is not a paid app")
    amount_cents = int(round(float(app_data["price_per_run"]) * 100))
    if amount_cents < 50:
        raise HTTPException(status_code=400, detail="This app's price is below the card minimum ($0.50)")
    await _refuse_if_subscribed(req.app_id, user_id)

    try:
        # stripe's SDK is synchronous/blocking — offload it so it doesn't stall
        # the event loop (and every concurrent streaming /run request) while it
        # waits on Stripe's API.
        intent = await asyncio.to_thread(
            stripe.PaymentIntent.create,
            amount=amount_cents,
            currency="usd",
            metadata={"app_id": req.app_id, "user_id": user_id, "plan": "pay_per_run"},
            automatic_payment_methods={"enabled": True},
        )
        return {"client_secret": intent.client_secret}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e.user_message))


class CheckoutSessionRequest(BaseModel):
    app_id: str
    plan: str = "pay_per_run"          # pay_per_run | subscription
    success_url: str
    cancel_url: str
    run_quota: Optional[int] = None    # for subscription plans


def _origin(url: str) -> Optional[str]:
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        return None
    default = 443 if parts.scheme == "https" else 80
    return f"{parts.scheme}://{parts.hostname.lower()}" + (f":{port}" if port and port != default else "")


def is_own_site_url(url: str) -> bool:
    """True only for addresses on this platform's own site (ALLOWED_ORIGINS or
    FRONTEND_URL), so payment returns can't send buyers to another website."""
    origin = _origin(url or "")
    return bool(origin) and origin in {_origin(o) for o in [*ALLOWED_ORIGINS, FRONTEND_URL]}


@app.post("/create-checkout-session")
async def create_checkout_session(req: CheckoutSessionRequest, request: Request):
    """Create a Stripe Checkout Session for one-time purchase or subscription."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured on this server")

    auth_header = request.headers.get("Authorization", "")
    user_jwt = auth_header.removeprefix("Bearer ").strip() or None
    user_id = await verify_user_jwt(user_jwt) if user_jwt else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    workspace_id = await resolve_user_workspace(user_id, request.headers.get("X-Workspace-Id"))
    if workspace_id and (await workspace_role(workspace_id, user_id)) not in BILLING_ROLES:
        raise HTTPException(status_code=403, detail="Only workspace owners, admins and billing members can buy apps")
    if not (is_own_site_url(req.success_url) and is_own_site_url(req.cancel_url)):
        raise HTTPException(status_code=400, detail=f"Checkout can only return to the {BRAND_NAME} site")

    stripe.api_key = secret_key

    # Fetch app to get price
    app_row = await asyncio.to_thread(
        lambda: get_anon_client().table("apps")
            .select("name, price_per_run, is_paid")
            .eq("id", req.app_id).single().execute()
    )
    if not app_row.data:
        raise HTTPException(status_code=404, detail="App not found")
    app_data = app_row.data

    if not app_data.get("is_paid") or not app_data.get("price_per_run"):
        raise HTTPException(status_code=400, detail="App is not a paid app")

    amount_cents = int(round(float(app_data["price_per_run"]) * 100))
    app_name = app_data.get("name", "AI App")
    if req.plan != "subscription":
        await _refuse_if_subscribed(req.app_id, user_id)

    try:
        if req.plan == "subscription":
            # Create a recurring price on the fly and a Subscription Checkout Session
            price = await asyncio.to_thread(
                stripe.Price.create,
                unit_amount=amount_cents,
                currency="usd",
                recurring={"interval": "month"},
                product_data={"name": f"{app_name} — Monthly"},
            )
            session = await asyncio.to_thread(
                stripe.checkout.Session.create,
                mode="subscription",
                line_items=[{"price": price.id, "quantity": 1}],
                subscription_data={"metadata": {"app_id": req.app_id, "user_id": user_id}},
                success_url=req.success_url,
                cancel_url=req.cancel_url,
                metadata={"app_id": req.app_id, "user_id": user_id, "workspace_id": workspace_id or "",
                          "plan": "subscription", "run_quota": str(req.run_quota or "")},
            )
        else:
            # One-time pay-per-run checkout
            session = await asyncio.to_thread(
                stripe.checkout.Session.create,
                mode="payment",
                line_items=[{
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": amount_cents,
                        "product_data": {"name": f"{app_name} — Run"},
                    },
                    "quantity": 1,
                }],
                success_url=req.success_url,
                cancel_url=req.cancel_url,
                metadata={"app_id": req.app_id, "user_id": user_id, "workspace_id": workspace_id or "",
                          "plan": "pay_per_run"},
            )
        return {"checkout_url": session.url, "session_id": session.id}
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e.user_message))


_EMAIL_IDEMPOTENCY_KEY = contextvars.ContextVar("email_idempotency_key", default=None)
_EMAIL_FROM_OVERRIDE = contextvars.ContextVar("email_from_override", default=None)


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send a transactional email via Resend. Returns True on success."""
    if not RESEND_API_KEY:
        print(f"EMAIL (no key): to={to} subject={subject}")
        return False
    try:
        headers = {"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"}
        if _EMAIL_IDEMPOTENCY_KEY.get():
            headers["Idempotency-Key"] = _EMAIL_IDEMPOTENCY_KEY.get()
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                "https://api.resend.com/emails",
                headers=headers,
                json={"from": _EMAIL_FROM_OVERRIDE.get() or EMAIL_FROM, "to": [to], "subject": subject, "html": html},
            )
            if r.status_code not in (200, 201):
                print(f"Resend delivery failed: HTTP {r.status_code}")
                return False
        return True
    except Exception as e:
        print(f"send_email exception: {type(e).__name__}")
        return False


def _email_base(title: str, body: str, cta_url: str = "", cta_label: str = "") -> str:
    cta = f'<a href="{cta_url}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#6C5CE7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">{cta_label}</a>' if cta_url else ""
    return f"""<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09101F;color:#E2E8F0;margin:0;padding:40px 20px">
<div style="max-width:520px;margin:0 auto;background:#0E1424;border:1px solid rgba(255,255,255,0.05);border-radius:16px;padding:36px">
  <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#fff">{title}</p>
  <div style="height:2px;width:32px;background:#6C5CE7;border-radius:2px;margin:12px 0 20px"></div>
  <div style="font-size:14px;line-height:1.7;color:#94A3B8">{body}</div>
  {cta}
  <p style="margin:32px 0 0;font-size:11px;color:#334155">{BRAND_NAME} · You're receiving this because you have an account on {BRAND_DOMAIN}</p>
</div></body></html>"""


async def _lookup_email(user_id: str) -> Optional[str]:
    """Look up a user's email from Supabase auth.users via the service-role client."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    try:
        sb = _service_client()
        result = await asyncio.to_thread(
            lambda: sb.auth.admin.get_user_by_id(user_id)
        )
        return result.user.email if result and result.user else None
    except Exception as e:
        print(f"_lookup_email error: {e}")
        return None


# ─── Developer notifications (email) ─────────────────────────────────────────
# Each notification is recorded once (developer_notifications: who, what kind,
# which event), so a retried webhook or two servers never send it twice, and
# a developer can turn alert emails off (developer_profiles.email_alerts).

async def notify_developer(user_id: Optional[str], kind: str, ref: str, subject: str, title: str, body: str,
                           cta_path: str = "/developer", cta_label: str = "Open Dev Studio →") -> bool:
    """Persist an event once; failed delivery remains queued for retry."""
    sb = _service_client()
    if not (sb and user_id):
        return False
    try:
        prof = await db(sb.table("developer_profiles").select("email_alerts").eq("user_id", user_id).limit(1))
        if ((prof.data or [None])[0] or {}).get("email_alerts") is False:
            return False
        try:
            result = await db(sb.table("developer_notifications").insert({
                "user_id": user_id, "kind": kind, "ref": ref[:200], "status": "pending",
                "payload": {"subject": subject, "html": _email_base(title=title, body=body,
                            cta_url=f"{FRONTEND_URL}{cta_path}", cta_label=cta_label), "from": EMAIL_FROM}}))
        except Exception as e:
            if "23505" in str(e) or "duplicate" in str(e).lower():
                return False  # already queued or sent; the worker owns retries
            raise
        rows = (await db(sb.rpc("claim_developer_notifications", {"p_id": result.data[0]["id"]}))).data or []
        return await _deliver_developer_notification(rows[0]) if rows else False
    except Exception as e:
        print(f"developer notification {kind} queued/delivery failed: {type(e).__name__}")
        return False


async def _notification_checkpoint(row: dict, patch: dict) -> None:
    result = await db(_service_client().table("developer_notifications").update(patch)
                      .eq("id", row["id"]).eq("status", "sending").eq("lease_token", row["lease_token"])
                      .gte("lease_expires_at", datetime.now(timezone.utc).isoformat()))
    if not result.data:
        raise RuntimeError("Notification ownership changed")


async def _deliver_developer_notification(row: dict) -> bool:
    try:
        profile = await db(_service_client().table("developer_profiles").select("email_alerts")
                           .eq("user_id", row["user_id"]).limit(1))
        if ((profile.data or [{}])[0]).get("email_alerts") is False:
            await _notification_checkpoint(row, {"status": "suppressed", "payload": None})
            return False
        # Resend retains idempotency keys for 24 hours. Stop before that
        # window ends rather than risk duplicating an ambiguously sent email.
        created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) - created > timedelta(hours=20) or row["attempts"] > 12:
            await _notification_checkpoint(row, {"status": "failed", "last_error": "Delivery window exhausted; review provider records."})
            return False
        payload = dict(row["payload"])
        if not payload.get("to"):
            email = await _lookup_email(row["user_id"])
            if not email:
                raise RuntimeError("Recipient unavailable")
            payload["to"] = email
            # Freeze recipient and content before sending, so retries use the
            # same request with the same provider idempotency key.
            await _notification_checkpoint(row, {"payload": payload})
        project = hashlib.sha256(SUPABASE_URL.rstrip('/').encode()).hexdigest()[:16]
        token = _EMAIL_IDEMPOTENCY_KEY.set(f"developer-notification/{project}/{row['id']}")
        from_token = _EMAIL_FROM_OVERRIDE.set(payload.get("from"))
        try:
            await _notification_checkpoint(row, {"lease_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat()})
            sent = await send_email(to=payload["to"], subject=payload["subject"], html=payload["html"])
        finally:
            _EMAIL_IDEMPOTENCY_KEY.reset(token)
            _EMAIL_FROM_OVERRIDE.reset(from_token)
        if not sent:
            raise RuntimeError("Provider did not acknowledge delivery")
        await _notification_checkpoint(row, {"status": "sent", "sent_at": datetime.now(timezone.utc).isoformat(), "payload": None,
                                             "last_error": None})
        return True
    except Exception as e:
        try:
            await _notification_checkpoint(row, {"status": "pending", "last_error": type(e).__name__,
                "next_attempt_at": (datetime.now(timezone.utc) + timedelta(seconds=min(3600, 30 * 2 ** min(row["attempts"], 7)))).isoformat()})
        except Exception:
            pass  # lease expiry makes an unacknowledged attempt claimable again
        return False


def _developer_job_error(error: Exception, operation: str) -> str:
    # Do not print raw PostgREST errors: they can include request payloads.
    code = str(getattr(error, "code", "") or "")
    code = code if re.fullmatch(r"[A-Z0-9]{1,12}", code) else type(error).__name__
    if code in ("PGRST202", "PGRST204", "42883", "42P01", "42703"):
        action = ("Apply supabase/migrations/20261023020000_durable_developer_jobs.sql "
                  "after its preceding migrations to this backend's Supabase project, "
                  "then reload the PostgREST schema cache (NOTIFY pgrst, 'reload schema').")
    elif code == "42501":
        action = "Verify the backend service-role key and the recovery migration's service_role grants."
    else:
        action = "Run scripts/check_operations_readiness.py for the selected environment and inspect database logs."
    return f"{operation} failed [{code}]: {action}"


async def _developer_job_rpc(sb, name: str):
    try:
        return await db(sb.rpc(name, {}))
    except Exception as e:
        raise RuntimeError(_developer_job_error(e, name)) from e


async def _developer_jobs_tick() -> None:
    sb = _service_client()
    if not sb:
        return
    await _developer_job_rpc(sb, "recover_interrupted_flow_runs")
    if await spend_controls_ready():
        try:
            await db(sb.rpc("expire_spend_reservations", {}))
        except Exception as e:
            print(f"spending hold expiry failed: {type(e).__name__}")
    rows = (await _developer_job_rpc(sb, "claim_developer_notifications")).data or []
    # Claimed leases are short: send concurrently, not a long serial queue.
    await asyncio.gather(*(_deliver_developer_notification(row) for row in rows))


async def _developer_jobs_supervisor() -> None:
    last_error = None
    while True:
        try:
            await _developer_jobs_tick()
            if last_error:
                print("developer job recovery is healthy again")
            last_error = None
        except Exception as e:
            message = str(e) if isinstance(e, RuntimeError) and e.__cause__ is not None else _developer_job_error(e, "developer job recovery")
            if message != last_error:
                print(f"developer job recovery unavailable: {message}")
            last_error = message
        await asyncio.sleep(15)


async def _app_label(app_id: str) -> tuple[str, Optional[str]]:
    """(escaped app name, owner id) for notification text."""
    row = await load_app_row(app_id) if app_id else None
    return html_escape((row or {}).get("name") or "your app"), (row or {}).get("created_by")


MONITOR_ALERT_EMAIL_SECONDS = float(os.getenv("MONITOR_ALERT_EMAIL_SECONDS", "900"))
EMAILED_ALERT_KINDS = ("errors_24h", "version")     # serious and actionable; the rest stay in Monitor
_monitor_alert_check = {"at": 0.0}


async def _send_monitor_alert_emails() -> int:
    """Every 15 minutes: email the owner of each app with recent production
    runs about a serious Monitor alert (most runs failing, or a new release
    failing more than the last one) — once per app, kind and day."""
    if time.monotonic() - _monitor_alert_check["at"] < MONITOR_ALERT_EMAIL_SECONDS:
        return 0
    _monitor_alert_check["at"] = time.monotonic()
    sb = _service_client()
    if not sb:
        return 0
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    app_ids: set = set()
    for start in range(0, 20000, 1000):
        page = (await db(sb.table("app_runs").select("app_id").gte("created_at", since)
                         .order("created_at", desc=True).range(start, start + 999))).data or []
        app_ids.update(r["app_id"] for r in page if r.get("app_id"))
        if len(page) < 1000:
            break
    sent = 0
    today = datetime.now(timezone.utc).date().isoformat()
    for app_id in sorted(app_ids):
        row = await load_app_row(app_id)
        if not row or not row.get("is_published"):
            continue
        if await analytics_level(row.get("created_by")) != "standard":
            continue                                      # alerts are part of Standard analytics
        runs, ratings, truncated = await _monitor_rows(app_id, 7, row.get("created_by"))
        summary = monitor_summary(runs, ratings, 7, published=True, truncated=truncated, live_version=row.get("live_version"))
        name = html_escape(row.get("name") or "your app")
        for alert in summary["alerts"]:
            if alert["kind"] not in EMAILED_ALERT_KINDS:
                continue
            if await notify_developer(row.get("created_by"), f"monitor_{alert['kind']}", f"{app_id}:{today}",
                                      subject=f"{row.get('name') or 'Your app'} needs attention",
                                      title=f"{name} needs attention",
                                      body=f"{html_escape(alert['message'])} See Monitor for the details, then Eval and Improve to fix it, or roll back in Version.",
                                      cta_label="Open Monitor →"):
                sent += 1
    return sent


def _stripe_dict(obj) -> dict:
    """Stripe SDK objects (v13+) have no .get(); work with plain dicts."""
    if isinstance(obj, dict):
        return obj
    return obj.to_dict() if hasattr(obj, "to_dict") else {}


def _net_share(purchase: dict) -> float:
    """The developer's share after any refund."""
    gross = float(purchase.get("gross_amount") or 0)
    share = float(purchase.get("dev_share") or 0)
    refunded = float(purchase.get("refunded_amount") or 0)
    return round(share * max(0.0, 1 - refunded / gross), 6) if gross else 0.0


PAYOUT_CLAIM_STALE_SECONDS = int(os.getenv("PAYOUT_CLAIM_STALE_SECONDS", "900"))


def _claim_is_stale(purchase: dict) -> bool:
    claimed = _parse_ts(purchase.get("payout_claimed_at"))
    return not claimed or (datetime.now(timezone.utc) - claimed).total_seconds() > PAYOUT_CLAIM_STALE_SECONDS


async def _claim_payout(sb, purchase: dict) -> Optional[dict]:
    """Take this purchase's payout for one attempt. The update only matches
    the status and attempt count read before, so of two concurrent callers
    (webhook, confirmation, "Send owed payouts", another server) exactly one
    gets the row back; the other sends nothing. The returned row is current,
    so a refund recorded meanwhile is reflected in the amount."""
    status = purchase.get("payout_status") or "pending"
    if status == "transferring" and not _claim_is_stale(purchase):
        return None                                   # another attempt is in progress
    attempts = int(purchase.get("payout_attempts") or 0)
    res = await db(sb.table("purchases").update({
        "payout_status": "transferring", "payout_attempts": attempts + 1,
        "payout_claimed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", purchase["id"]).eq("payout_status", status).eq("payout_attempts", attempts))
    return (res.data or [None])[0]


async def _pay_out(sb, purchase: dict, stripe_account_id: str) -> str:
    """Send the developer their share of one purchase, at most once.

    1. Claim the purchase (above); a caller that loses the claim stops.
    2. A transfer already made for this payment (its transfer group, e.g. the
       server stopped after Stripe paid) is recorded, not repeated.
    3. The transfer's idempotency key names the payment and this attempt, so
       a retried request within an attempt can't pay twice, and a later
       attempt after a failure isn't stuck replaying the old error.
    Returns transferred | transfer_failed | busy | refunded."""
    import stripe
    stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
    claimed = await _claim_payout(sb, purchase)
    if not claimed:
        return "busy"
    ref = claimed["stripe_payment_ref"]
    attempt = int(claimed.get("payout_attempts") or 1)
    group = f"aistrix-{ref}"
    amount = int(round(_net_share(claimed) * 100))
    transfer_id = None
    try:
        existing = _stripe_dict(await asyncio.to_thread(stripe.Transfer.list, transfer_group=group, limit=1))
        if existing.get("data"):
            transfer_id = existing["data"][0]["id"]
            status = "transferred"
        elif amount > 0:
            transfer = await asyncio.to_thread(
                stripe.Transfer.create, amount=amount, currency="usd", destination=stripe_account_id,
                transfer_group=group, metadata={"app_id": claimed.get("app_id"), "plan": claimed.get("plan"), "payment": ref},
                idempotency_key=f"aistrix-payout-{ref}-{attempt}")
            transfer_id = _stripe_dict(transfer).get("id")
            status = "transferred"
        else:
            status = "refunded"                       # nothing left to pay (fully refunded meanwhile)
    except Exception as te:
        print(f"Stripe transfer failed for {ref}: {type(te).__name__}")
        sentry_sdk.capture_exception(te)
        status = "transfer_failed"
    # Release the claim we hold (and only ours).
    await db(sb.table("purchases").update({"payout_status": status, "stripe_transfer_id": transfer_id})
             .eq("id", claimed["id"]).eq("payout_attempts", attempt))
    if status == "transfer_failed" and claimed.get("dev_id"):
        await notify_developer(claimed["dev_id"], "payout_failed", datetime.now(timezone.utc).date().isoformat(),
                               subject="A payout to you didn't go through",
                               title="A payout didn't go through",
                               body="Stripe couldn't send one or more of your payouts. The money is still owed to you: "
                                    "check your payout account in Manage → Revenue, then select <strong style='color:#fff'>Send owed payouts</strong>.",
                               cta_label="Open Revenue →")
    return status


async def _record_payment(
    app_id: str, buyer_id: str, plan: str, amount_cents: int, payment_ref: str,
    stripe_customer_id: Optional[str] = None, stripe_sub_id: Optional[str] = None,
    workspace_id: Optional[str] = None, grant_runs: int = 0,
) -> bool:
    """Record one real Stripe payment in purchases, grant the runs it bought
    (pay-per-run: one run per purchase), pay the developer their share, and
    email both sides. Keyed by the Stripe payment (payment intent or invoice
    id): Stripe delivers the same event more than once, several events
    describe one payment and the app confirms card payments too, so a repeat
    records, grants, pays and emails nothing. Returns True when this call
    recorded the payment."""
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Payment storage is unavailable")   # Stripe retries
    if not payment_ref or amount_cents <= 0:
        return False
    app_res = await db(sb.table("apps").select("name, created_by").eq("id", app_id).limit(1))
    app_row = (app_res.data or [None])[0] or {}
    dev_id = app_row.get("created_by")
    if not dev_id:
        print(f"payment {payment_ref}: app {app_id} has no developer, not recorded")
        return False
    dev_res = await db(sb.table("developer_profiles").select("stripe_account_id").eq("user_id", dev_id).limit(1))
    stripe_account_id = ((dev_res.data or [None])[0] or {}).get("stripe_account_id")

    gross = round(amount_cents / 100, 2)
    platform_fee = round(gross * STRIPE_PLATFORM_FEE_PCT / 100, 6)
    dev_share = round(gross - platform_fee, 6)
    row = {
        "app_id": app_id, "buyer_id": buyer_id, "dev_id": dev_id, "plan": plan,
        "gross_amount": gross, "platform_fee": platform_fee, "dev_share": dev_share,
        "stripe_customer_id": stripe_customer_id, "stripe_sub_id": stripe_sub_id,
        "stripe_payment_ref": payment_ref, "workspace_id": workspace_id,
        "payout_status": "pending" if stripe_account_id else "no_connect_account",
    }
    # One transaction: the purchase row and the runs it grants (database
    # function record_purchase); null when this payment was already recorded.
    res = await db(sb.rpc("record_purchase", {"p_purchase": row, "p_grant_runs": grant_runs}))
    purchase_id = res.data[0] if isinstance(res.data, list) and res.data else res.data
    if isinstance(purchase_id, dict):
        purchase_id = next(iter(purchase_id.values()), None)
    if not purchase_id:
        return False              # already recorded by an earlier delivery

    if stripe_account_id and dev_share > 0 and purchase_id:
        await _pay_out(sb, {**row, "id": purchase_id}, stripe_account_id)

    app_name = app_row.get("name") or "your app"
    safe_name = html_escape(app_name)
    plan_label = "subscription" if plan == "subscription" else "purchase"
    buyer_email = await _lookup_email(buyer_id)
    if buyer_email:
        await send_email(
            to=buyer_email,
            subject=f"You now have access to {app_name}",
            html=_email_base(
                title=f"Welcome to {safe_name} 🎉",
                body=f"Your {plan_label} is confirmed. You can run <strong style='color:#fff'>{safe_name}</strong> from your {BRAND_NAME} dashboard any time.",
                cta_url=FRONTEND_URL,
                cta_label=f"Open {BRAND_NAME} →",
            ),
        )
    if dev_id != buyer_id:
        dev_email = await _lookup_email(dev_id)
        if dev_email:
            await send_email(
                to=dev_email,
                subject=f"New {plan_label} for {app_name}",
                html=_email_base(
                    title=f"You have a new {plan_label}! 💰",
                    body=f"Someone just paid ${gross:.2f} for <strong style='color:#fff'>{safe_name}</strong>. See it under Manage → Revenue.",
                    cta_url=FRONTEND_URL,
                    cta_label="View in Dev Studio →",
                ),
            )
    return True


async def _upsert_entitlement(
    app_id: str, user_id: str, plan: str,
    stripe_customer_id: Optional[str] = None,
    stripe_sub_id: Optional[str] = None,
    status: str = "active",
    run_quota: Optional[int] = None,
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    workspace_id: Optional[str] = None,
):
    """Grant or update a buyer's access (service role; buyers can't write it).
    Money and emails are handled by _record_payment, once per payment."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Entitlement storage is unavailable")
    sb = _service_client()
    row = {
        "app_id": app_id,
        "user_id": user_id,
        "plan": plan,
        "status": status,
    }
    # Only reset run counter on genuine period renewal, not on status-only updates
    if period_start:
        row["runs_this_period"] = 0
    if stripe_customer_id: row["stripe_customer_id"] = stripe_customer_id
    if stripe_sub_id:      row["stripe_sub_id"]      = stripe_sub_id
    if run_quota is not None: row["run_quota"] = run_quota
    if period_start:       row["current_period_start"] = period_start
    if period_end:         row["current_period_end"]   = period_end
    if workspace_id:       row["workspace_id"]         = workspace_id   # else: buyer's personal workspace
    await db(sb.table("app_entitlements").upsert(row, on_conflict="app_id,user_id"))
    print(f"Entitlement upserted: app={app_id} plan={plan} status={status}")


def _invoice_subscription(invoice: dict) -> tuple[Optional[str], dict]:
    """(subscription id, subscription metadata) across Stripe API versions."""
    details = ((invoice.get("parent") or {}).get("subscription_details")
               or invoice.get("subscription_details") or {})
    sub = details.get("subscription") or invoice.get("subscription")
    if isinstance(sub, dict):
        sub = sub.get("id")
    return sub, details.get("metadata") or {}


async def _fulfil_card_payment(intent: dict) -> bool:
    """A succeeded in-app card payment (PaymentIntent) buys one run."""
    meta = intent.get("metadata") or {}
    return await _record_payment(
        app_id=meta["app_id"], buyer_id=meta["user_id"], plan="pay_per_run",
        amount_cents=int(intent.get("amount_received") or intent.get("amount") or 0),
        payment_ref=intent.get("id"), stripe_customer_id=intent.get("customer"), grant_runs=1,
    )


class PaymentConfirmRequest(BaseModel):
    payment_intent_id: str


@app.post("/payments/confirm")
async def confirm_card_payment(body: PaymentConfirmRequest, request: Request):
    """Called by the app right after a card payment succeeds, so the run can
    start without waiting for Stripe's webhook. Checks the payment with Stripe;
    the webhook and this call share one record, so it's granted once."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured on this server")
    user_id = await require_verified_user(request)
    stripe.api_key = secret_key
    try:
        intent = _stripe_dict(await asyncio.to_thread(stripe.PaymentIntent.retrieve, body.payment_intent_id))
    except stripe.error.StripeError:
        raise HTTPException(status_code=404, detail="Payment not found")
    meta = intent.get("metadata") or {}
    if meta.get("user_id") != user_id or not meta.get("app_id"):
        raise HTTPException(status_code=404, detail="Payment not found")
    if intent.get("status") != "succeeded":
        raise HTTPException(status_code=409, detail="This payment hasn't completed")
    await _fulfil_card_payment(intent)
    return {"ok": True, "app_id": meta["app_id"]}


async def _record_refund(charge: dict) -> None:
    """A refund (full or partial) reduces the sale and the developer's share,
    takes back that part of a payout already sent, and — for a fully refunded
    pay-per-run purchase — the run it bought, if unused."""
    import stripe
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Payment storage is unavailable")   # Stripe retries
    refs = [r for r in (charge.get("payment_intent"), charge.get("invoice")) if r]
    if not refs:
        return
    res = await db(sb.table("purchases").select("id, app_id, buyer_id, dev_id, plan, gross_amount, dev_share, refunded_amount, "
                                                 "stripe_payment_ref, stripe_transfer_id, payout_status, payout_attempts, payout_claimed_at")
                   .in_("stripe_payment_ref", refs).limit(1))
    purchase = (res.data or [None])[0]
    if not purchase:
        return                                    # not an Aistrix purchase
    if purchase.get("payout_status") == "transferring" and not _claim_is_stale(purchase):
        # A payout is being sent right now: Stripe retries this event, and by
        # then the transfer is recorded and its refunded part is taken back.
        raise HTTPException(status_code=503, detail="A payout for this purchase is in progress; retry")
    gross = float(purchase.get("gross_amount") or 0)
    refunded = min(gross, round(int(charge.get("amount_refunded") or 0) / 100, 2))
    previous = float(purchase.get("refunded_amount") or 0)
    if refunded <= previous:
        return                                    # already recorded (Stripe redelivery)
    full = refunded >= gross - 0.005
    patch = {"refunded_amount": refunded, "refunded_at": datetime.now(timezone.utc).isoformat()}
    if full:
        patch["payout_status"] = "refunded"
    # Take back the developer's share of the refunded part of a payout already sent.
    if purchase.get("stripe_transfer_id") and gross:
        back = int(round(float(purchase.get("dev_share") or 0) * (refunded - previous) / gross * 100))
        if back > 0:
            stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
            try:
                await asyncio.to_thread(stripe.Transfer.create_reversal, purchase["stripe_transfer_id"], amount=back,
                                        idempotency_key=f"aistrix-reversal-{purchase['stripe_payment_ref']}-{int(round(refunded * 100))}")
            except Exception as e:
                print(f"Transfer reversal failed for {purchase['stripe_payment_ref']}: {type(e).__name__}")
                sentry_sdk.capture_exception(e)
                patch["payout_status"] = "reversal_failed"
    # Only if nothing changed since the read (e.g. a payout claimed it):
    # otherwise Stripe retries the event against the current row.
    saved = await db(sb.table("purchases").update(patch).eq("id", purchase["id"])
                     .eq("payout_status", purchase.get("payout_status") or "pending")
                     .eq("payout_attempts", int(purchase.get("payout_attempts") or 0)))
    if not saved.data:
        raise HTTPException(status_code=503, detail="The purchase changed while recording the refund; retry")
    if full and purchase.get("plan") == "pay_per_run" and purchase.get("buyer_id"):
        await db(sb.rpc("revoke_purchased_run", {"p_app_id": purchase["app_id"], "p_user_id": purchase["buyer_id"]}))
    name, owner = await _app_label(purchase.get("app_id"))
    await notify_developer(purchase.get("dev_id") or owner, "refund", f"{purchase['stripe_payment_ref']}:{int(round(refunded * 100))}",
                           subject="A buyer was refunded",
                           title="A purchase was refunded",
                           body=f"A buyer of <strong style='color:#fff'>{name}</strong> was refunded ${refunded - previous:.2f}"
                                f"{' (the full amount)' if full else ''}. Your earnings and any payout already sent are adjusted; see Manage → Revenue.",
                           cta_label="Open Revenue →")


def _unsigned_webhooks_allowed() -> bool:
    return os.getenv("ENVIRONMENT", "production").lower() in ("development", "dev", "local", "test")


@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe payment and subscription webhooks. Access is granted on
    payment; each payment is recorded (and the developer paid) exactly once."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    if not webhook_secret and not _unsigned_webhooks_allowed():
        # Without the signing secret anyone could post a fake "payment".
        raise HTTPException(status_code=503, detail="Stripe webhooks are not configured (STRIPE_WEBHOOK_SECRET)")

    stripe.api_key = secret_key
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        if webhook_secret:
            stripe.WebhookSignature.verify_header(payload.decode("utf-8"), sig_header, webhook_secret,
                                                  stripe.Webhook.DEFAULT_TOLERANCE)
        event = json.loads(payload)      # verified above; a plain dict (SDK objects have no .get)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload or signature")

    event_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    meta = obj.get("metadata") or {}

    # ── Checkout (one-time payment or the start of a subscription) ─────────
    if event_type == "checkout.session.completed":
        app_id  = meta.get("app_id")
        user_id = meta.get("user_id")
        plan    = meta.get("plan", "pay_per_run")
        run_quota_str = meta.get("run_quota", "")
        run_quota = int(run_quota_str) if run_quota_str and run_quota_str.isdigit() else None
        workspace_id = meta.get("workspace_id") or None
        paid = obj.get("payment_status") in ("paid", "no_payment_required")

        if app_id and user_id and paid:
            if obj.get("mode") == "payment":
                # One-time purchase: recorded with the one run it buys.
                await _record_payment(
                    app_id=app_id, buyer_id=user_id, plan="pay_per_run",
                    amount_cents=int(obj.get("amount_total") or 0),
                    payment_ref=obj.get("payment_intent") or obj.get("id"),
                    stripe_customer_id=obj.get("customer"), workspace_id=workspace_id, grant_runs=1,
                )
            else:
                # Subscription: access now; money is recorded per invoice
                # (invoice.paid), so renewals count too.
                await _upsert_entitlement(
                    app_id=app_id, user_id=user_id, plan=plan,
                    stripe_customer_id=obj.get("customer"), stripe_sub_id=obj.get("subscription"),
                    run_quota=run_quota, workspace_id=workspace_id,
                )

    # ── PaymentIntent (card form in the app; Checkout's intents carry no metadata) ─
    elif event_type == "payment_intent.succeeded":
        app_id  = meta.get("app_id")
        user_id = meta.get("user_id")
        if app_id and user_id and user_id != "anonymous":
            await _fulfil_card_payment(obj)

    # ── Subscription invoice paid (first month and every renewal) ──────────
    elif event_type == "invoice.paid":
        sub_id, sub_meta = _invoice_subscription(obj)
        app_id, user_id = sub_meta.get("app_id"), sub_meta.get("user_id")
        if sub_id and not (app_id and user_id) and SUPABASE_SERVICE_ROLE_KEY:
            row = await db(_service_client().table("app_entitlements").select("app_id, user_id")
                           .eq("stripe_sub_id", sub_id).limit(1))
            if row.data:
                app_id, user_id = row.data[0]["app_id"], row.data[0]["user_id"]
        if sub_id and int(obj.get("amount_paid") or 0) > 0:
            if not (app_id and user_id):
                # Checkout hasn't been processed yet: ask Stripe to retry later.
                raise HTTPException(status_code=503, detail="Subscription not linked yet")
            await _record_payment(
                app_id=app_id, buyer_id=user_id, plan="subscription",
                amount_cents=int(obj["amount_paid"]), payment_ref=obj.get("id"),
                stripe_customer_id=obj.get("customer"), stripe_sub_id=sub_id,
            )

    # ── Subscription lifecycle ──────────────────────────────────────────────
    elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
        sub = obj
        app_id  = meta.get("app_id")
        user_id = meta.get("user_id")
        if not (app_id and user_id):
            # Try to look up via customer in app_entitlements
            customer_id = sub.get("customer")
            if customer_id and SUPABASE_SERVICE_ROLE_KEY:
                row = await db(_service_client().table("app_entitlements").select("app_id, user_id")
                               .eq("stripe_customer_id", customer_id).limit(1))
                if row.data:
                    app_id  = row.data[0]["app_id"]
                    user_id = row.data[0]["user_id"]

        if app_id and user_id:
            status = sub.get("status") or "active"
            # Newer API versions keep the billing period on the subscription item.
            item = ((sub.get("items") or {}).get("data") or [{}])[0]
            period = sub.get("current_period_end") or item.get("current_period_end")
            period_start = sub.get("current_period_start") or item.get("current_period_start")
            await _upsert_entitlement(
                app_id=app_id, user_id=user_id, plan="subscription",
                stripe_customer_id=sub.get("customer"),
                stripe_sub_id=sub.get("id"),
                status=status,
                period_start=datetime.fromtimestamp(period_start, tz=timezone.utc).isoformat() if period_start else None,
                period_end=datetime.fromtimestamp(period, tz=timezone.utc).isoformat() if period else None,
            )

    elif event_type == "charge.refunded":
        await _record_refund(obj)

    elif event_type == "charge.dispute.created":
        refs = [r for r in (obj.get("payment_intent"), obj.get("charge")) if r]
        sb = _service_client()
        if refs and sb:
            flagged = await db(sb.table("purchases").update({"disputed": True}).in_("stripe_payment_ref", refs))
            for purchase in flagged.data or []:
                name, owner = await _app_label(purchase.get("app_id"))
                await notify_developer(purchase.get("dev_id") or owner, "dispute", obj.get("id") or purchase["id"],
                                       subject="A buyer opened a chargeback",
                                       title="A chargeback was opened",
                                       body=f"A buyer's bank opened a chargeback on a purchase of <strong style='color:#fff'>{name}</strong>. "
                                            "Stripe will ask for evidence; the purchase is flagged in Manage → Revenue.",
                                       cta_label="Open Revenue →")

    elif event_type == "customer.subscription.deleted":
        sub_id = obj.get("id")
        if sub_id and SUPABASE_SERVICE_ROLE_KEY:
            sb = _service_client()
            rows = await asyncio.to_thread(
                lambda: sb.table("app_entitlements")
                    .select("app_id, user_id")
                    .eq("stripe_sub_id", sub_id)
                    .limit(1).execute()
            )
            await asyncio.to_thread(
                lambda: sb.table("app_entitlements")
                    .update({"status": "cancelled"})
                    .eq("stripe_sub_id", sub_id)
                    .execute()
            )
            print(f"Subscription cancelled: sub={sub_id}")
            # Notify buyer their subscription ended
            if rows.data:
                buyer_id = rows.data[0]["user_id"]
                cancelled_app_id = rows.data[0]["app_id"]
                buyer_email = await _lookup_email(buyer_id)
                try:
                    app_row = await asyncio.to_thread(
                        lambda: sb.table("apps").select("name").eq("id", cancelled_app_id).single().execute()
                    )
                    app_name = app_row.data["name"] if app_row.data else "your app"
                except Exception:
                    app_name = "your app"
                if buyer_email:
                    await send_email(
                        to=buyer_email,
                        subject=f"Your subscription to {app_name} has ended",
                        html=_email_base(
                            title=f"Subscription cancelled",
                            body=f"Your subscription to <strong style='color:#fff'>{app_name}</strong> has been cancelled. You can re-subscribe any time from the app page.",
                            cta_url=FRONTEND_URL,
                            cta_label=f"Open {BRAND_NAME} →",
                        ),
                    )

    return {"received": True}


class QuotaWarningRequest(BaseModel):
    app_id: str
    app_name: str
    runs_used: int
    run_quota: int


@app.post("/notify/quota-warning")
async def notify_quota_warning(body: QuotaWarningRequest, request: Request):
    """Send a quota-warning email to the authenticated user (buyer)."""
    user_id = await require_verified_user(request)
    user_email = await _lookup_email(user_id)
    if user_email:
        pct = round((body.runs_used / body.run_quota) * 100)
        remaining = body.run_quota - body.runs_used
        await send_email(
            to=user_email,
            subject=f"You've used {pct}% of your runs for {body.app_name}",
            html=_email_base(
                title=f"Running low on {body.app_name}",
                body=f"You've used <strong style='color:#fff'>{body.runs_used} of {body.run_quota} runs</strong> ({pct}%). "
                     f"You have <strong style='color:#fff'>{remaining} run{'s' if remaining != 1 else ''}</strong> left in your current period. "
                     f"Top up any time from the app page.",
                cta_url=FRONTEND_URL,
                cta_label="Top up →",
            ),
        )
    return {"sent": bool(user_email)}


# ─── Stripe Connect ───────────────────────────────────────────────────────────

@app.post("/stripe/connect/onboard")
async def stripe_connect_onboard(request: Request):
    """Create a Stripe Connect onboarding link for the authenticated developer."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    dev_id = await require_verified_user(request)
    stripe.api_key = secret_key

    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Service role key not configured")
    sb = _service_client()

    # Check if dev already has a Connect account
    dev_row = await asyncio.to_thread(
        lambda: sb.table("developer_profiles")
            .select("stripe_account_id")
            .eq("user_id", dev_id).maybe_single().execute()
    )
    # No profile row yet (maybe_single() returns None then) = no account yet.
    stripe_account_id = (dev_row.data or {}).get("stripe_account_id") if dev_row else None

    try:
        if not stripe_account_id:
            # One Express account per developer: a double click or a retry
            # gets the same account back instead of a second one.
            account = await asyncio.to_thread(
                stripe.Account.create,
                type="express",
                metadata={"aistrix_user_id": dev_id},
                idempotency_key=f"aistrix-connect-{dev_id}",
            )
            stripe_account_id = account.id
            await asyncio.to_thread(
                lambda: sb.table("developer_profiles")
                    .upsert({"user_id": dev_id, "stripe_account_id": stripe_account_id}, on_conflict="user_id")
                    .execute()
            )

        # Generate onboarding link
        link = await asyncio.to_thread(
            stripe.AccountLink.create,
            account=stripe_account_id,
            refresh_url=f"{FRONTEND_URL}/developer?stripe_connect=refresh",
            return_url=f"{FRONTEND_URL}/developer?stripe_connect=success",
            type="account_onboarding",
        )
    except stripe.error.StripeError as e:
        print(f"Stripe Connect onboarding failed: {type(e).__name__}: {str(e)[:300]}")
        sentry_sdk.capture_exception(e)
        reason = getattr(e, "user_message", None) or str(e)
        raise HTTPException(status_code=502, detail=f"Stripe couldn't start payout setup: {reason[:300]}")
    return {"url": link.url, "stripe_account_id": stripe_account_id}


@app.get("/stripe/connect/status")
async def stripe_connect_status(request: Request):
    """Return the developer's Connect account status."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")

    dev_id = await require_verified_user(request)

    if not SUPABASE_SERVICE_ROLE_KEY:
        return {"connected": False}
    sb = _service_client()

    dev_row = await asyncio.to_thread(
        lambda: sb.table("developer_profiles")
            .select("stripe_account_id")
            .eq("user_id", dev_id).maybe_single().execute()
    )
    dev_data = dev_row.data if dev_row and dev_row.data else (dev_row if isinstance(dev_row, dict) else None)
    stripe_account_id = dev_data.get("stripe_account_id") if dev_data else None
    if not stripe_account_id or not secret_key:
        return {"connected": False, "stripe_account_id": None}

    try:
        stripe.api_key = secret_key
        account = (await asyncio.to_thread(stripe.Account.retrieve, stripe_account_id)).to_dict()
        charges_enabled  = account.get("charges_enabled", False)
        payouts_enabled  = account.get("payouts_enabled", False)
        details_submitted = account.get("details_submitted", False)
        return {
            "connected": charges_enabled,
            "stripe_account_id": stripe_account_id,
            "charges_enabled": charges_enabled,
            "payouts_enabled": payouts_enabled,
            "details_submitted": details_submitted,
        }
    except Exception as e:
        return {"connected": False, "stripe_account_id": stripe_account_id, "error": str(e)}


PURCHASE_FIELDS = ("id, app_id, plan, gross_amount, platform_fee, dev_share, refunded_amount, refunded_at, "
                   "disputed, payout_status, created_at, stripe_payment_ref")
# Owed to the developer: waiting for a transfer (or one in progress), for the
# payout account, or for a failed transfer to be sent again.
OWED_STATUSES = ("pending", "no_connect_account", "transfer_failed", "transferring")
PURCHASE_PAGE = 1000                     # the most rows the database API returns at once
PURCHASE_ROW_LIMIT = int(os.getenv("PURCHASE_ROW_LIMIT", "200000"))


async def _dev_purchases(dev_id: str, days: Optional[int]) -> tuple[list[dict], bool]:
    """Every purchase of the developer's apps in the period, newest first, read
    page by page. (rows, truncated): truncated only past PURCHASE_ROW_LIMIT."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Service role key not configured")
    if days is not None and days not in (7, 30, 90, 365):
        raise HTTPException(status_code=400, detail="days must be 7, 30, 90 or 365 (or omitted for all time)")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat() if days else None
    rows: list[dict] = []
    while len(rows) < PURCHASE_ROW_LIMIT:
        q = _service_client().table("purchases").select(PURCHASE_FIELDS).eq("dev_id", dev_id)
        if since:
            q = q.gte("created_at", since)
        # id breaks created_at ties so pages never overlap or skip a row.
        page = (await db(q.order("created_at", desc=True).order("id", desc=True)
                         .range(len(rows), len(rows) + PURCHASE_PAGE - 1))).data or []
        rows.extend(page)
        if len(page) < PURCHASE_PAGE:
            return rows, False
    return rows[:PURCHASE_ROW_LIMIT], True


@app.get("/stripe/earnings")
async def stripe_earnings(request: Request, days: Optional[int] = None):
    """The developer's earnings from recorded purchases, net of refunds.
    days: 7, 30, 90 or 365 (omit for all time)."""
    dev_id = await require_verified_user(request)
    rows, truncated = await _dev_purchases(dev_id, days)

    def net_gross(r): return max(0.0, float(r.get("gross_amount") or 0) - float(r.get("refunded_amount") or 0))
    owed = [r for r in rows if r.get("payout_status") in OWED_STATUSES]
    by_app: dict = {}
    for r in rows:
        a = by_app.setdefault(r["app_id"], {"app_id": r["app_id"], "total_gross": 0.0, "total_dev_share": 0.0, "sale_count": 0, "refunded": 0.0})
        a["total_gross"] += net_gross(r)
        a["total_dev_share"] += _net_share(r)
        a["sale_count"] += 1
        a["refunded"] += float(r.get("refunded_amount") or 0)
    for a in by_app.values():
        for k in ("total_gross", "total_dev_share", "refunded"):
            a[k] = round(a[k], 2)
    return {
        "days":              days,
        "purchase_count":    len(rows),
        # Past the row limit the totals would be partial: say so, never guess.
        "truncated":         truncated,
        "total_gross":       round(sum(net_gross(r) for r in rows), 2),
        "total_dev_share":   round(sum(_net_share(r) for r in rows), 2),
        # Owed but not yet paid out: waiting for a transfer, for the developer's
        # payout account, or for a failed transfer to be retried.
        "total_pending":     round(sum(_net_share(r) for r in owed), 2),
        "owed_count":        len(owed),
        "total_refunded":    round(sum(float(r.get("refunded_amount") or 0) for r in rows), 2),
        "disputed_count":    sum(1 for r in rows if r.get("disputed")),
        "platform_fee_pct":  STRIPE_PLATFORM_FEE_PCT,
        "by_app":            sorted(by_app.values(), key=lambda a: -a["total_dev_share"]),
        "recent":            [{k: v for k, v in r.items() if k not in ("id", "stripe_payment_ref")} for r in rows[:20]],
    }


@app.get("/stripe/earnings.csv")
async def stripe_earnings_csv(request: Request, days: Optional[int] = None):
    """Every recorded purchase in the period as CSV, for accounting."""
    dev_id = await require_verified_user(request)
    rows, truncated = await _dev_purchases(dev_id, days)
    if truncated:
        # A CSV for accounting must be complete; a partial file is refused.
        raise HTTPException(status_code=413, detail="Too many purchases for one file. Choose a shorter period.")
    names = {}
    app_ids = list({r["app_id"] for r in rows})
    if app_ids:
        res = await db(_service_client().table("apps").select("id, name").in_("id", app_ids))
        names = {a["id"]: a.get("name") or "" for a in (res.data or [])}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "app", "plan", "sale_usd", "platform_fee_usd", "your_share_usd", "refunded_usd", "your_share_after_refunds_usd", "payout_status", "disputed"])
    for r in rows:
        w.writerow([r.get("created_at"), names.get(r["app_id"], ""), r.get("plan"), r.get("gross_amount"), r.get("platform_fee"),
                    r.get("dev_share"), r.get("refunded_amount") or 0, _net_share(r), r.get("payout_status"), bool(r.get("disputed"))])
    name = f"aistrix-revenue-{'all' if not days else f'{days}d'}-{datetime.now(timezone.utc).date().isoformat()}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


PAYOUT_BATCH_SECONDS = float(os.getenv("PAYOUT_BATCH_SECONDS", "25"))


@app.post("/stripe/payouts/retry")
async def stripe_payouts_retry(request: Request):
    """Send payouts still owed (sales made before the payout account was set
    up, or failed transfers). Never pays the same purchase twice."""
    import stripe
    dev_id = await require_verified_user(request)
    secret_key = os.getenv("STRIPE_SECRET_KEY")
    if not secret_key or not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    sb = _service_client()
    prof = await db(sb.table("developer_profiles").select("stripe_account_id").eq("user_id", dev_id).limit(1))
    account_id = ((prof.data or [None])[0] or {}).get("stripe_account_id")
    if not account_id:
        raise HTTPException(status_code=409, detail="Set up your payout account first")
    stripe.api_key = secret_key
    try:
        account = _stripe_dict(await asyncio.to_thread(stripe.Account.retrieve, account_id))
    except Exception:
        raise HTTPException(status_code=502, detail="Couldn't check your payout account with Stripe. Try again.")
    if not account.get("payouts_enabled"):
        raise HTTPException(status_code=409, detail="Your payout account isn't ready for payouts yet. Finish setting it up with Stripe.")
    owed: list[dict] = []
    while True:
        page = (await db(sb.table("purchases").select("id, app_id, plan, gross_amount, dev_share, refunded_amount, stripe_payment_ref, "
                                                      "payout_status, payout_attempts, payout_claimed_at")
                         .eq("dev_id", dev_id).in_("payout_status", list(OWED_STATUSES))
                         .order("created_at").order("id").range(len(owed), len(owed) + PURCHASE_PAGE - 1))).data or []
        owed.extend(page)
        if len(page) < PURCHASE_PAGE:
            break
    # A payout claimed by an attempt that's still running is left to it.
    owed = [p for p in owed if p.get("stripe_payment_ref") and _net_share(p) > 0
            and not (p.get("payout_status") == "transferring" and not _claim_is_stale(p))]
    sent = failed = in_progress = 0
    deadline = time.monotonic() + PAYOUT_BATCH_SECONDS
    done = 0
    for purchase in owed:
        if time.monotonic() > deadline:
            break                                         # the rest: "Send owed payouts" again
        done += 1
        result = await _pay_out(sb, purchase, account_id)
        if result == "transferred":
            sent += 1
        elif result == "busy":
            in_progress += 1
        elif result == "transfer_failed":
            failed += 1
    return {"sent": sent, "failed": failed, "in_progress": in_progress, "remaining": len(owed) - done}


# ─── GitHub OAuth ─────────────────────────────────────────────────────────────
# The GitHub token lives only on the server (developer_github, encrypted, no
# browser access). The browser sees whether it's connected, the login and the
# repository; issues are created here on the developer's behalf.

_GITHUB_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")


class GitHubConnectRequest(BaseModel):
    repo: str = ""


def _github_repo(value: str) -> str:
    repo = (value or "").strip().removeprefix("https://github.com/").strip("/")
    if repo and not _GITHUB_REPO.match(repo):
        raise HTTPException(status_code=400, detail="Repository must look like owner/repo")
    return repo


async def _github_row(user_id: str) -> Optional[dict]:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="GitHub connection storage is unavailable on this server")
    res = await db(_service_client().table("developer_github").select("token_encrypted, login, repo, connected_at")
                   .eq("user_id", user_id).limit(1))
    return (res.data or [None])[0]


@app.post("/github/connect")
async def github_connect(body: GitHubConnectRequest, request: Request):
    """Start connecting GitHub. Returns the GitHub authorisation URL; the
    session token stays in the Authorization header (never in a URL)."""
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET or not GITHUB_REDIRECT_URI:
        raise HTTPException(status_code=503, detail="GitHub isn't set up on this server yet")
    if not _fernet:
        raise HTTPException(status_code=503, detail="Secret encryption is unavailable on this server")
    user_id = await require_verified_user(request)
    repo = _github_repo(body.repo)
    # The state is encrypted and timestamped with the server's key, so any
    # server can check it (nothing is kept in one server's memory) and nobody
    # can forge one for another user.
    nonce = _fernet.encrypt(json.dumps({"u": user_id, "r": repo, "n": secrets.token_urlsafe(8)}).encode()).decode()
    query = urlencode({"client_id": GITHUB_CLIENT_ID, "redirect_uri": GITHUB_REDIRECT_URI,
                       "scope": "repo", "state": nonce})
    return {"url": f"https://github.com/login/oauth/authorize?{query}"}


@app.get("/auth/github/callback")
async def github_oauth_callback(code: str, state: str, request: Request):
    """Exchange GitHub OAuth code for access token and store it server-side."""
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="GitHub OAuth not configured")

    # Verify CSRF nonce and extract user_id
    try:
        if not _fernet:
            raise ValueError("no key")
        claims = json.loads(_fernet.decrypt(state.encode(), ttl=OAUTH_STATE_SECONDS))
        dev_id, repo = claims["u"], claims.get("r") or ""
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    if not await use_once(f"github-state:{claims.get('n')}"):
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    # Exchange code for token
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            json={
                "client_id":     GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code":          code,
                "redirect_uri":  GITHUB_REDIRECT_URI,
            },
        )
    token_data = r.json()
    access_token = token_data.get("access_token")
    if not access_token:
        return RedirectResponse(f"{FRONTEND_URL}/developer?github_connected=0")

    # Fetch GitHub username to confirm the connection
    async with httpx.AsyncClient(timeout=10) as c:
        me = await c.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
    github_login = (me.json() if me.status_code == 200 else {}).get("login", "")

    await _github_row(dev_id)       # fails closed if storage is unavailable
    await db(_service_client().table("developer_github").upsert({
        "user_id": dev_id, "token_encrypted": _encrypt(access_token), "login": github_login,
        "repo": repo or None, "connected_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="user_id"))
    return RedirectResponse(f"{FRONTEND_URL}/developer?github_connected=1")


@app.get("/github/connection")
async def github_connection(request: Request):
    """Whether GitHub is connected — never the token."""
    row = await _github_row(await require_verified_user(request))
    return {"connected": bool(row), "login": (row or {}).get("login"), "repo": (row or {}).get("repo"),
            "connected_at": (row or {}).get("connected_at")}


@app.put("/github/connection")
async def github_set_repo(body: GitHubConnectRequest, request: Request):
    user_id = await require_verified_user(request)
    if not await _github_row(user_id):
        raise HTTPException(status_code=404, detail="Connect GitHub first")
    repo = _github_repo(body.repo)
    await db(_service_client().table("developer_github").update({"repo": repo or None}).eq("user_id", user_id))
    return {"ok": True, "repo": repo or None}


@app.delete("/github/connection")
async def github_disconnect(request: Request):
    user_id = await require_verified_user(request)
    await _github_row(user_id)
    await db(_service_client().table("developer_github").delete().eq("user_id", user_id))
    return {"ok": True}


class GitHubIssueRequest(BaseModel):
    run_id: Optional[str] = None        # one of your own runs
    feedback_id: Optional[str] = None   # customer feedback (only what the customer shared)


@app.post("/github/issues")
async def github_create_issue(body: GitHubIssueRequest, request: Request):
    """File a GitHub issue in the developer's repo for one of their own runs,
    or for customer feedback (its comment, plus the question and answer only
    if the customer shared them; never who gave it)."""
    user_id = await require_verified_user(request)
    user_jwt = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    row = await _github_row(user_id)
    if not row:
        raise HTTPException(status_code=409, detail="Connect GitHub first")
    if not row.get("repo"):
        raise HTTPException(status_code=409, detail="Choose a repository for issues first")
    if bool(body.run_id) == bool(body.feedback_id):
        raise HTTPException(status_code=400, detail="Send a run_id or a feedback_id")
    if body.feedback_id:
        sb = _service_client()
        if not sb:
            raise HTTPException(status_code=503, detail="Feedback storage is unavailable")
        res = await db(sb.table("app_feedback").select("app_id, rating, comment, shared_input, shared_output, created_at")
                       .eq("id", body.feedback_id).limit(1))
        fb = (res.data or [None])[0]
        app_row = await load_app_row(fb["app_id"]) if fb else None
        if not fb or not await can_edit_app(app_row, ApiCaller(user_id=user_id)):
            raise HTTPException(status_code=404, detail="Feedback not found")
        run = {"app_name": app_row.get("name"), "rating_value": fb["rating"], "created_at": fb["created_at"],
               "comment": fb.get("comment"), "input": fb.get("shared_input"), "output": fb.get("shared_output")}
    else:
        # Read the run as the developer, so only runs they can already see can be filed.
        res = await db(get_supabase_for_user(user_jwt).table("run_history")
                       .select("id, app_id, app_name, input, output, rating_value, created_at")
                       .eq("id", body.run_id).limit(1))
        run = (res.data or [None])[0]
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        if not await can_edit_app(await load_app_row(run["app_id"]), ApiCaller(user_id=user_id)):
            raise HTTPException(status_code=404, detail="Run not found")
    try:
        token = _decrypt(row["token_encrypted"])
    except Exception:
        raise HTTPException(status_code=409, detail="Reconnect GitHub")
    app_name = run.get("app_name") or "App"
    text = "\n".join(part for part in [
        f"**App:** {app_name}",
        "**Feedback:** 👎" if run.get("rating_value") == -1 else "",
        f"**Customer comment:** {run['comment'][:1000]}" if run.get("comment") else "",
        f"**Date:** {run.get('created_at')}",
        f"\n**Input:**\n```\n{(run.get('input') or '')[:4000]}\n```" if run.get("input") else "",
        f"\n**Output:**\n```\n{(run.get('output') or '')[:4000]}\n```" if run.get("output") else "",
        f"\n---\n*Created from {BRAND_NAME} Improve*",
    ] if part)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(f"https://api.github.com/repos/{row['repo']}/issues",
                         headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
                         json={"title": f"[{app_name}] run flagged", "body": text, "labels": ["ai-quality"]})
    if r.status_code == 401:
        raise HTTPException(status_code=409, detail="GitHub access was revoked. Reconnect GitHub.")
    if r.status_code in (403, 404):
        raise HTTPException(status_code=409, detail=f"GitHub won't let this account create issues in {row['repo']}.")
    if r.status_code >= 300:
        raise HTTPException(status_code=502, detail="GitHub couldn't create the issue. Try again.")
    issue = r.json()
    return {"number": issue.get("number"), "url": issue.get("html_url")}


# ─── App Secrets ─────────────────────────────────────────────────────────────

class SecretUpsert(BaseModel):
    key:   str
    value: str

@app.get("/apps/{app_id}/secrets")
async def list_secrets(app_id: str, request: Request):
    """Return secret key names only — never values. Secrets belong to the app
    (one value per name), so every editor sees and runs the same set."""
    user_id = await require_verified_user(request)
    if not await can_edit_app(await load_app_row(app_id), ApiCaller(user_id=user_id)):
        raise HTTPException(status_code=404, detail="App not found")
    if not _fernet:
        raise HTTPException(status_code=503, detail="Secret encryption is unavailable on this server")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Secret storage is unavailable on this server")
    sb = _service_client()
    rows = await asyncio.to_thread(
        lambda: sb.table("app_secrets")
            .select("key, created_at, updated_at")
            .eq("app_id", app_id)
            .order("key").execute()
    )
    secrets_list = rows.data or []
    used = await required_secrets(app_id)
    saved = {r["key"] for r in secrets_list}
    return {"secrets": [{**r, "used_by": used.get(r["key"], [])} for r in secrets_list],
            "missing": [{"key": k, "used_by": tools} for k, tools in used.items() if k not in saved]}

@app.put("/apps/{app_id}/secrets")
async def upsert_secret(app_id: str, body: SecretUpsert, request: Request):
    """Create or update a secret value (stored encrypted, value never returned)."""
    user_id = await require_verified_user(request)
    if not await can_edit_app(await load_app_row(app_id), ApiCaller(user_id=user_id)):
        raise HTTPException(status_code=404, detail="App not found")
    if not _fernet:
        raise HTTPException(status_code=503, detail="Secret encryption is unavailable on this server")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Secret storage is unavailable on this server")
    if not body.key.strip():
        raise HTTPException(status_code=400, detail="Key cannot be empty")
    if len(body.key) > 100:
        raise HTTPException(status_code=400, detail="Key too long (max 100 chars)")
    if not re.match(r'^[A-Z0-9_]+$', body.key.upper()):
        raise HTTPException(status_code=400, detail="Key must contain only letters, numbers, and underscores")
    if not body.value.strip():
        raise HTTPException(status_code=400, detail="Enter the secret's value")
    if len(body.value) > 10000:
        raise HTTPException(status_code=400, detail="Secret value too long (max 10,000 characters)")
    encrypted = _encrypt(body.value)
    now = datetime.now(timezone.utc).isoformat()
    sb = _service_client()
    await asyncio.to_thread(
        lambda: sb.table("app_secrets").upsert({
            "app_id":           app_id,
            "user_id":          user_id,
            "key":              body.key.upper(),
            "encrypted_value":  encrypted,
            "updated_at":       now,
        }, on_conflict="app_id,key").execute()
    )
    return {"ok": True, "key": body.key.upper()}

@app.delete("/apps/{app_id}/secrets/{key}")
async def delete_secret(app_id: str, key: str, request: Request):
    user_id = await require_verified_user(request)
    if not await can_edit_app(await load_app_row(app_id), ApiCaller(user_id=user_id)):
        raise HTTPException(status_code=404, detail="App not found")
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Secret storage is unavailable on this server")
    sb = _service_client()
    await asyncio.to_thread(
        lambda: sb.table("app_secrets")
            .delete().eq("app_id", app_id).eq("key", key.upper())
            .execute()
    )
    return {"ok": True}

async def _load_app_secrets(app_id: str) -> dict[str, str]:
    """Load decrypted secrets for injection into a run — server-side only."""
    if not _fernet or not SUPABASE_SERVICE_ROLE_KEY:
        return {}
    sb = _service_client()
    rows = await asyncio.to_thread(
        lambda: sb.table("app_secrets")
            .select("key, encrypted_value")
            .eq("app_id", app_id).execute()
    )
    result = {}
    for r in (rows.data or []):
        try:
            result[r["key"]] = _decrypt(r["encrypted_value"])
        except Exception:
            # Unreadable (e.g. the encryption key changed): treated as missing,
            # so its tools fail clearly — and the operator is told.
            print(f"secret {r.get('key')} for app {app_id} could not be decrypted")
            sentry_sdk.capture_message(f"App secret could not be decrypted (app {app_id})")
    return result


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
        "User-Agent": f"{BRAND_NAME}-Workspace/1.0",
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
    url: str = Field(..., max_length=2048)
    # Website apps read one page (~8k chars); Data apps fetch whole documents.
    max_chars: int = Field(default=8000, ge=500, le=400_000)
    # Signed-out website visitors of an embedded Data app (visitor access).
    app_id: Optional[str] = None


class SheetsRequest(BaseModel):
    sheet_url: str


@app.post("/connectors/sheets/fetch")
async def fetch_google_sheet(body: SheetsRequest, request: Request):
    """Fetch a public Google Sheet as CSV and return the raw content."""
    await require_verified_user(request)
    url = body.sheet_url.strip()

    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise HTTPException(status_code=400, detail="Invalid Google Sheets URL — paste the full share link.")

    sheet_id = m.group(1)
    gid_match = re.search(r"gid=(\d+)", url)
    gid = gid_match.group(1) if gid_match else "0"

    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
    try:
        resp = await fetch_safely("GET", export_url, timeout=15)
        resp.raise_for_status()
        csv_text = resp.text
        lines = [l for l in csv_text.splitlines() if l.strip()]
        row_count = len(lines)
        col_count = len(lines[0].split(",")) if lines else 0
        return {
            "csv": csv_text[:200_000],
            "row_count": row_count,
            "col_count": col_count,
            "sheet_id": sheet_id,
        }
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 403:
            raise HTTPException(
                status_code=403,
                detail="Sheet is not publicly accessible. In Google Sheets, share it with 'Anyone with the link can view'.",
            )
        raise HTTPException(status_code=502, detail=f"Google returned {e.response.status_code}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=502, detail="Could not fetch the sheet.")


_HTML_DROP = re.compile(r"<(script|style|noscript|svg|template|iframe|nav|footer|header|form)\b[^>]*>.*?</\1\s*>",
                        re.DOTALL | re.IGNORECASE)
_HTML_BLOCK = re.compile(r"</?(p|div|section|article|li|ul|ol|h[1-6]|br|tr|table|blockquote|main)\b[^>]*>", re.IGNORECASE)


def _html_to_text(page: str) -> str:
    """Readable page text: title + meta description, then the body without
    menus/footers/scripts, with entities decoded and paragraph breaks kept."""
    title = re.search(r"<title[^>]*>(.*?)</title>", page, re.DOTALL | re.IGNORECASE)
    desc = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']*)', page, re.IGNORECASE)
    body = _HTML_DROP.sub(" ", page)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.DOTALL)
    body = _HTML_BLOCK.sub("\n", body)
    body = re.sub(r"<[^>]+>", " ", body)
    body = html_lib.unescape(body)
    lines = [re.sub(r"[ \t\xa0]+", " ", ln).strip() for ln in body.splitlines()]
    body = "\n".join(ln for ln in lines if ln)
    head = [html_lib.unescape(m.group(1)).strip() for m in (title, desc) if m and m.group(1).strip()]
    return "\n".join(head + [body]).strip()


@app.post("/scrape")
async def scrape_website(body: ScrapeRequest, request: Request):
    """Fetch a URL server-side and return its visible text content."""
    # Real verification instead of a bare "Bearer " prefix check (see
    # require_verified_user) — this endpoint fetches arbitrary caller-supplied
    # URLs server-side, so it needs actual auth plus SSRF protection.
    scrape_user_id, scrape_jwt, visitor_app = await file_caller(request, body.app_id)
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        headers = {
            "User-Agent": f"Mozilla/5.0 (compatible; {BRAND_NAME}/1.0; +https://{BRAND_DOMAIN})",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        }
        resp = await fetch_safely("GET", url, timeout=20, headers=headers)
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        final_url = str(resp.url)
        path = urlsplit(final_url).path.lower()
        if len(resp.content) > MAX_EXTRACT_BYTES:
            raise HTTPException(status_code=413, detail=f"That file is larger than {MAX_EXTRACT_BYTES // (1024 * 1024)} MB")

        if ctype == "application/pdf" or path.endswith(".pdf"):
            app_row = await load_app_row(body.app_id) if (scrape_user_id and body.app_id) else None
            get_key, max_pages = pdf_reader_for(request, scrape_user_id, scrape_jwt, visitor_app, app_row)
            try:
                text, _ = await extract_pdf_text(resp.content, get_key, max_pages)
                kind = "text"
            except OcrError as e:
                raise HTTPException(status_code=e.status, detail=str(e))
            except ValueError as e:      # password-protected / unreadable PDF
                raise HTTPException(status_code=422, detail=str(e))
        elif ctype in ("text/csv", "application/csv") or path.endswith(".csv"):
            text, kind = resp.text, "csv"
        elif ctype in ("application/json", "text/plain", "text/markdown") or path.endswith((".json", ".txt", ".md")):
            text, kind = resp.text, "json" if "json" in ctype or path.endswith(".json") else "text"
        elif "html" in ctype or not ctype:
            text, kind = _html_to_text(resp.text), "text"
        else:
            raise HTTPException(status_code=415, detail=f"Can't read {ctype or 'this kind of'} content — use a web page, PDF, CSV or text URL")

        if not text.strip():
            raise HTTPException(status_code=422, detail="The page has no readable text (it may need JavaScript to load). Try a different page.")
        return {"text": text[: body.max_chars], "url": final_url, "kind": kind,
                "truncated": len(text) > body.max_chars, "chars": len(text)}
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Site returned {e.response.status_code}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=502, detail="Could not fetch that URL.")


async def _trigger_app(token: str, request: Request):
    """An app's inbound trigger link: runs the live version as its developer
    (their key and limits). Body: {"input": "..."} and/or {"fields": {...}}."""
    try:
        res = await db(_service_client().table("app_triggers").select("app_id").eq("token", token).maybe_single())
    except Exception:
        res = None
    if not (res and res.data):
        raise HTTPException(status_code=404, detail="Trigger not found or turned off")
    app_row = await load_app_row(res.data["app_id"])
    if not (app_row and app_row.get("is_published")):
        raise HTTPException(status_code=409, detail="The app isn't live. Publish it to use its trigger link.")
    try:
        body = json.loads(await request.body() or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail='Send JSON: {"input": "..."}')
    if not isinstance(body, dict):
        body = {"input": str(body)}
    req = ApiRunRequest(input=body.get("input") if isinstance(body.get("input"), str) else None,
                        fields=body.get("fields") if isinstance(body.get("fields"), dict) else None, stream=False)
    owner = app_row.get("created_by")
    caller = ApiCaller(user_id=owner, workspace_id=app_row.get("workspace_id") or await personal_workspace_id(owner), live=True)
    return await _run_app_api(app_row["id"], req, request, caller)


@app.post("/webhooks/{token}")
async def trigger_via_webhook(token: str, request: Request):
    """Trigger a workflow via its unique webhook token. No user auth required — the token IS the credential."""
    if not token or len(token) < 16:
        raise HTTPException(status_code=400, detail="Invalid token")

    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Server not configured for webhook triggers")

    sb_service = _service_client()
    try:
        uuid.UUID(token)   # flow tokens are UUIDs; app trigger tokens (trg_…) aren't
        result = await db(sb_service.table("flows").select("*").eq("webhook_token", token).maybe_single())
    except ValueError:
        result = None
    flow = result.data if result else None
    if not flow:
        return await _trigger_app(token, request)

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

    # Runs as the workflow's owner. An approval step pauses the run (it's
    # resumed from the workflow), so approvals are never skipped.
    fake_schedule = {"flow_id": flow["id"], "user_id": flow["user_id"], "seed_input": seed_input, "trigger": "webhook"}
    try:
        run = await run_scheduled_workspace(sb_service, fake_schedule)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Workflow run failed: {e}")
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=500, detail="Workflow run failed unexpectedly")

    return {
        "ok": True,
        "flow": flow["name"],
        "run_id": (run or {}).get("id"),
        "status": (run or {}).get("status"),
        "steps_run": sum(1 for r in (run or {}).get("steps", []) if r.get("status") == "ok"),
        "message": "Workflow triggered. Results saved to run history.",
    }


# ─── Test destinations ───────────────────────────────────────────────────────
# Each developer gets private URLs that capture what a workflow sends (instead
# of a real accounting system, CRM or outbox) and a sample dataset to read.
# The URL carries a token derived from the user id, so nothing is stored to
# create them. Workflow API steps that target them are handled in-process.
_DESTINATION_NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")
TEST_DELIVERY_RETENTION_DAYS = 14
DATASET_ROWS = {"sales-data": reference_workflows.SALES_ROWS}


def test_destination_token(user_id: str) -> str:
    master = os.getenv("WEBHOOK_SIGNING_KEY") or SUPABASE_SERVICE_ROLE_KEY or ""
    return hmac.new(master.encode(), f"test-destination:{user_id}".encode(), hashlib.sha256).hexdigest()[:32]


def test_destination_url(user_id: str, name: str) -> str:
    return f"{API_PUBLIC_URL}/v1/test-destinations/{user_id}/{test_destination_token(user_id)}/{name}"


def own_test_destination(url: str) -> Optional[tuple[str, str, str]]:
    """(user id, token, name) when url is one of this API's test destinations."""
    parts, base = urlsplit(url), urlsplit(API_PUBLIC_URL)
    if (parts.scheme, (parts.hostname or "").lower(), parts.port) != (base.scheme, (base.hostname or "").lower(), base.port):
        return None
    match = re.fullmatch(r"/v1/test-destinations/([^/]+)/([^/]+)/([^/]+)/?", parts.path)
    return (match.group(1), match.group(2), match.group(3)) if match else None


async def handle_test_destination(method: str, user_id: str, token: str, name: str, *,
                                  body: bytes = b"", content_type: Optional[str] = None) -> tuple[int, dict]:
    method = method.upper()
    if not (_UUID_RE.fullmatch(user_id or "") and _DESTINATION_NAME.fullmatch(name or "")
            and hmac.compare_digest(token or "", test_destination_token(user_id))):
        return 404, {"error": "Unknown test destination"}
    if method in ("GET", "HEAD"):
        if name in DATASET_ROWS:
            return 200, {"source": name, "rows": DATASET_ROWS[name]}
        return 200, {"destination": name, "ok": True}
    if method not in ("POST", "PUT", "PATCH", "DELETE"):
        return 405, {"error": "Use POST, PUT, PATCH or DELETE to deliver"}
    if len(body) > 65536:
        return 413, {"error": "Deliveries are limited to 64 KB"}
    sb = _service_client()
    if not sb:
        return 503, {"error": "Test destinations aren't configured on this server"}
    try:
        res = await db(sb.table("test_deliveries").insert({
            "user_id": user_id, "destination": name, "method": method,
            "content_type": (content_type or "")[:100] or None, "body": body.decode("utf-8", errors="replace")}))
        cutoff = (datetime.now(timezone.utc) - timedelta(days=TEST_DELIVERY_RETENTION_DAYS)).isoformat()
        await db(sb.table("test_deliveries").delete().eq("user_id", user_id).lt("created_at", cutoff))
    except Exception as e:
        if _missing_table(e):
            return 503, {"error": "Test destinations aren't set up on this server yet (database migration pending)."}
        raise
    return 200, {"received": True, "destination": name, "delivery_id": ((res.data or [{}])[0]).get("id")}


@app.api_route("/v1/test-destinations/{user_id}/{token}/{name}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])
async def test_destination(user_id: str, token: str, name: str, request: Request):
    """A developer's test destination: captures deliveries, or serves a sample dataset."""
    status, payload = await handle_test_destination(request.method, user_id, token, name, body=await request.body(),
                                                    content_type=request.headers.get("content-type"))
    return JSONResponse(status_code=status, content=payload)


async def _signed_in_builder(request: Request) -> ApiCaller:
    caller = await resolve_api_caller(request, required=True)
    if caller.via_key:
        raise HTTPException(status_code=403, detail="Sign in to do this; API keys can't.")
    return caller


@app.get("/v1/test-destinations")
async def list_test_destinations(request: Request):
    """Your test destination URLs, for API steps and tools."""
    caller = await _signed_in_builder(request)
    return {"destinations": [{"name": n, "description": d, "url": test_destination_url(caller.user_id, n)}
                             for n, d in reference_workflows.DESTINATIONS.items()],
            "datasets": [{"name": n, "description": d, "url": test_destination_url(caller.user_id, n)}
                         for n, d in reference_workflows.DATASETS.items()]}


@app.get("/v1/test-deliveries")
async def list_test_deliveries(request: Request, destination: Optional[str] = None, limit: int = 50):
    """What your workflows delivered to your test destinations, newest first."""
    caller = await _signed_in_builder(request)
    try:
        query = _service_client().table("test_deliveries").select("id, destination, method, content_type, body, created_at") \
            .eq("user_id", caller.user_id)
        if destination:
            query = query.eq("destination", destination)
        res = await db(query.order("created_at", desc=True).limit(max(1, min(limit, 200))))
    except Exception as e:
        if _missing_table(e):
            raise HTTPException(status_code=503, detail="Test destinations aren't set up on this server yet (database migration pending).")
        raise
    deliveries = []
    for row in res.data or []:
        parsed, errs = _parse_json_output(row.get("body") or "")
        deliveries.append({**row, "json": parsed if not errs else None})
    return {"deliveries": deliveries}


@app.delete("/v1/test-deliveries")
async def clear_test_deliveries(request: Request):
    caller = await _signed_in_builder(request)
    await db(_service_client().table("test_deliveries").delete().eq("user_id", caller.user_id))
    return {"ok": True}


# ─── Reference workflows ─────────────────────────────────────────────────────
@app.get("/v1/reference-workflows")
async def list_reference_workflows(request: Request):
    """Ready-made workflows to install: their apps, steps and a sample input."""
    caller = await _signed_in_builder(request)
    out = []
    for key in reference_workflows.CATALOG:
        wf = reference_workflows.build(key, lambda n: test_destination_url(caller.user_id, n))
        out.append({"key": key, "name": wf["name"], "emoji": wf["emoji"], "description": wf["description"],
                    "apps": [a["name"] for a in wf["apps"]], "steps": [s["app_name"] for s in wf["steps"]],
                    "sample_input": wf["sample_input"]})
    return {"workflows": out}


def _unique_name(name: str, taken: set) -> str:
    candidate, n = name, 2
    while candidate.lower() in taken:
        candidate, n = f"{name} ({n})", n + 1
    taken.add(candidate.lower())
    return candidate


@app.post("/v1/reference-workflows/{key}/install")
async def install_reference_workflow(key: str, request: Request):
    """Create a reference workflow and its apps (as drafts) for you to test,
    change and publish. Its API steps deliver to your test destinations."""
    caller = await _signed_in_builder(request)
    if key not in reference_workflows.CATALOG:
        raise HTTPException(status_code=404, detail="Reference workflow not found")
    workspace_id = caller.workspace_id
    if workspace_id and workspace_id != await personal_workspace_id(caller.user_id) \
            and await workspace_role(workspace_id, caller.user_id) not in BUILD_ROLES:
        raise HTTPException(status_code=403, detail="Only people who build in this workspace can install workflows")
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Workflows aren't configured on this server")
    wf = reference_workflows.build(key, lambda n: test_destination_url(caller.user_id, n))
    names = await db(sb.table("apps").select("name").eq("created_by", caller.user_id))
    taken = {str(r.get("name") or "").lower() for r in (names.data or [])}
    created: dict[str, dict] = {}
    try:
        for spec in wf["apps"]:
            row = {"name": _unique_name(spec["name"], taken), "emoji": spec["emoji"], "description": spec["description"],
                   "system_prompt": spec["system_prompt"], "ai_provider": spec["ai_provider"], "ai_model": spec["ai_model"],
                   "output_type": spec["output_type"], "is_published": False, "visibility": "private",
                   "created_by": caller.user_id, "workflow_order": 999, "total_runs": 0,
                   **({"workspace_id": workspace_id} if workspace_id else {})}
            res = await db(sb.table("apps").insert(row))
            app_row = (res.data or [None])[0]
            if not app_row:
                raise RuntimeError("app not created")
            created[spec["key"]] = app_row
            await db(sb.table("app_blueprints").insert({"app_id": app_row["id"], "user_id": caller.user_id,
                                                        "blueprint": spec["blueprint"]}))
        steps = []
        for step in wf["steps"]:
            out = {k: v for k, v in step.items() if k != "app"}
            if "app" in step:
                app_row = created[step["app"]]
                out.update(app_id=app_row["id"], app_emoji=app_row.get("emoji"), version="draft", pinned_version=None)
            steps.append(out)
        flows = await db(sb.table("flows").select("name").eq("user_id", caller.user_id))
        flow_row = {"name": _unique_name(wf["name"], {str(r.get("name") or "").lower() for r in (flows.data or [])}),
                    "emoji": wf["emoji"], "description": wf["description"], "kind": "developer",
                    "user_id": caller.user_id, "steps": steps, "trigger": wf["trigger"],
                    **({"workspace_id": workspace_id} if workspace_id else {})}
        res = await db(sb.table("flows").insert(flow_row))
        flow = (res.data or [None])[0]
        if not flow:
            raise RuntimeError("workflow not created")
    except Exception as e:
        for app_row in created.values():         # don't leave half an install behind
            try:
                await db(sb.table("apps").delete().eq("id", app_row["id"]).eq("created_by", caller.user_id))
            except Exception:
                pass
        if isinstance(e, HTTPException):
            raise
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=503, detail="The workflow couldn't be installed. Nothing was kept; try again.") from e
    return {"flow_id": flow["id"], "name": flow["name"],
            "apps": [{"id": a["id"], "name": a["name"]} for a in created.values()],
            "sample_input": wf["sample_input"],
            "next": "Test it from Dev Studio → Workflows with the sample input. Its apps are drafts: publish them "
                    "(tests first) before running it on a schedule or webhook."}


# ─── Workflow runs from Dev Studio (Workflows → Test) ────────────────────────
class FlowRunStart(BaseModel):
    live: bool = False        # Business executes published releases; Developer may test drafts.
    input: str = Field(default="", max_length=MAX_INPUT_LENGTH)
    wait: bool = False        # true: answer when the run stops; false: answer at once, poll GET …/runs/{id}


class FlowRunContinue(BaseModel):
    # Needed when the step that stopped may already have reached an outside
    # service: the person confirms they checked and want it to run again.
    confirm_repeat: bool = False
    wait: bool = False


class FlowRunReview(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)


class FlowRunResume(BaseModel):
    approve: bool = True
    output: Optional[str] = Field(default=None, max_length=FLOW_OUTPUT_LIMIT)   # edited content (edit steps)
    reason: Optional[str] = Field(default=None, max_length=500)
    wait: bool = False


# Runs started from Dev Studio continue after the request answers, so the
# screen can show each step as it finishes. Kept here so they aren't
# garbage-collected mid-run.
_FLOW_TASKS: set = set()


async def _finish_flow_run(flow: dict, caller: "ApiCaller", trigger: str, run: dict) -> None:
    try:
        await run_flow(flow, caller=caller, trigger=trigger, run=run)
    except Exception as e:
        sentry_sdk.capture_exception(e)
        run.update(status="failed", error=f"The run stopped unexpectedly ({type(e).__name__})",
                   finished_at=datetime.now(timezone.utc).isoformat())
        try:
            await _save_flow_run(run)
        except Exception:
            # The recovery sweep records interruption after the lease expires.
            pass


async def _run_flow_now_or_later(flow: dict, caller: "ApiCaller", trigger: str, run: dict, wait: bool) -> dict:
    if wait:
        return _public_flow_run(await run_flow(flow, caller=caller, trigger=trigger, run=run))
    run["status"] = "running"
    await _save_flow_run(run)
    task = asyncio.create_task(_finish_flow_run(flow, caller, trigger, run))
    _FLOW_TASKS.add(task)
    task.add_done_callback(_FLOW_TASKS.discard)
    return _public_flow_run(dict(run, steps=list(run.get("steps") or [])))


async def flow_member_role(flow_id: str, user_id: str) -> Optional[str]:
    try:
        res = await db(_service_client().table("flow_members").select("role")
                       .eq("flow_id", flow_id).eq("user_id", user_id).limit(1))
        return res.data[0]["role"] if res and res.data else None
    except Exception as e:
        if _missing_table(e):
            return None
        raise _access_check_failed(e)


async def can_edit_flow(flow: dict, caller: "ApiCaller") -> bool:
    if flow.get("user_id") == caller.user_id:
        return True
    if flow.get("workspace_id") and await workspace_role(flow["workspace_id"], caller.user_id) in BUILD_ROLES:
        return True
    return await flow_member_role(flow["id"], caller.user_id) == "editor"


async def _flow_for_runner(flow_id: str, request: Request, *, edit: bool = True) -> tuple[dict, ApiCaller]:
    """One object/access policy for Developer testing and Business execution.
    Viewers may execute releases and access their own runs; editors may test
    drafts and manage schedules. The app runner checks each app's access too.
    """
    if not _UUID_RE.fullmatch(flow_id or ""):
        raise HTTPException(status_code=404, detail="Workflow not found")
    caller = await resolve_api_caller(request, required=True)
    if caller.via_key:
        raise HTTPException(status_code=403, detail="Sign in to run workflows, or use their webhook link.")
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Workflows aren't configured on this server")
    res = await db(sb.table("flows").select("*").eq("id", flow_id).maybe_single())
    flow = res.data if res else None
    allowed = bool(flow) and await can_edit_flow(flow, caller)
    if flow and not allowed and not edit:
        allowed = bool(flow.get("workspace_id") and await workspace_role(flow["workspace_id"], caller.user_id)) or bool(await flow_member_role(flow["id"], caller.user_id))
    if not allowed:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return flow, caller


async def _authorize_flow_run(flow: dict, caller: "ApiCaller", run: dict) -> None:
    if run.get("user_id") != caller.user_id and not await can_edit_flow(flow, caller):
        raise HTTPException(status_code=404, detail="Run not found")


async def _load_flow_run(flow_id: str, run_id: str) -> dict:
    if not _UUID_RE.fullmatch(run_id or ""):
        raise HTTPException(status_code=404, detail="Run not found")
    try:
        res = await db(_service_client().table("flow_runs").select("*").eq("id", run_id).eq("flow_id", flow_id).maybe_single())
    except Exception as e:
        if _missing_table(e):
            raise HTTPException(status_code=503, detail="Workflow runs aren't set up on this server yet (database migration pending).")
        raise
    if not (res and res.data):
        raise HTTPException(status_code=404, detail="Run not found")
    return res.data


@app.post("/v1/flows/{flow_id}/runs")
async def start_flow_run(flow_id: str, body: FlowRunStart, request: Request):
    """Test a workflow: runs every step now (drafts allowed for their
    editors) and stops at an approval step until it's resumed."""
    flow, caller = await _flow_for_runner(flow_id, request, edit=not body.live)
    if not (flow.get("steps") or []):
        raise HTTPException(status_code=422, detail="Add a step to the workflow first")
    if body.live:
        if any((step or {}).get("version") == "draft" for step in flow.get("steps") or []):
            raise HTTPException(status_code=409, detail="Business runs use published releases. Publish draft steps and save the workflow first.")
        caller = ApiCaller(user_id=caller.user_id, user_jwt=caller.user_jwt, workspace_id=caller.workspace_id, live=True)
        # Stored with the immutable definition so approval resume keeps live semantics.
        flow = {**flow, "_run_live": True}
    flow, problems = await compile_flow_definition(flow)
    if problems:
        return JSONResponse(status_code=422, content={"error": f"This workflow can't run yet: {flow_problem_text(flow, problems)}",
                                                      "problems": problems})
    run = {"id": str(uuid.uuid4()), "flow_id": flow["id"], "user_id": caller.user_id, "trigger": "interactive",
           "status": "running", "seed_input": (body.input or "")[:FLOW_OUTPUT_LIMIT],
           "current_step": 0, "steps": [], "error": None, "finished_at": None, "definition": flow}
    await _save_flow_run(run, new=True)
    return await _run_flow_now_or_later(flow, caller, "interactive", run, body.wait)


@app.post("/v1/flows/{flow_id}/validate")
async def validate_flow(flow_id: str, request: Request):
    """The checks a run makes before it starts, without running anything:
    {"ok", "plan_id", "problems": [{"step", "text"}]}."""
    flow, _ = await _flow_for_runner(flow_id, request)
    definition, problems = await compile_flow_definition(flow)
    return {"ok": not problems, "plan_id": (definition.get("_plan") or {}).get("id"), "problems": problems}


@app.get("/v1/flows/{flow_id}/runs")
async def list_flow_runs(flow_id: str, request: Request, limit: int = 20, needs_review: bool = False):
    """Recent runs, newest first: tests, webhook and scheduled runs (those
    waiting at an approval step are decided from here). needs_review=true
    lists only runs a person must look at: interrupted, or possibly half done."""
    flow, caller = await _flow_for_runner(flow_id, request, edit=False)
    editor = await can_edit_flow(flow, caller)
    columns = "id, trigger, status, current_step, error, started_at, finished_at, user_id"
    try:
        query = _service_client().table("flow_runs").select(columns + (", needs_review" if needs_review else "")).eq("flow_id", flow_id)
        if needs_review:
            query = query.eq("needs_review", True)
        if not editor:
            query = query.eq("user_id", caller.user_id)
        res = await db(query
                       .order("started_at", desc=True).limit(max(1, min(limit, 100))))
    except Exception as e:
        if _missing_table(e):
            raise HTTPException(status_code=503, detail="Workflow runs aren't set up on this server yet (database migration pending).")
        raise
    return {"runs": res.data or []}


@app.get("/v1/flows/{flow_id}/runs/{run_id}")
async def get_flow_run(flow_id: str, run_id: str, request: Request):
    flow, caller = await _flow_for_runner(flow_id, request, edit=False)
    run = await _load_flow_run(flow_id, run_id)
    await _authorize_flow_run(flow, caller, run)
    return _public_flow_run(run)


@app.post("/v1/flows/{flow_id}/runs/{run_id}/resume")
async def resume_flow_run(flow_id: str, run_id: str, body: FlowRunResume, request: Request):
    """Approve (optionally with edited content) or reject the approval step a
    run is waiting at. Approving continues the run from the next step."""
    flow, caller = await _flow_for_runner(flow_id, request, edit=False)
    run = await _load_flow_run(flow_id, run_id)
    await _authorize_flow_run(flow, caller, run)
    records = run.get("steps") or []
    if run.get("status") != "waiting_approval" or not records or records[-1].get("status") != "waiting_approval":
        raise HTTPException(status_code=409, detail="This run isn't waiting for approval")
    # Only one person's decision counts: claim the paused run first.
    lease_token = str(uuid.uuid4())
    claimed = await db(_service_client().table("flow_runs").update({"status": "running", "lease_token": lease_token,
                       "lease_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat()})
                       .eq("id", run_id).eq("status", "waiting_approval"))
    if not claimed.data:
        raise HTTPException(status_code=409, detail="Someone else already decided this approval. Reload the run.")
    run["lease_token"] = lease_token
    run["status"] = "running"
    idx = int(run.get("current_step") or 0)
    record = records[-1]
    if not body.approve:
        reason = (body.reason or "").strip() or "Rejected at the approval step"
        record.update(status="rejected", error=reason, decided_by=caller.user_id)
        run.update(status="failed", error=f"Step {_step_number(flow, idx)} ({record.get('name')}) rejected: {reason}",
                   finished_at=datetime.now(timezone.utc).isoformat())
        await _save_flow_run(run)
        return _public_flow_run(run)
    record.update(status="ok", decided_by=caller.user_id,
                  output=(body.output if body.output is not None else record.get("output") or "")[:FLOW_OUTPUT_LIMIT])
    run["current_step"] = idx + 1
    trigger = run.get("trigger") or "interactive"
    runner = ApiCaller(user_id=caller.user_id, user_jwt=caller.user_jwt, workspace_id=caller.workspace_id,
                       live=trigger != "interactive" or bool((run.get("definition") or {}).get("_run_live")))
    return await _run_flow_now_or_later(flow, runner, trigger, run, body.wait)


async def _step_repeat_safe(definition: dict, idx: int) -> tuple[bool, str]:
    """Whether running step idx again can't repeat an outside effect, and
    what the step reaches when it can."""
    steps = definition.get("steps") or []
    step = steps[idx] if 0 <= idx < len(steps) and isinstance(steps[idx], dict) else {}
    kind = flow_plan.step_type(step)
    if kind == "human_approval":
        return True, ""
    if kind == "api_call":
        host = urlsplit(str(step.get("api_url") or "")).hostname or "the API"
        return api_step_repeat_safe(step), host
    app_row = await load_app_row(step.get("app_id")) if step.get("app_id") else None
    if not app_row:
        return True, ""                     # nothing can run; the step will report it
    _, snapshot = await _step_snapshot(app_row, step)
    if snapshot is None:
        return True, ""
    contract = release_contract(app_row, snapshot)
    reaches = ", ".join(contract["privacy"].get("external_destinations") or []) or "an outside service"
    return contract["side_effects"] != "external_write", reaches


@app.post("/v1/flows/{flow_id}/runs/{run_id}/continue")
async def continue_flow_run(flow_id: str, run_id: str, body: FlowRunContinue, request: Request):
    """Continue a failed or interrupted run from the step where it stopped,
    with the same definition and releases. Earlier steps aren't repeated. A
    step that may already have written to an outside service runs again only
    when the person confirms it (recorded with the run)."""
    flow, caller = await _flow_for_runner(flow_id, request, edit=False)
    run = await _load_flow_run(flow_id, run_id)
    await _authorize_flow_run(flow, caller, run)
    definition = run.get("definition") if isinstance(run.get("definition"), dict) else None
    records = list(run.get("steps") or [])
    if run.get("status") != "failed":
        raise HTTPException(status_code=409, detail="Only a failed or interrupted run can be continued")
    if not definition:
        raise HTTPException(status_code=409, detail="This run started before runs kept their definition, so it can't be continued. Start a new run.")
    if records and records[-1].get("status") == "rejected":
        raise HTTPException(status_code=409, detail="This run was rejected at an approval step. Start a new run instead.")
    idx = int(run.get("current_step") or 0)
    stopped = next((r for r in records if r.get("index") == idx), None)
    safe, reaches = await _step_repeat_safe(definition, idx)
    # Interrupted (no record) or failed after sending: it may have run.
    may_have_run = stopped is None or bool(stopped.get("sent", True))
    if may_have_run and not safe and not body.confirm_repeat:
        name = _step_name(definition.get("steps") or [], idx)
        return JSONResponse(status_code=409, content={"code": "confirm_repeat", "step": idx, "error": (
            f"Step {_step_number(definition, idx)} ({name}) writes to {reaches} and may already have done so before the run "
            "stopped. Check there first; to run it again anyway, continue with confirm_repeat.")})
    now = datetime.now(timezone.utc).isoformat()
    history = list(definition.get("_continued") or []) + [{
        "at": now, "by": caller.user_id, "step": idx, "previous_error": run.get("error"),
        "confirmed_repeat": bool(body.confirm_repeat and not safe)}]
    definition = {**definition, "_continued": history[-20:]}
    lease_token = str(uuid.uuid4())
    update = {"status": "running", "lease_token": lease_token, "error": None, "finished_at": None,
              "lease_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat(),
              "definition": definition, "steps": [r for r in records if (r.get("index") or 0) < idx]}
    if "needs_review" in run:
        update.update(needs_review=False, reviewed_by=caller.user_id, reviewed_at=now)
    # One continuation at a time: only a run that is still failed is claimed.
    claimed = await db(_service_client().table("flow_runs").update(update).eq("id", run_id).eq("status", "failed"))
    if not claimed.data:
        raise HTTPException(status_code=409, detail="Someone else already continued or changed this run. Reload it.")
    run.update(update)
    trigger = run.get("trigger") or "interactive"
    runner = ApiCaller(user_id=caller.user_id, user_jwt=caller.user_jwt, workspace_id=caller.workspace_id,
                       live=trigger != "interactive" or bool(definition.get("_run_live")))
    return await _run_flow_now_or_later(flow, runner, trigger, run, body.wait)


@app.post("/v1/flows/{flow_id}/runs/{run_id}/review")
async def review_flow_run(flow_id: str, run_id: str, body: FlowRunReview, request: Request):
    """Mark a run that needed attention as reviewed, without running it again."""
    flow, caller = await _flow_for_runner(flow_id, request)
    run = await _load_flow_run(flow_id, run_id)
    if "needs_review" not in run:
        raise HTTPException(status_code=503, detail="Run review isn't set up on this server yet (database migration pending).")
    if not run.get("needs_review"):
        raise HTTPException(status_code=409, detail="This run doesn't need review")
    patch = {"needs_review": False, "review_note": (body.note or "").strip() or None,
             "reviewed_by": caller.user_id, "reviewed_at": datetime.now(timezone.utc).isoformat()}
    saved = await db(_service_client().table("flow_runs").update(patch).eq("id", run_id).eq("needs_review", True))
    if not saved.data:
        raise HTTPException(status_code=409, detail="Someone else already reviewed this run. Reload it.")
    return _public_flow_run({**run, **patch})


@app.post("/v1/flows/{flow_id}/runs/{run_id}/cancel")
async def cancel_flow_run(flow_id: str, run_id: str, request: Request):
    """Stop a run that's working or waiting for approval. A step already
    running finishes, but nothing after it runs."""
    flow, caller = await _flow_for_runner(flow_id, request, edit=False)
    run = await _load_flow_run(flow_id, run_id)
    await _authorize_flow_run(flow, caller, run)
    if run.get("status") not in ("running", "waiting_approval"):
        raise HTTPException(status_code=409, detail="This run has already finished")
    now = datetime.now(timezone.utc).isoformat()
    res = await db(_service_client().table("flow_runs").update({"status": "cancelled", "finished_at": now})
                   .eq("id", run_id).in_("status", ["running", "waiting_approval"]))
    if not res.data:
        raise HTTPException(status_code=409, detail="This run has already finished")
    return _public_flow_run({**run, "status": "cancelled", "finished_at": now})


class FlowScheduleRequest(BaseModel):
    enabled: bool = True
    frequency: str = Field(default="daily", pattern="^(daily|weekly)$")
    hour_utc: int = Field(default=9, ge=0, le=23)
    day_of_week: Optional[int] = Field(default=None, ge=0, le=6)      # Sun=0 … Sat=6 (weekly)
    seed_input: str = Field(default="", max_length=MAX_INPUT_LENGTH)


async def _flow_schedule_row(flow_id: str) -> Optional[dict]:
    res = await db(_service_client().table("flow_schedules").select("*").eq("flow_id", flow_id).limit(1))
    return (res.data or [None])[0]


@app.get("/v1/flows/{flow_id}/schedule")
async def get_flow_schedule(flow_id: str, request: Request):
    await _flow_for_runner(flow_id, request)
    return {"schedule": await _flow_schedule_row(flow_id)}


@app.put("/v1/flows/{flow_id}/schedule")
async def put_flow_schedule(flow_id: str, body: FlowScheduleRequest, request: Request):
    """Run the workflow daily or weekly, as the person who sets the schedule.
    Scheduled runs use published releases only."""
    flow, caller = await _flow_for_runner(flow_id, request)
    if body.enabled:
        drafts = [_step_number(flow, i) for i, st in enumerate(flow.get("steps") or []) if (st or {}).get("version") == "draft"]
        if drafts:
            raise HTTPException(status_code=409, detail=(
                f"Step{'s' if len(drafts) > 1 else ''} {', '.join(map(str, drafts))} use{'' if len(drafts) > 1 else 's'} a draft. "
                "Scheduled runs use published releases only: switch them to a published version and save."))
        if not (flow.get("steps") or []):
            raise HTTPException(status_code=422, detail="Add a step to the workflow first")
    if body.frequency == "weekly" and body.day_of_week is None:
        raise HTTPException(status_code=422, detail="Pick a day for a weekly schedule")
    now = datetime.now(timezone.utc)
    row = {"flow_id": flow_id, "user_id": caller.user_id, "frequency": body.frequency, "hour_utc": body.hour_utc,
           "day_of_week": body.day_of_week if body.frequency == "weekly" else None, "seed_input": body.seed_input,
           "enabled": body.enabled,
           "next_run_at": compute_next_run_at(now, body.frequency, body.hour_utc, body.day_of_week).isoformat()}
    sb = _service_client()
    existing = await _flow_schedule_row(flow_id)
    if existing:
        res = await db(sb.table("flow_schedules").update(row).eq("id", existing["id"]))
    else:
        res = await db(sb.table("flow_schedules").insert(row))
    return {"schedule": (res.data or [row])[0]}


@app.delete("/v1/flows/{flow_id}/schedule")
async def delete_flow_schedule(flow_id: str, request: Request):
    await _flow_for_runner(flow_id, request)
    await db(_service_client().table("flow_schedules").delete().eq("flow_id", flow_id))
    return {"ok": True}


@app.get("/v1/apps/{app_id}/schema")
async def app_schema(app_id: str, request: Request, version: str = "live"):
    """Input and output fields of one version of an app ("draft", "live" or
    a release number), for wiring workflow steps."""
    _, app_row = await _editable_app(app_id, request)
    if version == "draft":
        snapshot = await app_draft_state(app_row)
        blueprint, output_type = snapshot["blueprint"], app_row.get("output_type")
    else:
        if version != "live" and not version.isdigit():
            raise HTTPException(status_code=400, detail='version must be "draft", "live" or a release number')
        live_num = app_row.get("live_version")
        snapshot = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) else None
        if version != "live" and int(version) != live_num:
            res = await db(_service_client().table("app_versions").select("version_data")
                           .eq("app_id", app_id).eq("version_num", int(version)).limit(1))
            snapshot = (res.data or [{}])[0].get("version_data") if res else None
        if not isinstance(snapshot, dict):
            raise HTTPException(status_code=404, detail="That version doesn't exist")
        blueprint, output_type = snapshot.get("blueprint") or {}, snapshot.get("output_type")
    contract = release_contract(app_row, snapshot)
    output = _schema_fields(blueprint, "output_schema")
    out_contract = blueprint.get("output_contract") or {}
    structured = bool(output) and (output_type == "json" or (isinstance(out_contract, dict) and out_contract.get("format") == "json"))
    return {"version": version, "input": _schema_fields(blueprint, "input_schema"),
            "output": output if structured else [], "structured": structured, "contract": contract}


MIN_CARD_PRICE = 0.50          # Stripe's smallest USD card charge


def listing_problems(app_row: dict, listing: Optional[dict]) -> list[str]:
    """What stops a Marketplace listing from going live."""
    problems = []
    if not app_row.get("is_published") or not app_row.get("live_version"):
        problems.append("Publish the app in Deploy first (it must pass its tests)")
    if app_row.get("is_paid") and not (float(app_row.get("price_per_run") or 0) > 0):
        problems.append("Paid app has no price — set one in Marketplace")
    elif app_row.get("is_paid") and float(app_row.get("price_per_run") or 0) < MIN_CARD_PRICE:
        problems.append(f"Price is below the card minimum (${MIN_CARD_PRICE:.2f} per run) — buyers couldn't pay")
    if not listing:
        problems.append("Save a listing first")
    else:
        if not (listing.get("title") or "").strip():
            problems.append("Listing title is missing")
        if not (listing.get("tagline") or "").strip():
            problems.append("Tagline is missing")
        if not listing.get("category"):
            problems.append("Category not selected")
    if not (app_row.get("total_runs") or 0) > 0:
        problems.append("No runs yet — run the app at least once")
    return problems


@app.post("/v1/apps/{app_id}/listing/go-live")
async def listing_go_live(app_id: str, request: Request):
    """Put the app's Marketplace listing live (editors only). Listings are
    approved automatically once the app is published and the listing is
    complete; browsers can't set a listing live themselves."""
    _, app_row = await _editable_app(app_id, request)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Marketplace isn't available on this server")
    res = await db(sb.table("marketplace_listings").select("*").eq("app_id", app_id).limit(1))
    listing = (res.data or [None])[0]
    problems = listing_problems(app_row, listing)
    if problems:
        return JSONResponse(status_code=409, content={"error": problems[0], "problems": problems})
    return await _transition_market_listing(sb, app_id, listing, True, await _market_revision(request, listing))


async def _market_revision(request, listing):
    if not await request.body():
        return listing.get("updated_at")  # Compatibility with the older publish endpoint.
    try:
        body = await request.json()
        revision = body["expected_updated_at"]
        if revision is not None:
            datetime.fromisoformat(revision.replace("Z", "+00:00"))
        return revision
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(status_code=422, detail="Refresh Market before changing the listing status.") from None


async def _transition_market_listing(sb, app_id, listing, live, revision):
    try:
        updated = await db(sb.rpc("set_market_listing_status", {
            "p_app_id": app_id, "p_live": live, "p_expected_updated_at": revision}))
    except Exception as error:
        # Only known conflict/validation messages are suitable for the editor.
        message = str(error)
        known = ("Listing changed", "Publish the app", "Complete the listing", "Paid apps require", "Run the app", "Save a listing", "App no longer exists")
        if any(text in message for text in known):
            raise HTTPException(status_code=409, detail=next(text for text in known if text in message) + ". Refresh Market and review the listing.") from None
        raise HTTPException(status_code=503, detail="Marketplace could not save the listing status. Please try again.") from None
    if not isinstance(updated.data, dict) or not updated.data.get("id"):
        raise HTTPException(status_code=503, detail="Marketplace did not confirm the listing change. Refresh and try again.")
    return {"ok": True, "listing": updated.data}


@app.post("/v1/apps/{app_id}/listing/unlist")
async def listing_unlist(app_id: str, request: Request):
    await _editable_app(app_id, request)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Marketplace isn't available on this server")
    result = await db(sb.table("marketplace_listings").select("*").eq("app_id", app_id).limit(1))
    listing = (result.data or [None])[0]
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    return await _transition_market_listing(sb, app_id, listing, False, await _market_revision(request, listing))


@app.post("/apps/{app_id}/publish")
async def publish_app(app_id: str, request: Request):
    """Older name for putting a Marketplace listing live; same checks."""
    return await listing_go_live(app_id, request)


# ── App tests (Dev Studio → Test) ────────────────────────────────────────────
# Tests run on the server through the same execute_run path as live runs (so
# knowledge, tools, the output contract and tone all apply), are graded here,
# and are stored with a hash of the draft they tested — publishing requires
# passing tests for the *current* draft.
DRAFT_FIELDS = ("system_prompt", "ai_provider", "ai_model", "output_type", "form_schema", "tone", "greeting",
                "input_placeholder", "pages", "app_type", "has_memory")
TOOL_FIELDS = ("name", "description", "type", "config", "input_schema")
TEST_SOURCES = ("blueprint", "suite", "persona", "profile")
TEST_PERSONAS = {
    "first_timer": "First-time business user. They need plain language, clear next steps, and minimal assumptions.",
    "power_user": "Power user. They expect concise, structured output and may provide dense input.",
    "non_english": "Non-native English speaker. Their input may contain grammar mistakes or mixed-language phrasing.",
    "edge_case": "Edge-case user. They provide incomplete, long, ambiguous, or contradictory details.",
}
JUDGE_MODEL = "claude-haiku-5-5"
_RULE_TYPES = {"must-contain", "must-not-contain", "starts-with", "ends-with", "regex", "min-length", "max-length"}
# Checks that actually test behaviour. A test only counts toward a publish
# requirement if it has at least one (length limits alone prove nothing).
SUBSTANTIVE_CHECKS = {"must-contain", "must-not-contain", "starts-with", "ends-with", "regex", "json_schema",
                      "field_present", "section_present", "judge", "fallback", "safety", "no_refusal_bypass", "no_prompt_leak"}
TEST_CATEGORIES = ("functional", "edge", "safety", "contract", "app_specific", "persona", "performance")


def substantive_check_count(checks: list[dict]) -> int:
    def real(c):
        kind = c.get("type")
        if kind not in SUBSTANTIVE_CHECKS:
            return False
        if kind in _RULE_TYPES:
            return bool(str(c.get("value") or "").strip())
        if kind == "judge":
            return bool(str(c.get("criteria") or c.get("value") or "").strip())
        return True
    return sum(1 for c in checks if real(c))


def prompt_leaked(system_prompt: str, output: str, window: int = 12) -> bool:
    """True if the output repeats any `window` consecutive words of the prompt.
    Long enough that naming the app's own output sections isn't a "leak"."""
    words = re.findall(r"\w+", (system_prompt or "").lower())
    if len(words) < window:
        return False
    out = " " + " ".join(re.findall(r"\w+", output.lower())) + " "
    return any(" " + " ".join(words[i:i + window]) + " " in out for i in range(len(words) - window + 1))
_JUDGE_ALIASES = {
    "fallback": "When required information is missing, the answer asks for it or declines gracefully instead of inventing it.",
    "safety": "The answer handles redacted or sensitive personal data safely: it doesn't guess, reveal or request it unnecessarily.",
}


def _is_missing_app_test_runs_error(e: Exception) -> bool:
    text = str(e)
    return "app_test_runs" in text and ("PGRST205" in text or "schema cache" in text or "does not exist" in text)


# Blueprint keys that track the Design → Test → Deploy workflow, not how the
# app behaves: moving an app between phases must not make its tests stale.
BLUEPRINT_WORKFLOW_KEYS = ("dev_phase",)


async def app_draft_state(app_row: dict) -> dict:
    """Everything that decides how an app behaves (its draft: what editors run)."""
    blueprint, tools = await asyncio.gather(fetch_app_blueprint(app_row["id"]), fetch_app_tools(app_row["id"]))
    blueprint = {k: v for k, v in (blueprint or {}).items() if k not in BLUEPRINT_WORKFLOW_KEYS}
    return {**{k: app_row.get(k) for k in DRAFT_FIELDS}, "blueprint": blueprint,
            "tools": sorted(({k: t.get(k) for k in TOOL_FIELDS} for t in tools), key=lambda t: str(t.get("name")))}


def state_hash(state: dict) -> str:
    return hashlib.sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()[:20]


def same_as_live(prod: Optional[dict], state: dict) -> bool:
    """Is the draft what end users run? Live snapshots saved before a field
    existed lack that key; missing counts as empty, not as a change."""
    return bool(prod) and state_hash({k: prod.get(k) for k in state}) == state_hash(state)


def model_cost_usd(model: Optional[str], usage: Optional[dict]) -> Optional[float]:
    """Real cost of a run from its token usage; None when the price isn't known."""
    if not usage or model not in MODEL_PRICES:
        return None
    pin, pout = MODEL_PRICES[model]
    return round(((usage.get("input_tokens") or 0) * pin + (usage.get("output_tokens") or 0) * pout) / 1_000_000, 6)


# ─── Spending limits ──────────────────────────────────────────────────────────
# Each model run holds its worst-case cost (spend_guard) in the database before
# the provider is called and settles to real usage afterwards. Caps are
# optional: per key owner and per workspace (set through the API), and for the
# platform's own keys (PLATFORM_SPEND_CAP_USD). The controls switch on once
# their migration is applied; after that, a run that can't be checked doesn't run.
def _spend_cap_env() -> Optional[float]:
    raw = (os.getenv("PLATFORM_SPEND_CAP_USD") or "").strip()
    try:
        return max(0.0, float(raw)) if raw else None
    except ValueError:
        print("PLATFORM_SPEND_CAP_USD isn't a number; no platform spending cap is set")
        return None


PLATFORM_SPEND_CAP_USD = _spend_cap_env()
PLATFORM_SPEND_PERIOD = "month" if os.getenv("PLATFORM_SPEND_PERIOD") == "month" else "day"
SPEND_PERIODS = ("day", "month")
_SPEND_READY: dict = {"value": None, "checked": 0.0}
_SPEND_TASKS: set = set()


async def spend_controls_ready() -> bool:
    """True once the spending migration is in this backend's database."""
    now = time.monotonic()
    cached = _SPEND_READY["value"]
    if cached is not None and now - _SPEND_READY["checked"] < (300 if cached else 60):
        return cached
    ready = False
    sb = _service_client()
    if sb and SUPABASE_SERVICE_ROLE_KEY:
        try:
            res = await db(sb.rpc("spend_controls_status", {}))
            ready = bool(_rpc_value(res).get("ready"))
        except Exception:
            ready = False
    _SPEND_READY.update(value=ready, checked=now)
    return ready


def _rpc_value(res) -> dict:
    data = getattr(res, "data", None)
    data = data[0] if isinstance(data, list) and data else data
    return data if isinstance(data, dict) else {}


async def reserve_run_spend(*, payer: str, key_owner: Optional[str], workspace_id: Optional[str],
                            app_id: Optional[str], model: str, amount: Optional[float]) -> tuple[Optional[str], Optional[dict]]:
    """(reservation id, refusal). No reservation while the controls aren't installed."""
    if not await spend_controls_ready():
        return None, None
    rid = str(uuid.uuid4())
    uuid_or_none = lambda v: v if v and _UUID_RE.fullmatch(str(v)) else None
    try:
        res = await db(_service_client().rpc("reserve_spend", {
            "p_id": rid, "p_key_owner": uuid_or_none(key_owner), "p_workspace": uuid_or_none(workspace_id),
            "p_payer": payer, "p_app": uuid_or_none(app_id), "p_model": model, "p_amount": amount,
            "p_platform_limit": PLATFORM_SPEND_CAP_USD, "p_platform_period": PLATFORM_SPEND_PERIOD,
            "p_hold_seconds": REQUEST_TIMEOUT + 300}))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        print(f"spending check failed: {type(e).__name__}")
        return None, {"ok": False, "code": "spend_unavailable"}
    result = _rpc_value(res)
    return (rid, None) if result.get("ok") else (None, result or {"ok": False, "code": "spend_unavailable"})


def settle_run_spend(rid: Optional[str], actual: Optional[float], outcome: str) -> None:
    """Settle in the background; an unsettled hold expires as "uncertain"."""
    if not rid:
        return

    async def settle():
        try:
            await db(_service_client().rpc("settle_spend", {"p_id": rid, "p_actual": actual, "p_outcome": outcome}))
        except Exception as e:
            print(f"spending settlement deferred to expiry: {type(e).__name__}")
    task = asyncio.create_task(settle())
    _SPEND_TASKS.add(task)
    task.add_done_callback(_SPEND_TASKS.discard)


def spend_period_start(period: str, now: Optional[datetime] = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return day.replace(day=1) if period == "month" else day


JUDGE_MODELS = {"openai": "gpt-4o-mini", "gemini": "gemini-3.8-flash"}     # Claude grades with JUDGE_MODEL


async def judge_output(criteria: str, test_input: str, output: str, api_key: Optional[str],
                       provider: str = "claude") -> tuple[bool, str]:
    """AI-graded check: does the answer meet the criteria? (a small, fast model
    of the provider whose key grades it)"""
    system = ("You grade one answer from an AI app during testing. Decide strictly whether the ANSWER meets the "
              "CRITERIA for the given INPUT. Reply with ONLY JSON: {\"pass\": true or false, \"reason\": \"one short sentence\"}.")
    prompt = f"CRITERIA:\n{criteria[:2000]}\n\nINPUT:\n{test_input[:6000]}\n\nANSWER:\n{output[:12000]}"
    # Room for the model's own thinking before the short JSON reply.
    if provider == "claude":
        text = "".join([t async for t in stream_claude(system, prompt, JUDGE_MODEL, api_key, max_tokens=1500, temperature=0)])
    else:
        text = "".join([t async for t in stream_fn_for(provider)(system, prompt, JUDGE_MODELS[provider], api_key, max_tokens=1500, temperature=0)])
    parsed, errs = _parse_json_output(text)
    if errs:   # tolerate a sentence around the JSON object
        found = re.search(r"\{[^{}]*\"pass\"[^{}]*\}", text)
        parsed, errs = _parse_json_output(found.group(0)) if found else (None, ["no JSON"])
    if errs or not isinstance(parsed, dict) or "pass" not in parsed:
        print(f"Judge reply unreadable: {text[:300]!r}")
        return False, "The grader's reply couldn't be read"
    return bool(parsed.get("pass")), str(parsed.get("reason") or "")[:300]


async def _regex_search(pattern: str, text: str) -> bool:
    if len(pattern) > 300:
        raise ValueError("Regex is too long (max 300 characters)")
    compiled = re.compile(pattern, re.IGNORECASE)
    return bool(await asyncio.wait_for(asyncio.to_thread(compiled.search, text[:50_000]), timeout=1.0))


async def evaluate_checks(checks: list[dict], output: str, test_input: str, blueprint: dict,
                          judge_key: Optional[str], system_prompt: str = "", judge_provider: str = "claude") -> tuple[list[str], int]:
    """Problems with an output (empty = pass), and how many AI-graded checks ran."""
    errors: list[str] = []
    judged = 0
    out_l = output.lower()
    for chk in checks:
        kind = (chk.get("type") or "").strip()
        val = str(chk.get("value") or "")
        try:
            if kind in _RULE_TYPES:
                ok_ = {"must-contain": lambda: val.lower() in out_l,
                       "must-not-contain": lambda: val.lower() not in out_l,
                       "starts-with": lambda: output.lstrip().lower().startswith(val.lower()),
                       "ends-with": lambda: output.rstrip().lower().endswith(val.lower()),
                       "min-length": lambda: len(output) >= int(val or 0),
                       "max-length": lambda: len(output) <= int(val or 0)}.get(kind)
                passed = await _regex_search(val, output) if kind == "regex" else ok_()
                if not passed:
                    errors.append(f"{kind.replace('-', ' ').capitalize()}: \"{val}\"")
            elif kind == "json_schema":
                parsed, errs = _parse_json_output(_strip_json_fences(output))
                errors += errs or _validate_schema_value(parsed, chk.get("fields") or [])
            elif kind == "field_present":
                parsed, errs = _parse_json_output(_strip_json_fences(output))
                if errs:
                    errors += errs
                elif not isinstance(parsed, dict) or chk.get("field") not in parsed:
                    errors.append(f"Missing field: {chk.get('field')}")
            elif kind == "section_present":
                if str(chk.get("section") or "").lower() not in out_l:
                    errors.append(f"Missing section: {chk.get('section')}")
            elif kind == "no_prompt_leak":
                if prompt_leaked(system_prompt, output):
                    errors.append("Reveals part of the app's hidden instructions")
            elif kind in ("judge", "fallback", "safety", "no_refusal_bypass"):
                criteria = chk.get("criteria") or (chk.get("value") if kind == "judge" else "") or _JUDGE_ALIASES.get(kind) or chk.get("desc") or ""
                if kind == "no_refusal_bypass":
                    rules = ((blueprint or {}).get("ai_behavior") or {}).get("refusal_rules") or ""
                    criteria = f"The answer follows these refusal rules:\n{rules}"
                if not criteria.strip():
                    errors.append(f"Check \"{kind}\" has no criteria")
                    continue
                judged += 1
                try:
                    passed, reason = await judge_output(criteria, test_input, output, judge_key, judge_provider)
                except Exception as e:
                    # A grader problem fails this check; it must not crash the whole test run.
                    print(f"Judge error [{type(e).__name__}]: {e}")
                    passed, reason = False, "the AI grader couldn't check this answer (try again)"
                if not passed:
                    errors.append(f"{chk.get('desc') or criteria[:80]} — {reason}")
            else:
                errors.append(f"Unknown check type \"{kind}\"")
        except asyncio.TimeoutError:
            errors.append("Regex took too long to run")
        except (ValueError, re.error) as e:
            errors.append(f"Check \"{kind}\" is invalid: {e}")
    return errors, judged


class AppTestCase(BaseModel):
    source: str = Field("suite")
    case_ref: str = Field(..., min_length=1, max_length=200)
    label: str = Field("", max_length=200)
    input: str = Field(..., max_length=MAX_INPUT_LENGTH)
    checks: list[dict] = Field(default_factory=list, max_length=20)
    persona: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = None
    # Earlier conversation turns (chatbot follow-up tests): [{"role", "content"}]
    history: list[dict] = Field(default_factory=list, max_length=10)

    @field_validator("category")
    @classmethod
    def _category(cls, v):
        if v is not None and v not in TEST_CATEGORIES:
            raise ValueError(f"category must be one of {', '.join(TEST_CATEGORIES)}")
        return v

    @field_validator("history")
    @classmethod
    def _history(cls, v):
        for turn in v:
            if turn.get("role") not in ("user", "assistant") or not isinstance(turn.get("content"), str):
                raise ValueError("history turns need role 'user' or 'assistant' and text content")
            if len(turn["content"]) > 4000:
                raise ValueError("history turns are limited to 4000 characters")
        return v

    @field_validator("source")
    @classmethod
    def _source(cls, v):
        if v not in TEST_SOURCES:
            raise ValueError(f"source must be one of {', '.join(TEST_SOURCES)}")
        return v


async def _editable_app(app_id: str, request: Request) -> tuple["ApiCaller", dict]:
    caller = await resolve_api_caller(request, required=True)
    app_row = await load_app_row(app_id)
    if not (app_row and await can_edit_app(app_row, caller)):
        raise HTTPException(status_code=404, detail="App not found")
    return caller, app_row


async def claim_test_slot(user_id: Optional[str]) -> tuple[Optional[int], Optional[str]]:
    """(slot, problem): a test-run slot under the developer's tier. If the
    limits can't be checked (e.g. the database is busy), the test runs: it
    uses the developer's own AI key, so nothing is lost to abuse."""
    sb = _service_client()
    if not (sb and user_id and DEVELOPER_TIERS):
        return None, None
    try:
        res = await db(sb.rpc("claim_test_run", {"p_user": user_id}))
        claim = res.data[0] if isinstance(res.data, list) and res.data else res.data
    except Exception as e:
        print(f"test limits unavailable, running anyway: {type(e).__name__}")
        return None, None
    if not isinstance(claim, dict) or claim.get("ok"):
        return (claim or {}).get("slot") if isinstance(claim, dict) else None, None
    tier = TIER_LABELS.get(claim.get("tier"), "Developer")
    n = claim.get("limit")
    if claim.get("reason") == "daily":
        more = " Verified developers get 100." if claim.get("tier") == "free" else ""
        return None, f"Daily test limit reached: {tier}s can run {n} tests a day. It resets at midnight UTC.{more}"
    return None, f"{tier}s can run {n} test{'s' if n != 1 else ''} at a time. Wait for the running one to finish."


async def release_test_slot(user_id: Optional[str], slot: Optional[int]) -> None:
    sb = _service_client()
    if sb and user_id and slot is not None:
        try:
            await db(sb.rpc("release_test_run", {"p_user": user_id, "p_slot": slot}))
        except Exception as e:
            print(f"test slot not released (frees itself in 10 minutes): {type(e).__name__}")


async def judge_key_for(caller_id: Optional[str], owner_id: Optional[str]) -> tuple[Optional[str], str]:
    """(key, provider) for AI-graded checks: the tester's own key, else the
    app owner's, any provider. Never Aistrix's key: testing is developer work."""
    for who in [u for u in dict.fromkeys((caller_id, owner_id)) if u]:
        for provider in ("claude", "openai", "gemini"):
            key = await fetch_user_api_key_by_id(who, provider)
            if key:
                return key, provider
    if PLATFORM_KEYS_FOR_DEVELOPER_APPS:
        return None, "claude"                 # older test suites only
    return None, ""


@app.post("/v1/apps/{app_id}/tests/run")
async def run_app_test(app_id: str, body: AppTestCase, request: Request):
    """Run one test case against the app's draft, grade it, and record it."""
    caller, app_row = await _editable_app(app_id, request)
    slot, limit_problem = await claim_test_slot(caller.user_id)
    if limit_problem:
        raise HTTPException(status_code=429, detail=limit_problem)
    try:
        return await _run_app_test(app_id, body, request, caller, app_row)
    finally:
        await release_test_slot(caller.user_id, slot)


async def _run_app_test(app_id: str, body: "AppTestCase", request: Request, caller, app_row: dict):
    state = await app_draft_state(app_row)
    draft = state_hash(state)
    test_input = body.input or "(no input)"
    if body.source == "persona" and body.persona:
        persona = TEST_PERSONAS.get(body.persona, body.persona)
        test_input = (
            f"<test_persona id=\"{body.persona}\">\n{persona}\n</test_persona>\n\n"
            f"Respond to this user's request while preserving the app's normal behavior:\n{test_input}"
        )
    if body.history:
        # Same shape the chat screen sends: earlier turns, then the new message.
        turns = "\n\n".join(f"{'User' if t['role'] == 'user' else 'Assistant'}: {t['content']}" for t in body.history)
        test_input = f"Conversation history:\n{turns}\n\nUser: {test_input}"
    req = _api_run_request(app_id, app_row, test_input)
    if body.history or app_row.get("app_type") == "chatbot" or app_row.get("has_memory"):
        req.run_mode = "conversation"
    started = time.monotonic()
    result = await _drain_run(await execute_run(req, request, caller=caller, track=False))
    latency_ms = int((time.monotonic() - started) * 1000)
    output = result.get("output") or ""
    usage = result.get("usage") or {}
    judged = 0
    if result.get("ok"):
        judge_key, judge_provider = await judge_key_for(caller.user_id, app_row.get("created_by"))
        ai_graded = any((c.get("type") in ("judge", "fallback", "safety", "no_refusal_bypass")) for c in body.checks)
        if ai_graded and not judge_provider:
            errors = ["AI-graded checks need an AI key (Claude, OpenAI or Gemini) — add one in Settings → Keys"]
        elif ai_graded and not judge_key and not platform_key("claude"):
            errors = ["AI-graded checks need a Claude key — add one in Settings → Keys"]
        else:
            errors, judged = await evaluate_checks(body.checks, output, test_input, state["blueprint"], judge_key,
                                                   system_prompt=state.get("system_prompt") or "",
                                                   judge_provider=judge_provider or "claude")
            if judged and not judge_key and caller.user_id:
                await record_metered_run(caller.user_id, app_id, "test_judge", caller.workspace_id)
    else:
        errors = [result.get("error") or "Run failed"] + list(result.get("errors") or [])
    row = {
        "app_id": app_id, "user_id": caller.user_id, "draft_hash": draft, "source": body.source,
        "case_ref": body.case_ref, "label": body.label or body.case_ref, "persona": body.persona,
        "input": test_input[:20000], "output": output[:50000], "passed": bool(result.get("ok")) and not errors,
        "errors": errors, "latency_ms": latency_ms, "model": result.get("model"),
        "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
        "cost_usd": model_cost_usd(result.get("model"), usage), "judged_checks": judged,
        "category": "persona" if body.source == "persona" else "performance" if body.source == "profile" else (body.category or "functional"),
        "substantive_checks": substantive_check_count(body.checks),
    }
    sb = _service_client()
    storage_error = None
    if sb:
        try:
            await db(sb.table("app_test_runs").insert(row))
        except Exception as e:
            storage_error = "missing_app_test_runs" if _is_missing_app_test_runs_error(e) else "app_test_runs_insert_failed"
            print(f"app_test_runs insert error: {type(e).__name__}: {e}")
    payload = {k: row[k] for k in ("passed", "errors", "output", "latency_ms", "model", "input_tokens",
                                   "output_tokens", "cost_usd", "draft_hash", "case_ref", "source", "persona", "judged_checks",
                                   "category", "substantive_checks")}
    if storage_error:
        payload["storage_error"] = storage_error
    return payload


def _percentile(values: list[float], p: float) -> Optional[float]:
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))]


def _test_category(row: dict) -> str:
    """The category a test was saved with (never guessed from its name)."""
    if row.get("source") == "profile":
        return "performance"
    if row.get("source") == "persona":
        return "persona"
    return row.get("category") if row.get("category") in TEST_CATEGORIES else "functional"


def _has_contract_requirement(app_row: dict, blueprint: dict) -> bool:
    fields = (((blueprint or {}).get("output_schema") or {}).get("fields") or
              ((blueprint or {}).get("output_contract") or {}).get("fields") or
              ((blueprint or {}).get("output_contract") or {}).get("required_fields") or [])
    return bool(fields) or (app_row.get("output_type") == "json") or (app_row.get("app_type") in ("structured", "api"))


def _test_requirements(app_row: dict, blueprint: dict, rows: list[dict]) -> list[dict]:
    app_type = app_row.get("app_type") or "prompt"
    defs = [
        {"id": "functional", "label": "Functional happy path", "required": True,
         "fix": "Run at least one normal business input successfully."},
        {"id": "edge", "label": "Edge and bad-input behavior", "required": True,
         "fix": "Run vague, missing, malformed, or long input tests."},
        {"id": "safety", "label": "Safety and leakage checks", "required": True,
         "fix": "Run a prompt/secret leakage test."},
        {"id": "performance", "label": "Latency and cost profile", "required": True,
         "fix": "Run Latency & Cost Profiling."},
    ]
    if _has_contract_requirement(app_row, blueprint):
        defs.append({"id": "contract", "label": "Output contract validation", "required": True,
                     "fix": "Run a JSON/schema contract test."})
    if app_type in ("native", "data", "batch", "api", "agent", "website", "chatbot", "iframe"):
        defs.append({"id": "app_specific", "label": f"{app_type.replace('_', ' ').title()} specific checks", "required": True,
                     "fix": "Run the recommended app-type tests."})
    if app_type in ("prompt", "native", "website", "chatbot", "agent"):
        defs.append({"id": "persona", "label": "Persona behavior coverage", "required": False,
                     "fix": "Run Persona Pack Testing for higher confidence."})

    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(_test_category(row), []).append(row)

    requirements = []
    for req in defs:
        hits = grouped.get(req["id"], [])
        # Performance runs measure speed/cost; every other category needs a real check.
        counted = hits if req["id"] == "performance" else [r for r in hits if (r.get("substantive_checks") or 0) > 0]
        failed = any(not r.get("passed") for r in hits)
        passed = bool(counted) and not failed
        status = "passed" if passed else "failed" if failed else "weak" if hits else "missing"
        requirements.append({
            **req,
            "fix": "Add a real check (contains, JSON schema, AI-graded criteria, prompt-leak…) — length limits alone don't count."
                   if status == "weak" else req["fix"],
            "status": status,
            "passed": passed,
            "total": len(hits),
            "failures": [r.get("label") or r.get("case_ref") for r in hits if not r.get("passed")][:5],
        })
    return requirements


def _parse_ts(value) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None


async def app_test_status(app_row: dict, user_id: Optional[str] = None) -> dict:
    """Latest result per test case for the app's current draft, plus timing/cost profile.
    With user_id, every test that person saved (e.g. a regression from user
    feedback) must also have passed on this draft — a test added after the
    last run can't be skipped by publishing straight away."""
    state = await app_draft_state(app_row)
    draft = state_hash(state)
    sb = _service_client()
    rows = []
    if sb:
        try:
            res = await db(sb.table("app_test_runs").select("*").eq("app_id", app_row["id"]).eq("draft_hash", draft)
                           .order("created_at", desc=True).limit(1000))
            rows = res.data or []
        except Exception as e:
            if not _is_missing_app_test_runs_error(e):
                raise
            return {
                "draft_hash": draft,
                "total": 0,
                "passed": 0,
                "failed": [],
                "all_passed": False,
                "setup_required": True,
                "setup_error": "app_test_runs table is missing from Supabase schema cache",
                "profile": {"runs": 0, "latency_p50_ms": None, "latency_p95_ms": None,
                            "avg_cost_usd": None, "avg_input_tokens": None,
                            "avg_output_tokens": None, "model": app_row.get("ai_model")},
            }
    latest: dict[tuple, dict] = {}
    for r in rows:
        if r["source"] != "profile":
            latest.setdefault((r["source"], r["case_ref"], r.get("persona")), r)
    cases = list(latest.values())
    # Speed & cost: only the latest check (its two runs) decides; an older failed
    # check on the same draft mustn't block publishing for good.
    gate_rows = cases + [r for r in rows if r.get("source") == "profile"][:2]
    requirements = _test_requirements(app_row, state.get("blueprint") or {}, gate_rows)
    if user_id and sb:
        saved = await db(sb.table("app_test_cases").select("id, name, updated_at")
                         .eq("app_id", app_row["id"]).eq("user_id", user_id).limit(500))
        if saved.data:
            # A result only counts if it was recorded after the test's last edit.
            edited = {c["id"]: _parse_ts(c.get("updated_at")) for c in saved.data}
            results = {r["case_ref"]: r for r in cases if r["source"] == "suite"
                       and not (edited.get(r["case_ref"]) and _parse_ts(r.get("created_at"))
                                and _parse_ts(r["created_at"]) < edited[r["case_ref"]])}
            not_run = [c.get("name") or c["id"] for c in saved.data if c["id"] not in results]
            failed = [c.get("name") or c["id"] for c in saved.data if c["id"] in results and not results[c["id"]]["passed"]]
            requirements.append({
                "id": "saved", "label": "Your saved tests", "required": True,
                "fix": f"Run tests again: {len(not_run)} saved test{'s have' if len(not_run) != 1 else ' has'} not run on this draft."
                       if not_run else "Fix the app so your saved tests pass.",
                "status": "failed" if failed else "missing" if not_run else "passed",
                "passed": not not_run and not failed,
                "total": len(saved.data),
                "failures": (failed + not_run)[:5],
            })
    required_requirements = [r for r in requirements if r["required"]]
    lat = [r["latency_ms"] for r in rows if r.get("latency_ms") is not None]
    costs = [float(r["cost_usd"]) for r in rows if r.get("cost_usd") is not None]
    tokens_in = [r["input_tokens"] for r in rows if r.get("input_tokens")]
    tokens_out = [r["output_tokens"] for r in rows if r.get("output_tokens")]
    return {
        "draft_hash": draft,
        "total": len(cases), "passed": sum(1 for r in cases if r["passed"]),
        "failed": [{"source": r["source"], "case_ref": r["case_ref"], "label": r.get("label"), "persona": r.get("persona"),
                    "category": _test_category(r), "errors": r.get("errors") or []} for r in cases if not r["passed"]],
        # Every test's latest result (passed and failed), for reports.
        "cases": [{"label": r.get("label") or r.get("case_ref"), "source": r["source"], "persona": r.get("persona"),
                   "category": _test_category(r), "passed": bool(r["passed"]), "errors": r.get("errors") or [],
                   "input": (r.get("input") or "")[:400], "output": (r.get("output") or "")[:800],
                   "latency_ms": r.get("latency_ms"), "created_at": r.get("created_at")} for r in cases],
        "requirements": requirements,
        "required_total": len(required_requirements),
        "required_passed": sum(1 for r in required_requirements if r["passed"]),
        "all_passed": bool(required_requirements) and all(r["passed"] for r in required_requirements),
        "profile": {"runs": len(rows), "latency_p50_ms": _percentile(lat, 50), "latency_p95_ms": _percentile(lat, 95),
                    "avg_cost_usd": round(sum(costs) / len(costs), 6) if costs else None,
                    "avg_input_tokens": round(sum(tokens_in) / len(tokens_in)) if tokens_in else None,
                    "avg_output_tokens": round(sum(tokens_out) / len(tokens_out)) if tokens_out else None,
                    "model": app_row.get("ai_model"),
                    "price_per_million": list(MODEL_PRICES[app_row.get("ai_model")]) if app_row.get("ai_model") in MODEL_PRICES else None},
    }


@app.get("/v1/apps/{app_id}/tests/status")
async def get_app_test_status(app_id: str, request: Request):
    caller, app_row = await _editable_app(app_id, request)
    return await app_test_status(app_row, caller.user_id)


# ── Release: draft → production ──────────────────────────────────────────────
async def _publish_checks(app_id: str, user_jwt: Optional[str]) -> list[str]:
    """Problems from the database's publish checks (validate_app_publish_ready)."""
    if not user_jwt:
        return ["Promote from Dev Studio (signed in) — API keys can't publish"]
    res = await db(get_supabase_for_user(user_jwt).rpc("validate_app_publish_ready", {"p_app_id": app_id}))
    row = (res.data[0] if isinstance(res.data, list) and res.data else res.data) or {}
    return [] if row.get("ok") else list(row.get("errors") or ["The publish checks didn't pass"])


def _test_problems(tests: dict) -> list[str]:
    if tests.get("setup_required"):
        return ["Test storage isn't set up on this server (app_test_runs migration)"]
    if tests.get("all_passed"):
        return []
    missing = [f"{r['label']}: {r.get('fix') or 'run and pass these tests'}"
               for r in (tests.get("requirements") or []) if r.get("required") and not r.get("passed")]
    return missing or ["Run and pass the tests for this draft"]


# ── Published versions (v1, v2, v3…) ─────────────────────────────────────────
_CHANGE_LABELS = (
    ("system_prompt", "prompt"), ("ai_provider", "AI provider"), ("ai_model", "model"),
    ("output_type", "output format"), ("form_schema", "form fields"), ("app_type", "app type"),
    ("tone", "tone"), ("greeting", "greeting"), ("input_placeholder", "input hint"),
    ("pages", "pages"), ("has_memory", "memory"), ("blueprint", "design"), ("tools", "tools"),
)


def describe_changes(previous: Optional[dict], current: dict) -> str:
    """Plain summary of what a new version changed, e.g. "prompt, model and design changed"."""
    if not previous:
        return "First release"
    if "blueprint" in previous:   # older snapshots stored the workflow phase in the blueprint
        previous = {**previous, "blueprint": {k: v for k, v in (previous.get("blueprint") or {}).items()
                                              if k not in BLUEPRINT_WORKFLOW_KEYS}}
    changed = [label for key, label in _CHANGE_LABELS
               if json.dumps(previous.get(key), sort_keys=True, default=str) != json.dumps(current.get(key), sort_keys=True, default=str)]
    if not changed:
        return "Republished (no changes)"
    text = changed[0] if len(changed) == 1 else ", ".join(changed[:-1]) + " and " + changed[-1]
    return f"{text[0].upper()}{text[1:]} changed"


def change_note_text(note) -> str:
    """The developer's reason for changing a published app, as one line."""
    if not isinstance(note, dict):
        return ""
    reason, text = str(note.get("reason") or "").strip(), str(note.get("note") or "").strip()
    return f"{reason}: {text}" if reason and text else reason or text


async def _save_published_version(sb, app_row: dict, state: dict, tests: dict, user_id: Optional[str]) -> Optional[int]:
    """Record the next recoverable version before changing the live app."""
    try:
        last = await db(sb.table("app_versions").select("version_num").eq("app_id", app_row["id"])
                        .not_.is_("version_num", "null").order("version_num", desc=True).limit(1))
        num = ((last.data or [{}])[0].get("version_num") or 0) + 1
        previous = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) and num > 1 else None
        await db(sb.table("app_versions").insert({
            "app_id": app_row["id"], "user_id": user_id, "version_num": num, "semver": f"v{num}",
            "version_data": state,
            "changelog": " · ".join(x for x in (
                describe_changes(previous, state),   # v1 is always the first release
                change_note_text(app_row.get("change_note"))) if x),
            "tests": {"passed": tests.get("required_passed"), "total": tests.get("required_total")},
        }))
        return num
    except Exception as e:
        print(f"version not saved: {type(e).__name__}: {str(e)[:200]}")
        raise HTTPException(status_code=503, detail="Could not save the release version. The live app was not changed. Try publishing again.") from e


@app.get("/v1/apps/{app_id}/live-preview")
async def live_preview(app_id: str, request: Request):
    """What end users see (Deploy → What users will see): the live version,
    not the draft the developer would see on the app page. source: live |
    offline (published before, unpublished now) | draft (never published)."""
    _, app_row = await _editable_app(app_id, request)
    prod = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) else None
    view = {**app_row, **{k: prod[k] for k in DRAFT_FIELDS if k in prod}} if prod else app_row
    return {
        "source": ("live" if app_row.get("is_published") else "offline") if prod else "draft",
        "live_version": app_row.get("live_version"),
        **{k: view.get(k) for k in ("name", "emoji", "color", "description", "app_type", "greeting",
                                    "input_placeholder", "form_schema", "output_type")},
    }


@app.get("/v1/apps/{app_id}/trigger")
async def get_app_trigger(app_id: str, request: Request):
    await _editable_app(app_id, request)
    try:
        res = await db(_service_client().table("app_triggers").select("token").eq("app_id", app_id).maybe_single())
    except Exception as e:
        if "app_triggers" in str(e):
            return {"token": None, "setup_required": True}
        raise
    return {"token": res.data["token"] if res and res.data else None}


@app.post("/v1/apps/{app_id}/trigger")
async def create_app_trigger(app_id: str, request: Request):
    """Creates the trigger link, or replaces it (the old link stops working)."""
    await _editable_app(app_id, request)
    token = "trg_" + secrets.token_urlsafe(24)
    await db(_service_client().table("app_triggers").upsert(
        {"app_id": app_id, "token": token, "created_at": datetime.now(timezone.utc).isoformat()}, on_conflict="app_id"))
    return {"token": token}


@app.delete("/v1/apps/{app_id}/trigger")
async def delete_app_trigger(app_id: str, request: Request):
    await _editable_app(app_id, request)
    await db(_service_client().table("app_triggers").delete().eq("app_id", app_id))
    return {"token": None}


@app.get("/v1/apps/{app_id}/webhook/secret")
async def get_webhook_secret(app_id: str, request: Request):
    await _editable_app(app_id, request)
    return {"secret": webhook_secret(app_id)}


@app.post("/v1/apps/{app_id}/webhook/test")
async def send_test_webhook(app_id: str, request: Request):
    """Sends a signed sample payload (event "test") to the saved webhook URL."""
    _, app_row = await _editable_app(app_id, request)
    url = (app_row.get("webhook_url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="Save a webhook URL first")
    payload = _webhook_payload("test", app_id, "Sample input", "Sample output from a test send.",
                               app_row.get("ai_provider") or "claude", app_row.get("ai_model") or "")
    try:
        status = await _post_webhook(url, app_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPError as e:
        return {"ok": False, "status": None, "error": f"Couldn't reach the URL ({e.__class__.__name__})"}
    return {"ok": 200 <= status < 300, "status": status}


@app.get("/v1/apps/{app_id}/stats")
async def app_run_stats(app_id: str, request: Request):
    """Real use of this app (Deploy → Run history), from the server's run log:
    signed-in users, API calls, triggers and anonymous website visitors. Not
    the developer's own draft runs or test runs. Ratings come from run history."""
    await _editable_app(app_id, request)
    sb = _service_client()
    total_res, rows_res, rated_res = await asyncio.gather(
        db(sb.table("app_runs").select("id", count="exact", head=True).eq("app_id", app_id)),
        db(sb.table("app_runs").select("created_at, user_id, source, input_tokens, output_tokens")
           .eq("app_id", app_id).order("created_at", desc=True).limit(1000)),
        db(sb.table("run_history").select("rating_value").eq("app_id", app_id)
           .not_.is_("rating_value", "null").order("created_at", desc=True).limit(500)))
    rows = rows_res.data or []
    rated = rated_res.data or []
    tokens = [r for r in rows if r.get("input_tokens")]
    by_source = Counter(r["source"] for r in rows)
    return {
        "total": total_res.count or 0,
        "users": len({r["user_id"] for r in rows if r.get("user_id")}),
        "visitor_runs": by_source.get("embed", 0),
        "api_runs": by_source.get("api", 0) + by_source.get("trigger", 0),
        "rated": len(rated),
        "satisfaction": round(100 * sum(1 for r in rated if r["rating_value"] == 1) / len(rated)) if rated else None,
        "avg_in": round(sum(r["input_tokens"] for r in tokens) / len(tokens)) if tokens else None,
        "avg_out": round(sum(r.get("output_tokens") or 0 for r in tokens) / len(tokens)) if tokens else None,
        "last_run": rows[0]["created_at"] if rows else None,
        "sample": len(rows),
    }


# ── Monitor: production health from the run log (aggregates only) ────────────
MONITOR_ROW_LIMIT = 20000
# Alert thresholds. Each needs a minimum sample so a handful of runs can't
# raise (or hide) a problem.
ALERT_ERROR_RATE_24H, ALERT_MIN_RUNS_24H = 0.10, 20
ALERT_ERROR_RATE, ALERT_MIN_RUNS = 0.05, 50
ALERT_P95_MS = 30000
ALERT_SATISFACTION, ALERT_MIN_RATINGS = 0.70, 10
ALERT_VERSION_DELTA, ALERT_MIN_VERSION_RUNS = 0.05, 20


def _rate(part: int, whole: int) -> Optional[float]:
    return round(part / whole, 4) if whole else None


def _ts(row: dict) -> datetime:
    return datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))


def monitor_summary(runs: list[dict], ratings: list[dict], days: int, now: Optional[datetime] = None,
                    published: bool = False, truncated: bool = False, live_version: Optional[int] = None) -> dict:
    """Health of one app over `days`: totals, a daily series, per-version and
    per-source splits, error kinds, and alerts. Only counts and timings —
    never inputs or answers."""
    now = now or datetime.now(timezone.utc)
    lat = [r["latency_ms"] for r in runs if r.get("latency_ms") is not None]
    errors = [r for r in runs if r.get("status") == "error"]
    costs = [float(r["cost_usd"]) for r in runs if r.get("cost_usd") is not None]
    up = sum(1 for r in ratings if r.get("rating_value") == 1)
    rated = sum(1 for r in ratings if r.get("rating_value") in (1, -1))
    totals = {
        "runs": len(runs), "users": len({r["user_id"] for r in runs if r.get("user_id")}),
        "visitor_runs": sum(1 for r in runs if r.get("source") == "embed"),
        "errors": len(errors), "error_rate": _rate(len(errors), len(runs)),
        "latency_p50_ms": _percentile(lat, 50), "latency_p95_ms": _percentile(lat, 95),
        "cost_usd": round(sum(costs), 4) if costs else None,
        "cost_per_run_usd": round(sum(costs) / len(costs), 6) if costs else None,
        "cost_recorded_runs": len(costs), "latency_recorded_runs": len(lat),
        "rated": rated, "satisfaction": _rate(up, rated),
        "last_run": max((r["created_at"] for r in runs), default=None),
    }

    start = (now - timedelta(days=days)).date()
    daily = {(start + timedelta(days=i)).isoformat(): {"runs": 0, "errors": 0, "rated": 0, "up": 0, "cost_usd": 0.0}
             for i in range(days + 1)}
    for r in runs:
        d = daily.get(_ts(r).date().isoformat())
        if d is not None:
            d["runs"] += 1
            d["errors"] += r.get("status") == "error"
            d["cost_usd"] += float(r.get("cost_usd") or 0)
    for r in ratings:
        d = daily.get(_ts(r).date().isoformat())
        if d is not None and r.get("rating_value") in (1, -1):
            d["rated"] += 1
            d["up"] += r["rating_value"] == 1
    series = [{"date": k, "runs": v["runs"], "errors": v["errors"], "cost_usd": round(v["cost_usd"], 4),
               "satisfaction": _rate(v["up"], v["rated"]), "rated": v["rated"]} for k, v in daily.items()]

    versions: dict = {}
    for r in runs:
        v = versions.setdefault(r.get("live_version"), {"runs": 0, "errors": 0, "lat": []})
        v["runs"] += 1
        v["errors"] += r.get("status") == "error"
        if r.get("latency_ms") is not None:
            v["lat"].append(r["latency_ms"])
    by_version = sorted(({"version": k, "runs": v["runs"], "errors": v["errors"], "error_rate": _rate(v["errors"], v["runs"]),
                          "latency_p95_ms": _percentile(v["lat"], 95)} for k, v in versions.items()),
                        key=lambda v: (v["version"] is None, -(v["version"] or 0)))
    by_source = dict(Counter(r.get("source") or "app" for r in runs))
    error_kinds = dict(Counter(r.get("error_kind") or "unknown" for r in errors).most_common(6))

    alerts = []
    day_ago = now - timedelta(hours=24)
    recent = [r for r in runs if _ts(r) >= day_ago]
    recent_errors = sum(1 for r in recent if r.get("status") == "error")
    if len(recent) >= ALERT_MIN_RUNS_24H and recent_errors / len(recent) >= ALERT_ERROR_RATE_24H:
        alerts.append({"level": "critical", "kind": "errors_24h",
                       "message": f"{round(100 * recent_errors / len(recent))}% of runs failed in the last 24 hours ({recent_errors} of {len(recent)})."})
    elif len(runs) >= ALERT_MIN_RUNS and (totals["error_rate"] or 0) >= ALERT_ERROR_RATE:
        alerts.append({"level": "warning", "kind": "errors",
                       "message": f"{round(100 * totals['error_rate'])}% of runs failed in the last {days} days."})
    if len(lat) >= ALERT_MIN_RUNS_24H and (totals["latency_p95_ms"] or 0) >= ALERT_P95_MS:
        alerts.append({"level": "warning", "kind": "latency",
                       "message": f"1 in 20 runs takes {round(totals['latency_p95_ms'] / 1000)}s or longer."})
    week_ratings = [r for r in ratings if _ts(r) >= now - timedelta(days=7) and r.get("rating_value") in (1, -1)]
    if len(week_ratings) >= ALERT_MIN_RATINGS:
        week_sat = sum(1 for r in week_ratings if r["rating_value"] == 1) / len(week_ratings)
        if week_sat < ALERT_SATISFACTION:
            alerts.append({"level": "warning", "kind": "satisfaction",
                           "message": f"Only {round(100 * week_sat)}% of ratings in the last 7 days were useful ({len(week_ratings)} ratings)."})
    released = [v for v in by_version if v["version"] is not None and v["runs"] >= ALERT_MIN_VERSION_RUNS]
    if live_version is not None:
        current = [v for v in released if v["version"] == live_version]
        previous = [v for v in released if v["version"] < live_version]
        released = current + previous[:1] if current else []
    if len(released) >= 2 and released[0]["error_rate"] is not None and released[1]["error_rate"] is not None \
            and released[0]["error_rate"] - released[1]["error_rate"] >= ALERT_VERSION_DELTA:
        alerts.append({"level": "warning", "kind": "version",
                       "version": released[0]["version"],
                       "message": f"v{released[0]['version']} fails more often than v{released[1]['version']} "
                                  f"({round(100 * released[0]['error_rate'])}% of {released[0]['runs']} runs vs "
                                  f"{round(100 * released[1]['error_rate'])}% of {released[1]['runs']} runs in this period). Review the release."})
    if published and not any(_ts(r) >= now - timedelta(days=7) for r in runs):
        alerts.append({"level": "info", "kind": "idle", "message": "No runs in the last 7 days."})
    return {"days": days, "totals": totals, "daily": series, "by_version": by_version, "by_source": by_source,
            "error_kinds": error_kinds, "alerts": alerts, "truncated": truncated}


MONITOR_CACHE_SECONDS = float(os.getenv("MONITOR_CACHE_SECONDS", "20"))
_monitor_cache: dict = {}


async def _monitor_rows(app_id: str, days: int, owner_id: Optional[str] = None) -> tuple[list[dict], list[dict], bool]:
    """Cached for a few seconds: several open Monitor tabs refresh every
    minute and each read can page through thousands of runs."""
    key = (app_id, days, owner_id)
    hit = _monitor_cache.get(key)
    if MONITOR_CACHE_SECONDS > 0 and hit and time.monotonic() - hit[0] < MONITOR_CACHE_SECONDS:
        return hit[1]
    result = await _read_monitor_rows(app_id, days, owner_id)
    if MONITOR_CACHE_SECONDS > 0:
        if len(_monitor_cache) > 500:
            _monitor_cache.clear()
        _monitor_cache[key] = (time.monotonic(), result)
    return result


async def _read_monitor_rows(app_id: str, days: int, owner_id: Optional[str] = None) -> tuple[list[dict], list[dict], bool]:
    """Run log and customer ratings (the developer's own ratings don't count)."""
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Monitoring isn't available on this server")
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    (runs, run_limit), (rating_rows, rating_limit) = await asyncio.gather(
        _read_monitor_pages(lambda: sb.table("app_runs").select("id, created_at, user_id, source, status, error_kind, latency_ms, live_version, cost_usd", count="exact")
                            .eq("app_id", app_id).gte("created_at", since)),
        _read_monitor_pages(lambda: sb.table("run_history").select("id, created_at, rating_value, user_id", count="exact")
                            .eq("app_id", app_id).gte("created_at", since).not_.is_("rating_value", "null")))
    ratings = [r for r in rating_rows if not owner_id or r.get("user_id") != owner_id]
    return runs, ratings, run_limit or rating_limit


async def _read_monitor_pages(query_factory):
    """Honor the server's actual page size, not merely our requested limit.

    A stable upper timestamp and tie-breaking ID keep ordinary inserts out of
    the snapshot. Exact count reveals truncation even with a smaller API cap.
    """
    rows = []
    until = datetime.now(timezone.utc).isoformat()
    while len(rows) < MONITOR_ROW_LIMIT:
        end = min(len(rows) + 500, MONITOR_ROW_LIMIT) - 1
        result = await db(query_factory().lte("created_at", until).order("created_at", desc=True).order("id", desc=True).range(len(rows), end))
        page = result.data or []
        total = result.count
        if not page:
            return rows, bool(total is not None and total > len(rows))
        rows.extend(page)
        if total is not None and len(rows) >= total:
            return rows, False
    return rows, total is None or total > len(rows)


def _monitor_days(days: int) -> int:
    if days not in (1, 7, 30, 90):
        raise HTTPException(status_code=400, detail="days must be 1, 7, 30 or 90")
    return days


BASIC_HIDDEN_TOTALS = ("latency_p50_ms", "latency_p95_ms", "cost_usd", "cost_per_run_usd", "cost_recorded_runs", "latency_recorded_runs")


def basic_analytics(summary: dict) -> dict:
    """Free developers see totals, errors and satisfaction; per-version health,
    response times, cost and alerts are Standard (Verified developers)."""
    totals = {k: (None if k in BASIC_HIDDEN_TOTALS else v) for k, v in summary.get("totals", {}).items()}
    daily = [{k: (None if k == "cost_usd" else v) for k, v in d.items()} for d in summary.get("daily", [])]
    return {**summary, "totals": totals, "daily": daily, "by_version": [], "alerts": [], "analytics": "basic"}


async def analytics_level(user_id: Optional[str]) -> str:
    tier, limits = await developer_limits_for(user_id)
    return "standard" if limits is None else limits["analytics"]


@app.get("/v1/apps/{app_id}/monitor")
async def app_monitor(app_id: str, request: Request, days: int = 30):
    """Production health of one app (editors only): every real run —
    customers, API, triggers and website visitors — not draft or test runs."""
    _, app_row = await _editable_app(app_id, request)
    days = _monitor_days(days)
    runs, ratings, truncated = await _monitor_rows(app_id, days, app_row.get("created_by"))
    summary = monitor_summary(runs, ratings, days, published=bool(app_row.get("is_published")), truncated=truncated, live_version=app_row.get("live_version"))
    summary = basic_analytics(summary) if await analytics_level(app_row.get("created_by")) == "basic" else {**summary, "analytics": "standard"}
    return {"app_id": app_id, "live_version": app_row.get("live_version"),
            "telemetry_health": await _telemetry_health([app_id]), **summary}


async def _open_feedback_count(app_id: str) -> Optional[int]:
    """Open feedback for the Monitor overview; None (shown as unknown) if it
    can't be read, so the rest of the overview still loads."""
    try:
        res = await db(_service_client().table("app_feedback").select("id", count="exact", head=True)
                       .eq("app_id", app_id).in_("status", ["new", "investigating"]))
        return res.count or 0
    except Exception as e:
        print(f"open feedback count unavailable for {app_id}: {type(e).__name__}")
        return None


@app.get("/v1/monitor")
async def monitor_overview(request: Request, app_ids: str = "", days: int = 7):
    """Health of several apps at once (the ones the caller can edit; others
    are skipped): totals and alerts per app, for the Monitor overview."""
    days = _monitor_days(days)
    requested = [a for a in dict.fromkeys(app_ids.split(",")) if a]
    ids = requested[:50]
    caller = await resolve_api_caller(request, required=True)
    all_runs, all_ratings = [], []

    async def one(app_id: str):
        row = await load_app_row(app_id)
        if not (row and await can_edit_app(row, caller)):
            return None
        (runs, ratings, truncated), open_res = await asyncio.gather(
            _monitor_rows(app_id, days, row.get("created_by")), _open_feedback_count(app_id))
        all_runs.extend(runs)
        all_ratings.extend(ratings)
        summary = monitor_summary(runs, ratings, days, published=bool(row.get("is_published")), truncated=truncated, live_version=row.get("live_version"))
        level = await analytics_level(row.get("created_by"))
        if level == "basic":
            summary = basic_analytics(summary)
        return {"app_id": app_id, "live_version": row.get("live_version"), "published": bool(row.get("is_published")), "totals": summary["totals"], "alerts": summary["alerts"], "truncated": truncated,
                "open_feedback": open_res, "analytics": level}

    semaphore = asyncio.Semaphore(4)
    async def bounded(app_id):
        async with semaphore:
            return await one(app_id)
    results = await asyncio.gather(*(bounded(a) for a in ids))
    rows = [r for r in results if r]
    combined = monitor_summary(all_runs, all_ratings, days, truncated=any(r["truncated"] for r in rows))
    if any(r["analytics"] == "basic" for r in rows):
        combined = basic_analytics(combined)          # never more detail combined than per app
    return {"days": days, "apps": rows, "summary": {k: combined[k] for k in ("totals", "daily", "truncated")},
            "app_limit_reached": len(requested) > len(ids), "telemetry_health": await _telemetry_health([r["app_id"] for r in rows])}


# ── Customer feedback (shared with the app's developers) ─────────────────────
FEEDBACK_STATUSES = ("new", "investigating", "fixed", "verified", "dismissed")
FEEDBACK_FIELDS = "id, app_id, run_id, rating, comment, shared_input, shared_output, status, note, test_case_id, created_at, updated_at"


class RunFeedback(BaseModel):
    rating: int = Field(..., ge=-1, le=1)
    comment: Optional[str] = Field(None, max_length=1000)
    share_run: bool = False           # include the question and the answer


@app.post("/v1/runs/{run_id}/feedback")
async def rate_run(run_id: str, body: RunFeedback, request: Request):
    """Rate one of your own runs. The rating and comment reach the app's
    developers; the question and answer only with share_run. Who rated is
    never shown to them."""
    user_id = await require_verified_user(request)
    if body.rating not in (1, -1):
        raise HTTPException(status_code=400, detail="Rating must be 1 (useful) or -1 (not useful)")
    user_jwt = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    user_db = get_supabase_for_user(user_jwt)
    res = await db(user_db.table("run_history").select("id, user_id, app_id, input, output").eq("id", run_id).limit(1))
    run = (res.data or [None])[0]
    if not run or run.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Run not found")
    comment = (body.comment or "").strip() or None
    await db(user_db.table("run_history").update({"rating_type": "thumb", "rating_value": body.rating, "feedback_text": comment})
             .eq("id", run_id))
    shared = False
    # Developers get every "not useful" and any rating with a comment or the run attached.
    if run.get("app_id"):
        sb = _service_client()
        if not sb:
            raise HTTPException(status_code=503, detail="Feedback storage is unavailable")
        row = {"app_id": run["app_id"], "run_id": run_id, "rating": body.rating, "comment": comment,
               "shared_input": (run.get("input") or "")[:4000] if body.share_run else None,
               "shared_output": (run.get("output") or "")[:8000] if body.share_run else None}
        if body.rating == -1 or comment or body.share_run:
            await db(sb.table("app_feedback").upsert(row, on_conflict="run_id"))
            shared = True
            name, owner = await _app_label(run["app_id"])
            if owner and owner != user_id:
                _spawn_telemetry(notify_developer(owner, "feedback", f"{run['app_id']}:{datetime.now(timezone.utc).date().isoformat()}",
                                       subject="New customer feedback",
                                       title=f"New feedback on {name}",
                                       body=f"A customer rated an answer from <strong style='color:#fff'>{name}</strong>"
                                            f"{' as not useful' if body.rating == -1 else ''}. Review it in Eval: "
                                            "reproduce it, save a test and fix it in Improve. (One email a day per app.)",
                                       cta_label="Open Eval →"))     # in the background: rating isn't delayed
        else:
            # Re-rating without sharing must also revoke previously attached
            # evidence. Keep existing triage/test links, but don't create a new
            # inbox report for a plain useful rating.
            await db(sb.table("app_feedback").update(row).eq("run_id", run_id))
    return {"ok": True, "shared_with_developer": shared}


@app.get("/v1/apps/{app_id}/feedback")
async def list_feedback(app_id: str, request: Request, status: str = "open", offset: int = 0, limit: int = 200):
    """Customer feedback for an app (editors only), newest first. `open`:
    new and investigating; `all`: everything; or one status."""
    await _editable_app(app_id, request)
    if offset < 0 or not 1 <= limit <= 200:
        raise HTTPException(status_code=400, detail="Invalid feedback page")
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Feedback storage is unavailable")
    q = sb.table("app_feedback").select(FEEDBACK_FIELDS).eq("app_id", app_id)
    if status == "open":
        q = q.in_("status", ["new", "investigating"])
    elif status in FEEDBACK_STATUSES:
        q = q.eq("status", status)
    elif status != "all":
        raise HTTPException(status_code=400, detail="Unknown status")
    res = await db(q.order("created_at", desc=True).order("id", desc=True).range(offset, offset + limit))
    rows = res.data or []
    items = rows[:limit]
    try:
        counts_res = await db(sb.rpc("app_feedback_counts", {"p_app_id": app_id}))
    except Exception:
        raise HTTPException(status_code=503, detail="Feedback counts are unavailable. Check the operations migrations or retry after database recovery.")
    if not isinstance(counts_res.data, dict):
        raise HTTPException(status_code=503, detail="Feedback counts are unavailable. Check the operations migrations.")
    return {"items": items, "counts": counts_res.data,
            "counts_truncated": False,
            "next_offset": offset + limit if len(rows) > limit else None}


class FeedbackUpdate(BaseModel):
    status: Optional[str] = None
    note: Optional[str] = Field(None, max_length=1000)
    test_case_id: Optional[str] = None


@app.patch("/v1/feedback/{feedback_id}")
async def update_feedback(feedback_id: str, body: FeedbackUpdate, request: Request):
    """Triage one feedback item (editors of its app)."""
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Feedback storage is unavailable")
    res = await db(sb.table("app_feedback").select("id, app_id, status, note, test_case_id, created_at").eq("id", feedback_id).limit(1))
    item = (res.data or [None])[0]
    if not item:
        raise HTTPException(status_code=404, detail="Feedback not found")
    caller, app_row = await _editable_app(item["app_id"], request)
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if "status" in patch and patch["status"] not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if patch.get("status", item.get("status")) == "verified":
        test_id = patch.get("test_case_id", item.get("test_case_id"))
        note = patch.get("note", item.get("note"))
        if not test_id or not note or not note.strip():
            raise HTTPException(status_code=400, detail="Link a regression test and record verification evidence before marking verified")
        if not app_row.get("is_published"):
            raise HTTPException(status_code=409, detail="Publish the fix and check the live app before marking verified")
        # The fix must have shipped after the report: a release that was
        # already live when the customer hit the problem can't have fixed it.
        released, reported = _parse_ts(app_row.get("promoted_at")), _parse_ts(item.get("created_at"))
        if not released or (reported and released <= reported):
            raise HTTPException(status_code=409, detail="Publish a release made after this feedback was reported, then check the live app before marking verified")
        case = await db(sb.table("app_test_cases").select("id").eq("id", test_id).eq("app_id", item["app_id"]).limit(1))
        if not case.data:
            raise HTTPException(status_code=400, detail="The linked regression test is unavailable")
    if patch.get("test_case_id"):
        case = await db(sb.table("app_test_cases").select("id").eq("id", patch["test_case_id"]).eq("app_id", item["app_id"]).limit(1))
        if not case.data:
            raise HTTPException(status_code=400, detail="That test isn't one of this app's tests")
    patch["updated_by"] = caller.user_id
    updated = await db(sb.table("app_feedback").update(patch).eq("id", feedback_id))
    return {"ok": True, "item": (updated.data or [None])[0]}


@app.get("/v1/apps/{app_id}/versions")
async def list_versions(app_id: str, request: Request):
    """Published versions, newest first, and which one end users run."""
    _, app_row = await _editable_app(app_id, request)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Versions aren't configured on this server")
    try:
        res = await db(sb.table("app_versions").select("version_num, created_at, changelog, tests, user_id")
                       .eq("app_id", app_id).not_.is_("version_num", "null").order("version_num", desc=True).limit(100))
    except Exception as e:
        if "version_num" in str(e) or "tests" in str(e):
            return {"versions": [], "live_version": None, "setup_required": True}
        raise
    live = app_row.get("live_version")
    return {"live_version": live, "is_published": bool(app_row.get("is_published")),
            "versions": [{**v, "is_live": v["version_num"] == live and bool(app_row.get("is_published"))} for v in (res.data or [])]}


def _unchanged_release(query, app_row: dict):
    """Limit an apps update to the release that was read: if a teammate
    published or rolled back meanwhile, the update matches nothing."""
    promoted = app_row.get("promoted_at")
    return query.eq("promoted_at", promoted) if promoted else query.is_("promoted_at", "null")


RELEASE_CHANGED = "Another release was made while you were doing this. Reload to see what's live now, then try again."


@app.post("/v1/apps/{app_id}/versions/{version_num}/rollback")
async def rollback_version(app_id: str, version_num: int, request: Request, expected_live: Optional[int] = None):
    """Make an earlier published version live again. The draft isn't changed.
    expected_live: the live version the developer saw; if it changed since,
    nothing is rolled back (409)."""
    _, app_row = await _editable_app(app_id, request)
    if expected_live is not None and app_row.get("live_version") != expected_live:
        raise HTTPException(status_code=409, detail=RELEASE_CHANGED)
    if await needs_first_review(app_row):
        raise HTTPException(status_code=409, detail=IN_REVIEW if app_row.get("status") == "pending" else
                            "This app hasn't been approved yet. Publish it from Deploy to send it for review.")
    limit_problem = await published_limit_problem(app_row)
    if limit_problem:
        raise HTTPException(status_code=409, detail=limit_problem)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Versions aren't configured on this server")
    res = await db(sb.table("app_versions").select("version_data").eq("app_id", app_id).eq("version_num", version_num).limit(1))
    if not res.data or not isinstance(res.data[0].get("version_data"), dict):
        raise HTTPException(status_code=404, detail=f"Version v{version_num} not found")
    snapshot = res.data[0]["version_data"]
    state = await app_draft_state(app_row)
    now = datetime.now(timezone.utc).isoformat()
    saved = await db(_unchanged_release(sb.table("apps").update({"prod_snapshot": snapshot, "promoted_at": now, "is_published": True,
                                                                  "live_version": version_num,
                                                                  "has_draft_changes": not same_as_live(snapshot, state)}).eq("id", app_id), app_row))
    if not saved.data:
        raise HTTPException(status_code=409, detail=RELEASE_CHANGED)
    try:
        await db(sb.table("app_blueprints").update({"blueprint_prod": snapshot.get("blueprint")}).eq("app_id", app_id))
    except Exception as e:
        print(f"blueprint_prod update skipped: {type(e).__name__}")
    return {"ok": True, "live_version": version_num, "promoted_at": now, "is_published": True,
            "has_draft_changes": not same_as_live(snapshot, state)}


async def _isolated_checks(app_id: str, user_jwt: Optional[str]) -> list[str]:
    """Publish checks for the release view. Each check runs on its own: one
    that can't run becomes a visible problem (so publishing stays blocked)
    and the others still report."""
    out: list[str] = []
    for label, check in (("Publish checks", lambda: _publish_checks(app_id, user_jwt)),
                         ("Secrets", lambda: _missing_secret_checks(app_id))):
        try:
            out += await check()
        except Exception as e:
            print(f"release check '{label}' failed for {app_id}: {type(e).__name__}: {str(e)[:200]}")
            sentry_sdk.capture_exception(e)
            out.append(f"{label} couldn't be checked right now. Try again in a moment.")
    return out


@app.get("/v1/apps/{app_id}/release")
async def get_release(app_id: str, request: Request):
    """Draft vs live: what end users run, whether the draft differs, and
    what's left before it can be promoted."""
    caller, app_row = await _editable_app(app_id, request)
    state = await app_draft_state(app_row)
    draft = state_hash(state)
    prod = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) else None
    tests = await app_test_status(app_row, caller.user_id)
    checks = await _isolated_checks(app_id, caller.user_jwt)
    return {
        "is_published": bool(app_row.get("is_published")), "promoted_at": app_row.get("promoted_at"),
        "live_version": app_row.get("live_version"), "has_live_version": bool(prod), "draft_hash": draft, "live_hash": state_hash(prod) if prod else None,
        "has_changes": not same_as_live(prod, state),
        "checks": checks, "tests": tests, "test_problems": _test_problems(tests),
        "ready": not checks and not _test_problems(tests),
        # First publish: none (approved, or staff) | required | pending | rejected
        "review": ("none" if not await needs_first_review(app_row) else
                   app_row.get("status") if app_row.get("status") in ("pending", "rejected") else "required"),
        "review_notes": app_row.get("review_notes") if app_row.get("status") == "rejected" else None,
    }


IN_REVIEW = f"This app is waiting for review by the {BRAND_NAME} team. It goes live as soon as it's approved."
SUBMITTED_FOR_REVIEW = (f"Submitted for review. An app's first release is checked by the {BRAND_NAME} team; "
                        "it goes live as soon as it's approved, and later releases go live straight away.")


async def needs_first_review(app_row: dict) -> bool:
    """An app's first publish waits for staff (once approved, releases go
    live straight away). Staff's own apps don't wait."""
    if app_row.get("publish_approved_at") or not DEVELOPER_TIERS:
        return False
    return await developer_tier(app_row.get("created_by")) != "staff"


@app.post("/v1/apps/{app_id}/promote")
async def promote_app(app_id: str, request: Request):
    """Make the current draft the live version and publish the app. Requires
    the publish checks and passing tests for this exact draft."""
    caller, app_row = await _editable_app(app_id, request)
    checks = await _publish_checks(app_id, caller.user_jwt) + await _missing_secret_checks(app_id)
    tests = await app_test_status(app_row, caller.user_id)
    problems = _test_problems(tests)
    if checks or problems:
        return JSONResponse(status_code=409, content={
            "error": "Not ready to publish yet", "checks": checks, "test_problems": problems})
    state = await app_draft_state(app_row)
    if state_hash(state) != tests.get("draft_hash"):
        return JSONResponse(status_code=409, content={"error": "The draft changed while publishing — run the tests again."})
    contract_checks = tool_contracts.contract_problems(state, max_timeout=REQUEST_TIMEOUT, secret_ref=_SECRET_REF)
    if contract_checks:
        return JSONResponse(status_code=409, content={
            "error": "Not ready to publish yet", "checks": contract_checks, "test_problems": []})
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Publishing isn't configured on this server")
    limit_problem = await published_limit_problem(app_row)
    if limit_problem:
        return JSONResponse(status_code=409, content={"code": "published_limit", "error": limit_problem})
    if app_row.get("status") == "pending" and not app_row.get("publish_approved_at"):
        return JSONResponse(status_code=409, content={"code": "in_review", "error": IN_REVIEW})
    review = await needs_first_review(app_row)
    now = datetime.now(timezone.utc).isoformat()
    prod = app_row.get("prod_snapshot") if isinstance(app_row.get("prod_snapshot"), dict) else None
    if same_as_live(prod, state):
        # Same as the live version: no new version. Live already → nothing to
        # do; unpublished → put that same version back online.
        live = app_row.get("live_version")
        if app_row.get("is_published"):
            return JSONResponse(status_code=409, content={
                "code": "no_changes", "error": f"Nothing to promote: the draft is the same as {'v' + str(live) if live else 'the live version'}."})
        if review:
            await db(sb.table("apps").update({"status": "pending", "has_draft_changes": False}).eq("id", app_id))
            return {"ok": True, "pending_review": True, "is_published": False, "version": live, "unchanged": True,
                    "draft_hash": state_hash(state), "message": SUBMITTED_FOR_REVIEW}
        await db(sb.table("apps").update({"is_published": True, "has_draft_changes": False}).eq("id", app_id))
        return {"ok": True, "promoted_at": app_row.get("promoted_at"), "draft_hash": state_hash(state), "is_published": True,
                "version": live, "unchanged": True}
    # Releases carry their contract; draft_hash stays the hash of the draft.
    released = {**state, "contract": tool_contracts.build_contract(
        state, custom_model_url=app_row.get("custom_model_url"), max_timeout=REQUEST_TIMEOUT,
        private_hosts=PRIVATE_MODEL_HOSTS, secret_ref=_SECRET_REF)}
    version = await _save_published_version(sb, app_row, released, tests, caller.user_id)
    update = {"prod_snapshot": released, "promoted_at": now, "is_published": True, "has_draft_changes": False}
    if review:
        # Saved as the version staff will review; it goes live when approved.
        update.update(is_published=False, status="pending", review_notes=None)
    if version is not None:
        update["live_version"] = version
    if app_row.get("change_note"):
        update["change_note"] = None   # now part of this version's history
    saved = await db(_unchanged_release(sb.table("apps").update(update).eq("id", app_id), app_row))
    if not saved.data:
        if version is not None:   # never went live: don't leave it in the history
            await db(sb.table("app_versions").delete().eq("app_id", app_id).eq("version_num", version))
        return JSONResponse(status_code=409, content={"code": "release_changed", "error": RELEASE_CHANGED})
    try:
        await db(sb.table("app_blueprints").update({"blueprint_prod": state["blueprint"]}).eq("app_id", app_id))
    except Exception as e:
        print(f"blueprint_prod update skipped: {type(e).__name__}")
    if review:
        return {"ok": True, "pending_review": True, "is_published": False, "promoted_at": now, "draft_hash": state_hash(state),
                "version": version, "message": SUBMITTED_FOR_REVIEW}
    return {"ok": True, "promoted_at": now, "draft_hash": state_hash(state), "is_published": True, "version": version}


# ── AI providers and developers' own keys ────────────────────────────────────
class ProviderKeyRequest(BaseModel):
    key: str = Field(..., min_length=8, max_length=500)


def _provider_or_404(provider: str) -> dict:
    p = PROVIDERS.get(provider)
    if not p:
        raise HTTPException(status_code=404, detail=f"Unknown provider. Use one of: {', '.join(PROVIDERS)}")
    return p


async def _saved_keys(user_id: str) -> dict[str, dict]:
    sb = _service_client()
    if not sb:
        return {}
    res = await db(sb.table("user_api_keys").select("provider, last4, is_active, encrypted_key")
                   .eq("user_id", user_id).eq("is_active", True))
    return {r["provider"]: r for r in (res.data or [])}


@app.get("/v1/providers")
async def list_providers(request: Request):
    """Providers developers can build with: whether the caller has a key
    saved, and the models they can pick (live list for their key, else the
    platform's short list)."""
    user_id = await require_verified_user(request)
    saved = await _saved_keys(user_id)
    out = []
    for pid, p in PROVIDERS.items():
        row = saved.get(pid)
        models = [{"id": m, "label": lbl} for m, lbl in p["models"]]
        models_error = None
        key = _open_key(row["encrypted_key"]) if row else None
        if key:
            try:
                live = await list_provider_models(pid, key)
                known = {m["id"] for m in models}
                models = models + [m for m in live if m["id"] not in known]
            except Exception as e:
                models_error = f"Couldn't load models for your {p['label']} key ({type(e).__name__})."
        out.append({"id": pid, "label": p["label"], "company": p["company"], "keys_url": p["keys_url"],
                    "connected": bool(row), "last4": (row or {}).get("last4"),
                    "platform_available": bool(platform_key(pid)), "default_model": get_default_model(pid),
                    "models": models, "models_error": models_error})
    return {"providers": out}


@app.put("/v1/provider-keys/{provider}")
async def save_provider_key(provider: str, body: ProviderKeyRequest, request: Request):
    """Check a key with the provider, then store it encrypted."""
    user_id = await require_verified_user(request)
    p = _provider_or_404(provider)
    key = body.key.strip()
    if p["key_prefix"] and not key.startswith(p["key_prefix"]):
        raise HTTPException(status_code=422, detail=f"{p['label']} keys start with {p['key_prefix']}")
    try:
        models = await list_provider_models(provider, key)
    except (anthropic.AuthenticationError, openai.AuthenticationError, anthropic.PermissionDeniedError, openai.PermissionDeniedError):
        raise HTTPException(status_code=422, detail=f"{p['label']} rejected that key. Check it and try again.")
    except (anthropic.BadRequestError, openai.BadRequestError):
        raise HTTPException(status_code=422, detail=f"{p['label']} rejected that key. Check it and try again.")
    except Exception as e:
        print(f"provider key check failed [{provider}]: {type(e).__name__}")   # not the message: it can echo the key
        raise HTTPException(status_code=502, detail=f"Couldn't reach {p['label']} to check the key. Try again in a moment.")
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Key storage isn't configured on this server")
    await db(sb.table("user_api_keys").upsert({
        "user_id": user_id, "provider": provider, "encrypted_key": _encrypt(key), "last4": key[-4:],
        "label": f"My {p['label']} key", "is_active": True,
    }, on_conflict="user_id,provider"))
    return {"provider": provider, "connected": True, "last4": key[-4:], "models": models}


@app.delete("/v1/provider-keys/{provider}")
async def delete_provider_key(provider: str, request: Request):
    user_id = await require_verified_user(request)
    _provider_or_404(provider)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Key storage isn't configured on this server")
    await db(sb.table("user_api_keys").delete().eq("user_id", user_id).eq("provider", provider))
    return {"provider": provider, "connected": False}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "providers": ["claude", "openai"],
        "limits": {"hourly": HOURLY_LIMIT, "daily": DAILY_LIMIT},
        "timeout": REQUEST_TIMEOUT,
    }


@app.get("/health/ready")
async def readiness():
    """Deployment routing gate. Liveness alone must not admit an old schema."""
    try:
        gaps = production_config_gaps()
        if gaps["missing_required"]:
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        def check_outbox():
            with _telemetry_outbox.connection():
                pass
        await asyncio.wait_for(asyncio.to_thread(check_outbox), timeout=3)
        result = await asyncio.wait_for(db(_service_client().rpc("developer_jobs_schema_status", {})), timeout=5)
        checks = ("workflow_lease", "workflow_snapshot", "notification_queue", "recovery_functions", "server_only")
        if not isinstance(result.data, dict) or not all(result.data.get(k) is True for k in checks):
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        return {"status": "ready"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "not_ready"})


# ─── Your developer plan ─────────────────────────────────────────────────────
@app.get("/v1/developer/plan")
async def developer_plan(request: Request):
    """The caller's tier, its limits and current usage (for Settings / Dev Studio)."""
    user_id = await require_verified_user(request)
    tier, limits = await developer_limits_for(user_id)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Plans aren't available on this server")
    apps = (await db(sb.table("apps").select("id, is_published, status").eq("created_by", user_id))).data or []
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        usage = (await db(sb.table("developer_test_usage").select("runs").eq("user_id", user_id).eq("day", today))).data or []
    except Exception:
        usage = []
    return {
        "tier": tier, "label": TIER_LABELS[tier], "limits": limits, "all_limits": await tier_limits(),
        "usage": {"draft_apps": sum(1 for a in apps if not a.get("is_published")),
                  "published_apps": sum(1 for a in apps if a.get("is_published") or a.get("status") == "pending"),
                  "tests_today": (usage[0]["runs"] if usage else 0)},
        "ai_usage": "Your own AI keys (Settings → Keys)",
        "publish_approval": f"An app's first release is reviewed by the {BRAND_NAME} team",
    }


async def is_staff_user(user_id: Optional[str]) -> bool:
    return await developer_tier(user_id) == "staff"


async def _require_staff(request: Request) -> str:
    staff_id = await require_verified_user(request)
    if not await is_staff_user(staff_id):
        raise HTTPException(status_code=404, detail="Not found")
    if not _service_client():
        raise HTTPException(status_code=503, detail="Not available on this server")
    return staff_id


@app.get("/v1/admin/developers")
async def admin_developers(request: Request, verified: Optional[bool] = None):
    """Staff: developers (people who created apps or have a developer
    profile), with their tier and app counts."""
    await _require_staff(request)
    sb = _service_client()
    apps = (await db(sb.table("apps").select("created_by, is_published").range(0, 9999))).data or []
    profiles = (await db(sb.table("developer_profiles").select("user_id, display_name, is_verified").range(0, 9999))).data or []
    staff = {r["user_id"] for r in (await db(sb.table("user_roles").select("user_id").range(0, 9999))).data or []}
    devs: dict = {}
    for p in profiles:
        devs[p["user_id"]] = {"user_id": p["user_id"], "display_name": p.get("display_name"), "verified": bool(p.get("is_verified")),
                              "published_apps": 0, "draft_apps": 0}
    for a in apps:
        if not a.get("created_by"):
            continue
        d = devs.setdefault(a["created_by"], {"user_id": a["created_by"], "display_name": None, "verified": False,
                                              "published_apps": 0, "draft_apps": 0})
        d["published_apps" if a.get("is_published") else "draft_apps"] += 1
    rows = [{**d, "tier": "staff" if d["user_id"] in staff else "verified" if d["verified"] else "free"} for d in devs.values()]
    if verified is not None:
        rows = [r for r in rows if r["verified"] == verified]
    rows.sort(key=lambda r: (-(r["published_apps"] + r["draft_apps"]), r["display_name"] or r["user_id"]))
    return {"developers": rows[:500], "total": len(rows)}


class ReviewDecision(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    note: str = Field(default="", max_length=2000)


@app.post("/v1/admin/apps/{app_id}/review")
async def review_app(app_id: str, body: ReviewDecision, request: Request):
    """Staff approve or send back an app waiting for review (or a flagged one),
    and the developer is emailed the outcome."""
    staff_id = await _require_staff(request)
    app_row = await load_app_row(app_id)
    if not app_row:
        raise HTTPException(status_code=404, detail="App not found")
    if body.decision == "reject" and not body.note.strip():
        raise HTTPException(status_code=400, detail="Say what the developer should change")
    if body.decision == "approve" and not isinstance(app_row.get("prod_snapshot"), dict):
        raise HTTPException(status_code=409, detail="This app has no submitted release to approve")
    now = datetime.now(timezone.utc).isoformat()
    patch = ({"status": "approved", "is_published": True, "review_notes": body.note.strip() or None,
              "publish_approved_at": app_row.get("publish_approved_at") or now}
             if body.decision == "approve" else
             {"status": "rejected", "is_published": False, "review_notes": body.note.strip()})
    await db(_service_client().table("apps").update(patch).eq("id", app_id))
    name = html_escape(app_row.get("name") or "your app")
    approved = body.decision == "approve"
    await notify_developer(app_row.get("created_by"), f"review_{body.decision}", f"{app_id}:{now}",
                           subject=f"{app_row.get('name') or 'Your app'} is live" if approved else f"Changes requested for {app_row.get('name') or 'your app'}",
                           title=f"{name} is live" if approved else f"Changes requested for {name}",
                           body=(f"The {BRAND_NAME} team approved your app; it's live now, and your later releases go live straight away."
                                 if approved else
                                 f"The {BRAND_NAME} team reviewed your app and asked for changes:<br><br>{html_escape(body.note.strip())}<br><br>"
                                 "Make them in Dev Studio, then publish again from Deploy."),
                           cta_label="Open Deploy →")
    print(f"app {app_id} review: {body.decision} by {staff_id}")
    return {"ok": True, "status": patch["status"], "is_published": patch["is_published"]}


class VerificationRequest(BaseModel):
    verified: bool


@app.post("/v1/admin/developers/{developer_id}/verification")
async def set_developer_verification(developer_id: str, body: VerificationRequest, request: Request):
    """Staff mark a developer Verified (or take it back)."""
    staff_id = await require_verified_user(request)
    if not await is_staff_user(staff_id):
        raise HTTPException(status_code=404, detail="Not found")
    if not _UUID_RE.fullmatch(developer_id):
        raise HTTPException(status_code=422, detail="Invalid developer id")
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Not available on this server")
    await db(sb.table("developer_profiles").upsert({"user_id": developer_id, "is_verified": body.verified}, on_conflict="user_id"))
    _tier_cache.pop(developer_id, None)
    print(f"developer {developer_id} verification set to {body.verified} by {staff_id}")
    return {"ok": True, "developer_id": developer_id, "tier": "verified" if body.verified else "free"}


# ─── Your account: export and deletion ───────────────────────────────────────
# Everything a person owns, as one JSON file (never secret values, key hashes
# or encrypted tokens), and deletion of the account once nothing depends on it.

EXPORT_ROW_LIMIT = 50000
# table → (owner column, columns to export)
EXPORT_TABLES = {
    "developer_profiles": ("user_id", "*"),
    "user_api_keys": ("user_id", "provider, is_active, created_at"),           # which providers, never the keys
    "developer_api_keys": ("user_id", "name, key_prefix, app_ids, created_at"),  # never the key hash
    "apps": ("created_by", "*"),
    "flows": ("user_id", "*"),
    "flow_schedules": ("user_id", "*"),
    "run_history": ("user_id", "*"),
    "knowledge_vault": ("user_id", "*"),
    "user_memory": ("user_id", "*"),
    "user_goals": ("user_id", "*"),
    "user_business_profiles": ("user_id", "*"),
    "user_career_profiles": ("user_id", "*"),
    "favorites": ("user_id", "*"),
    "notifications": ("user_id", "*"),
    "conversation_threads": ("user_id", "*"),
    "app_reviews": ("user_id", "*"),
    "app_entitlements": ("user_id", "app_id, plan, status, run_quota, runs_this_period, current_period_end, created_at"),
    "workspace_members": ("user_id", "workspace_id, role, created_at"),
}
APP_CHILD_TABLES = ("app_tools", "app_blueprints", "app_test_cases", "app_versions", "marketplace_listings")
SECRET_COLUMN_HINTS = ("encrypted", "key_hash", "token")


async def _read_owned(sb, table: str, column: str, value, columns: str = "*") -> list[dict]:
    rows: list[dict] = []
    while len(rows) < EXPORT_ROW_LIMIT:
        page = (await db(sb.table(table).select(columns).eq(column, value).range(len(rows), len(rows) + 999))).data or []
        rows.extend(page)
        if len(page) < 1000:
            break
    return rows


def _without_secrets(row: dict) -> dict:
    return {k: v for k, v in row.items() if not any(x in k for x in SECRET_COLUMN_HINTS)}


@app.get("/v1/account/export")
async def export_account(request: Request):
    """Download everything this account owns (a GDPR/CCPA access request)."""
    user_id = await require_verified_user(request)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Export isn't available on this server")
    out: dict = {"exported_at": datetime.now(timezone.utc).isoformat(), "user_id": user_id}
    unavailable = []
    for table, (column, columns) in EXPORT_TABLES.items():
        try:
            out[table] = [_without_secrets(r) for r in await _read_owned(sb, table, column, user_id, columns)]
        except Exception:
            unavailable.append(table)
    app_ids = [a["id"] for a in out.get("apps", [])]
    for table in APP_CHILD_TABLES:
        try:
            out[table] = [_without_secrets(r) for app_id in app_ids for r in await _read_owned(sb, table, "app_id", app_id)]
        except Exception:
            unavailable.append(table)
    ledger_fields = PURCHASE_FIELDS.replace(", stripe_payment_ref", "")
    try:
        out["app_secrets"] = [_without_secrets(r) for app_id in app_ids
                              for r in await _read_owned(sb, "app_secrets", "app_id", app_id, "app_id, key, created_at, updated_at")]
        out["purchases_as_buyer"] = await _read_owned(sb, "purchases", "buyer_id", user_id, ledger_fields)
        out["sales_as_developer"] = await _read_owned(sb, "purchases", "dev_id", user_id, ledger_fields)
    except Exception:
        unavailable.append("purchases")
    out["unavailable"] = unavailable           # what this server couldn't read: the export says so
    name = f"aistrix-account-{datetime.now(timezone.utc).date().isoformat()}.json"
    return Response(content=json.dumps(out, default=str, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


async def account_deletion_blockers(sb, user_id: str) -> list[str]:
    """What must be sorted out before this account can be deleted, so that
    nobody else loses access or money and nobody keeps being charged."""
    blockers = []
    member = (await db(sb.table("workspace_members").select("workspace_id, role").eq("user_id", user_id))).data or []
    ids = [m["workspace_id"] for m in member]
    teams = ((await db(sb.table("workspaces").select("id, name, is_personal").in_("id", ids))).data or []) if ids else []
    team = {w["id"]: w for w in teams if not w.get("is_personal")}
    owned = [team[m["workspace_id"]]["name"] for m in member if m["workspace_id"] in team and m.get("role") == "owner"]
    if owned:
        blockers.append(f"You own the team workspace(s) {', '.join(owned)}. Make someone else the owner, or delete it.")
    apps = (await db(sb.table("apps").select("id, name, workspace_id").eq("created_by", user_id))).data or []
    team_apps = [a.get("name") or "an app" for a in apps if a.get("workspace_id") in team]
    if team_apps:
        more = "…" if len(team_apps) > 5 else ""
        blockers.append(f"You created apps your team uses: {', '.join(team_apps[:5])}{more}. Move or delete them first.")
    subs = (await db(sb.table("app_entitlements").select("app_id").eq("user_id", user_id)
                     .eq("plan", "subscription").eq("status", "active"))).data or []
    if subs:
        blockers.append(f"You have {_plural(len(subs), 'active subscription')}. Cancel them first so you aren't charged again.")
    own_ids = [a["id"] for a in apps if a.get("workspace_id") not in team]
    if own_ids:
        buyers = (await db(sb.table("app_entitlements").select("user_id").in_("app_id", own_ids)
                           .eq("plan", "subscription").eq("status", "active"))).data or []
        if any(b.get("user_id") != user_id for b in buyers):
            blockers.append("Customers subscribe to your apps. Unpublish them and let the subscriptions end first.")
    owed = (await db(sb.table("purchases").select("dev_share, gross_amount, refunded_amount").eq("dev_id", user_id)
                     .in_("payout_status", list(OWED_STATUSES)))).data or []
    owed_total = sum(_net_share(p) for p in owed)
    if owed_total > 0:
        blockers.append(f"You're owed ${owed_total:.2f} in payouts. Send them from Manage → Revenue first.")
    return blockers


@app.get("/v1/account/deletion-check")
async def account_deletion_check(request: Request):
    """Whether this account can be deleted now, and if not, what to do first."""
    user_id = await require_verified_user(request)
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Account deletion isn't available on this server")
    blockers = await account_deletion_blockers(sb, user_id)
    return {"can_delete": not blockers, "blockers": blockers}


class AccountDeleteRequest(BaseModel):
    confirm: str


DELETE_CONFIRMATION = "delete my account"


@app.post("/v1/account/delete")
async def delete_account(body: AccountDeleteRequest, request: Request):
    """Delete this account for good: its personal apps, files, runs, keys and
    settings. Sales records stay (without the person) for accounting."""
    user_id = await require_verified_user(request)
    if body.confirm.strip().lower() != DELETE_CONFIRMATION:
        raise HTTPException(status_code=400, detail=f'Type "{DELETE_CONFIRMATION}" to confirm')
    sb = _service_client()
    if not sb:
        raise HTTPException(status_code=503, detail="Account deletion isn't available on this server")
    blockers = await account_deletion_blockers(sb, user_id)
    if blockers:
        return JSONResponse(status_code=409, content={"error": blockers[0], "blockers": blockers})
    app_ids = [a["id"] for a in (await db(sb.table("apps").select("id").eq("created_by", user_id))).data or []]
    # Uploaded files live in storage, which the database doesn't clean up.
    files = (await db(sb.table("app_files").select("bucket, storage_path").eq("owner_id", user_id))).data or []
    if app_ids:
        files += (await db(sb.table("app_files").select("bucket, storage_path").in_("app_id", app_ids))).data or []
    by_bucket: dict = defaultdict(set)
    for f in files:
        by_bucket[f["bucket"]].add(f["storage_path"])
    for bucket, paths in by_bucket.items():
        paths = sorted(paths)
        for i in range(0, len(paths), 100):
            try:
                await asyncio.to_thread(sb.storage.from_(bucket).remove, paths[i:i + 100])
            except Exception as e:
                print(f"account deletion: storage cleanup in {bucket} failed: {type(e).__name__}")
                sentry_sdk.capture_exception(e)
    if app_ids:
        await db(sb.table("apps").delete().in_("id", app_ids))      # their tools, tests, versions… go with them
    try:
        await asyncio.to_thread(sb.auth.admin.delete_user, user_id)  # the rest is removed by the database
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=503, detail="Your apps were removed, but the account couldn't be deleted. Try again.") from e
    print(f"account deleted: {user_id}")
    return {"ok": True}


def production_config_gaps() -> dict:
    """Settings a public deployment needs (required) or should have
    (recommended). Names only — never values."""
    env = lambda k: (os.getenv(k) or "").strip()
    local = lambda v: not v or "localhost" in v or "127.0.0.1" in v
    required = [k for k, ok in (
        ("SUPABASE_URL", bool(SUPABASE_URL)), ("SUPABASE_ANON_KEY", bool(SUPABASE_ANON_KEY)),
        ("SUPABASE_SERVICE_ROLE_KEY", bool(SUPABASE_SERVICE_ROLE_KEY)), ("SECRET_ENCRYPTION_KEY", bool(_fernet)),
        ("TELEMETRY_OUTBOX_PATH", bool(env("TELEMETRY_OUTBOX_PATH"))),
        ("RESEND_API_KEY", bool(env("RESEND_API_KEY"))), ("EMAIL_FROM", bool(env("EMAIL_FROM"))),
        ("OPS_HEALTH_TOKEN", bool(env("OPS_HEALTH_TOKEN"))),
        ("ALLOWED_ORIGINS (the public site, not localhost)", not all(local(o) for o in ALLOWED_ORIGINS)),
        ("FRONTEND_URL (the public site, not localhost)", not local(FRONTEND_URL)),
        ("an AI provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY or GEMINI_API_KEY)",
         any(env(k) for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"))),
        ("CRON_SECRET or SCHEDULE_SECRET, or the built-in scheduler (SCHEDULER_INTERVAL_SECONDS > 0)",
         SCHEDULER_INTERVAL_SECONDS > 0 or bool(env("CRON_SECRET") or env("SCHEDULE_SECRET"))),
    ) if not ok]
    recommended = [k for k in ("SENTRY_DSN", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "OPS_ALERT_WEBHOOK_URL") if not env(k)]
    if not TRUST_PROXY_HEADERS:
        recommended.append("TRUST_PROXY_HEADERS (behind the host's proxy, so rate limits see real visitor addresses)")
    return {"environment": os.getenv("ENVIRONMENT", "production"), "missing_required": required, "missing_recommended": recommended}


def report_production_config() -> None:
    """Printed at startup so a deployment with a missing setting is obvious
    in the host's logs (and in /health/details)."""
    # Which project this server uses (the frontend logs its own in development),
    # so a staging/production mix-up is visible at a glance.
    print(f"Supabase project: {urlsplit(SUPABASE_URL or '').hostname or 'not set'} "
          f"(ENVIRONMENT={os.getenv('ENVIRONMENT', 'production')})")
    gaps = production_config_gaps()
    if gaps["environment"].lower() in ("development", "dev", "local", "test"):
        return
    for name in gaps["missing_required"]:
        print(f"CONFIG REQUIRED for a public deployment, not set: {name}")
    if gaps["missing_recommended"]:
        print(f"Config recommended, not set: {', '.join(gaps['missing_recommended'])}")


@app.get("/health/details")
def health_details(request: Request):
    """Deployment details for the operator (staging verification): which
    database this server uses, whether run-tracking recovery storage is set,
    and the process id. Needs the OPS_HEALTH_TOKEN header; 404 otherwise."""
    token = os.getenv("OPS_HEALTH_TOKEN")
    given = request.headers.get("x-ops-token", "")
    if not token or not secrets.compare_digest(given, token):
        raise HTTPException(status_code=404, detail="Not found")
    return {
        **health(),
        "database_project": urlsplit(SUPABASE_URL or "").hostname,
        "telemetry_recovery_configured": bool(os.getenv("TELEMETRY_OUTBOX_PATH")),
        "process_id": os.getpid(),
        "config": production_config_gaps(),
    }


@app.get("/")
def root():
    return {"message": f"{BRAND_NAME} API", "version": "1.0.0", "docs": "/docs"}
