import asyncio
import ast
import csv
import hashlib
import io
import ipaddress
import json
import math
import operator
import os
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
from cryptography.fernet import Fernet
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
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

@asynccontextmanager
async def lifespan(_app):
    # Resume batch jobs left queued/interrupted by a restart, and keep sweeping
    # so another worker picks up jobs whose worker died (stale heartbeat).
    supervisor = asyncio.create_task(_batch_supervisor())
    try:
        yield
    finally:
        supervisor.cancel()


app = FastAPI(title="Aistrix API", version="1.0.0", lifespan=lifespan)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Narrowed from ["*"]/["*"] — only the methods/headers this API actually uses.
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret", "X-Schedule-Secret", "X-Workspace-Id"],
)

SUPABASE_URL              = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY         = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
RESEND_API_KEY            = os.getenv("RESEND_API_KEY")
EMAIL_FROM                = os.getenv("EMAIL_FROM", "Aistrix <noreply@aistrix.app>")
STRIPE_PLATFORM_FEE_PCT   = float(os.getenv("STRIPE_PLATFORM_FEE_PCT", "20"))  # % Aistrix keeps
FRONTEND_URL              = os.getenv("FRONTEND_URL", "http://localhost:5173")
GITHUB_CLIENT_ID          = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET      = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_REDIRECT_URI       = os.getenv("GITHUB_REDIRECT_URI")  # e.g. https://api.aistrix.app/auth/github/callback

# Short-lived nonce store for GitHub OAuth CSRF protection: nonce → (user_id, expiry_ts)
_oauth_nonces: dict[str, tuple[str, float]] = {}
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
REQUEST_TIMEOUT           = int(os.getenv("REQUEST_TIMEOUT", "90"))
HOURLY_LIMIT              = int(os.getenv("RATE_LIMIT_PER_HOUR", "30"))
DAILY_LIMIT               = int(os.getenv("RATE_LIMIT_PER_DAY", "200"))
MAX_INPUT_LENGTH          = int(os.getenv("MAX_INPUT_LENGTH", "20000"))
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


TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "").lower() in ("1", "true", "yes")
EMBED_VISITOR_HOURLY_LIMIT = int(os.getenv("EMBED_VISITOR_RATE_LIMIT_PER_HOUR", "20"))


def client_ip(request: Request) -> str:
    """Real client IP. Behind a load balancer request.client.host is the
    proxy, which would put every anonymous user in one shared bucket — set
    TRUST_PROXY_HEADERS=1 when the backend sits behind a trusted proxy."""
    if TRUST_PROXY_HEADERS:
        fwd = request.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_embed_visitor_rate_limit(ip: str, app_id: str) -> tuple[bool, str]:
    now = time.monotonic()
    hits = _anon_hits[f"embed:{app_id}:{ip}"]
    while hits and now - hits[0] > 3600:
        hits.popleft()
    if len(hits) >= EMBED_VISITOR_HOURLY_LIMIT:
        return False, "You've reached the hourly limit for this assistant. Please try again later."
    hits.append(now)
    return True, ""


def check_anon_rate_limit(ip: str) -> tuple[bool, str]:
    now = time.monotonic()
    hits = _anon_hits[ip]
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
def _service_client() -> Optional[Client]:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) if SUPABASE_SERVICE_ROLE_KEY else None


async def load_app_row(app_id: Optional[str]) -> Optional[dict]:
    sb = _service_client()
    if not (app_id and sb):
        return None
    try:
        res = await db(sb.table("apps").select("*").eq("id", app_id).maybe_single())
        return res.data if res and res.data else None
    except Exception as e:
        print(f"load_app_row error: {e}")
        return None


async def app_member_role(app_id: str, user_id: Optional[str]) -> Optional[str]:
    sb = _service_client()
    if not (sb and user_id):
        return None
    try:
        res = await db(sb.table("app_members").select("role").eq("app_id", app_id).eq("user_id", user_id).limit(1))
        return res.data[0]["role"] if res and res.data else None
    except Exception:
        return None   # table may not exist on older deployments


BUILD_ROLES = ("owner", "admin", "developer")     # build/edit apps, tools, keys
MANAGE_ROLES = ("owner", "admin")                 # people, settings, everyone's activity
BILLING_ROLES = ("owner", "admin", "billing")     # purchases
_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


async def workspace_role(workspace_id: Optional[str], user_id: Optional[str]) -> Optional[str]:
    sb = _service_client()
    if not (sb and workspace_id and user_id):
        return None
    try:
        res = await db(sb.table("workspace_members").select("role")
                       .eq("workspace_id", workspace_id).eq("user_id", user_id).limit(1))
        return res.data[0]["role"] if res and res.data else None
    except Exception:
        return None   # workspaces not migrated yet


async def personal_workspace_id(user_id: Optional[str]) -> Optional[str]:
    sb = _service_client()
    if not (sb and user_id):
        return None
    try:
        res = await db(sb.table("workspaces").select("id").eq("personal_owner_id", user_id).limit(1))
        return res.data[0]["id"] if res and res.data else None
    except Exception:
        return None


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
        return f"You've used all {quota} runs in this period — top up to keep running this app"
    return None


