"""AI providers and who pays: developers' own keys (encrypted, checked on
save), Claude/OpenAI/Gemini routing, model choice on own vs platform keys,
and per-app billing — free (developer's key, per-user daily limit) or byok
(end users' own key)."""
from types import SimpleNamespace as NS

from cryptography.fernet import Fernet

import _harness
from _harness import ok, finish
_harness.setup(SECRET_ENCRYPTION_KEY=Fernet.generate_key().decode())
import main  # noqa
from fastapi.testclient import TestClient

c = TestClient(main.app)
OWNER, BUYER, STRANGER = "owner", "buyer", "stranger"

# ── keys: encrypted at rest, legacy plaintext still readable ────────────────
sealed = main._encrypt("sk-ant-secret-1234")
ok("stored keys are encrypted", sealed.startswith("gAAAA") and "secret" not in sealed)
ok("encrypted keys open", main._open_key(sealed) == "sk-ant-secret-1234")
ok("legacy plaintext keys still work", main._open_key("sk-legacy-9999") == "sk-legacy-9999")
ok("tampered ciphertext → no key", main._open_key("gAAAAnot-a-real-token") is None)

# ── model choice ────────────────────────────────────────────────────────────
ok("platform key: unknown model → provider default", main.validate_model("openai", "gpt-6-astra") == "gpt-4o-mini")
ok("own key: any model the provider offers", main.validate_model("openai", "gpt-6-astra", any_model=True) == "gpt-6-astra")
ok("own key: junk model ids still rejected", main.validate_model("openai", "x; drop table", any_model=True) == "gpt-4o-mini")
ok("gemini default model", main.validate_model("gemini", None) == "gemini-3.8-flash")
ok("gemini uses Google's OpenAI-compatible endpoint",
   str(main._openai_client("gemini", "AIza-test").base_url).startswith("https://generativelanguage.googleapis.com/v1beta/openai"))

# ── runs: who pays ──────────────────────────────────────────────────────────
APPS = {}
def app(app_id, billing="free", provider="claude", model=None, limit=None, embed=False):
    APPS[app_id] = {"id": app_id, "name": app_id, "created_by": OWNER, "is_published": True, "is_paid": False,
                    "visibility": "public", "system_prompt": "Help", "ai_provider": provider, "ai_model": model,
                    "billing_mode": billing, "free_runs_per_user_day": limit, "embed_public": embed}

KEYS = {}            # (user, provider) → key
DEV_RUNS = {}        # (user, app) → runs today
EVENTS = []
CALLS = []

async def load_app_row(app_id): return APPS.get(app_id)
async def verify(tok): return {"tok-owner": OWNER, "tok-buyer": BUYER, "tok-stranger": STRANGER}.get(tok)
async def key_by_jwt(jwt, provider): return KEYS.get(({"tok-owner": OWNER, "tok-buyer": BUYER, "tok-stranger": STRANGER}.get(jwt), provider))
async def key_by_id(uid, provider): return KEYS.get((uid, provider))
async def runs_today(uid, app_id): return DEV_RUNS.get((uid, app_id), 0)
async def record(uid, app_id, source, ws=None): EVENTS.append((uid, app_id, source))
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def allow(*a, **k): return True, ""

def fake_stream(name):
    async def stream(system, user_input, model, api_key=None, usage_holder=None, provider=None, **kw):
        CALLS.append({"fn": name, "key": api_key, "model": model, "provider": provider})
        yield "ok"
    return stream

main.load_app_row = load_app_row; main.verify_user_jwt = verify
main.fetch_user_api_key = key_by_jwt; main.fetch_user_api_key_by_id = key_by_id
main.dev_key_runs_today = runs_today; main.record_metered_run = record
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main.fetch_app_blueprint = emptyd
main._load_app_secrets = emptyd; main.check_rate_limit = allow
main.stream_claude = fake_stream("claude"); main.stream_openai = fake_stream("openai")
main.platform_key = lambda provider: "platform-key" if provider in ("claude", "openai") else None

