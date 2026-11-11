"""OpenAI/Anthropic-compatible model gateway (/v1/gateway) end to end through
main.py, called with the REAL openai and anthropic Python SDKs (their HTTP
client is pointed at the app). Upstream providers, Supabase and the spending
controls are fakes; nothing leaves the process."""
import json
import uuid

import _harness
from _harness import finish


def ok(name, cond, detail=None):
    if not _harness.ok(name, cond) and detail is not None:
        print(f"  detail: {str(detail)[:600]}")


from cryptography.fernet import Fernet

_harness.setup(PLATFORM_RESUME_SECONDS="0", SECRET_ENCRYPTION_KEY=Fernet.generate_key().decode())

import anthropic
import openai
from fastapi.testclient import TestClient

import main


class Res:
    def __init__(self, data):
        self.data = data


class Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload, self.limit_n, self.order_by = db, table, [], "select", None, None, None

    def select(self, *_a, **_k): self.op = "select"; return self
    def insert(self, row): self.op, self.payload = "insert", row; return self
    def eq(self, k, v): self.filters.append(lambda r: r.get(k) == v); return self
    def order(self, k, desc=False): self.order_by = (k, desc); return self
    def limit(self, n): self.limit_n = n; return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "insert":
            rows.append(json.loads(json.dumps(self.payload)))
            return Res([self.payload])
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.order_by:
            match.sort(key=lambda r: r.get(self.order_by[0]) or "", reverse=self.order_by[1])
        return Res(match[:self.limit_n] if self.limit_n else match)


class FakeSB:
    def __init__(self): self.db = {}
    def table(self, t): return Q(self.db, t)
    def rpc(self, *a, **k): raise Exception("no such function")


SB = FakeSB()
main._service_client = lambda: SB
main.get_anon_client = lambda: SB

OWNER, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
KEYS = {"ak_live_owner1": {"user_id": OWNER, "workspace_id": None, "app_ids": [], "key_id": "k1"},
        "ak_live_other1": {"user_id": OTHER, "workspace_id": None, "app_ids": [], "key_id": "k2"},
        "ak_live_restricted": {"user_id": OWNER, "workspace_id": None, "app_ids": ["app-1"], "key_id": "k3"}}


async def resolve_key(raw):
    return KEYS.get(raw)
main.resolve_developer_key = resolve_key


async def none(*a, **k): return None
main.personal_workspace_id = none
main.resolve_user_workspace = none


async def verify(tok): return {"jwt-owner": OWNER}.get(tok)
main.verify_user_jwt = verify

PROVIDER_KEYS = {}
async def provider_key(user_id, provider):
    return PROVIDER_KEYS.get((user_id, provider))
main.fetch_user_api_key_by_id = provider_key
PROVIDER_KEYS[(OWNER, "claude")] = "sk-ant-owner-own"
PROVIDER_KEYS[(OWNER, "openai")] = "sk-openai-owner-own"

SPEND, REFUSE = [], []
async def reserve(**kw):
    SPEND.append(("reserve", kw["model"], kw["amount"], kw["key_owner"]))
    if REFUSE:
        return None, {"ok": False, "code": "key_cap", "limit": 5, "spent": 5}
    return f"r{len(SPEND)}", None
def settle(rid, actual, outcome):
    SPEND.append(("settle", rid, actual, outcome))
main.reserve_run_spend = reserve
main.settle_run_spend = settle


# ── Upstream fakes: the provider SDK clients the gateway creates ─────────────

class _B:
    def __init__(self, **kw): self.__dict__.update(kw)


UP = {"claude": [], "openai": []}          # requests that reached each provider
REPLIES = {"claude": [], "openai": []}     # scripted answers


def claude_text(text, stop="end_turn"):
    return _B(content=[_B(type="text", text=text)], usage=_B(input_tokens=400, output_tokens=50), stop_reason=stop)


def claude_tool(name, args, cid="toolu_1"):
    return _B(content=[_B(type="tool_use", id=cid, name=name, input=args)], usage=_B(input_tokens=400, output_tokens=30),
              stop_reason="tool_use")