async def consume_entitlement_run(ent: dict, app_name: str) -> None:
    """Count a successful run against the buyer's quota. Server-side only:
    RLS blocks client writes to app_entitlements, so the old browser-side
    increment silently never happened and quotas were never enforced."""
    sb = _service_client()
    if not sb:
        return
    try:
        res = await db(sb.rpc("consume_entitlement_run", {"p_entitlement_id": ent["id"]}))
        used = res.data if isinstance(res.data, int) else (ent.get("runs_this_period") or 0) + 1
    except Exception:
        used = (ent.get("runs_this_period") or 0) + 1
        try:
            await db(sb.table("app_entitlements").update({"runs_this_period": used}).eq("id", ent["id"]))
        except Exception as e:
            print(f"consume_entitlement_run error: {e}")
            return
    quota = ent.get("run_quota")
    if quota and used == math.floor(quota * 0.8) and used < quota:
        email = await _lookup_email(ent["user_id"])
        if email:
            remaining = quota - used
            await send_email(
                to=email,
                subject=f"You've used 80% of your runs for {app_name}",
                html=_email_base(
                    title=f"Running low on {app_name}",
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
        res = await db(sb.table("user_api_keys").select("encrypted_key")
                       .eq("user_id", user_id).eq("provider", provider).eq("is_active", True).limit(1))
        return res.data[0]["encrypted_key"] if res and res.data else None
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
        h, d = await asyncio.gather(
            db(svc.table(table).select("id", count="exact", head=True).eq("user_id", user_id).gte("created_at", one_hour_ago)),
            db(svc.table(table).select("id", count="exact", head=True).eq("user_id", user_id).gte("created_at", day_start)),
        )
        return h.count or 0, d.count or 0

    try:
        return await counts("run_events")
    except Exception:
        return await counts("run_history")   # run_events not migrated yet


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
            sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) if SUPABASE_SERVICE_ROLE_KEY else get_supabase_for_user(user_jwt)
            hourly_count, daily_count = await get_usage_counts(sb, user_id)

            if hourly_count >= HOURLY_LIMIT:
                return False, f"Rate limit: {hourly_count}/{HOURLY_LIMIT} runs this hour. Try again in ~60 minutes."
            if daily_count >= DAILY_LIMIT:
                return False, f"Daily limit reached: {daily_count}/{DAILY_LIMIT} runs today. Resets at midnight UTC. Add your API key to bypass limits."

            return True, ""
        except Exception:
            pass  # DB error on a verified user — fall through to the conservative IP limit below

    return check_anon_rate_limit(client_ip(request))


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


async def execute_tool(tool: dict, tool_input: dict, ctx: Optional[dict] = None) -> str:
    """ctx carries run-scoped server data: {"secrets", "caller_id", "api_key", "provider"}."""
    ctx = ctx or {}
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
                    r = await fetch_safely("GET", url, timeout=15, params=body_fields, headers=headers)
                else:
                    r = await fetch_safely(method, url, timeout=15, json=body_fields, headers=headers)
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
            other_provider = other.get("ai_provider") or "claude"
            other_model = validate_model(other_provider, other.get("ai_model") or get_default_model(other_provider))
            key = ctx.get("api_key") if ctx.get("provider") == other_provider else None
            collected = []
            fn = stream_openai if other_provider == "openai" else stream_claude
            async for token in fn(other.get("system_prompt") or "You are helpful.", app_input, other_model, key):
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
            to = tool_input.get("to", "").strip()
            subject = tool_input.get("subject", "Message from Aistrix")
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
                              "from": {"email": config.get("from", "noreply@aistrix.ai")},
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


def get_default_model(provider: str) -> str:
    return {"claude": "claude-sonnet-5-5", "openai": "gpt-4o-mini"}.get(provider, "claude-sonnet-5-5")


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


async def run_openai_with_tools(system, user_input, model, tools, api_key=None, max_steps: int = 10, ctx: Optional[dict] = None):
    client = openai.AsyncOpenAI(api_key=api_key or os.getenv("OPENAI_API_KEY"))
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
    page_index: Optional[int] = Field(default=None, ge=0, le=50)   # multi-page apps

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
        name = field.get("field")
        if not name:
            continue
        label = f"{path}.{name}" if path else str(name)
        present = name in value and value[name] not in (None, "")
        if not present:
            if field.get("required") is not False:
                errors.append(f'"{label}" is required')
            continue

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
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        row = await asyncio.to_thread(
            lambda: sb.table("app_blueprints").select("blueprint").eq("app_id", app_id).maybe_single().execute()
        )
        return row.data.get("blueprint") if row and row.data and isinstance(row.data.get("blueprint"), dict) else {}
    except Exception as e:
        print(f"fetch_app_blueprint error: {e}")
        return {}


def _fields_to_input(fields: dict[str, Any]) -> str:
    lines = []
    for key, value in fields.items():
        if isinstance(value, (dict, list)):
            rendered = json.dumps(value, ensure_ascii=False)
        else:
            rendered = "" if value is None else str(value)
        lines.append(f"{key}: {rendered}")
    return "\n".join(lines)


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
        if not f.get("field"):
            continue
        req = "required" if f.get("required") is not False else "optional"
        extra = f" one of {f['enum_values']}" if f.get("enum_values") else ""
        desc = f" — {f['description']}" if f.get("description") else ""
        lines.append(f"{indent}- {f['field']} ({f.get('type') or 'string'}, {req}){extra}{desc}")
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


async def execute_run(req: RunRequest, request: Request, *, caller: "ApiCaller", on_complete=None):
    """Shared run pipeline for /run (browser) and /v1/apps/{id}/run (API).

    `caller` is already authenticated and carries the active workspace. For
    any app the caller can't edit, the prompt, model and provider come from
    the database — never from the request — so paid/private prompts can't be
    swapped or bypassed.
    """
    user_jwt, caller_id = caller.user_jwt, caller.user_id
    # ── App resolution + access ──────────────────────────────────────────────
    app_row = await load_app_row(req.app_id) if req.app_id else None
    if req.app_id and SUPABASE_SERVICE_ROLE_KEY and not app_row:
        return JSONResponse(status_code=404, content={"error": "App not found"})
    is_editor = await can_edit_app(app_row, caller) if app_row else False

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
    elif not caller_id:
        # Anonymous callers with no app context can't pick custom endpoints.
        req.custom_model_url = None
        req.custom_model_name = None

    if req.custom_model_url:
        try:
            assert_public_url(req.custom_model_url)
        except ValueError as e:
            return JSONResponse(status_code=400, content={"error": f"Custom model URL rejected: {e}"})

    # ── Paid-app entitlement (verified caller only) ───────────────────────────
    entitlement = None
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
    if req.custom_model_url and req.custom_model_name:
        provider = "custom"
        model = req.custom_model_name
    else:
        provider = req.ai_provider if req.ai_provider in ("claude", "openai") else "claude"
        model = validate_model(provider, req.ai_model or get_default_model(provider))

    # ── Key + rate limit. Bring-your-own-key callers aren't metered against
    # platform limits (that's what the 429 message has always promised).
    # Anonymous website visitors of a widget with visitor access run on the
    # owner's key when saved, with a per-visitor, per-app limit. ────────────
    embed_visitor = bool(app_row and not caller_id and app_row.get("embed_public") and not app_row.get("is_paid"))
    if caller_id and user_jwt:
        user_api_key = await fetch_user_api_key(user_jwt, provider)
    elif caller_id:
        user_api_key = await fetch_user_api_key_by_id(caller_id, provider)
    elif embed_visitor and app_row.get("created_by"):
        user_api_key = await fetch_user_api_key_by_id(app_row["created_by"], provider)
    else:
        user_api_key = None
    if embed_visitor:
        allowed, rate_msg = check_embed_visitor_rate_limit(client_ip(request), app_row["id"])
        if not allowed:
            return JSONResponse(status_code=429, content={"error": rate_msg})
    elif not user_api_key:
        allowed, rate_msg = await check_rate_limit(request, user_jwt, caller_id)
        if not allowed:
            return JSONResponse(status_code=429, content={"error": rate_msg})
        if caller_id:
            # Counted when the run starts: failed runs still spend platform tokens.
            await record_metered_run(caller_id, req.app_id, "api" if not user_jwt else "app", caller.workspace_id)

    # ── System prompt ────────────────────────────────────────────────────────
    base_system = (req.system_prompt or "You are a helpful AI assistant.") + RUN_MODE_SUFFIX.get(req.run_mode or "", "")
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
        fetch_app_tools(req.app_id) if req.app_id else _default([]),
        _load_app_secrets(req.app_id, owner_id) if (req.app_id and owner_id) else _default({}),
        fetch_app_blueprint(req.app_id) if req.app_id else _default({}),
    )
    webhook_url = app_row.get("webhook_url") if app_row else None

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

    async def finish(full_result: str):
        # Side effects first: consumers (stream=false, batches, clients that
        # disconnect on "done") stop reading at the done event, so anything
        # after that yield would never run.
        _record_run_outcome(True)
        if entitlement:
            asyncio.create_task(consume_entitlement_run(entitlement, app_name))
        if webhook_url:
            asyncio.create_task(_fire_webhook(webhook_url, req.app_id, req.input, full_result, provider, model))
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
            stream_fn = stream_openai if provider == "openai" else stream_claude

            # ── Tool-enabled agentic loop ──
            if tools:
                run_fn = run_claude_with_tools if provider != "openai" else run_openai_with_tools
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
                        _record_run_outcome(False, "contract")
                        return

            # ── Structured output: buffer, validate, one self-repair retry ──
            elif contract_fields:
                attempt_input = req.input
                text, errs = "", []
                for attempt in range(2):
                    attempt_usage: dict = {}
                    parts = [t async for t in stream_fn(system, attempt_input, model, user_api_key,
                                                        temperature=min(temp, 0.3), usage_holder=attempt_usage)]
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
                    _record_run_outcome(False, "contract")
                    return
                collected.append(text)
                for i in range(0, len(text), 200):
                    yield _sse({"token": text[i:i + 200]})

            # ── Standard streaming ──
            else:
                async for token in stream_fn(system, req.input, model, user_api_key, temperature=temp, usage_holder=usage):
                    collected.append(token)
                    yield _sse({"token": token})

            async for ev in finish("".join(collected)):
                yield ev

        except (anthropic.AuthenticationError, openai.AuthenticationError):
            _record_run_outcome(False, "auth")
            yield _sse({"error": f"Invalid {provider} API key — check Settings → Keys and make sure the key is active."})
        except (anthropic.PermissionDeniedError,):
            _record_run_outcome(False, "permission")
            yield _sse({"error": f"API key does not have permission for this model. Check your {provider} account."})
        except (anthropic.RateLimitError, openai.RateLimitError):
            _record_run_outcome(False, "rate_limit")
            yield _sse({"error": "Rate limit reached. Add your own API key in Settings → Keys for unlimited runs, or wait a moment and try again."})
        except (anthropic.BadRequestError, openai.BadRequestError) as e:
            _record_run_outcome(False, "bad_request")
            yield _sse({"error": f"Prompt config error: {str(e)[:200]}"})
        except (anthropic.InternalServerError, openai.InternalServerError):
            _record_run_outcome(False, "provider_error")
            yield _sse({"error": f"{provider.capitalize()} service error — try again in a moment."})
        except asyncio.TimeoutError:
            _record_run_outcome(False, "timeout")
            yield _sse({"error": f"Request timed out after {REQUEST_TIMEOUT} seconds. Try a shorter input or switch to a faster model (e.g. Haiku)."})
        except Exception as e:
            # Full detail goes to Sentry/logs only — never to the client.
            _record_run_outcome(False, "unexpected")
            sentry_sdk.capture_exception(e)
            print(f"Streaming error [{type(e).__name__}]: {e}")
            yield _sse({"error": "Unexpected backend error. This has been logged — please try again."})

    async def generate_with_timeout():
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                async for chunk in generate():
                    yield chunk
        except asyncio.TimeoutError:
            _record_run_outcome(False, "timeout")
            yield _sse({"error": f"Request timed out after {REQUEST_TIMEOUT}s. Try a shorter input or faster model."})

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
        return {"ok": False, "status": response.status_code, "error": body.get("error") or body.get("detail") or "Run failed"}
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
                return {"ok": False, "status": 422, "error": "Output contract failed", "errors": ev["contract_error"]}
            elif "error" in ev:
                status = 429 if "rate limit" in ev["error"].lower() else 504 if "timed out" in ev["error"].lower() else 502
                return {"ok": False, "status": status, "error": ev["error"]}
    return {"ok": False, "status": 502, "error": "Run ended without a result"}


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


