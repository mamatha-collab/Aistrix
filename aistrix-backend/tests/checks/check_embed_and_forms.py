"""Embedded Data apps for signed-out visitors (file extraction, URL reading,
OCR on the owner's key with a smaller page cap, per-visitor limit), and
server-side required-field checks for Form apps."""
import base64, io, zipfile
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
main.platform_key = lambda provider: "test-platform-key"   # model calls are stubbed; never a real key
from fastapi.testclient import TestClient
import pypdf

# The default (deployed .env files may override it — keep them in step).
from pathlib import Path as _Path
ok("run time limit defaults to 180 s", 'os.getenv("REQUEST_TIMEOUT", "180")' in _Path(main.__file__).read_text(encoding="utf-8")
   and "REQUEST_TIMEOUT=180" in (_Path(main.__file__).parent / ".env.example").read_text(encoding="utf-8"))

c = TestClient(main.app)

APPS = {
    "data-embed": {"id": "data-embed", "name": "Data", "created_by": "owner", "app_type": "data", "is_published": True,
                   "embed_public": True, "is_paid": False, "visibility": "public", "system_prompt": "Analyse"},
    "data-private": {"id": "data-private", "name": "No visitors", "created_by": "owner", "app_type": "data",
                     "is_published": True, "embed_public": False, "is_paid": False, "visibility": "public"},
    "data-paid": {"id": "data-paid", "name": "Paid", "created_by": "owner", "app_type": "data", "is_published": True,
                  "embed_public": True, "is_paid": True, "visibility": "public"},
    "form": {"id": "form", "name": "Pitch", "created_by": "owner", "app_type": "native", "is_published": True,
             "visibility": "public", "system_prompt": "Pitch {{Company Name}}",
             "form_schema": [{"id": "1", "label": "Company Name", "type": "text", "required": True},
                             {"id": "2", "label": "Budget", "type": "number", "required": True},
                             {"id": "3", "label": "Notes", "type": "textarea", "required": False}]},
}


async def load_app_row(app_id): return APPS.get(app_id)
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def allow(*a, **k): return True, ""
async def verified(req):
    if req.headers.get("Authorization") == "Bearer good":
        return "u1"
    raise main.HTTPException(status_code=401, detail="Unauthorized")


OWNER_KEYS = []
async def owner_key(uid, provider): OWNER_KEYS.append(uid); return "sk-owner"

main.load_app_row = load_app_row; main.require_verified_user = verified
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main.fetch_app_blueprint = emptyd
main._load_app_secrets = emptyd; main.check_rate_limit = allow; main.fetch_user_api_key = none
main.fetch_user_api_key_by_id = owner_key; main.record_metered_run = none


def docx(text):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')
    return base64.b64encode(b.getvalue()).decode()


def extract(app_id=None, content=None, name="sales.docx", auth=None):
    body = {"file_name": name, "content_b64": content or docx("Q3 revenue 1200")}
    if app_id: body["app_id"] = app_id
    return c.post("/v1/files/extract", json=body, headers={"Authorization": auth} if auth else {})


# ── who may read files ──────────────────────────────────────────────────────
main.EMBED_VISITOR_HOURLY_LIMIT = 100
r = extract("data-embed")
ok("visitor of an embedded Data app can extract a file", r.status_code == 200 and r.json()["text"] == "Q3 revenue 1200")
ok("…not when visitor access is off (401)", extract("data-private").status_code == 401)
ok("…not for a paid app (401)", extract("data-paid").status_code == 401)
ok("…not for an unknown app (401)", extract("nope").status_code == 401)
ok("no app and no sign-in → 401", extract().status_code == 401)
ok("signed-in users unchanged", extract(auth="Bearer good").status_code == 200)
ok("a bad token isn't treated as a visitor (401)", extract("data-embed", auth="Bearer forged").status_code == 401)

# ── visitor OCR: owner's key, smaller page cap ──────────────────────────────
def scanned_pdf(pages):
    w = pypdf.PdfWriter()
    for _ in range(pages):
        w.add_blank_page(612, 792)
    b = io.BytesIO(); w.write(b)
    return base64.b64encode(b.getvalue()).decode()

KEYS_USED = []
class _Stream:
    def __init__(self, kw): self.kw = kw
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get_final_message(self):
        return NS(stop_reason="end_turn", content=[NS(type="text", text="--- Page 1 ---\nInvoice total 99")])
