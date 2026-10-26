"""Run the local API against explicitly selected configuration, without job sweeps."""
import argparse
import os
from pathlib import Path
import sys

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]


def local_environment(selected, default, inherited):
    # main.load_dotenv() must not fill missing staging secrets from the default
    # (potentially production) .env. Empty values intentionally block that fallback.
    values = {**inherited, **{key: '' for key in default},
              **{key: value or '' for key, value in selected.items()}}
    origins = [origin.strip() for origin in values.get('ALLOWED_ORIGINS', '').split(',') if origin.strip()]
    values['ALLOWED_ORIGINS'] = ','.join(dict.fromkeys([
        *origins, 'http://localhost:3000', 'http://127.0.0.1:3000',
    ]))
    values['FRONTEND_URL'] = 'http://localhost:3000'
    values['SCHEDULER_INTERVAL_SECONDS'] = '0'
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env.staging')
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()
    config_path = (BACKEND / args.env_file).resolve()
    if not config_path.is_file():
        parser.error('The selected environment file does not exist.')
    selected = dotenv_values(config_path)
    missing = [key for key in ('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY') if not selected.get(key)]
    if missing:
        parser.error('Selected environment is missing: ' + ', '.join(missing))
    frontend_path = BACKEND.parent / 'aistrix-frontend' / config_path.name
    if frontend_path.is_file():
        frontend = dotenv_values(frontend_path)
        frontend_project = frontend.get('NEXT_PUBLIC_SUPABASE_URL') or frontend.get('VITE_SUPABASE_URL')
        if frontend_project and frontend_project.rstrip('/') != selected['SUPABASE_URL'].rstrip('/'):
            parser.error('Frontend and backend configuration select different Supabase projects.')
    values = local_environment(selected, dotenv_values(BACKEND / '.env'), os.environ)
    # Each selected project gets its own local telemetry recovery storage.
    values['TELEMETRY_OUTBOX_PATH'] = str(BACKEND / '.data' / config_path.name.replace('.', '_') / 'telemetry.sqlite3')
    os.environ.update(values)
    sys.path.insert(0, str(BACKEND))
    import uvicorn
    print(f'Local API using {config_path.name} on port {args.port}; frontend http://localhost:3000; background job sweeps disabled.', flush=True)
    # API routes remain real and authorized; automatic batch/schedule/recovery
    # processing is deliberately not started by this development helper.
    uvicorn.run('main:app', host='127.0.0.1', port=args.port, lifespan='off')


if __name__ == '__main__':
    main()