async def _extract_api_file(f: ApiFileInput) -> tuple[str, bool]:
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
        text = await asyncio.to_thread(extractor, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        sentry_sdk.capture_exception(e)
        raise HTTPException(status_code=422, detail="Could not read this file — it may be corrupted or in an older format")
    return text[:MAX_EXTRACT_CHARS], ext in ("xlsx", "xlsm")


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
                     user_context: Optional[str] = None, temperature: Optional[float] = None) -> RunRequest:
    return RunRequest(
        app_id=app_id, input=input_text,
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
    app_data = await _load_api_app(app_id, caller)
    blueprint = await fetch_app_blueprint(app_id)

    pieces = []
    if req.fields is not None:
        pieces.append(_validated_fields_input(req.fields, _schema_fields(blueprint, "input_schema")))
    if (req.input or "").strip():
        pieces.append(req.input.strip())
    file_text, is_csv = "", False
    if req.file is not None:
        file_text, is_csv = await _extract_api_file(req.file)
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
        run_req = _api_run_request(app_id, app_data, input_text, **kwargs)
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
    blueprint = await fetch_app_blueprint(app_id)
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
        raise HTTPException(status_code=503, detail="Key storage isn't migrated — run supabase_developer_platform.sql")
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
        subject=f"You're invited to {ws[0]['name']} on Aistrix",
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
    blueprint = await fetch_app_blueprint(app_id)
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
        raise HTTPException(status_code=503, detail="Batch storage isn't migrated — run supabase_developer_platform.sql")
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


@app.post("/v1/files/extract")
async def extract_file_text(req: ExtractRequest, request: Request):
    """Turn an uploaded PDF / XLSX / DOCX into plain text (CSV for sheets)."""
    await require_verified_user(request)
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
    try:
        text = await asyncio.to_thread(extractor, data)
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
    sb_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
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
        assert_public_url(webhook_url)
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(webhook_url, json=payload, headers={"Content-Type": "application/json", "User-Agent": "Aistrix-Webhook/1.0"})
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
        f":rotating_light: Aistrix: {rate:.0%} of /run requests failed in the last {window_min} min "
        f"({failures}/{total}). Top error types: {top_kinds}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # {"text": ...} is a Slack incoming-webhook payload; any other
            # receiver can read the same field, so no receiver-specific branching.
            await client.post(OPS_ALERT_WEBHOOK_URL, json={"text": text}, headers={"Content-Type": "application/json", "User-Agent": "Aistrix-OpsAlert/1.0"})
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
            "input": current_input, "output": full,
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
    user_id = await verify_user_jwt(user_jwt) if user_jwt else None

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


class CheckoutSessionRequest(BaseModel):
    app_id: str
    plan: str = "pay_per_run"          # pay_per_run | subscription
    success_url: str
    cancel_url: str
    run_quota: Optional[int] = None    # for subscription plans


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

    amount_cents = int(float(app_data["price_per_run"]) * 100)
    app_name = app_data.get("name", "AI App")

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


async def send_email(to: str, subject: str, html: str) -> bool:
    """Send a transactional email via Resend. Returns True on success."""
    if not RESEND_API_KEY:
        print(f"EMAIL (no key): to={to} subject={subject}")
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
                json={"from": EMAIL_FROM, "to": [to], "subject": subject, "html": html},
            )
            if r.status_code not in (200, 201):
                print(f"Resend error {r.status_code}: {r.text}")
                return False
        return True
    except Exception as e:
        print(f"send_email exception: {e}")
        return False