class _Client:
    def __init__(self, api_key=None):
        KEYS_USED.append(api_key)
        self.beta = NS(messages=NS(stream=lambda **kw: _Stream(kw)))
main.anthropic.AsyncAnthropic = _Client

OWNER_KEYS.clear()
r = extract("data-embed", scanned_pdf(1), "scan.pdf")
ok("visitor OCR runs on the app owner's Claude key", r.status_code == 200 and "Invoice total 99" in r.json()["text"]
   and OWNER_KEYS == ["owner"] and KEYS_USED[-1] == "sk-owner")
main.EMBED_VISITOR_OCR_MAX_PAGES = 2
r = extract("data-embed", scanned_pdf(3), "scan.pdf")
ok("visitor scanned-page cap applies (422, 'up to 2')", r.status_code == 422 and "up to 2" in r.json()["detail"])
import os as _os
_os.environ["ANTHROPIC_API_KEY"] = "platform-key"     # fake; the client above is stubbed
r = extract(content=scanned_pdf(3), name="scan.pdf", auth="Bearer good")
ok("signed-in users keep the full page cap", r.status_code == 200)
_os.environ["ANTHROPIC_API_KEY"] = ""

# ── visitor URL reading ─────────────────────────────────────────────────────
class _Resp:
    def __init__(self, body, ctype):
        self.content = body.encode(); self.text = body; self.headers = {"content-type": ctype}; self.url = "https://acme.test/data.csv"
    def raise_for_status(self): pass
async def fake_fetch(method, url, **kw): return _Resp("region,amount\nEU,10\n", "text/csv")
main.fetch_safely = fake_fetch
r = c.post("/scrape", json={"url": "https://acme.test/data.csv", "app_id": "data-embed"})
ok("visitor of an embedded Data app can read a URL", r.status_code == 200 and r.json()["kind"] == "csv")
ok("…not when visitor access is off (401)", c.post("/scrape", json={"url": "https://acme.test/x", "app_id": "data-private"}).status_code == 401)

# ── per-visitor, per-app limit covers file and URL reads ────────────────────
main._anon_hits.clear()
main.EMBED_VISITOR_HOURLY_LIMIT = 2
codes = [extract("data-embed").status_code, c.post("/scrape", json={"url": "https://acme.test/d.csv", "app_id": "data-embed"}).status_code,
         extract("data-embed").status_code]
ok("visitor limit applies across reads (200, 200, 429)", codes == [200, 200, 429])
main.EMBED_VISITOR_HOURLY_LIMIT = 100

# ── Form apps: required fields checked on the server ────────────────────────
SEEN = {}
async def fake_stream(system, user_input, model, api_key=None, usage_holder=None, **kw):
    SEEN["system"] = system
    yield "ok"
main.stream_claude = fake_stream
main.fetch_user_api_key_by_id = none

def run(field_values=None, input_text="Company Name: Acme"):
    body = {"app_id": "form", "input": input_text}
    if field_values is not None: body["field_values"] = field_values
    return c.post("/run", json=body)

r = run({"Company Name": "Acme", "Budget": "", "Notes": ""})
ok("missing required field → 422 naming it", r.status_code == 422 and r.json()["error"] == "Fill in the required field: Budget")
r = run({"Company Name": " ", "Budget": None})
ok("blank/None count as missing (both named)", r.status_code == 422 and r.json()["error"] == "Fill in the required fields: Company Name, Budget")
r = run({"Company Name": "Acme", "Budget": 500})
ok("all required filled → runs", r.status_code == 200 and '"done": true' in r.text and "Pitch Acme" in SEEN["system"])
ok("optional fields may be empty", run({"Company Name": "Acme", "Budget": "5k", "Notes": ""}).status_code == 200)
ok("plain-text input (flows) still accepted", run(None).status_code == 200)
r = c.post("/v1/apps/form/run", json={"fields": {"company_name": "Globex"}, "stream": False})
ok("API fields use the same check", r.status_code == 422 and "Budget" in r.text)
r = c.post("/v1/apps/form/run", json={"fields": {"company_name": "Globex", "budget": 900}, "stream": False})
ok("API fields with snake_case keys pass", r.status_code == 200)

finish()
