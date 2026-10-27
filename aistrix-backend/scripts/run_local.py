"""Run the local API against explicitly selected configuration, without job sweeps."""
import argparse
import errno
import http.client
import json
import os
from pathlib import Path
import socket
import sys

from dotenv import dotenv_values

BACKEND = Path(__file__).resolve().parents[1]


def is_local_api(port, brand):
    # Direct loopback connection: no proxy, redirects, credentials or outbound calls.
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        for path, key, expected in (('/', 'message', f'{brand} API'), ('/health', 'status', 'ok')):
            connection.request('GET', path)
            response = connection.getresponse()
            raw = response.read(4097)
            if response.status != 200 or len(raw) > 4096 or json.loads(raw).get(key) != expected:
                return False
        return True
    except (OSError, ValueError, AttributeError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def existing_listener(port, brand):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if os.name == 'nt':
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', port))
    except OSError as error:
        if error.errno not in (errno.EADDRINUSE, 10048) and getattr(error, 'winerror', None) != 10048:
            raise
        return 'aistrix' if is_local_api(port, brand) else 'other'
    return None


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
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535.')
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
    try:
        listener = existing_listener(args.port, values.get('BRAND_NAME') or 'Aistrix')
    except OSError:
        parser.error(f'Port {args.port} cannot be bound. Check local port reservations and permissions.')
    if listener == 'aistrix':
        print(f'Aistrix API is already running at http://127.0.0.1:{args.port}.', flush=True)
        print('Refresh http://localhost:3000 to use it. Another server was not started.', flush=True)
        print('To apply backend code or environment changes, stop the existing API first, then run this command again.', flush=True)
        return
    if listener:
        parser.error(f'Port {args.port} is already in use, but a healthy Aistrix API could not be verified. Stop the existing listener before retrying.')
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
