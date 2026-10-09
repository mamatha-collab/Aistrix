"""Compare two Supabase environments (e.g. production vs staging).

Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY from two
backend env files and checks what's visible through the API:
  • tables and their columns (names + types)
  • database functions exposed as RPC
  • storage buckets (privacy + size limits)
  • what a signed-out visitor can reach (sample of read/call probes)
Exit code 1 when anything differs. Read-only.

    aistrix-backend/venv/Scripts/python scripts/compare_envs.py aistrix-backend/.env aistrix-backend/.env.staging
"""
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values
from supabase import create_client

ZERO = "00000000-0000-0000-0000-000000000000"
ANON_RPC_PROBES = {
    "personal_workspace_id": {"p_user_id": ZERO},
    "consume_entitlement_run": {"p_entitlement_id": ZERO},
    "update_app_badges": {},
    "increment_app_runs": {"p_app_id": ZERO},
    "workspace_member_list": {"p_workspace_id": ZERO},
    "accept_workspace_invite": {"p_token": ZERO},
}
ANON_TABLE_PROBES = ["app_tools", "app_secrets", "developer_api_keys", "workspaces", "run_events", "user_api_keys"]


def snapshot(env_path: str) -> dict:
    env = dotenv_values(env_path)
    url, key, anon_key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY"), env.get("SUPABASE_ANON_KEY")
    if not (url and key and anon_key):
        sys.exit(f"{env_path}: needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY")
    spec = httpx.get(f"{url}/rest/v1/", headers={"apikey": key, "Authorization": f"Bearer {key}",
                                                  "Accept": "application/openapi+json"}, timeout=30).json()
    tables = {t: {c: (p.get("format") or p.get("type")) for c, p in d.get("properties", {}).items()}
              for t, d in spec.get("definitions", {}).items()}
    rpcs = sorted(p[5:] for p in spec.get("paths", {}) if p.startswith("/rpc/"))
    svc = create_client(url, key)
    buckets = {b.id: (b.public, b.file_size_limit) for b in svc.storage.list_buckets()}

    anon = create_client(url, anon_key)
    access = {}
    for fn, args in ANON_RPC_PROBES.items():
        try:
            anon.rpc(fn, args).execute()
            access[f"rpc {fn}"] = "callable"
        except Exception as e:
            access[f"rpc {fn}"] = "blocked" if ("permission denied" in str(e) or "42501" in str(e)) else "error"
    for t in ANON_TABLE_PROBES:
        try:
            rows = anon.table(t).select("*").limit(1).execute().data
            access[f"read {t}"] = "rows visible" if rows else "empty/hidden"
        except Exception:
            access[f"read {t}"] = "blocked"
    return {"url": url, "tables": tables, "rpcs": rpcs, "buckets": buckets, "access": access}


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    a, b = (snapshot(p) for p in sys.argv[1:3])
    na, nb = (Path(p).name for p in sys.argv[1:3])
    print(f"A = {na}  ({a['url']})\nB = {nb}  ({b['url']})\n")
    problems = 0

    def report(title, only_a, only_b, changed=()):
        nonlocal problems
        issues = [f"  only in A: {x}" for x in only_a] + [f"  only in B: {x}" for x in only_b] + list(changed)
        problems += len(issues)
        print(f"{'OK  ' if not issues else 'DIFF'} {title}")
        for line in issues:
            print(line)

    ta, tb = a["tables"], b["tables"]
    report(f"tables ({len(ta)} vs {len(tb)})", sorted(set(ta) - set(tb)), sorted(set(tb) - set(ta)))
    col_diffs = []
    for t in sorted(set(ta) & set(tb)):
        for c in sorted(set(ta[t]) | set(tb[t])):
            if ta[t].get(c) != tb[t].get(c):
                col_diffs.append(f"  {t}.{c}: A={ta[t].get(c) or '—'}  B={tb[t].get(c) or '—'}")
    report("columns and types", [], [], col_diffs)
    report(f"functions ({len(a['rpcs'])} vs {len(b['rpcs'])})",
           sorted(set(a["rpcs"]) - set(b["rpcs"])), sorted(set(b["rpcs"]) - set(a["rpcs"])))
    bucket_diffs = [f"  {k}: A={a['buckets'].get(k)}  B={b['buckets'].get(k)}"
                    for k in sorted(set(a["buckets"]) | set(b["buckets"])) if a["buckets"].get(k) != b["buckets"].get(k)]
    report("storage buckets", [], [], bucket_diffs)
    # Row visibility depends on data, so only flag access-level differences.
    norm = lambda v: "readable" if v in ("rows visible", "empty/hidden") else v
    access_diffs = [f"  {k}: A={a['access'][k]}  B={b['access'][k]}"
                    for k in a["access"] if norm(a["access"][k]) != norm(b["access"][k])]
    report("signed-out access", [], [], access_diffs)

    print(f"\n{'Environments match.' if not problems else f'{problems} difference(s).'}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
