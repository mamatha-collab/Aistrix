"""Write supabase/migrations/<timestamp>_baseline.sql from the live schema.

Needs scripts/schema_baseline_export.sql to have been run in the Supabase SQL
Editor first (it creates aistrix_schema_ddl()). Uses the backend's .env for
SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

    aistrix-backend/venv/Scripts/python scripts/generate_baseline.py
"""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "aistrix-backend" / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
ddl = sb.rpc("aistrix_schema_ddl", {}).execute().data
if not isinstance(ddl, str) or "create table" not in ddl:
    sys.exit("Export returned no schema — was scripts/schema_baseline_export.sql run?")

migrations = ROOT / "supabase" / "migrations"
migrations.mkdir(parents=True, exist_ok=True)
existing = sorted(migrations.glob("*_baseline.sql"))
if existing and "--force" not in sys.argv:
    sys.exit(f"A baseline already exists: {existing[-1].name} (pass --force to write another)")

stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
path = migrations / f"{stamp}_baseline.sql"
header = (
    "-- Baseline: production schema when the project moved to Supabase CLI migrations.\n"
    "-- Already applied on production (recorded with `supabase migration repair`);\n"
    "-- runs only on new environments (staging, local). Do not edit.\n\n"
)
path.write_text(header + ddl, encoding="utf-8", newline="\n")
print(f"Wrote {path.relative_to(ROOT)} ({len(ddl):,} chars, {ddl.count(chr(10)):,} lines)")