def _email_base(title: str, body: str, cta_url: str = "", cta_label: str = "") -> str:
    cta = f'<a href="{cta_url}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:#6C5CE7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">{cta_label}</a>' if cta_url else ""
    return f"""<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09101F;color:#E2E8F0;margin:0;padding:40px 20px">
<div style="max-width:520px;margin:0 auto;background:#0E1424;border:1px solid rgba(255,255,255,0.05);border-radius:16px;padding:36px">
  <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#fff">{title}</p>
  <div style="height:2px;width:32px;background:#6C5CE7;border-radius:2px;margin:12px 0 20px"></div>
  <div style="font-size:14px;line-height:1.7;color:#94A3B8">{body}</div>
  {cta}
  <p style="margin:32px 0 0;font-size:11px;color:#334155">Aistrix · You're receiving this because you have an account on aistrix.app</p>
</div></body></html>"""


async def _lookup_email(user_id: str) -> Optional[str]:
    """Look up a user's email from Supabase auth.users via the service-role client."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        return None
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        result = await asyncio.to_thread(
            lambda: sb.auth.admin.get_user_by_id(user_id)
        )
        return result.user.email if result and result.user else None
    except Exception as e:
        print(f"_lookup_email error: {e}")
        return None


async def _record_purchase(
    app_id: str, buyer_id: str, dev_id: str, plan: str,
    stripe_customer_id: Optional[str], stripe_sub_id: Optional[str],
    sb,
):
    """Insert a row into purchases and attempt a Stripe Connect transfer to the developer."""
    try:
        # Fetch app price + dev's Connect account id
        app_row = await asyncio.to_thread(
            lambda: sb.table("apps").select("price_per_run").eq("id", app_id).single().execute()
        )
        price = float(app_row.data.get("price_per_run") or 0) if app_row.data else 0.0

        dev_row = await asyncio.to_thread(
            lambda: sb.table("developer_profiles")
                .select("stripe_account_id")
                .eq("user_id", dev_id).single().execute()
        )
        stripe_account_id = dev_row.data.get("stripe_account_id") if dev_row.data else None

        platform_fee = round(price * STRIPE_PLATFORM_FEE_PCT / 100, 6)
        dev_share    = round(price - platform_fee, 6)

        # Insert purchase record
        purchase_row = {
            "app_id":             app_id,
            "buyer_id":           buyer_id,
            "dev_id":             dev_id,
            "plan":               plan,
            "gross_amount":       price,
            "platform_fee":       platform_fee,
            "dev_share":          dev_share,
            "stripe_customer_id": stripe_customer_id,
            "stripe_sub_id":      stripe_sub_id,
            "payout_status":      "pending" if stripe_account_id else "no_connect_account",
        }
        await asyncio.to_thread(
            lambda: sb.table("purchases").insert(purchase_row).execute()
        )

        # Attempt transfer if developer has Connect account and price > 0
        if stripe_account_id and dev_share > 0:
            import stripe
            stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
            transfer_amount = int(dev_share * 100)  # cents
            try:
                await asyncio.to_thread(
                    stripe.Transfer.create,
                    amount=transfer_amount,
                    currency="usd",
                    destination=stripe_account_id,
                    metadata={"app_id": app_id, "buyer_id": buyer_id, "plan": plan},
                )
                purchase_row = await asyncio.to_thread(
                    lambda: sb.table("purchases")
                        .select("id").eq("app_id", app_id).eq("buyer_id", buyer_id)
                        .order("created_at", desc=True).limit(1).execute()
                )
                if purchase_row.data:
                    purchase_id = purchase_row.data[0]["id"]
                    await asyncio.to_thread(
                        lambda: sb.table("purchases")
                            .update({"payout_status": "transferred"})
                            .eq("id", purchase_id).execute()
                    )
                print(f"Transfer {transfer_amount}c → connect/{stripe_account_id} for app={app_id}")
            except Exception as te:
                print(f"Stripe Transfer failed: {te}")

    except Exception as e:
        print(f"_record_purchase error: {e}")


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
    """Upsert app_entitlements row using the service-role client (bypasses RLS)."""
    if not SUPABASE_SERVICE_ROLE_KEY:
        print("WARN: SUPABASE_SERVICE_ROLE_KEY not set — cannot upsert entitlement")
        return
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
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

    result = await asyncio.to_thread(
        lambda: sb.table("app_entitlements")
            .upsert(row, on_conflict="app_id,user_id")
            .execute()
    )
    print(f"Entitlement upserted: app={app_id} user={user_id} plan={plan} status={status}")

    if status != "active":
        return

    # Look up app name + developer user_id
    try:
        app_row = await asyncio.to_thread(
            lambda: sb.table("apps").select("name, created_by").eq("id", app_id).single().execute()
        )
        app_name    = app_row.data["name"] if app_row.data else "your app"
        dev_user_id = app_row.data.get("created_by") if app_row.data else None
    except Exception:
        app_name, dev_user_id = "your app", None

    plan_label = "subscription" if plan == "subscription" else "purchase"

    # Email buyer — welcome
    buyer_email = await _lookup_email(user_id)
    if buyer_email:
        await send_email(
            to=buyer_email,
            subject=f"You now have access to {app_name}",
            html=_email_base(
                title=f"Welcome to {app_name} 🎉",
                body=f"Your {plan_label} is confirmed. You can run <strong style='color:#fff'>{app_name}</strong> from your Aistrix dashboard any time.",
                cta_url="https://aistrix.app",
                cta_label="Open Aistrix →",
            ),
        )

    # Email developer — new sale
    if dev_user_id and dev_user_id != user_id:
        dev_email = await _lookup_email(dev_user_id)
        if dev_email:
            await send_email(
                to=dev_email,
                subject=f"New {plan_label} for {app_name}",
                html=_email_base(
                    title=f"You have a new {plan_label}! 💰",
                    body=f"Someone just made a <strong style='color:#fff'>{plan_label}</strong> for <strong style='color:#fff'>{app_name}</strong>. Check your Monitor tab for subscriber stats.",
                    cta_url="https://aistrix.app",
                    cta_label="View in Dev Studio →",
                ),
            )

    # Record purchase for revenue tracking + attempt Connect transfer
    if dev_user_id:
        await _record_purchase(
            app_id=app_id, buyer_id=user_id, dev_id=dev_user_id,
            plan=plan, stripe_customer_id=stripe_customer_id,
            stripe_sub_id=stripe_sub_id, sb=sb,
        )


@app.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe payment and subscription webhooks."""
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
            event = await asyncio.to_thread(
                stripe.Webhook.construct_event, payload, sig_header, webhook_secret
            )
        else:
            # Dev mode: parse without signature verification
            event = json.loads(payload)
    except (ValueError, Exception):
        raise HTTPException(status_code=400, detail="Invalid payload or signature")

    event_type = event.get("type", "")
    obj = event.get("data", {}).get("object", {})
    meta = obj.get("metadata", {})

    # ── One-time payment via Checkout Session ───────────────────────────────
    if event_type == "checkout.session.completed":
        app_id  = meta.get("app_id")
        user_id = meta.get("user_id")
        plan    = meta.get("plan", "pay_per_run")
        run_quota_str = meta.get("run_quota", "")
        run_quota = int(run_quota_str) if run_quota_str and run_quota_str.isdigit() else None

        if app_id and user_id:
            customer_id = obj.get("customer")
            sub_id      = obj.get("subscription")
            await _upsert_entitlement(
                app_id=app_id, user_id=user_id, plan=plan,
                stripe_customer_id=customer_id, stripe_sub_id=sub_id,
                run_quota=run_quota, workspace_id=meta.get("workspace_id") or None,
            )

    # ── PaymentIntent (Elements flow) ───────────────────────────────────────
    elif event_type == "payment_intent.succeeded":
        app_id  = meta.get("app_id")
        user_id = meta.get("user_id")
        if app_id and user_id and user_id != "anonymous":
            await _upsert_entitlement(app_id=app_id, user_id=user_id, plan="pay_per_run")

    # ── Subscription lifecycle ──────────────────────────────────────────────
    elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
        sub = obj
        app_id  = sub.get("metadata", {}).get("app_id")
        user_id = sub.get("metadata", {}).get("user_id")
        if not (app_id and user_id):
            # Try to look up via customer in app_entitlements
            customer_id = sub.get("customer")
            if customer_id and SUPABASE_SERVICE_ROLE_KEY:
                sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
                row = await asyncio.to_thread(
                    lambda: sb.table("app_entitlements")
                        .select("app_id, user_id")
                        .eq("stripe_customer_id", customer_id)
                        .limit(1).execute()
                )
                if row.data:
                    app_id  = row.data[0]["app_id"]
                    user_id = row.data[0]["user_id"]

        if app_id and user_id:
            status = "active" if sub.get("status") == "active" else sub.get("status", "active")
            period = sub.get("current_period_end")
            period_end_iso = datetime.fromtimestamp(period, tz=timezone.utc).isoformat() if period else None
            period_start = sub.get("current_period_start")
            period_start_iso = datetime.fromtimestamp(period_start, tz=timezone.utc).isoformat() if period_start else None
            await _upsert_entitlement(
                app_id=app_id, user_id=user_id, plan="subscription",
                stripe_customer_id=sub.get("customer"),
                stripe_sub_id=sub.get("id"),
                status=status,
                period_start=period_start_iso,
                period_end=period_end_iso,
            )

    elif event_type == "customer.subscription.deleted":
        sub_id = obj.get("id")
        if sub_id and SUPABASE_SERVICE_ROLE_KEY:
            sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
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
                            cta_url="https://aistrix.app",
                            cta_label="Open Aistrix →",
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
                cta_url="https://aistrix.app",
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
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    # Check if dev already has a Connect account
    dev_row = await asyncio.to_thread(
        lambda: sb.table("developer_profiles")
            .select("stripe_account_id")
            .eq("user_id", dev_id).maybe_single().execute()
    )
    stripe_account_id = dev_row.data.get("stripe_account_id") if dev_row.data else None

    if not stripe_account_id:
        # Create new Express account
        account = await asyncio.to_thread(
            stripe.Account.create,
            type="express",
            metadata={"aistrix_user_id": dev_id},
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
        refresh_url=f"{FRONTEND_URL}/studio?stripe_connect=refresh",
        return_url=f"{FRONTEND_URL}/studio?stripe_connect=success",
        type="account_onboarding",
    )
    return {"url": link.url, "stripe_account_id": stripe_account_id}