class ClaudeStream:
    def __init__(self, reply): self.reply = reply
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False

    @property
    async def text_stream(self):
        for b in self.reply.content:
            if b.type == "text":
                for i in range(0, len(b.text), 4):
                    yield b.text[i:i + 4]

    async def get_final_message(self): return self.reply


class FakeAnthropic:
    def __init__(self, api_key=None):
        self.api_key = api_key
        self.messages = self

    async def create(self, **kw):
        UP["claude"].append({**kw, "api_key": self.api_key, "streamed": False})
        return REPLIES["claude"].pop(0)

    def stream(self, **kw):
        UP["claude"].append({**kw, "api_key": self.api_key, "streamed": True})
        return ClaudeStream(REPLIES["claude"].pop(0))


main.anthropic.AsyncAnthropic = FakeAnthropic


class FakeOpenAI:
    def __init__(self, api_key):
        self.api_key = api_key
        self.chat = _B(completions=self)

    async def create(self, **kw):
        UP["openai"].append({**kw, "api_key": self.api_key})
        text = REPLIES["openai"].pop(0)
        if kw.get("stream"):
            async def gen():
                for i in range(0, len(text), 5):
                    yield _B(usage=None, choices=[_B(finish_reason=None, delta=_B(content=text[i:i + 5], tool_calls=None))])
                yield _B(usage=None, choices=[_B(finish_reason="stop", delta=_B(content=None, tool_calls=None))])
                yield _B(usage=_B(prompt_tokens=300, completion_tokens=20), choices=[])
            return gen()
        return _B(usage=_B(prompt_tokens=300, completion_tokens=20),
                  choices=[_B(finish_reason="stop", message=_B(content=text, tool_calls=None))])


main._openai_client = lambda provider, key: FakeOpenAI(key)

c = TestClient(main.app)
BASE = "http://testserver/v1/gateway"
oa = openai.OpenAI(base_url=f"{BASE}/openai", api_key="ak_live_owner1", http_client=c, max_retries=0)
an = anthropic.Anthropic(base_url=f"{BASE}/anthropic", api_key="ak_live_owner1", http_client=c, max_retries=0)

# ── OpenAI SDK ───────────────────────────────────────────────────────────────
REPLIES["claude"] = [claude_text("Paris is the capital of France.")]
r = oa.chat.completions.create(model="policy:balanced", messages=[{"role": "system", "content": "Be brief."},
                                                                  {"role": "user", "content": "Capital of France?"}],
                               extra_headers={"X-Aistrix-Trace": "agent-run-1"})
ok("the OpenAI SDK gets a chat completion", r.choices[0].message.content == "Paris is the capital of France."
   and r.choices[0].finish_reason == "stop" and r.usage.prompt_tokens == 400 and r.usage.completion_tokens == 50, r)
ok("the call used the owner's stored Claude key and the policy model", UP["claude"][-1]["api_key"] == "sk-ant-owner-own"
   and UP["claude"][-1]["model"] == "claude-sonnet-5-5" and UP["claude"][-1]["system"] == "Be brief.")
ok("spend was reserved before and settled after", SPEND[0][0] == "reserve" and SPEND[0][3] == OWNER
   and SPEND[1][0] == "settle" and SPEND[1][3] == "settled")

