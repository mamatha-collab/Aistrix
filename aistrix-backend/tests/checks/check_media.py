"""Vision and Voice apps: images sent with a run reach the model in each
provider's format (and are refused where they'd be silently dropped); audio is
transcribed on the person's or the developer's own OpenAI key, only for people
who can use the Voice app. Fake Supabase, fake model and fake OpenAI only."""
import asyncio
import base64
from types import SimpleNamespace as NS

import _harness
from _harness import ok, finish
_harness.setup(DEVELOPER_TIERS="1", AISTRIX_TESTS_ALLOW_PLATFORM_KEYS="0")
import main  # noqa
from fastapi.testclient import TestClient

DEV, CUSTOMER, OTHER = "dev", "customer", "other"
KEYS: dict = {}
APPS: dict = {}
SEEN, TRANSCRIBED = [], []


def app(app_id, app_type="vision", **extra):
    APPS[app_id] = {"id": app_id, "name": app_id, "created_by": DEV, "app_type": app_type, "is_published": True,
                    "publish_approved_at": "2026-10-01", "visibility": "public", "system_prompt": "Describe it.",
                    "ai_provider": "claude", "ai_model": "claude-haiku-5-5", "output_type": "markdown", **extra}


async def load(app_id): return dict(APPS[app_id]) if app_id in APPS else None
async def verify(tok): return tok.removeprefix("tok-") or None
async def none(*a, **k): return None
async def empty(*a, **k): return ""
async def emptyd(*a, **k): return {}
async def emptyl(*a, **k): return []
async def allow(*a, **k): return True, ""
async def key_by_id(uid, provider): return KEYS.get((uid, provider))
async def key_by_jwt(jwt, provider): return KEYS.get((jwt.removeprefix("tok-"), provider))
async def can_edit(app_row, caller): return bool(app_row) and caller is not None and caller.user_id == app_row.get("created_by")
async def can_view(app_row, caller): return bool(app_row) and (app_row.get("is_published") or caller.user_id == app_row.get("created_by"))
async def tier(uid): return "free"
TOOLS: dict = {}
async def tools_for(app_id): return TOOLS.get(app_id, [])


async def fake_stream(system, user_input, model, api_key=None, usage_holder=None, images=None, **kw):
    SEEN.append({"input": user_input, "images": images, "key": api_key})
    if usage_holder is not None:
        usage_holder.update(input_tokens=10, output_tokens=5)
    yield "a red bicycle"


class FakeTranscriptions:
    text = "Hello team, the launch moves to Friday."
    async def create(self, model, file):
        TRANSCRIBED.append({"model": model, "name": file[0], "bytes": len(file[1])})
        return NS(text=self.text)
transcriptions = FakeTranscriptions()
KEYS_USED = []
def openai_client(provider, key):
    KEYS_USED.append(key)
    return NS(audio=NS(transcriptions=transcriptions))


main.load_app_row = load; main.verify_user_jwt = verify; main.can_edit_app = can_edit; main.can_view_app = can_view
main.app_member_role = none; main.workspace_role = none; main.personal_workspace_id = none
main.fetch_app_knowledge = empty; main.fetch_app_tools = tools_for; main._load_app_secrets = emptyd
main.fetch_app_blueprint = emptyd
main.check_rate_limit = allow; main.record_metered_run = none; main.find_active_entitlement = none
main.fetch_user_api_key = key_by_jwt; main.fetch_user_api_key_by_id = key_by_id; main.developer_tier = tier
main.stream_claude = fake_stream; main.stream_openai = fake_stream
main._openai_client = openai_client
class Q:
    """Empty tables that accept any query (runs here don't need stored rows)."""
    def __init__(self, name): self.name = name
    def __getattr__(self, attr): return lambda *a, **k: self
    @property
    def not_(self): return self
    def execute(self): return NS(data=[], count=0)


main._service_client = lambda: NS(table=lambda t: Q(t), rpc=lambda *a, **k: NS(execute=lambda: NS(data=True)))
main._telemetry_service_client = main._service_client
c = TestClient(main.app, raise_server_exceptions=False)
as_ = lambda who: {"Authorization": f"Bearer tok-{who}"}
png = base64.b64encode(b"\x89PNG\r\n\x1a\nfake-image").decode()

# ── Vision: images reach the model ───────────────────────────────────────────
app("photo-app")
KEYS[(DEV, "claude")] = "sk-ant-dev"
r = c.post("/run", json={"app_id": "photo-app", "input": "What is in this picture?",
                         "images": [{"media_type": "image/png", "data": png}]}, headers=as_(CUSTOMER))
