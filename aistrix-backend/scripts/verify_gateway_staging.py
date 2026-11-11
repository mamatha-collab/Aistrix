"""Model gateway and code import on staging, through the backend's own HTTP
endpoints, on .env.staging (never the default .env), as a real staging user
with their own saved Claude key.

The backend runs in-process (FastAPI TestClient) and is called with the REAL
openai and anthropic Python SDKs. Sign-in is replaced by a local test token
mapped to that user (sent as a Bearer token; ak_live_ keys are covered by
the offline checks); everything after that is the real path: the saved key,
Anthropic, spend reservations and the gateway_calls table on staging.

Model calls use policy:fast (Claude Haiku) to keep the cost to cents.

The import step creates a temporary code app, imports a folder of the
project's GitHub repository (through the user's GitHub connection when
staging has one, else a public repository), checks the saved source and
deletes the app. Nothing is built or run.

  venv/Scripts/python scripts/verify_gateway_staging.py --email you@example.com
"""
import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))
TOKEN = "local-verify-token"
REPO = "https://github.com/mamatha-collab/Aistrix/tree/feat/platform-v1/examples/python-inventory-job"
PUBLIC_REPO = "https://github.com/octocat/Hello-World"


def say(results, ok, text, detail=None):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'} {text}", flush=True)
    if not ok and detail is not None:
        print(f"  detail: {str(detail)[:500]}", flush=True)