@app.get("/stripe/connect/status")
async def stripe_connect_status(request: Request):
    """Return the developer's Connect account status."""
    import stripe
    secret_key = os.getenv("STRIPE_SECRET_KEY")

    dev_id = await require_verified_user(request)

    if not SUPABASE_SERVICE_ROLE_KEY:
        return {"connected": False}
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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
        account = await asyncio.to_thread(stripe.Account.retrieve, stripe_account_id)
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


@app.get("/stripe/earnings")
async def stripe_earnings(request: Request):
    """Return the developer's earnings summary from the purchases table."""
    dev_id = await require_verified_user(request)

    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Service role key not configured")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    purchases = await asyncio.to_thread(
        lambda: sb.table("purchases")
            .select("app_id, plan, gross_amount, platform_fee, dev_share, payout_status, created_at")
            .eq("dev_id", dev_id)
            .order("created_at", desc=True)
            .execute()
    )
    rows = purchases.data or []

    total_gross   = sum(r.get("gross_amount", 0) or 0 for r in rows)
    total_dev     = sum(r.get("dev_share", 0) or 0 for r in rows)
    total_pending = sum(r.get("dev_share", 0) or 0 for r in rows if r.get("payout_status") == "pending")
    by_app: dict = {}
    for r in rows:
        aid = r["app_id"]
        if aid not in by_app:
            by_app[aid] = {"app_id": aid, "total_gross": 0, "total_dev_share": 0, "sale_count": 0}
        by_app[aid]["total_gross"]     += r.get("gross_amount", 0) or 0
        by_app[aid]["total_dev_share"] += r.get("dev_share", 0) or 0
        by_app[aid]["sale_count"]      += 1

    return {
        "total_gross":       round(total_gross, 2),
        "total_dev_share":   round(total_dev, 2),
        "total_pending":     round(total_pending, 2),
        "platform_fee_pct":  STRIPE_PLATFORM_FEE_PCT,
        "by_app":            list(by_app.values()),
        "recent":            rows[:20],
    }


