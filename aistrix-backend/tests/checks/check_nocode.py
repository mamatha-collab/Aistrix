"""No-code app types: /scrape (HTML, CSV, PDF, JS-only pages), readable
validation errors, chatbot tone, form placeholders."""
import io, os

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
os.environ.pop("ANTHROPIC_API_KEY", None)   # never call the real API from tests
from fastapi.testclient import TestClient

c = TestClient(main.app)

async def user(req): return "u1"
main.require_verified_user = user

class Resp:
    def __init__(s, body, ctype, url="https://acme.test/page"):
        s.content = body if isinstance(body, bytes) else body.encode()
        s.text = s.content.decode("latin-1")
        s.headers = {"content-type": ctype}
        s.url = url
    def raise_for_status(s): pass

PAGES = {}
async def fake_fetch(method, url, **kw): return PAGES[url]
main.fetch_safely = fake_fetch

PAGES["https://acme.test/"] = Resp("""<html><head><title>Acme &amp; Sons</title>
<meta name="description" content="Plumbing since 1990"></head><body>
<nav><a>Home</a><a>Login</a></nav><header>Big banner</header>
<main><h1>Our services</h1><p>Emergency repairs&nbsp;24/7 &mdash; call AT&amp;T line.</p>
<script>var x=1</script><ul><li>Boilers</li><li>Pipes</li></ul></main>
<footer>(c) Acme cookie policy</footer></body></html>""", "text/html; charset=utf-8", "https://acme.test/")
r = c.post("/scrape", json={"url": "acme.test/"}).json()
t = r["text"]
ok("html: title + description first", t.startswith("Acme & Sons\nPlumbing since 1990"))
ok("html: entities decoded", "AT&T" in t and "—" in t and "&amp;" not in t)
ok("html: nav/header/footer/script dropped", not any(w in t for w in ("Login", "Big banner", "cookie", "var x")))
ok("html: paragraphs kept on lines", "Our services\n" in t and "\nBoilers\nPipes" in t)

PAGES["https://acme.test/data.csv"] = Resp("region,amount\nEU,10\nUS,20\n", "text/csv")
r = c.post("/scrape", json={"url": "https://acme.test/data.csv", "max_chars": 100000}).json()
ok("csv url returned raw with kind=csv", r["kind"] == "csv" and r["text"].startswith("region,amount"))

from pypdf import PdfWriter
w = PdfWriter(); w.add_blank_page(100, 100); b = io.BytesIO(); w.write(b)
PAGES["https://acme.test/r.pdf"] = Resp(b.getvalue(), "application/pdf")
r = c.post("/scrape", json={"url": "https://acme.test/r.pdf"})
ok("scanned pdf without OCR key → clear 503", r.status_code == 503 and "scanned pages" in r.json()["detail"].lower())

PAGES["https://acme.test/app"] = Resp("<html><body><div id=root></div><script>render()</script></body></html>", "text/html")
r = c.post("/scrape", json={"url": "https://acme.test/app"})
ok("JS-only page → clear 422", r.status_code == 422 and "javascript" in r.json()["detail"].lower())

PAGES["https://acme.test/img.png"] = Resp(b"\x89PNG", "image/png")
r = c.post("/scrape", json={"url": "https://acme.test/img.png"})
ok("image url → 415 with guidance", r.status_code == 415)

# readable validation errors
r = c.post("/run", json={"input": "x" * (main.MAX_INPUT_LENGTH + 10)})
body = r.json()
ok("422 has a readable 'error' sentence", r.status_code == 422 and "Input too long" in body.get("error", "") and isinstance(body.get("detail"), list))

# tone is appended to the system prompt
seen = {}
async def fake_stream(system, user_input, model, api_key=None, **kw):
    seen["system"] = system
    yield "hi"
main.stream_claude = fake_stream
async def app_row(app_id): return {"id": "a1", "name": "Bot", "created_by": "owner", "is_published": True,
                                   "system_prompt": "You are Acme's helper.", "tone": "concise", "app_type": "chatbot"}
async def nothing(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyl(*a, **k): return []
async def emptyd(*a, **k): return {}
async def rl(*a, **k): return True, ""
main.load_app_row = app_row; main.app_member_role = nothing; main.workspace_role = nothing
main.fetch_app_knowledge = empty; main.fetch_app_tools = emptyl; main.fetch_app_blueprint = emptyd
main._load_app_secrets = emptyd; main.check_rate_limit = rl; main.fetch_user_api_key_by_id = nothing
main.personal_workspace_id = nothing
c.post("/run", json={"app_id": "a1", "input": "hello", "run_mode": "conversation"})
ok("tone preset reaches the model", "Tone: concise" in seen.get("system", "") and "You are Acme's helper." in seen["system"])

async def form_app(app_id): return {"id": "f1", "name": "Pitch", "created_by": "owner", "is_published": True, "app_type": "native",
                                    "system_prompt": "Write a pitch for {{Company Name}} with budget {{budget}}.", "output_type": "markdown"}
main.load_app_row = form_app
c.post("/run", json={"app_id": "f1", "input": "Company Name: Acme", "field_values": {"Company Name": "Acme", "Budget": "5k"}})
ok("form placeholders filled via /run", "pitch for Acme with budget 5k" in seen["system"])
c.post("/v1/apps/f1/run", json={"fields": {"company_name": "Globex", "budget": 900}, "stream": False})
ok("form placeholders filled via API fields", "pitch for Globex with budget 900" in seen["system"])
finish()
