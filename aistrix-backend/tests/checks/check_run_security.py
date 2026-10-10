"""/run security and behaviour: paid-app entitlements and quotas, forged
tokens, owner drafts, SSRF on custom model URLs, structured-output repair,
API gateway, file extraction, agent loop stop, embed visitor limits."""
import asyncio, base64, io, json, os

import _harness
from _harness import ok, finish
_harness.setup()
import main
from fastapi.testclient import TestClient

c = TestClient(main.app)

# ── helpers
ok("secret refs resolved", main.resolve_secret_refs({"h": {"Authorization": "Bearer {{ secrets.api_key }}"}}, {"API_KEY": "s3"}) == {"h": {"Authorization": "Bearer s3"}})

# ── fakes
APPS = {
    "paid": {"id": "paid", "name": "Paid", "created_by": "owner", "is_paid": True, "is_published": True,
             "system_prompt": "SECRET PROMPT", "ai_provider": "claude", "ai_model": "claude-sonnet-5-5", "visibility": "public"},
    "draft": {"id": "draft", "name": "Draft", "created_by": "owner", "is_paid": False, "is_published": False,
              "system_prompt": "x", "visibility": "public"},
    "json": {"id": "json", "name": "J", "created_by": "owner", "is_paid": False, "is_published": True,
             "system_prompt": "extract", "output_type": "json", "visibility": "public"},
}
captured = {}

async def load_app_row(app_id): return APPS.get(app_id)
async def app_member_role(a, u): return None
async def verify(tok): return {"tok-owner": "owner", "tok-buyer": "buyer"}.get(tok)
ENT = {}
async def find_ent(a, caller): return ENT.get((a, caller.user_id)) if caller and caller.user_id else None
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def rl(*a, **k): return True, ""
BLUEPRINT = {"output_contract": {"format": "json"}, "output_schema": {"fields": [{"field": "name", "type": "string"}, {"field": "age", "type": "number"}]}}
async def bp(a): return BLUEPRINT if a == "json" else {}
attempts = []
async def fake_stream(system, user_input, model, api_key=None, max_tokens=4096, temperature=1.0, usage_holder=None):
    captured["system"] = system
    attempts.append(user_input)
    if captured.get("mode") == "json":
        yield '{"name": "Al", "age": "x"}' if len(attempts) == 1 else '{"name": "Al", "age": 3}'
    else:
        yield "hello"
    if usage_holder is not None:
        usage_holder["input_tokens"] = 1; usage_holder["output_tokens"] = 1

main.load_app_row = load_app_row
main.app_member_role = app_member_role
main.verify_user_jwt = verify
main.find_active_entitlement = find_ent
main.fetch_user_api_key = none
main.fetch_user_api_key_by_id = none
main.check_rate_limit = rl
main.fetch_app_knowledge = empty
main.fetch_app_tools = emptyl
main.fetch_app_blueprint = bp
main._load_app_secrets = emptyd
main.stream_claude = fake_stream
consumed = []
async def consume(e, n): consumed.append(e["id"])
main.consume_entitlement_run = consume

def run(body, tok=None):
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    r = c.post("/run", json=body, headers=h)
    return r.status_code, r.text

# paid app: anon → 401, buyer w/o entitlement → 402, swapped prompt ignored
ok("paid app, signed out → 401", run({"app_id": "paid", "input": "hi", "system_prompt": "EVIL"})[0] == 401)
ok("paid app, no purchase → 402", run({"app_id": "paid", "input": "hi", "system_prompt": "EVIL"}, "tok-buyer")[0] == 402)
ENT[("paid", "buyer")] = {"id": "e1", "user_id": "buyer", "run_quota": 5, "runs_this_period": 1}
code, body = run({"app_id": "paid", "input": "hi", "system_prompt": "EVIL", "run_mode": "agent"}, "tok-buyer")
ok("buyer runs with the app's own prompt (swap ignored)", code == 200 and "SECRET PROMPT" in captured["system"] and "EVIL" not in captured["system"])
ok("run_mode suffix applied", "autonomous agent mode" in captured["system"])
import time; time.sleep(0.2)
ok("entitlement run consumed", consumed == ["e1"])
ENT[("paid", "buyer")]["runs_this_period"] = 5
code, body = run({"app_id": "paid", "input": "hi"}, "tok-buyer")
ok("quota used up → 402 with message", code == 402 and "used all 5 runs" in body)
# forged token can't impersonate
ok("forged token can't impersonate → 401", run({"app_id": "paid", "input": "hi"}, "eyJ.fake.jwt")[0] == 401)
# owner can use draft prompt
code, _ = run({"app_id": "paid", "input": "hi", "system_prompt": "DRAFT"}, "tok-owner")
ok("owner can run a draft prompt", code == 200 and "DRAFT" in captured["system"])
# unpublished app for non-owner → 404
ok("unpublished app hidden from others → 404", run({"app_id": "draft", "input": "hi"})[0] == 404)
# SSRF on custom model (owner)
code, body = run({"app_id": "draft", "input": "hi", "custom_model_url": "http://169.254.169.254/v1", "custom_model_name": "m"}, "tok-owner")
ok("SSRF: private custom model URL → 400", code == 400 and "non-public address" in body)
# structured repair
captured["mode"] = "json"; attempts.clear()
code, body = run({"app_id": "json", "input": "Al is three", "output_type": "json"})
ok("structured: invalid JSON repaired on a 2nd attempt", code == 200 and len(attempts) == 2 and "repairing_output" in body and '"done": true' in body)
ok("structured: output contract in system prompt", "<output_contract>" in captured["system"])

