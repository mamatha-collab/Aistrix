"""Shared setup for the backend check scripts.

Each check script runs in its own process (tests/test_checks.py) because it
patches `main` module globals differently. Import this module and call
`setup()` BEFORE `import main`.

Safety: main.py calls load_dotenv(), which would pull real keys from
aistrix-backend/.env. load_dotenv never overrides variables that are already
set, so setup() sets every paid/outbound key to "" first — tests can never
reach Anthropic, OpenAI, Stripe, email providers or a real Supabase.
"""
import os
import sys
import tempfile
import atexit
import shutil
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
SDK = BACKEND.parent / "aistrix-sdk"

_BLANKED = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
            "RESEND_API_KEY", "SENDGRID_API_KEY", "GITHUB_CLIENT_SECRET")

_failed: list[str] = []
_passed = 0


def setup(**env: str) -> None:
    telemetry_dir = tempfile.mkdtemp(prefix="aistrix-telemetry-check-")
    atexit.register(shutil.rmtree, telemetry_dir, ignore_errors=True)
    os.environ.update({
        "SUPABASE_URL": "http://fake.invalid",
        "SUPABASE_ANON_KEY": "anon",
        "SUPABASE_SERVICE_ROLE_KEY": "svc",
        "SENTRY_DSN": "",
        "MONITOR_CACHE_SECONDS": "0", "SCHEDULER_INTERVAL_SECONDS": "0",     # checks change data between requests
        # Suites written before developer tiers: Aistrix pays, no tier limits.
        # check_tiers.py turns both on.
        "DEVELOPER_TIERS": "0", "AISTRIX_TESTS_ALLOW_PLATFORM_KEYS": "1",
        "TELEMETRY_OUTBOX_PATH": str(Path(telemetry_dir) / "outbox.sqlite3"),
        **{k: "" for k in _BLANKED},
        **env,
    })
    for p in (BACKEND, SDK):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


def ok(name: str, cond) -> bool:
    """Record one check; prints PASS/FAIL so the runner can report it."""
    global _passed
    if cond:
        _passed += 1
        print(f"PASS {name}", flush=True)
    else:
        _failed.append(name)
        print(f"FAIL {name}", flush=True)
    return bool(cond)


def finish() -> None:
    print(f"SUMMARY {_passed} passed, {len(_failed)} failed", flush=True)
    sys.exit(1 if _failed or _passed == 0 else 0)
