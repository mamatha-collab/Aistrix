"""Native prompt apps on staging: real prompt apps with AEX_NATIVE_TYPES=prompt
(the model call made by an AEX llm.chat node), through the backend's own
HTTP endpoints, on .env.staging (never the default .env), as a real staging
user with their own saved Claude key.

The backend runs in-process (FastAPI TestClient). Sign-in is replaced by a
local test token mapped to that user, and the saved key is read by user id
instead of under the user's session; everything after that is the real path.
Only prompt apps without tools, webhooks, output contracts or custom models
are run, so nothing reaches an outside service.

For each app: a streamed run on the native path, checked for its native run
record; for the first app also the public API (stream: false) and one run
with the flag off, to compare what the caller receives.

  venv/Scripts/python scripts/verify_native_prompt_staging.py --email you@example.com
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))
TOKEN = "local-verify-token"
INPUTS = {
    "Support Reply Drafter": "Our March invoice was charged twice. Can you help?",
    "Meeting Notes Summarizer": ("Weekly ops sync, 27 Oct. Dana: warehouse move slips one week to 10 Nov. "
                                 "Sam: new courier contract signed, starts 1 Nov. Action: Dana to update customers by Friday."),
    "QA Build Verification 2026-10-14": "Build 2026.10.27-3: login, checkout and search pass; export to CSV fails with a 500.",
}


def say(results, ok, text):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'} {text}", flush=True)


def main_cli() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--email", required=True)
    args = p.parse_args()
    import run_local
    staging, default = dotenv_values(BACKEND / ".env.staging"), dotenv_values(BACKEND / ".env")
    if not staging.get("SUPABASE_URL") or staging.get("SUPABASE_URL") == default.get("SUPABASE_URL"):
        print("Refusing: .env.staging must name a Supabase project different from .env")
        return 2
    os.environ.update(run_local.local_environment(staging, default, dict(os.environ)))
    os.environ.update(PLATFORM_RESUME_SECONDS="0", SCHEDULER_INTERVAL_SECONDS="0", AISTRIX_TESTS_ALLOW_PLATFORM_KEYS="",
                      AEX_WORKFLOWS="off", AEX_APP_TYPES="", AEX_NATIVE_TYPES="prompt")
    os.chdir(BACKEND)
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
    real_key_by_jwt = main.fetch_user_api_key

    async def key_by_jwt(jwt, provider):
        if jwt == TOKEN:
            return await main.fetch_user_api_key_by_id(owner, provider)
        return await real_key_by_jwt(jwt, provider)
    main.fetch_user_api_key = key_by_jwt

    tools = {t["app_id"] for t in sb.table("app_tools").select("app_id").execute().data or []}
    apps = {a["name"]: a for a in sb.table("apps").select("*").eq("created_by", owner).eq("app_type", "prompt").execute().data}
    results = []

    def native_records(app_id, since):
        key = f"Application/legacy-apps/app-{app_id}"
        for _ in range(30):
            rows = [r for r in (sb.table("platform_runs").select("id,status,trigger,workload,created_at,record")
                                .eq("resource_key", key).gte("created_at", since).execute().data or [])
                    if r["workload"] == "chat"]
            if rows:
                return rows
            time.sleep(0.5)
        return []

    def now_iso():
        return main.datetime.now(main.timezone.utc).isoformat()

    def stream_run(c, app, text):
        # Like the browser: the app's configured provider and model go with the request.
        body = {"app_id": app["id"], "input": text, "ai_provider": app.get("ai_provider") or "claude", "ai_model": app.get("ai_model")}
        with c.stream("POST", "/run", json=body, headers={"Authorization": f"Bearer {TOKEN}"}) as s:
            events = [json.loads(line[6:]) for line in s.iter_lines() if line.startswith("data: ")]
        return s.status_code, events

    with TestClient(main.app) as c:
        chosen = [n for n in INPUTS if n in apps]
        for name in chosen:
            app = apps[name]
            bp = asyncio.run(main.fetch_app_blueprint(app["id"])) or {}
            if app["id"] in tools or app.get("webhook_url") or app.get("custom_model_url") \
                    or (bp.get("output_contract") or {}).get("format") == "json":
                print(f"SKIP {name}: has tools, a webhook, a custom model or an output contract")
                continue
            since = now_iso()
            t0 = time.monotonic()
            status, events = stream_run(c, app, INPUTS[name])
            text = "".join(e.get("token", "") for e in events)
            done = next((e for e in events if e.get("done")), {})
            say(results, status == 200 and text and done, f"{name} ({app.get('ai_model')}): streamed {len(text)} chars in "
                f"{sum('token' in e for e in events)} chunks, {time.monotonic() - t0:.1f}s, usage {done.get('usage')}")
            print(f"     output: {text[:170]!r}")
            recs = native_records(app["id"], since)
            rec = recs[0] if recs else None
            step = ((rec or {}).get("record") or {}).get("steps", {}).get("answer", {})
            # The node must have called the app's own model, the one the caller was told.
            say(results, len(recs) == 1 and rec["status"] == "succeeded" and step.get("status") == "succeeded"
                and (step.get("detail") or {}).get("model") == done.get("model") == app.get("ai_model"),
                f"{name}: one native AEX run, llm.chat node {step.get('status')} on {(step.get('detail') or {}).get('model')}")

        first = apps.get(chosen[0]) if chosen else None
        if first:
            since = now_iso()
            r = c.post(f"/v1/apps/{first['id']}/run", json={"input": INPUTS[chosen[0]], "stream": False},
                       headers={"Authorization": f"Bearer {TOKEN}"})
            body = r.json()
            recs = native_records(first["id"], since)
            say(results, r.status_code == 200 and body.get("output") and [x["status"] for x in recs] == ["succeeded"],
                f"{chosen[0]}: public API (stream: false) on the native path: HTTP {r.status_code}, "
                f"{len(body.get('output') or '')} chars, native run {[x['status'] for x in recs]}")

            native_status, native_events = stream_run(c, first, INPUTS[chosen[0]])
            os.environ["AEX_NATIVE_TYPES"] = ""
            since = now_iso()
            legacy_status, legacy_events = stream_run(c, first, INPUTS[chosen[0]])
            os.environ["AEX_NATIVE_TYPES"] = "prompt"
            shape = lambda evs: (sorted({k for e in evs for k in e if k != "usage"}),
                                 {k: v for k, v in next((e for e in evs if e.get("done")), {}).items() if k != "usage"})
            say(results, native_status == legacy_status == 200 and shape(native_events) == shape(legacy_events)
                and not native_records(first["id"], since),
                f"{chosen[0]}: flag off runs the legacy call (no native record) and the caller sees the same event kinds "
                f"and done metadata {shape(legacy_events)}")

    print(f"SUMMARY {sum(results)} passed, {len(results) - sum(results)} failed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main_cli())