REPLIES["claude"] = [claude_tool("get_weather", {"city": "Paris"})]
tools = [{"type": "function", "function": {"name": "get_weather", "description": "Weather for a city",
                                           "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}]
r = oa.chat.completions.create(model="claude/claude-sonnet-5-5", messages=[{"role": "user", "content": "Weather in Paris?"}], tools=tools)
call = r.choices[0].message.tool_calls[0]
ok("tool calls come back in OpenAI form", r.choices[0].finish_reason == "tool_calls" and call.function.name == "get_weather"
   and json.loads(call.function.arguments) == {"city": "Paris"} and UP["claude"][-1]["tools"][0]["input_schema"]["type"] == "object", r)
REPLIES["claude"] = [claude_text("It is sunny.")]
r = oa.chat.completions.create(model="claude/claude-sonnet-5-5", tools=tools, messages=[
    {"role": "user", "content": "Weather in Paris?"},
    {"role": "assistant", "content": None, "tool_calls": [{"id": call.id, "type": "function",
                                                            "function": {"name": "get_weather", "arguments": '{"city":"Paris"}'}}]},
    {"role": "tool", "tool_call_id": call.id, "content": "sunny, 21C"}])
sent = UP["claude"][-1]["messages"]
ok("tool results go upstream as Claude tool_result blocks", r.choices[0].message.content == "It is sunny."
   and sent[1]["content"][0]["type"] == "tool_use" and sent[2]["content"][0] == {"type": "tool_result", "tool_use_id": call.id,
                                                                               "content": "sunny, 21C", "is_error": False}, sent)

REPLIES["claude"] = [claude_text("Streaming works fine.")]
chunks = list(oa.chat.completions.create(model="policy:balanced", stream=True, stream_options={"include_usage": True},
                                         messages=[{"role": "user", "content": "Stream please"}]))
text = "".join(ch.choices[0].delta.content or "" for ch in chunks if ch.choices)
ok("OpenAI streaming delivers the text in pieces, a finish reason and usage", text == "Streaming works fine."
   and sum(1 for ch in chunks if ch.choices and ch.choices[0].delta.content) > 1
   and any(ch.choices and ch.choices[0].finish_reason == "stop" for ch in chunks)
   and chunks[-1].usage.completion_tokens == 50 and UP["claude"][-1]["streamed"], text)

REPLIES["claude"] = [claude_tool("get_weather", {"city": "Rome"}, "toolu_9")]
chunks = list(oa.chat.completions.create(model="policy:balanced", stream=True, tools=tools,
                                         messages=[{"role": "user", "content": "Weather in Rome?"}]))
calls = [tc for ch in chunks if ch.choices for tc in (ch.choices[0].delta.tool_calls or [])]
ok("streamed tool calls arrive whole", len(calls) == 1 and calls[0].function.name == "get_weather"
   and json.loads(calls[0].function.arguments) == {"city": "Rome"}
   and any(ch.choices and ch.choices[0].finish_reason == "tool_calls" for ch in chunks))

REPLIES["openai"] = ["Hello from GPT."]
r = oa.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])
ok("a bare OpenAI model id routes to OpenAI with the owner's key", r.choices[0].message.content == "Hello from GPT."
   and UP["openai"][-1]["api_key"] == "sk-openai-owner-own" and UP["openai"][-1]["model"] == "gpt-4o")
REPLIES["openai"] = ["Streamed from GPT."]
text = "".join(ch.choices[0].delta.content or "" for ch in oa.chat.completions.create(
    model="openai/gpt-4o", stream=True, messages=[{"role": "user", "content": "hi"}]) if ch.choices)
ok("OpenAI upstream streams through too", text == "Streamed from GPT." and UP["openai"][-1]["stream"] is True, text)

ok("the model list includes policies and provider models",
   {"policy:balanced", "claude/claude-sonnet-5-5", "openai/gpt-4o"} <= {m.id for m in oa.models.list().data})

# ── Anthropic SDK (sends x-api-key) ──────────────────────────────────────────
REPLIES["claude"] = [claude_text("Bonjour!")]
m = an.messages.create(model="claude-sonnet-5-5", max_tokens=200, system="Answer in French.",
                       messages=[{"role": "user", "content": "Hello"}])
ok("the Anthropic SDK gets a message with its x-api-key", m.content[0].text == "Bonjour!" and m.stop_reason == "end_turn"
   and m.usage.input_tokens == 400 and UP["claude"][-1]["system"] == "Answer in French."
   and UP["claude"][-1]["max_tokens"] == 200, m)

REPLIES["claude"] = [claude_tool("lookup", {"q": "x"}, "toolu_5")]
m = an.messages.create(model="claude/claude-sonnet-5-5", max_tokens=200,
                       tools=[{"name": "lookup", "description": "Look up", "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}}}],
                       messages=[{"role": "user", "content": "find x"}])
ok("Anthropic tool use round-trips", m.stop_reason == "tool_use" and m.content[0].type == "tool_use"
   and m.content[0].input == {"q": "x"} and m.content[0].id == "toolu_5", m)

REPLIES["claude"] = [claude_text("Streaming in Anthropic form.")]
with an.messages.stream(model="claude-sonnet-5-5", max_tokens=100, messages=[{"role": "user", "content": "go"}]) as s:
    pieces = list(s.text_stream)
    final = s.get_final_message()
ok("Anthropic streaming yields text events and a final message", "".join(pieces) == "Streaming in Anthropic form."
   and len(pieces) > 1 and final.stop_reason == "end_turn" and final.usage.output_tokens == 50, pieces)

REPLIES["claude"] = [claude_tool("lookup", {"q": "y"}, "toolu_6")]
with an.messages.stream(model="claude-sonnet-5-5", max_tokens=100, messages=[{"role": "user", "content": "go"}],
                        tools=[{"name": "lookup", "description": "d", "input_schema": {"type": "object"}}]) as s:
    final = s.get_final_message()
ok("a streamed Anthropic tool call is rebuilt by the SDK", final.stop_reason == "tool_use" and final.content[0].input == {"q": "y"}, final)

# ── refusals and errors in each SDK's own form ───────────────────────────────
def raised(fn):
    try:
        fn()
    except Exception as e:
        return e
    return None

e = raised(lambda: openai.OpenAI(base_url=f"{BASE}/openai", api_key="ak_live_nope", http_client=c, max_retries=0)
           .chat.completions.create(model="policy:fast", messages=[{"role": "user", "content": "x"}]))
ok("a bad key is an OpenAI AuthenticationError", isinstance(e, openai.AuthenticationError), e)
e = raised(lambda: anthropic.Anthropic(base_url=f"{BASE}/anthropic", api_key="ak_live_nope", http_client=c, max_retries=0)
           .messages.create(model="claude-sonnet-5-5", max_tokens=10, messages=[{"role": "user", "content": "x"}]))
ok("a bad key is an Anthropic AuthenticationError", isinstance(e, anthropic.AuthenticationError), e)
e = raised(lambda: openai.OpenAI(base_url=f"{BASE}/openai", api_key="ak_live_restricted", http_client=c, max_retries=0)
           .chat.completions.create(model="policy:fast", messages=[{"role": "user", "content": "x"}]))
ok("an app-restricted key is refused", isinstance(e, openai.PermissionDeniedError), e)
before = len(UP["claude"])
REFUSE.append(1)
e = raised(lambda: oa.chat.completions.create(model="policy:balanced", messages=[{"role": "user", "content": "x"}]))
REFUSE.clear()
ok("a spending limit refuses before the provider is called", isinstance(e, openai.RateLimitError) and len(UP["claude"]) == before, e)
e = raised(lambda: oa.chat.completions.create(model="gemini/gemini-3.8-flash", messages=[{"role": "user", "content": "x"}]))
ok("a provider with no stored key is explained", isinstance(e, openai.BadRequestError) and "No gemini API key" in str(e), e)
e = raised(lambda: oa.chat.completions.create(model="llama-3", messages=[{"role": "user", "content": "x"}]))
ok("an unknown model is refused", isinstance(e, openai.BadRequestError) and "Prefix it with its provider" in str(e), e)
e = raised(lambda: oa.chat.completions.create(model="policy:fast", messages=[{"role": "user", "content": [
    {"type": "image_url", "image_url": {"url": "https://x.example/a.png"}}]}]))
ok("non-text content is refused clearly", isinstance(e, openai.BadRequestError) and "only text content" in str(e), e)
REPLIES["claude"] = [claude_text("via session")]
r = c.post("/v1/gateway/openai/chat/completions", headers={"Authorization": "Bearer jwt-owner"},
           json={"model": "policy:balanced", "messages": [{"role": "user", "content": "x"}]})
ok("a signed-in session can call the gateway too", r.status_code == 200 and r.json()["choices"][0]["message"]["content"] == "via session", r.text)

# ── the call log ─────────────────────────────────────────────────────────────
calls = SB.db.get("gateway_calls", [])
ok("every call is logged with tokens, cost and status", len(calls) >= 12 and calls[0]["trace"] == "agent-run-1"
   and calls[0]["input_tokens"] == 400 and calls[0]["cost_usd"] == round((400 * 2.0 + 50 * 10.0) / 1e6, 6)
   and calls[0]["provider"] == "claude" and calls[0]["status"] == "ok", calls[:1])
ok("refused calls are logged as errors", any(x["status"] == "error" and x["error_code"] == "spend_limit" for x in calls))
ok("the log never holds prompts, answers or tool arguments",
   not any(s in json.dumps(calls) for s in ("Capital of France", "Paris is the capital", "sunny, 21C", "Weather in")))
r = c.get("/v1/gateway/calls?trace=agent-run-1", headers={"Authorization": "Bearer ak_live_owner1"})
ok("calls are listed by trace", r.status_code == 200 and len(r.json()["calls"]) == 1 and r.json()["cost_usd"] > 0, r.text)
r = c.get("/v1/gateway/calls", headers={"Authorization": "Bearer ak_live_other1"})
ok("other people don't see the calls", r.status_code == 200 and r.json()["calls"] == [], r.text)

# ── run tokens: a code job calling models from its sandbox ───────────────────
import e2b_runtime

job = {"user_id": OWNER, "id": str(uuid.uuid4()), "app_id": str(uuid.uuid4())}
run_key = e2b_runtime.mint_run_token(main._fernet, job, 120, budget=0.002)
job_oa = openai.OpenAI(base_url=f"{BASE}/openai", api_key=run_key, http_client=c, max_retries=0)
REPLIES["claude"] = [claude_text("from the job")]
r = job_oa.chat.completions.create(model="policy:balanced", messages=[{"role": "user", "content": "x"}])
logged = [x for x in SB.db["gateway_calls"] if x["trace"] == f"code-task:{job['id']}"]
ok("a job's run token calls models as its owner, under the job's trace", r.choices[0].message.content == "from the job"
   and UP["claude"][-1]["api_key"] == "sk-ant-owner-own" and len(logged) == 1 and logged[0]["owner_id"] == OWNER)
REPLIES["claude"] = [claude_text("second")]
job_an = anthropic.Anthropic(base_url=f"{BASE}/anthropic", api_key=run_key, http_client=c, max_retries=0)
m = job_an.messages.create(model="claude-sonnet-5-5", max_tokens=50, messages=[{"role": "user", "content": "x"}])
ok("the same token works with the Anthropic SDK", m.content[0].text == "second")
before = len(UP["claude"])
e = raised(lambda: job_oa.chat.completions.create(model="policy:balanced", messages=[{"role": "user", "content": "x"}]))
ok("the job stops at its model budget before calling the provider", isinstance(e, openai.RateLimitError)
   and "model budget" in str(e) and len(UP["claude"]) == before, e)
expired = e2b_runtime.mint_run_token(main._fernet, job, -1)
e = raised(lambda: openai.OpenAI(base_url=f"{BASE}/openai", api_key=expired, http_client=c, max_retries=0)
           .chat.completions.create(model="policy:fast", messages=[{"role": "user", "content": "x"}]))
ok("an expired run token is refused", isinstance(e, openai.AuthenticationError) and "expired" in str(e), e)
forged = "ak_run_" + Fernet(Fernet.generate_key()).encrypt(json.dumps({"o": OWNER, "t": "x", "b": 9, "exp": 9e9}).encode()).decode()
e = raised(lambda: openai.OpenAI(base_url=f"{BASE}/openai", api_key=forged, http_client=c, max_retries=0)
           .chat.completions.create(model="policy:fast", messages=[{"role": "user", "content": "x"}]))
ok("a token not signed by this server is refused", isinstance(e, openai.AuthenticationError), e)
r = c.get("/v1/gateway/calls", headers={"Authorization": f"Bearer {run_key}"})
ok("a run token can't read the owner's call log", r.status_code == 403, r.text)

finish()