ok("a Vision app's image is sent to the model with the question", r.status_code == 200 and SEEN
   and SEEN[-1]["images"] and SEEN[-1]["images"][0].media_type == "image/png" and SEEN[-1]["key"] == "sk-ant-dev")
blocks = main._claude_content("Describe", SEEN[-1]["images"])
ok("…as a Claude image block before the text", blocks[0]["type"] == "image" and blocks[0]["source"]["data"] == png
   and blocks[-1] == {"type": "text", "text": "Describe"})
parts = main._openai_content("Describe", SEEN[-1]["images"])
ok("…and as an image URL for OpenAI and Gemini", parts[0]["image_url"]["url"].startswith("data:image/png;base64,"))
ok("a run without images is unchanged (plain text)", main._claude_content("hi") == "hi" and main._openai_content("hi") == "hi")
r = c.post("/run", json={"app_id": "photo-app", "input": "x", "images": [{"media_type": "image/bmp", "data": png}]}, headers=as_(CUSTOMER))
ok("only PNG, JPEG, WebP and GIF are accepted", r.status_code == 422)
r = c.post("/run", json={"app_id": "photo-app", "input": "x", "images": [{"media_type": "image/png", "data": png}] * 5}, headers=as_(CUSTOMER))
ok("at most 4 images per run", r.status_code == 422)
big = "A" * (6 * 1024 * 1024 * 4 // 3)
r = c.post("/run", json={"app_id": "photo-app", "input": "x", "images": [{"media_type": "image/png", "data": big}]}, headers=as_(CUSTOMER))
ok("each image under 5 MB", r.status_code == 422)
TOOLS["photo-app"] = [{"name": "lookup", "description": "d", "type": "calculator", "config": {}, "input_schema": {}}]
SEEN.clear()
r = c.post("/run", json={"app_id": "photo-app", "input": "x", "images": [{"media_type": "image/png", "data": png}]}, headers=as_(CUSTOMER))
ok("images aren't silently dropped by apps with tools: refused with a reason", r.status_code == 400
   and r.json()["code"] == "images_not_supported" and not SEEN)
TOOLS.clear()

# ── Voice: transcription on the person's or developer's OpenAI key ───────────
app("voice-app", "voice")
audio = base64.b64encode(b"ID3fake-mp3-bytes").decode()
body = {"file_name": "standup.mp3", "content_b64": audio, "app_id": "voice-app"}
KEYS.clear()
r = c.post("/v1/files/transcribe", json=body, headers=as_(CUSTOMER))
ok("without any OpenAI key, transcription says what to add (never Aistrix's key)", r.status_code == 409
   and "OpenAI key" in r.json()["detail"] and not TRANSCRIBED)
KEYS[(DEV, "openai")] = "sk-openai-dev"
r = c.post("/v1/files/transcribe", json=body, headers=as_(CUSTOMER))
ok("a customer's recording is transcribed on the developer's OpenAI key", r.status_code == 200
   and r.json()["text"] == "Hello team, the launch moves to Friday." and KEYS_USED[-1] == "sk-openai-dev"
   and TRANSCRIBED[-1]["name"] == "standup.mp3")
KEYS[(CUSTOMER, "openai")] = "sk-openai-customer"
c.post("/v1/files/transcribe", json=body, headers=as_(CUSTOMER))
ok("…or on the customer's own key when they have one", KEYS_USED[-1] == "sk-openai-customer")
ok("only for Voice apps", c.post("/v1/files/transcribe", json={**body, "app_id": "photo-app"}, headers=as_(CUSTOMER)).status_code == 400)
app("draft-voice", "voice", is_published=False)
ok("not for apps the person can't use", c.post("/v1/files/transcribe", json={**body, "app_id": "draft-voice"}, headers=as_(OTHER)).status_code == 404)
app("paid-voice", "voice", is_paid=True)
ok("a paid Voice app needs access first", c.post("/v1/files/transcribe", json={**body, "app_id": "paid-voice"}, headers=as_(CUSTOMER)).status_code == 402)
ok("its developer can always transcribe while building", c.post("/v1/files/transcribe", json={**body, "app_id": "draft-voice"}, headers=as_(DEV)).status_code == 200)
ok("only audio files", c.post("/v1/files/transcribe", json={**body, "file_name": "notes.pdf"}, headers=as_(CUSTOMER)).status_code == 415)
main.MAX_AUDIO_BYTES = 4
ok("recordings over the size limit are refused", c.post("/v1/files/transcribe", json=body, headers=as_(CUSTOMER)).status_code == 413)
main.MAX_AUDIO_BYTES = 25 * 1024 * 1024
transcriptions.text = "   "
ok("a recording with no speech says so", c.post("/v1/files/transcribe", json=body, headers=as_(CUSTOMER)).status_code == 422)
finish()
