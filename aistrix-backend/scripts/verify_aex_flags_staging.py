"""Phase 2 on staging: real apps and a real workflow with AEX_WORKFLOWS=on
and AEX_APP_TYPES=all, through the backend's own HTTP endpoints, on
.env.staging (never the default .env), as a real staging user with their
own saved Claude key.

The backend runs in-process (FastAPI TestClient). Sign-in is replaced by a
local test token mapped to that user, since the script has no password;
everything after authentication is the real code path against staging.

Only apps without tools or webhooks and workflows without API steps or
integration webhooks are run, so nothing reaches an outside service.

  venv/Scripts/python scripts/verify_aex_flags_staging.py --email you@example.com
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))
TOKEN = "local-verify-token"

SAMPLES = {"company": "Acme GmbH", "name": "Dana Smith", "email": "dana@acme.example", "role": "Operations lead",
           "title": "Senior Data Analyst", "location": "Berlin", "budget": 25000, "employees": 120, "seats": 40,
           "industry": "Logistics", "message": "Our March invoice was charged twice. Can you help?",
           "contact_role": "Head of Procurement", "what_they_asked_for": "A demo and pricing for 40 seats"}
INVOICE = ("INVOICE 2026-0457\nFrom: Northwind Supplies Ltd\nTo: Acme GmbH\nDate: 2026-10-20\n"
           "3 x Pallet wrap @ 40.00 = 120.00\nSubtotal 120.00\nVAT 20% 24.00\nTotal due: 144.00 GBP")
CSV = "month,region,revenue\n2026-07,North,12000\n2026-07,South,9000\n2026-08,North,15000\n2026-08,South,8000\n"


def say(results, ok, text):
    results.append(bool(ok))
    print(f"{'PASS' if ok else 'FAIL'} {text}", flush=True)


def sample_fields(fields: list) -> dict:
    out = {}
    for f in fields:
        name = f.get("field") or f.get("name") or f.get("label")
        if not name:
            continue
        key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        kind = f.get("type") or "string"
        choices = f.get("options") or f.get("enum") or f.get("enum_values")
        if isinstance(choices, str):
            choices = [c.strip() for c in choices.split(",") if c.strip()]      # form_schema keeps "a,b,c"
        if choices:
            out[name] = choices[0] if isinstance(choices[0], str) else (choices[0].get("value") or choices[0].get("label"))
        elif key in SAMPLES:
            out[name] = SAMPLES[key]
        elif kind in ("number", "integer"):
            out[name] = SAMPLES.get(name.lower(), 10)
        elif kind == "boolean":
            out[name] = True
        elif kind.endswith("array"):
            out[name] = [SAMPLES.get(name.lower(), "example")]
        else:
            key = next((k for k in SAMPLES if k in name.lower()), None)
            out[name] = SAMPLES[key] if key else f"Example {name.replace('_', ' ')}"
    return out


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
                      AEX_WORKFLOWS="on", AEX_APP_TYPES="all")
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
    # Saved keys are normally read with the user's own session (row-level
    # security); the stand-in token can't do that, so read the same row by id.
    real_key_by_jwt = main.fetch_user_api_key

    async def key_by_jwt(jwt, provider):
        if jwt == TOKEN:
            return await main.fetch_user_api_key_by_id(owner, provider)
        return await real_key_by_jwt(jwt, provider)
    main.fetch_user_api_key = key_by_jwt
    c = TestClient(main.app)
    H = {"Authorization": f"Bearer {TOKEN}"}
    results = []

    apps = {a["name"]: a for a in sb.table("apps").select("*").eq("created_by", owner).execute().data}
    tools = {t["app_id"] for t in sb.table("app_tools").select("app_id").execute().data or []}

    def safe(app):
        return app and app["id"] not in tools and not app.get("webhook_url")

    def platform_record(app_id, since):
        key = f"Application/legacy-apps/app-{app_id}"
        for _ in range(20):
            rows = sb.table("platform_runs").select("id,status,trigger,created_at,record").eq("resource_key", key) \
                .gte("created_at", since).execute().data or []
            if rows:
                return rows
            time.sleep(0.5)
        return []

    def app_runs_since(app_id, since):
        return sb.table("app_runs").select("source,status,error_kind,input_tokens,output_tokens,created_at") \
            .eq("app_id", app_id).gte("created_at", since).execute().data or []

    def now_iso():
        return main.datetime.now(main.timezone.utc).isoformat()

    plans = [("Support Reply Drafter", "api", {"input": SAMPLES["message"]}),
             ("Invoice Extractor", "api", {"input": INVOICE}),
             ("Sales CSV Analyst", "api", {"input": CSV + "\nWhich region grew from July to August?"}),
             ("Lead Qualifier", "sse", None),
             ("Bella - Bakery Helper", "sse", {"input": "Do you have gluten-free bread on Saturdays?"})]
    for name, path, body in plans:
        app = apps.get(name)
        if not safe(app):
            print(f"SKIP {name}: missing, or it has tools or a webhook")
            continue
        if body is None:
            # Form apps check their required fields by label (form_schema).
            fields = app.get("form_schema") or ((app.get("prod_snapshot") or {}).get("blueprint") or {}).get("input_schema", {}).get("fields") or []
            values = sample_fields(fields)
            # Like the browser: the filled fields also go as the text input.
            body = {"field_values": values, "input": "\n".join(f"{k}: {v}" for k, v in values.items())}
        since = now_iso()
        t0 = time.monotonic()
        if path == "api":
            r = c.post(f"/v1/apps/{app['id']}/run", json={**body, "stream": False}, headers=H)
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            output = data.get("output") or data.get("data")
            ok = r.status_code == 200 and bool(output)
            detail = f"HTTP {r.status_code}, {len(json.dumps(output)) if output else 0} chars"
        else:
            payload = {"app_id": app["id"], "input": body.get("input") or "", **({"field_values": body["field_values"]} if body.get("field_values") else {})}
            with c.stream("POST", "/run", json=payload, headers=H) as s:
                events = [json.loads(line[6:]) for line in s.iter_lines() if line.startswith("data: ")]
            tokens = "".join(e.get("token", "") for e in events)
            ok = s.status_code == 200 and tokens and any(e.get("done") for e in events)
            output = tokens
            detail = f"HTTP {s.status_code}, streamed {len(tokens)} chars in {sum('token' in e for e in events)} chunks"
        say(results, ok, f"{name} ({app['app_type']}, {path}): {detail}, {time.monotonic() - t0:.1f}s")
        if output:
            print(f"     output: {str(output)[:160]!r}")
        recs = platform_record(app["id"], since)
        say(results, len(recs) == 1 and recs[0]["status"] == "succeeded",
            f"{name}: recorded once in platform_runs on AEX ({[x['status'] for x in recs]})")

    # One app with the flags off, to compare what the run log keeps.
    app = apps.get("Support Reply Drafter")
    if safe(app):
        os.environ["AEX_APP_TYPES"] = ""
        since = now_iso()
        r = c.post(f"/v1/apps/{app['id']}/run", json={"input": SAMPLES["message"], "stream": False}, headers=H)
        legacy_logs = app_runs_since(app["id"], since)
        os.environ["AEX_APP_TYPES"] = "all"
        say(results, r.status_code == 200 and not platform_record(app["id"], since),
            "flags off: the same app runs on the legacy path and writes no platform_runs record")
        since_on = now_iso()
        r2 = c.post(f"/v1/apps/{app['id']}/run", json={"input": SAMPLES["message"], "stream": False}, headers=H)
        aex_logs = app_runs_since(app["id"], since_on)
        shape = lambda rows: sorted((x["source"], x["status"], x["error_kind"]) for x in rows)
        say(results, r2.status_code == 200 and shape(legacy_logs) == shape(aex_logs),
            f"the app's own run log is the same on both paths ({shape(legacy_logs)} vs {shape(aex_logs)})")

    # The workflow: approval first, then Lead Qualifier.
    flows = [f for f in sb.table("flows").select("*").eq("user_id", owner).execute().data or []
             if not f.get("integration_webhook_url") and all((s.get("step_type") or "app") != "api_call" for s in f.get("steps") or [])]
    for flow in flows[:1]:
        seed = {"company": "Acme GmbH", "contact_role": SAMPLES["contact_role"], "request": SAMPLES["what_they_asked_for"]}
        r = c.post(f"/v1/flows/{flow['id']}/runs", json={"wait": True, "input": json.dumps(seed)}, headers=H)
        run = r.json()
        say(results, r.status_code == 200 and run.get("status") == "waiting_approval",
            f"workflow '{flow['name']}' on AEX waits at its approval step ({run.get('status')}: {run.get('error')})")
        if run.get("status") == "waiting_approval":
            r = c.post(f"/v1/flows/{flow['id']}/runs/{run['id']}/resume", json={"approve": True, "wait": True}, headers=H)
            done = r.json()
            say(results, r.status_code == 200 and done.get("status") == "done",
                f"approving it runs the remaining steps ({done.get('status')}: {done.get('error')})")
            steps = done.get("steps") or []
            print(f"     steps: {[(s.get('name'), s.get('status'), s.get('version')) for s in steps]}")
            stored = sb.table("flow_runs").select("status,current_step,steps,needs_review").eq("id", run["id"]).execute().data[0]
            say(results, stored["status"] == "done" and stored["current_step"] == len(flow["steps"])
                and [s["status"] for s in stored["steps"]] == ["ok"] * len(flow["steps"]),
                "flow_runs keeps the legacy shape (status, current_step, one ok record per step)")
            app_step = next((s for s in flow["steps"] if s.get("app_id")), None)
            if app_step:
                print(f"     workflow app step output: {str(steps[-1].get('output'))[:160]!r}")

    print(f"SUMMARY {sum(results)} passed, {len(results) - sum(results)} failed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main_cli())
