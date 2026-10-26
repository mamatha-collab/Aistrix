"""OCR for scanned PDF pages: only image-only pages, chunking, ordering,
errors, key choice (own vs platform), metering, agent pdf tool."""
import asyncio, base64, io, os, re

import _harness
from _harness import ok, finish
_harness.setup()
import main  # noqa
import pypdf
from types import SimpleNamespace as NS
from fastapi.testclient import TestClient



def text_pdf(txt: str) -> bytes:
    content = f"BT /F1 12 Tf 72 720 Td ({txt}) Tj ET".encode()
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out)); out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % x for x in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)
    return out


def build(pages):  # pages: list of str (text page) or None (scanned/blank page)
    w = pypdf.PdfWriter()
    for p in pages:
        if p is None:
            w.add_blank_page(612, 792)
        else:
            w.add_page(pypdf.PdfReader(io.BytesIO(text_pdf(p))).pages[0])
    b = io.BytesIO(); w.write(b); return b.getvalue()


CALLS, MODE = [], {"v": "markers"}


class FakeStream:
    def __init__(self, kw): self.kw = kw
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get_final_message(self):
        prompt = self.kw["messages"][0]["content"][1]["text"]
        pages = [int(x) for x in re.search(r"holds pages ([\d, ]+) of", prompt).group(1).split(",")]
        doc = self.kw["messages"][0]["content"][0]
        n_in_pdf = len(pypdf.PdfReader(io.BytesIO(base64.b64decode(doc["source"]["data"]))).pages)
        CALLS.append({"pages": pages, "pdf_pages": n_in_pdf, **{k: self.kw.get(k) for k in ("model", "betas", "fallbacks", "output_config")}, "api_key": self.api_key})
        mode = MODE["v"]
        if mode == "refusal":
            return NS(stop_reason="refusal", content=[])
        if mode == "auth":
            raise main.anthropic.AuthenticationError("bad key", response=NS(status_code=401, headers={}, request=None), body=None)
        if mode == "nomarkers":
            return NS(stop_reason="end_turn", content=[NS(type="text", text="Invoice #42 total $99")])
        text = "\n".join(f"--- Page {p} ---\nScanned text of page {p}" for p in pages)
        return NS(stop_reason="end_turn", content=[NS(type="thinking", thinking=""), NS(type="text", text=text)])


class FakeClient:
    def __init__(self, api_key=None):
        outer = self
        self.api_key = api_key
        def stream(**kw):
            s = FakeStream(kw); s.api_key = outer.api_key; return s
        self.beta = NS(messages=NS(stream=stream))


main.anthropic.AsyncAnthropic = FakeClient
os.environ["ANTHROPIC_API_KEY"] = "platform-key"

# ── mixed PDF: only the image-only pages are OCR'd, in order, chunked ──────
main.OCR_PAGES_PER_REQUEST = 2
pdf = build(["Typed cover page with plenty of text here", None, None, "Typed terms page with plenty of text here", None])
CALLS.clear()
text, n = asyncio.run(main.extract_pdf_text(pdf))
ok("only scanned pages OCR'd (2,3,5)", n == 3 and sorted(p for c in CALLS for p in c["pages"]) == [2, 3, 5])
ok("chunked by OCR_PAGES_PER_REQUEST", [c["pages"] for c in CALLS] == [[2, 3], [5]] and [c["pdf_pages"] for c in CALLS] == [2, 1])
ok("pages merged in order", [int(x) for x in re.findall(r"--- Page (\d+) ---", text)] == [1, 2, 3, 4, 5]
   and "Typed cover page" in text and "Scanned text of page 2" in text and "Scanned text of page 5" in text)
c0 = CALLS[0]
ok("request: model, effort low, default fallback", c0["model"] == "claude-opus-5-5" and c0["output_config"] == {"effort": "low"}
   and c0["fallbacks"] == "default" and c0["betas"] == ["server-side-fallback-2026-07-01"])