# ── API gateway stream=false
r = c.post("/v1/apps/json/run", json={"input": "Al", "stream": False})
attempts.clear()
ok("API stream=false returns parsed data", r.status_code == 200 and r.json().get("data") == {"name": "Al", "age": 3})
ok("API: unknown key → 401", c.post("/v1/apps/json/run", json={"input": "x"}, headers={"Authorization": "Bearer ak_live_nope"}).status_code == 401)

# ── extraction
async def okuser(r): return "u"
main.require_verified_user = okuser
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.append(["name", "score"]); ws.append(["a", 1]); bio = io.BytesIO(); wb.save(bio)
r = c.post("/v1/files/extract", json={"file_name": "t.xlsx", "content_b64": base64.b64encode(bio.getvalue()).decode()})
ok("xlsx → CSV text", r.status_code == 200 and r.json()["kind"] == "csv" and r.json()["text"].startswith("name,score"))
import zipfile
bio = io.BytesIO()
with zipfile.ZipFile(bio, "w") as z:
    z.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello doc</w:t></w:r></w:p></w:body></w:document>')
r = c.post("/v1/files/extract", json={"file_name": "t.docx", "content_b64": base64.b64encode(bio.getvalue()).decode()})
ok("docx → text", r.status_code == 200 and r.json()["text"] == "Hello doc")
from pypdf import PdfWriter
w = PdfWriter(); w.add_blank_page(100, 100); bio = io.BytesIO(); w.write(bio)
r = c.post("/v1/files/extract", json={"file_name": "t.pdf", "content_b64": base64.b64encode(bio.getvalue()).decode()})
ok("scanned PDF with no OCR key → 503", r.status_code == 503 and "scanned pages" in r.json()["detail"])
ok("unsupported file type → 415", c.post("/v1/files/extract", json={"file_name": "t.exe", "content_b64": "AA=="}).status_code == 415)

# ── agent loop: max_tokens terminates
class Resp:
    def __init__(s, stop): s.stop_reason = stop; s.content = [type("B", (), {"text": "partial", "type": "text"})()]; s.usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()
class Msgs:
    calls = 0
    async def create(s, **k): Msgs.calls += 1; return Resp("max_tokens")
class Cl:
    def __init__(s, **k): s.messages = Msgs()
main.anthropic.AsyncAnthropic = Cl
async def agent():
    out = [e async for e in main.run_claude_with_tools("s", "u", "m", [{"name": "t", "description": "d"}], max_steps=10)]
    return out
out = asyncio.run(agent())
ok("agent loop stops at max_tokens (1 call)", Msgs.calls == 1 and out[0][1].startswith("partial"))

# ── embed visitor: per-app limit + owner key
APPS["widget"] = {"id": "widget", "name": "W", "created_by": "owner", "is_paid": False, "is_published": True,
                  "system_prompt": "w", "visibility": "public", "embed_public": True}
keys_used = []
async def owner_key(uid, prov): keys_used.append(uid); return "sk-owner"
main.fetch_user_api_key_by_id = owner_key
captured["mode"] = ""
main.EMBED_VISITOR_HOURLY_LIMIT = 2
codes = [run({"app_id": "widget", "input": "hi"})[0] for _ in range(3)]
ok("embed visitors: per-app limit, owner's key", codes == [200, 200, 429] and keys_used[:1] == ["owner"])
finish()