def run(app_id, tok=None):
    CALLS.clear(); EVENTS.clear()
    r = c.post("/run", json={"app_id": app_id, "input": "hi"}, headers={"Authorization": f"Bearer {tok}"} if tok else {})
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text)

# free: developer's key pays
app("free-app"); KEYS[(OWNER, "claude")] = "sk-dev"
code, _ = run("free-app", "tok-buyer")
ok("free: developer's key pays for end users", code == 200 and CALLS[0]["key"] == "sk-dev")
ok("free: counted as a developer-paid run", EVENTS == [(BUYER, "free-app", "dev_key")])
KEYS[(BUYER, "claude")] = "sk-buyer"
run("free-app", "tok-buyer")
ok("free: developer's key used even if the user has one", CALLS[0]["key"] == "sk-dev")
DEV_RUNS[(BUYER, "free-app")] = main.DEV_KEY_RUNS_PER_USER_DAY
code, body = run("free-app", "tok-buyer")
ok("free: default per-user daily limit → 429", code == 429 and "free runs of this app" in body["error"] and CALLS == [])
app("free-limited", limit=2); DEV_RUNS[(BUYER, "free-limited")] = 2
code, body = run("free-limited", "tok-buyer")
ok("free: the app's own daily limit applies", code == 429 and "today's 2 free runs" in body["error"])
DEV_RUNS.clear()

# free without a developer key: user's own key, else the platform
del KEYS[(OWNER, "claude")]
run("free-app", "tok-buyer")
ok("free, no developer key: user's own key, not metered", CALLS[0]["key"] == "sk-buyer" and EVENTS == [])
code, _ = run("free-app", "tok-stranger")
ok("free, no keys at all: platform key, metered", code == 200 and CALLS[0]["key"] is None and EVENTS == [(STRANGER, "free-app", "app")])

# byok: end users bring their own key
app("byok-app", billing="byok"); KEYS[(OWNER, "claude")] = "sk-dev"
code, _ = run("byok-app", "tok-buyer")
ok("byok: the user's own key is used", code == 200 and CALLS[0]["key"] == "sk-buyer" and EVENTS == [])
code, body = run("byok-app", "tok-stranger")
ok("byok: no key → 403 needs_own_key, nothing run", code == 403 and body["code"] == "needs_own_key"
   and "Settings → Keys" in body["error"] and CALLS == [])
code, body = run("byok-app")
ok("byok: signed out → 401 asking to sign in", code == 401 and "Sign in" in body["error"])
app("byok-embed", billing="byok", embed=True)
ok("byok: website visitors can't run it", run("byok-embed")[0] == 401)
code, _ = run("byok-app", "tok-owner")
ok("byok: the developer can still build/test with their key", code == 200 and CALLS[0]["key"] == "sk-dev")

# providers and models
app("gemini-app", provider="gemini", model="gemini-4-pro"); KEYS[(OWNER, "gemini")] = "AIza-dev"
code, _ = run("gemini-app", "tok-buyer")
ok("gemini apps run through the OpenAI-compatible path", code == 200 and CALLS[0]["fn"] == "openai" and CALLS[0]["provider"] == "gemini")
ok("…with the developer's key and their chosen model", CALLS[0]["key"] == "AIza-dev" and CALLS[0]["model"] == "gemini-4-pro")
del KEYS[(OWNER, "gemini")]
code, body = run("gemini-app", "tok-buyer")
ok("no key anywhere for a provider → clear 400", code == 400 and body["code"] == "needs_own_key" and "Gemini" in body["error"])
app("openai-app", provider="openai", model="gpt-6-astra")
run("openai-app", "tok-stranger")
ok("platform-key run keeps to the allowed models", CALLS[0]["model"] == "gpt-4o-mini" and CALLS[0]["key"] is None)