# ─── GitHub OAuth ─────────────────────────────────────────────────────────────

@app.get("/auth/github")
async def github_oauth_start(request: Request, token: Optional[str] = None):
    """Redirect developer to GitHub OAuth authorisation page."""
    if not GITHUB_CLIENT_ID:
        raise HTTPException(status_code=503, detail="GitHub OAuth not configured")
    # Accept token as query param (browser redirect can't set headers)
    if token:
        user_id = await verify_user_jwt(token)
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    else:
        user_id = await require_verified_user(request)
    nonce = secrets.token_urlsafe(32)
    _oauth_nonces[nonce] = (user_id, time.time() + 600)  # 10-min window
    # Prune stale nonces
    now = time.time()
    for k in [k for k, (_, exp) in list(_oauth_nonces.items()) if exp < now]:
        _oauth_nonces.pop(k, None)
    scope = "repo"
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&redirect_uri={GITHUB_REDIRECT_URI}"
        f"&scope={scope}"
        f"&state={nonce}"
    )
    return RedirectResponse(url)


@app.get("/auth/github/callback")
async def github_oauth_callback(code: str, state: str, request: Request):
    """Exchange GitHub OAuth code for access token and store it server-side."""
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="GitHub OAuth not configured")

    # Verify CSRF nonce and extract user_id
    nonce_entry = _oauth_nonces.pop(state, None)
    if not nonce_entry or nonce_entry[1] < time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")
    dev_id = nonce_entry[0]

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
        raise HTTPException(status_code=400, detail=f"GitHub token exchange failed: {token_data.get('error_description', 'unknown error')}")

    # Fetch GitHub username to confirm the connection
    async with httpx.AsyncClient(timeout=10) as c:
        me = await c.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
    github_user = me.json()
    github_login = github_user.get("login", "")

    # Store token server-side in developer_settings (service-role only)
    if SUPABASE_SERVICE_ROLE_KEY:
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        existing = await asyncio.to_thread(
            lambda: sb.table("developer_settings")
                .select("settings")
                .eq("user_id", dev_id).maybe_single().execute()
        )
        current = {}
        if existing and existing.data:
            current = existing.data.get("settings") or {}
        current["github"] = {"token": access_token, "login": github_login, "connected_at": datetime.now(timezone.utc).isoformat()}
        await asyncio.to_thread(
            lambda: sb.table("developer_settings")
                .upsert({"user_id": dev_id, "settings": current}, on_conflict="user_id")
                .execute()
        )

    return RedirectResponse(f"{FRONTEND_URL}/studio?github_connected=1&login={github_login}")


