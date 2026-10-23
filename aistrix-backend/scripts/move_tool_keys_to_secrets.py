"""Move raw keys out of app tool settings into encrypted app secrets.

Tools used to store API keys (e.g. an email tool's SendGrid key) directly in
app_tools.config. This saves each one as an app secret (encrypted, owned by
the app's owner — the account runs load secrets for) and replaces the value
with a {{secrets.NAME}} reference, which is filled in only when the tool runs.

Run once per environment, from aistrix-backend/, with that environment's
.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SECRET_ENCRYPTION_KEY):

    python scripts/move_tool_keys_to_secrets.py            # dry run: report only
    python scripts/move_tool_keys_to_secrets.py --apply    # make the changes
    python scripts/move_tool_keys_to_secrets.py --env-file .env.staging

Keys are never printed. Tools with key-like text elsewhere in their settings
(e.g. inside headers) are listed for a manual fix.
"""
import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import dotenv_values
from supabase import create_client

SECRET_FIELDS = {"api_key", "apikey", "token", "access_token", "auth_token", "secret", "password"}
REF = re.compile(r"^\s*\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}\s*$")
KEY_LIKE = re.compile(r"(sk-ant-[\w-]{8,}|sk-(?:proj-)?[\w-]{16,}|AIza[\w-]{20,}|ak_live_\w{8,}|SG\.[\w.-]{16,}|gh[pousr]_\w{20,})")


def secret_name(tool_name: str, field: str) -> str:
    base = re.sub(r"[^A-Z0-9]+", "_", f"{tool_name}_{field}".upper()).strip("_")
    return (base or "TOOL_KEY")[:100]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry run)")
    ap.add_argument("--env-file", default=".env", help="environment file to read (default: .env)")
    args = ap.parse_args()

    env = dotenv_values(Path(args.env_file))
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SECRET_ENCRYPTION_KEY") if not env.get(k)]
    if missing:
        print(f"Missing in {args.env_file}: {', '.join(missing)}")
        return 2
    fernet = Fernet(env["SECRET_ENCRYPTION_KEY"].encode())
    sb = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])

    tools = sb.table("app_tools").select("id, app_id, name, config").execute().data or []
    owners = {a["id"]: a["created_by"] for a in (sb.table("apps").select("id, created_by").execute().data or [])}

    moved = manual = 0
    for tool in tools:
        config = dict(tool.get("config") or {})
        changed = []
        for field, value in list(config.items()):
            if field.lower() in SECRET_FIELDS and isinstance(value, str) and value.strip() and not REF.match(value):
                name = secret_name(tool["name"] or "tool", field)
                owner = owners.get(tool["app_id"])
                if not owner:
                    print(f"  skip tool {tool['id']}: its app has no owner")
                    continue
                changed.append((field, name))
                if args.apply:
                    sb.table("app_secrets").upsert({
                        "app_id": tool["app_id"], "user_id": owner, "key": name,
                        "encrypted_value": fernet.encrypt(value.strip().encode()).decode(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }, on_conflict="app_id,key").execute()
                config[field] = "{{secrets.%s}}" % name
        if changed:
            moved += len(changed)
            fields = ", ".join(f"{f} → {{{{secrets.{n}}}}}" for f, n in changed)
            print(f"{'moved' if args.apply else 'would move'}: tool {tool['id']} ({tool['name']}) on app {tool['app_id']}: {fields}")
            if args.apply:
                sb.table("app_tools").update({"config": config}).eq("id", tool["id"]).execute()
        rest = {k: v for k, v in config.items() if k.lower() not in SECRET_FIELDS}
        if KEY_LIKE.search(str(rest)):
            manual += 1
            print(f"FIX BY HAND: tool {tool['id']} ({tool['name']}) on app {tool['app_id']} has key-like text in its "
                  f"settings (e.g. headers). Save it as an app secret and reference it as {{{{secrets.NAME}}}}.")

    print(f"\n{len(tools)} tools checked · {moved} key(s) {'moved' if args.apply else 'to move'} · {manual} to fix by hand"
          + ("" if args.apply else " · dry run — re-run with --apply"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