# ── platform limits ignore developer-paid runs ──────────────────────────────
QUERIES = []
class _Q:
    def __init__(self): self.calls = []
    def __getattr__(self, name):
        def f(*a, **k): self.calls.append((name, a)); return self
        return f
    def execute(self): QUERIES.append(self.calls); return NS(count=3, data=None)
main._service_client = lambda: NS(table=lambda t: _Q())
import asyncio
h, d = asyncio.run(main.get_usage_counts(None, BUYER))
ok("platform run limits exclude developer-paid runs", (h, d) == (3, 3)
   and all(("neq", ("source", "dev_key")) in q for q in QUERIES))

# ── key endpoints ───────────────────────────────────────────────────────────
SAVED = []
class _Table:
    def __init__(self, name): self.name = name; self.op = None
    def upsert(self, row, on_conflict=None): SAVED.append(row); return self
    def delete(self): self.op = "delete"; return self
    def select(self, *a, **k): return self
    def eq(self, *a): return self
    def execute(self):
        if self.op == "delete": SAVED.clear()
        return NS(data=[{"provider": r["provider"], "last4": r["last4"], "is_active": True, "encrypted_key": r["encrypted_key"]} for r in SAVED])
main._service_client = lambda: NS(table=lambda t: _Table(t))
async def verified(req):
    if req.headers.get("Authorization") == "Bearer tok-owner":
        return OWNER
    raise main.HTTPException(status_code=401, detail="Unauthorized")
main.require_verified_user = verified
LISTED = []
async def models(provider, key):
    LISTED.append((provider, key))
    if key.endswith("bad!"):
        raise main.anthropic.AuthenticationError("bad", response=NS(status_code=401, headers={}, request=None), body=None)
    return [{"id": "claude-next", "label": "Claude Next"}]
main.list_provider_models = models
auth = {"Authorization": "Bearer tok-owner"}

r = c.put("/v1/provider-keys/claude", json={"key": "sk-ant-good-key-7777"}, headers=auth)
ok("save key: checked with the provider, stored encrypted",
   r.status_code == 200 and r.json()["last4"] == "7777" and LISTED[-1] == ("claude", "sk-ant-good-key-7777")
   and SAVED[0]["encrypted_key"].startswith("gAAAA") and "good-key" not in SAVED[0]["encrypted_key"]
   and main._open_key(SAVED[0]["encrypted_key"]) == "sk-ant-good-key-7777")
r = c.put("/v1/provider-keys/claude", json={"key": "sk-ant-key-is-bad!"}, headers=auth)
ok("rejected key → 422, not saved", r.status_code == 422 and "rejected" in r.json()["detail"] and len(SAVED) == 1)
r = c.put("/v1/provider-keys/claude", json={"key": "AIzaWrongProvider"}, headers=auth)
ok("wrong key format for the provider → 422", r.status_code == 422 and "sk-ant-" in r.json()["detail"])
ok("unknown provider → 404", c.put("/v1/provider-keys/nope", json={"key": "whatever-123"}, headers=auth).status_code == 404)
ok("signed out → 401", c.put("/v1/provider-keys/claude", json={"key": "sk-ant-good-key-7777"}).status_code == 401)

r = c.get("/v1/providers", headers=auth).json()["providers"]
by = {p["id"]: p for p in r}
ok("providers: Claude, OpenAI, Gemini", list(by) == ["claude", "openai", "gemini"])
ok("providers: connected + last4, never the key", by["claude"]["connected"] and by["claude"]["last4"] == "7777"
   and "encrypted_key" not in str(r) and "good-key" not in str(r))
ok("providers: models = platform list + the key's live list", [m["id"] for m in by["claude"]["models"]][-1] == "claude-next"
   and by["claude"]["models"][0]["id"] == "claude-sonnet-5-5")
ok("providers: not-connected providers show the platform list", not by["gemini"]["connected"] and by["gemini"]["models"][0]["id"] == "gemini-3.8-flash")
r = c.delete("/v1/provider-keys/claude", headers=auth)
ok("remove key", r.status_code == 200 and SAVED == [])

finish()