def main_cli() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--email", required=True)
    p.add_argument("--skip-import", action="store_true")
    args = p.parse_args()
    import run_local
    staging, default = dotenv_values(BACKEND / ".env.staging"), dotenv_values(BACKEND / ".env")
    if not staging.get("SUPABASE_URL") or staging.get("SUPABASE_URL") == default.get("SUPABASE_URL"):
        print("Refusing: .env.staging must name a Supabase project different from .env")
        return 2
    os.environ.update(run_local.local_environment(staging, default, dict(os.environ)))
    os.environ.update(PLATFORM_RESUME_SECONDS="0", SCHEDULER_INTERVAL_SECONDS="0", AISTRIX_TESTS_ALLOW_PLATFORM_KEYS="")
    os.chdir(BACKEND)
    import anthropic
    import openai
    import main
    from fastapi.testclient import TestClient

    sb = main._service_client()
    owner = next((str(u.id) for u in sb.auth.admin.list_users(page=1, per_page=1000)
                  if (u.email or "").lower() == args.email.lower()), None)
    if not owner:
        print("No staging user with that email")
        return 1

    async def verify(token):
        return owner if token == TOKEN else None
    main.verify_user_jwt = verify
    results = []
    trace = f"staging-verify-{uuid.uuid4().hex[:12]}"
    since = main.datetime.now(main.timezone.utc).isoformat()

    with TestClient(main.app) as c:
        base = "http://testserver/v1/gateway"
        oa = openai.OpenAI(base_url=f"{base}/openai", api_key=TOKEN, http_client=c, max_retries=0,
                           default_headers={"X-Aistrix-Trace": trace})
        an = anthropic.Anthropic(base_url=f"{base}/anthropic", auth_token=TOKEN, http_client=c, max_retries=0,
                                 default_headers={"X-Aistrix-Trace": trace})

        # ── OpenAI SDK → Claude ─────────────────────────────────────────────
        r = oa.chat.completions.create(model="policy:fast", max_tokens=60, messages=[
            {"role": "system", "content": "Answer in one short sentence."},
            {"role": "user", "content": "What is the capital of France?"}])
        text = r.choices[0].message.content or ""
        say(results, "paris" in text.lower() and r.usage.prompt_tokens > 0 and r.choices[0].finish_reason == "stop",
            f"OpenAI SDK → Claude Haiku answered ({r.usage.prompt_tokens} in / {r.usage.completion_tokens} out)", r)

        chunks = list(oa.chat.completions.create(model="policy:fast", max_tokens=80, stream=True,
                                                 stream_options={"include_usage": True},
                                                 messages=[{"role": "user", "content": "Count from 1 to 10, comma separated."}]))
        pieces = [ch.choices[0].delta.content for ch in chunks if ch.choices and ch.choices[0].delta.content]
        streamed = "".join(pieces)
        say(results, "10" in streamed and len(pieces) > 1 and chunks[-1].usage and chunks[-1].usage.completion_tokens > 0,
            f"OpenAI streaming arrived in {len(pieces)} pieces with usage", streamed)

        tools = [{"type": "function", "function": {
            "name": "get_order_status", "description": "Look up the shipping status of an order by its id.",
            "parameters": {"type": "object", "required": ["order_id"],
                           "properties": {"order_id": {"type": "string"}}}}}]
        ask = [{"role": "user", "content": "Where is order A-1001? Use the tool."}]
        r = oa.chat.completions.create(model="policy:fast", max_tokens=200, tools=tools, messages=ask)
        calls = r.choices[0].message.tool_calls or []
        args_ok = bool(calls) and json.loads(calls[0].function.arguments).get("order_id") == "A-1001"
        say(results, r.choices[0].finish_reason == "tool_calls" and args_ok, "Claude asked for the tool with the order id", r)
        if calls:
            follow = ask + [{"role": "assistant", "content": r.choices[0].message.content,
                             "tool_calls": [{"id": calls[0].id, "type": "function",
                                             "function": {"name": calls[0].function.name, "arguments": calls[0].function.arguments}}]},
                            {"role": "tool", "tool_call_id": calls[0].id, "content": '{"status": "delivered", "date": "2026-11-09"}'}]
            r = oa.chat.completions.create(model="policy:fast", max_tokens=120, tools=tools, messages=follow)
            say(results, "deliver" in (r.choices[0].message.content or "").lower(),
                "the tool result went back and Claude used it", r.choices[0].message.content)

        # ── Anthropic SDK ───────────────────────────────────────────────────
        m = an.messages.create(model="claude-haiku-5-5", max_tokens=60, system="Reply in French, one sentence.",
                               messages=[{"role": "user", "content": "Good morning"}])
        say(results, m.content and m.content[0].type == "text" and m.stop_reason == "end_turn" and m.usage.output_tokens > 0,
            "Anthropic SDK got a message", m)
        with an.messages.stream(model="claude-haiku-5-5", max_tokens=80,
                                messages=[{"role": "user", "content": "Name three colours."}]) as s:
            pieces = list(s.text_stream)
            final = s.get_final_message()
        say(results, len(pieces) > 1 and final.stop_reason == "end_turn", f"Anthropic streaming arrived in {len(pieces)} pieces")

        # ── refusals ────────────────────────────────────────────────────────
        try:
            oa.chat.completions.create(model="llama-3", messages=[{"role": "user", "content": "x"}])
            refused = None
        except openai.BadRequestError as e:
            refused = e
        say(results, refused is not None and "Prefix it with its provider" in str(refused), "an unknown model is refused")

        # ── the call log and spend on staging ───────────────────────────────
        r = c.get(f"/v1/gateway/calls?trace={trace}", headers={"Authorization": f"Bearer {TOKEN}"})
        rows = r.json().get("calls") or []
        # Six calls reached Claude; the unknown model was refused before any call, so it isn't logged.
        say(results, r.status_code == 200 and len(rows) == 6 and all(x["status"] == "ok" for x in rows)
            and all(x["provider"] == "claude" and x["model"] == "claude-haiku-5-5" for x in rows)
            and sum(1 for x in rows if x["stream"]) == 2 and all((x["cost_usd"] or 0) > 0 for x in rows),
            f"staging logged {len(rows)} calls, total ${r.json().get('cost_usd')}", rows[:2])
        say(results, not any(s in json.dumps(rows) for s in ("capital of France", "A-1001", "delivered", "Good morning")),
            "the log holds no prompt, answer or tool text")
        held = []
        for _ in range(20):
            held = (sb.table("spend_reservations").select("model,status,reserved_usd,actual_usd,payer")
                    .eq("key_owner", owner).gte("created_at", since).execute().data or [])
            if len(held) >= 6 and all(h["status"] != "reserved" for h in held):
                break
            time.sleep(0.5)
        say(results, len(held) == 6 and all(h["status"] == "settled" and h["payer"] == "own" for h in held)
            and all(float(h["actual_usd"] or 0) <= float(h["reserved_usd"] or 0) for h in held),
            f"each call reserved spend and settled it ({len(held)} reservations)", held[:3])

        # ── importing code from GitHub ──────────────────────────────────────
        if not args.skip_import:
            app_id = None
            try:
                app_id = sb.table("apps").insert({"name": "Import check (temporary)", "created_by": owner,
                                                  "app_type": "code_job", "visibility": "private", "output_type": "json",
                                                  "description": "Temporary app for the import check."}).execute().data[0]["id"]
                connected = bool((sb.table("developer_github").select("user_id").eq("user_id", owner).execute().data or []))
                r = c.post(f"/v1/apps/{app_id}/code/import", json={"repo": REPO}, headers={"Authorization": f"Bearer {TOKEN}"})
                data = r.json()
                imp = data.get("import") or {}
                saved = data.get("source") or {}
                say(results, r.status_code == 200 and sorted(imp.get("files", [])) == ["main.py", "requirements.txt", "sample-input.json"]
                    and saved.get("source_hash") and saved.get("manifest", {}).get("entrypoint") and imp.get("commit")
                    and imp.get("private_access") == connected,
                    f"imported {imp.get('repo')}/{imp.get('path')} at commit {imp.get('commit')} "
                    f"({'GitHub connection' if connected else 'anonymously, public repository'}): files {imp.get('files')}, "
                    f"skipped {[x['path'] for x in imp.get('skipped', [])]}, entrypoint {saved.get('manifest', {}).get('entrypoint')}", r.text)
                stored = sb.table("code_sources").select("source_hash").eq("app_id", app_id).execute().data or []
                say(results, len(stored) == 1 and stored[0]["source_hash"] == saved.get("source_hash"),
                    "the source version is stored on staging with the same hash")
                queued = sb.table("code_tasks").select("id").eq("app_id", app_id).execute().data or []
                say(results, not queued, "importing queued no build or run")
            finally:
                if app_id:
                    sb.table("apps").delete().eq("id", app_id).execute()
                    gone = not (sb.table("apps").select("id").eq("id", app_id).execute().data or [])
                    say(results, gone, "the temporary code app was deleted")

    print(f"SUMMARY {sum(results)} passed, {len(results) - sum(results)} failed (trace {trace})")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main_cli())
