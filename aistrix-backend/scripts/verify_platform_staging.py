"""End-to-end check of platform v1 against the staging Supabase project.

Runs in-process with main.py on .env.staging (never the default .env), as a
real staging user, with that user's own saved Claude key:

  release app + eval suite → staging → production gate refuses → eval suite
  (real model calls, ERP mocked) → production → a run that posts to the
  owner's test destination → a run that waits for approval → a run left
  without a worker and resumed → a staging rollback.

Nothing leaves Aistrix: the ERP step posts to aistrix-test://destinations/erp,
which stores the body in test_deliveries for that user.

  venv/Scripts/python scripts/verify_platform_staging.py --email you@example.com
"""
import argparse
import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]
EXAMPLES = BACKEND.parent / "examples" / "invoice-pipeline"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))


def b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def say(ok: bool, text: str) -> bool:
    print(f"{'PASS' if ok else 'FAIL'} {text}", flush=True)
    return ok


async def verify(main, email: str) -> bool:
    from aistrix_platform import spec
    from aistrix_platform.evals import run_suite
    from aistrix_platform.registry import GateRefused

    engine, registry = main.app.state.platform_parts()
    sb = main._service_client()
    users = await asyncio.to_thread(lambda: sb.auth.admin.list_users(page=1, per_page=1000))
    owner = next((u.id for u in users if (u.email or "").lower() == email.lower()), None)
    if not owner:
        print(f"No staging user with that email")
        return False
    owner = str(owner)
    print(f"Owner: staging user {owner[:8]}…")
    if not await main.fetch_user_api_key_by_id(owner, "claude"):
        print("This user has no Claude key saved on staging. Add one in Settings → AI providers, then rerun.")
        return False
    results = []

    stamp = str(int(time.time()))
    version = f"1.0.{stamp}"
    app_doc = spec.parse_text((EXAMPLES / "aistrix.yaml").read_text(encoding="utf-8"))
    app_doc["metadata"].update(namespace="verify", version=version)
    post = next(n for n in app_doc["spec"]["workloads"][0]["nodes"] if n["id"] == "post")
    post["url"] = "aistrix-test://destinations/erp"
    app_doc["policies"].pop("outboundHosts", None)
    app_doc["tests"] = [f"EvalSuite/verify/invoice-regression@{version}"]
    suite_doc = spec.parse_text((EXAMPLES / "eval-suite.yaml").read_text(encoding="utf-8"))
    suite_doc["metadata"].update(namespace="verify", version=version)
    suite_doc["spec"]["target"]["ref"] = f"Application/verify/invoice-extractor@{version}"
    key = "Application/verify/invoice-extractor"

    # The spec declares ERP_API_KEY; store a placeholder (test destinations don't keep headers).
    await main.db(sb.table("platform_secrets").upsert({
        "owner_id": owner, "resource_key": key, "key": "ERP_API_KEY",
        "encrypted_value": main._encrypt("staging-verify-placeholder"), "last4": "lder",
        "updated_at": main.datetime.now(main.timezone.utc).isoformat()}, on_conflict="owner_id,resource_key,key"))

    app = await registry.release(app_doc, owner_id=owner, workspace_id=None, by=owner)
    suite = await registry.release(suite_doc, owner_id=owner, workspace_id=None, by=owner)
    results.append(say(app["version"] == version and suite["kind"] == "EvalSuite", f"released {key}@{version} and its eval suite"))
    stored = await registry.store.find_release(key, version, owner)
    results.append(say(stored and stored["content_hash"] == spec.content_hash(app_doc), "the release is stored with its content hash"))
    try:
        await main.db(sb.table("platform_releases").update({"version": "tampered"}).eq("id", app["id"]))
        results.append(say(False, "releases can't be edited in the database"))
    except Exception as e:
        results.append(say("immutable" in str(e), "releases can't be edited in the database"))

    await registry.promote(key, version, "staging", owner_id=owner, by=owner)
    try:
        await registry.promote(key, version, "production", owner_id=owner, by=owner)
        results.append(say(False, "production refuses a release without passing evals"))
    except GateRefused as e:
        results.append(say("hasn't been run" in str(e), "production refuses a release without passing evals"))

    t0 = time.monotonic()
    result = await run_suite(engine, registry, suite, owner_id=owner, workspace_id=None)
    for case in result["cases"]:
        print(f"     case {case['name']!r}: {'passed' if case['passed'] else 'failed'} {case['failures'] or ''}")
    results.append(say(result["passed"], f"eval suite on real Claude: {result['pass_rate']:.0%} passed, "
                                         f"${result['cost_usd']:.5f}, {time.monotonic() - t0:.1f}s"))
    if result["passed"]:
        env = await registry.promote(key, version, "production", owner_id=owner, by=owner)
        results.append(say(env["release_id"] == app["id"], "production now points at the release"))
    else:
        print("Stopping: production stays closed while evals fail.")
        return False

    release = await registry.resolve(key, "production", owner_id=owner)
    plan = release["plans"]["extract"]

    small = {"invoice_id": f"verify-{stamp}-1",
             "file": {"name": "small.txt", "mime": "text/plain", "content_base64": b64("Invoice from ACME GmbH. Total: 120.00 EUR.")}}
    run = await engine.start(plan, small, owner_id=owner, release_id=release["id"], environment="production", trigger="api")
    run = await engine.execute(run["id"])
    results.append(say(run["status"] == "succeeded", f"production run {run['id'][:8]}… {run['status']} "
                                                     f"(output {json.dumps(run['output'])}, ${run['cost_usd']:.5f})"))
    rows = (await main.db(sb.table("test_deliveries").select("id,destination,method,body,created_at").eq("user_id", owner)
                          .eq("destination", "erp").order("created_at", desc=True).limit(5))).data or []
    delivered = [r for r in rows if json.loads(r["body"] or "{}").get("invoice_id") == small["invoice_id"]]
    results.append(say(len(delivered) == 1 and delivered[0]["method"] == "POST",
                       f"the ERP write was captured once in test_deliveries ({delivered[0]['id'][:8] if delivered else 'none'}…)"))
    results.append(say("staging-verify-placeholder" not in json.dumps(rows), "the captured delivery doesn't hold the secret"))
    events = await engine.store.events(run["id"])
    results.append(say(events[0]["type"] == "run.created" and events[-1]["type"] == "run.finished",
                       f"{len(events)} run events stored in order"))

    large = {"invoice_id": f"verify-{stamp}-2",
             "file": {"name": "large.txt", "mime": "text/plain", "content_base64": b64("Invoice from Bolt Ltd. Total: 54,000.00 GBP.")}}
    run = await engine.start(plan, large, owner_id=owner, release_id=release["id"], environment="production", trigger="api")
    run = await engine.execute(run["id"])
    waited = run["status"] == "waiting_approval"
    results.append(say(waited, f"a large invoice waits for approval ({run['status']})"))
    if waited:
        await engine.approve(run["id"], "review", approved=True, by=owner, note="staging verification")
        run = await engine.execute(run["id"])
        results.append(say(run["status"] == "succeeded" and run["steps"]["review"]["decidedBy"] == owner,
                           "approving it finishes the run"))

    third = {**small, "invoice_id": f"verify-{stamp}-3"}
    stuck = await engine.start(plan, third, owner_id=owner, release_id=release["id"], environment="production", trigger="api")
    resumable = await engine.store.resumable_runs(limit=200)
    results.append(say(stuck["id"] in resumable, "a run with no worker shows up in the resume sweep"))
    resumed = await engine.execute(stuck["id"])
    results.append(say(resumed["status"] == "succeeded", "resuming it finishes the run"))

    v2 = json.loads(json.dumps(app_doc))
    v2["metadata"]["version"] = f"1.1.{stamp}"
    v2["tests"] = []
    await registry.release(v2, owner_id=owner, workspace_id=None, by=owner)
    await registry.promote(key, f"1.1.{stamp}", "staging", owner_id=owner, by=owner)
    back = await registry.rollback(key, "staging", owner_id=owner, by=owner)
    results.append(say(back["version"] == version, "rolling back staging returns the previous release"))

    print(f"SUMMARY {sum(results)} passed, {len(results) - sum(results)} failed")
    return all(results)


def main_cli() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--email", required=True, help="the staging user to run as (uses their saved Claude key)")
    args = p.parse_args()
    import run_local
    staging = dotenv_values(BACKEND / ".env.staging")
    default = dotenv_values(BACKEND / ".env")
    if not staging.get("SUPABASE_URL") or staging.get("SUPABASE_URL") == default.get("SUPABASE_URL"):
        print("Refusing: .env.staging must name a Supabase project different from .env")
        return 2
    os.environ.update(run_local.local_environment(staging, default, dict(os.environ)))
    os.environ.update(PLATFORM_RESUME_SECONDS="0", SCHEDULER_INTERVAL_SECONDS="0", AISTRIX_TESTS_ALLOW_PLATFORM_KEYS="")
    os.chdir(BACKEND)
    import main
    return 0 if asyncio.run(verify(main, args.email)) else 1


if __name__ == "__main__":
    sys.exit(main_cli())
