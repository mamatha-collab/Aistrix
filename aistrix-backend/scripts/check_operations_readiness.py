"""Read-only schema preflight for a deliberately selected deployment.

Usage: python scripts/check_operations_readiness.py --env-file .env.staging
No model calls, table writes, migrations or credentials in output.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from dotenv import dotenv_values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--env-file', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not args.env_file.is_file():
        parser.error('The selected environment file does not exist')
    env = {**dotenv_values(args.env_file), **os.environ}
    url, key = env.get('SUPABASE_URL', ''), env.get('SUPABASE_SERVICE_ROLE_KEY', '')
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'database_host': urlparse(url).hostname,
              'database_configured': bool(url and key), 'schema': None,
              'recovery_path_configured_in_selected_env': bool(env.get('TELEMETRY_OUTBOX_PATH')),
              'persistent_volume_verified': False,
              'hosted_customer_editor_journey_verified': False}
    if not url or not key:
        report['database_status'] = 'missing configuration'
    else:
        try:
            with httpx.Client(timeout=20, headers={'apikey': key, 'Authorization': f'Bearer {key}'}) as client:
                probes = {
                    'run_telemetry': ('app_runs', 'id,status,error_kind,latency_ms,live_version,model,cost_usd'),
                    'feedback': ('app_feedback', 'id,note,test_case_id,shared_input,shared_output,status'),
                    'test_case_freshness': ('app_test_cases', 'id,updated_at'),
                }
                probe_responses = {name: client.get(f'{url.rstrip("/")}/rest/v1/{table}', params={'select': fields, 'limit': 0}) for name, (table, fields) in probes.items()}
                report['column_checks'] = {name: response.status_code in (200, 206) for name, response in probe_responses.items()}
                report['column_http_status'] = {name: response.status_code for name, response in probe_responses.items()}
                response = client.post(f'{url.rstrip("/")}/rest/v1/rpc/operations_schema_status', json={})
                if response.status_code == 200 and isinstance(response.json(), dict):
                    report['schema'] = response.json()
                    report['database_status'] = 'passed' if all(v is True for v in response.json().values()) and all(report['column_checks'].values()) else 'checks failed'
                else:
                    report['database_status'] = 'schema preflight unavailable; migration or service-role access needs verification'
                    report['http_status'] = response.status_code
        except Exception:
            report['database_status'] = 'database unreachable or response invalid'
    text = json.dumps(report, indent=2)
    print(text)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + '\n', encoding='utf-8')
    # Schema success is not production approval: the two hosted/infrastructure
    # checks above must be independently recorded by the release operator.
    return 0 if report.get('database_status') == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