ok("platform key used when no own key", c0["api_key"] == "platform-key")

# ── text-only PDF: no OCR calls at all ──────────────────────────────────────
CALLS.clear()
text, n = asyncio.run(main.extract_pdf_text(build(["All typed page one with enough text", "All typed page two with enough text"])))
ok("text-only PDF makes no OCR calls", n == 0 and not CALLS)

# ── model ignored the page markers on a single page ─────────────────────────
MODE["v"] = "nomarkers"
text, n = asyncio.run(main.extract_pdf_text(build([None])))
ok("single page without markers still captured", "Invoice #42 total $99" in text and n == 1)

# ── failures become clear OcrErrors ─────────────────────────────────────────
for mode, status, word in (("refusal", 422, "could not be transcribed"), ("auth", 502, "key was rejected")):
    MODE["v"] = mode
    try:
        asyncio.run(main.extract_pdf_text(build([None]))); ok(f"{mode} raises", False)
    except main.OcrError as e:
        ok(f"{mode} → {status} '{word}'", e.status == status and word in str(e))
MODE["v"] = "markers"

key = os.environ.pop("ANTHROPIC_API_KEY")
try:
    asyncio.run(main.extract_pdf_text(build([None]))); ok("no key", False)
except main.OcrError as e:
    ok("no key configured → 503", e.status == 503)
os.environ["ANTHROPIC_API_KEY"] = key

main.OCR_MAX_PAGES = 2
try:
    asyncio.run(main.extract_pdf_text(build([None, None, None]))); ok("page cap", False)
except ValueError as e:
    ok("too many scanned pages → clear message", "3 scanned pages" in str(e) and "up to 2" in str(e))
main.OCR_MAX_PAGES = 200

# ── endpoint: own key preferred, else platform key + metering ───────────────
c = TestClient(main.app)
async def verified(req): return "u1"
main.require_verified_user = verified
OWN = {"key": None}
async def own_key(jwt, provider): return OWN["key"]
main.fetch_user_api_key = own_key
async def allow(*a, **k): return True, ""
main.check_rate_limit = allow
METERED = []
async def meter(uid, app_id, source, ws=None): METERED.append(source)
main.record_metered_run = meter

body = {"file_name": "scan.pdf", "content_b64": base64.b64encode(build(["Typed page with plenty of words here", None])).decode()}
CALLS.clear()
r = c.post("/v1/files/extract", json=body, headers={"Authorization": "Bearer jwt"}).json()
ok("endpoint returns OCR text + ocr_pages", r["ocr_pages"] == 1 and "Scanned text of page 2" in r["text"])
ok("platform OCR is metered", METERED == ["ocr"] and CALLS[-1]["api_key"] == "platform-key")
OWN["key"] = "sk-own"; METERED.clear(); CALLS.clear()
c.post("/v1/files/extract", json=body, headers={"Authorization": "Bearer jwt"})
ok("own Claude key used and not metered", CALLS[-1]["api_key"] == "sk-own" and METERED == [])
async def deny(*a, **k): return False, "Rate limit: 30/30 runs this hour."
main.check_rate_limit = deny; OWN["key"] = None
r = c.post("/v1/files/extract", json=body, headers={"Authorization": "Bearer jwt"})
ok("rate-limited user → 429 before any OCR call", r.status_code == 429 and "Rate limit" in r.json()["detail"])

# ── agent pdf tool uses OCR too, with the run's key ─────────────────────────
MODE["v"] = "markers"; CALLS.clear()
async def fake_fetch(method, url, **kw): return NS(content=build([None]))
main.fetch_safely = fake_fetch
out = asyncio.run(main.execute_tool({"type": "pdf", "config": {}}, {"url": "https://x.test/scan.pdf"}, {"api_key": "sk-run", "provider": "claude"}))
ok("agent pdf tool OCRs with the run's key", "Scanned text of page 1" in out and CALLS[-1]["api_key"] == "sk-run")
finish()