# ─── App Secrets ─────────────────────────────────────────────────────────────

class SecretUpsert(BaseModel):
    key:   str
    value: str

@app.get("/apps/{app_id}/secrets")
async def list_secrets(app_id: str, request: Request):
    """Return secret key names only — never values."""
    if not _fernet:
        return {"secrets": [], "warning": "SECRET_ENCRYPTION_KEY not configured"}
    user_id = await require_verified_user(request)
    if not SUPABASE_SERVICE_ROLE_KEY:
        return {"secrets": []}
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    rows = await asyncio.to_thread(
        lambda: sb.table("app_secrets")
            .select("key, created_at, updated_at")
            .eq("app_id", app_id).eq("user_id", user_id)
            .order("key").execute()
    )
    return {"secrets": rows.data or []}

@app.put("/apps/{app_id}/secrets")
async def upsert_secret(app_id: str, body: SecretUpsert, request: Request):
    """Create or update a secret value (stored encrypted, value never returned)."""
    if not _fernet:
        raise HTTPException(status_code=503, detail="SECRET_ENCRYPTION_KEY not set on server — add it to .env and restart")
    user_id = await require_verified_user(request)
    if not body.key.strip():
        raise HTTPException(status_code=400, detail="Key cannot be empty")
    if len(body.key) > 100:
        raise HTTPException(status_code=400, detail="Key too long (max 100 chars)")
    if not re.match(r'^[A-Z0-9_]+$', body.key.upper()):
        raise HTTPException(status_code=400, detail="Key must contain only letters, numbers, and underscores")
    encrypted = _encrypt(body.value)
    now = datetime.now(timezone.utc).isoformat()
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
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
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    await asyncio.to_thread(
        lambda: sb.table("app_secrets")
            .delete().eq("app_id", app_id).eq("user_id", user_id).eq("key", key.upper())
            .execute()
    )
    return {"ok": True}

