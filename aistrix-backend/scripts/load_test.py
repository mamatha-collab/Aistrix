"""Load test for a deployed Aistrix API (staging, never production).

Simulates many developers' apps being used at once and reports throughput,
response times (p50/p95/p99) and failures per endpoint.

  python scripts/load_test.py --base https://staging-api.example.com --users 100 --seconds 60

By default only read-only endpoints are hit (/health and, with --key, the
caller's usage). Real AI runs cost money: they are sent only with --run-app and
an API key for that app, and --runs-per-user caps how many each user sends.

Options:
  --base URL          API to test (required)
  --users N           concurrent simulated users (default 50)
  --seconds S         how long to run (default 30)
  --key KEY           an Aistrix API key (ak_live_…) for authenticated reads/runs
  --run-app APP_ID    also run this published app (costs AI credits)
  --runs-per-user N   cap on runs per simulated user (default 2)
"""
import argparse
import asyncio
import statistics
import time
from collections import defaultdict

import httpx


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    k = max(0, min(len(values) - 1, round(p / 100 * (len(values) - 1))))
    return values[k]


async def user_loop(client: httpx.AsyncClient, args, deadline: float, stats: dict) -> None:
    runs_left = args.runs_per_user
    while time.monotonic() < deadline:
        jobs = [("GET /health", "GET", "/health", None)]
        if args.key:
            jobs.append(("GET /v1/usage", "GET", "/v1/usage", None))
        if args.run_app and runs_left > 0:
            jobs.append(("POST /v1/apps/{id}/run", "POST", f"/v1/apps/{args.run_app}/run",
                         {"input": "Load test: reply with the single word OK.", "stream": False}))
            runs_left -= 1
        for name, method, path, body in jobs:
            start = time.perf_counter()
            try:
                r = await client.request(method, path, json=body)
                ok = r.status_code < 400
                stats[name]["codes"][r.status_code] += 1
            except Exception as e:
                ok = False
                stats[name]["codes"][type(e).__name__] += 1
            stats[name]["ms"].append((time.perf_counter() - start) * 1000)
            stats[name]["fail"] += 0 if ok else 1


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--key")
    ap.add_argument("--run-app")
    ap.add_argument("--runs-per-user", type=int, default=2)
    args = ap.parse_args()
    if args.run_app and not args.key:
        ap.error("--run-app needs --key (an API key allowed to run that app)")

    headers = {"Authorization": f"Bearer {args.key}"} if args.key else {}
    stats: dict = defaultdict(lambda: {"ms": [], "fail": 0, "codes": defaultdict(int)})
    limits = httpx.Limits(max_connections=args.users * 2, max_keepalive_connections=args.users)
    async with httpx.AsyncClient(base_url=args.base.rstrip("/"), headers=headers, timeout=120, limits=limits) as client:
        started = time.monotonic()
        deadline = started + args.seconds
        await asyncio.gather(*(user_loop(client, args, deadline, stats) for _ in range(args.users)))
        elapsed = time.monotonic() - started

    print(f"\n{args.users} users for {elapsed:.0f}s against {args.base}\n")
    print(f"{'endpoint':28} {'requests':>9} {'req/s':>7} {'p50 ms':>8} {'p95 ms':>8} {'p99 ms':>8} {'failed':>7}  codes")
    worst = 0.0
    for name, s in stats.items():
        n = len(s["ms"])
        rate = s["fail"] / n if n else 0
        worst = max(worst, rate)
        codes = ", ".join(f"{k}x{v}" for k, v in sorted(s["codes"].items(), key=lambda kv: str(kv[0])))
        print(f"{name:28} {n:9d} {n / elapsed:7.1f} {percentile(s['ms'], 50):8.0f} {percentile(s['ms'], 95):8.0f} "
              f"{percentile(s['ms'], 99):8.0f} {rate:7.1%}  {codes}")
    if any(s["ms"] for s in stats.values()):
        allms = [m for s in stats.values() for m in s["ms"]]
        print(f"\noverall mean {statistics.mean(allms):.0f} ms; worst failure rate {worst:.1%}")
    # 429s are rate limits doing their job, not failures of the service.
    raise SystemExit(1 if worst > 0.01 and not all(set(s["codes"]) <= {200, 429} for s in stats.values()) else 0)


if __name__ == "__main__":
    asyncio.run(main())
