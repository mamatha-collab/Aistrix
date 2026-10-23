"""Runs each tests/checks/check_*.py in its own Python process.

The check scripts patch `main` module globals (fake Supabase, fake model
streams, rate limits), so they can't share one interpreter. A script fails
when any of its checks prints FAIL, it exits non-zero, or it runs no checks.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

CHECKS = sorted((Path(__file__).parent / "checks").glob("check_*.py"))


@pytest.mark.parametrize("script", CHECKS, ids=[p.stem for p in CHECKS])
def test_check_script(script: Path):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    proc = subprocess.run([sys.executable, str(script)], cwd=script.parent, env=env,
                          capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = proc.stdout.splitlines()
    failed = [line[5:] for line in lines if line.startswith("FAIL ")]
    passed = sum(line.startswith("PASS ") for line in lines)
    assert proc.returncode == 0 and not failed and passed, (
        f"{script.name}: {passed} passed, failed: {failed or 'none'} (exit {proc.returncode})\n"
        f"--- stdout (tail) ---\n{chr(10).join(lines[-30:])}\n--- stderr (tail) ---\n{proc.stderr[-3000:]}"
    )