async def _load_app_secrets(app_id: str, user_id: str) -> dict[str, str]:
    """Load decrypted secrets for injection into a run — server-side only."""
    if not _fernet or not SUPABASE_SERVICE_ROLE_KEY:
        return {}
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    rows = await asyncio.to_thread(
        lambda: sb.table("app_secrets")
            .select("key, encrypted_value")
            .eq("app_id", app_id).eq("user_id", user_id).execute()
    )
    result = {}
    for r in (rows.data or []):
        try:
            result[r["key"]] = _decrypt(r["encrypted_value"])
        except Exception:
            pass
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


@app.post("/apps/{app_id}/publish")
async def publish_app(app_id: str, request: Request):
    """Validate publish criteria server-side and set status='live'."""
    user_id = await require_verified_user(request)
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="Service not configured")
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    app_row = await asyncio.to_thread(
        lambda: sb.table("apps")
            .select("id, name, system_prompt, created_by")
            .eq("id", app_id).eq("created_by", user_id).maybe_single().execute()
    )
    if not app_row or not app_row.data:
        raise HTTPException(status_code=404, detail="App not found")
    data = app_row.data
    errors = []
    if not (data.get("name") or "").strip():
        errors.append("App name is required")
    if not (data.get("system_prompt") or "").strip():
        errors.append("System prompt is required")
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))
    await asyncio.to_thread(
        lambda: sb.table("marketplace_listings")
            .update({"status": "live"})
            .eq("app_id", app_id).eq("user_id", user_id).execute()
    )
    return {"status": "live"}


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
