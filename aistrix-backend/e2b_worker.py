"""Cross-platform queue coordinator. Submitted Python executes remotely in E2B."""
import argparse
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import dotenv_values
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions
from e2b_runtime import ManagedError, Runtime


_TOKENISH = re.compile(r'[A-Za-z0-9_\-.=+/]{32,}')


def describe(failure):
    """What went wrong, safe to log: the error type and a short message with
    anything token-like (keys, JWTs, long ids) redacted."""
    text = _TOKENISH.sub('[redacted]', ' '.join(str(failure).split()))[:200]
    return f'{type(failure).__name__}: {text}' if text else type(failure).__name__


def log(message):
    print(f'{datetime.now(timezone.utc).isoformat(timespec="seconds")} {message}', flush=True)


class Coordinator:
    # Leases last 90 seconds (claim_code_task / heartbeat_code_task). A job is
    # given up only when the server refuses the heartbeat, or after heartbeats
    # have failed for LOST_AFTER seconds, still inside the lease, so a short
    # network blip doesn't cancel work the server would have kept.
    BEAT_SECONDS = 10
    LOST_AFTER = 60

    def __init__(self, client, runtime, *, beat_seconds=None, lost_after=None):
        self.client, self.runtime = client, runtime
        identity = str(uuid.uuid4())
        self.ids = {kind: f'e2b-{kind}-{identity}' for kind in ('build', 'run')}
        self.task = None
        self.cancelled, self.stopping = threading.Event(), threading.Event()
        self.beat_seconds = beat_seconds or self.BEAT_SECONDS
        self.lost_after = lost_after or self.LOST_AFTER

    def rpc(self, name, params):
        return self.client.rpc(name, params).execute().data

    def announce(self):
        for kind, identity in self.ids.items():
            self.client.table('code_workers').upsert({'id': identity, 'kind': kind, 'executor': 'e2b', 'seen_at': datetime.now(timezone.utc).isoformat()}).execute()

    def keep_alive(self):
        failing_since = None
        while not self.stopping.wait(self.beat_seconds):
            task = self.task
            try:
                self.announce()
                if task and self.rpc('heartbeat_code_task', {'p_id': task['id'], 'p_token': task['lease_token']}) is not True:
                    if task is self.task:
                        log('The server refused the job heartbeat; stopping the job.')
                        self.cancelled.set(); self.runtime.cancel()
                if failing_since is not None:
                    log(f'Heartbeat restored after {time.monotonic() - failing_since:.0f}s.')
                failing_since = None
            except Exception as failure:
                if failing_since is None:
                    failing_since = time.monotonic()
                log(f'Heartbeat failed ({describe(failure)}).')
                if task and task is self.task and time.monotonic() - failing_since >= self.lost_after:
                    log(f'Heartbeats failing for {self.lost_after}s; stopping the job before its lease runs out.')
                    self.cancelled.set(); self.runtime.cancel()

    def once(self):
        for kind in ('build', 'run'):
            rows = self.rpc('claim_code_task', {'p_worker': self.ids[kind], 'p_kind': kind})
            if not rows:
                continue
            self.task = task = rows[0]
            self.cancelled.clear()
            started = time.monotonic()
            result, logs, error, status = None, '', None, 'succeeded'
            try:
                source = self.client.table('code_sources').select('*').eq('id', task['source_id']).eq('app_id', task['app_id']).single().execute().data
                result, logs = self.runtime.execute(task, source, self.cancelled)
                if self.cancelled.is_set():
                    raise ManagedError('Job cancelled or worker ownership lost.')
            except Exception as failure:
                status = 'failed'
                error = str(failure)[:2000] if isinstance(failure, ManagedError) else 'Managed execution could not complete. Inspect the source and provider configuration.'
                logs = failure.logs if isinstance(failure, ManagedError) else ''
            try:
                self.rpc('finish_code_task', {'p_id': task['id'], 'p_token': task['lease_token'], 'p_status': status,
                    'p_result': result, 'p_logs': logs.encode('utf-8')[:65536].decode('utf-8', 'ignore'),
                    'p_error': error, 'p_elapsed': int((time.monotonic() - started) * 1000)})
            finally:
                self.task = None
            return True
        return False

    def serve(self):
        self.runtime.preflight()
        self.announce()
        keeper = threading.Thread(target=self.keep_alive, daemon=True)
        keeper.start()
        log('E2B coordinator ready. Guest code runs only in managed sandboxes.')
        try:
            while not self.stopping.is_set():
                try:
                    if not self.once():
                        self.stopping.wait(2)
                except Exception as failure:
                    log(f'Queue storage unavailable ({describe(failure)}); waiting before the next poll.')
                    self.stopping.wait(10)
        finally:
            self.stopping.set(); self.cancelled.set(); self.runtime.cancel()
            try:
                for identity in self.ids.values():
                    self.client.table('code_workers').delete().eq('id', identity).execute()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env.staging')
    parser.add_argument('--check', action='store_true', help='Read-only account/template preflight; creates no sandbox.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    config = dotenv_values(root / args.env_file)
    if not all(config.get(key) for key in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'E2B_API_KEY')):
        raise ManagedError('The selected environment needs Supabase settings and E2B_API_KEY. No fallback environment is used.')
    fernet = None
    if config.get('SECRET_ENCRYPTION_KEY') and config.get('GATEWAY_PUBLIC_URL'):
        from cryptography.fernet import Fernet
        fernet = Fernet(config['SECRET_ENCRYPTION_KEY'].encode())
    runtime = Runtime(config['E2B_API_KEY'], config.get('E2B_TEMPLATE') or 'base',
                      dependencies=config.get('E2B_DEPENDENCY_TEMPLATES') == '1', egress=config.get('E2B_EGRESS') == '1',
                      gateway_url=config.get('GATEWAY_PUBLIC_URL'), fernet=fernet)
    if args.check:
        print(json.dumps({'provider': 'e2b', 'template': runtime.preflight(), 'sandbox_created': False}))
        return
    client = create_client(config['SUPABASE_URL'], config['SUPABASE_SERVICE_ROLE_KEY'], options=SyncClientOptions(postgrest_client_timeout=20))
    Coordinator(client, runtime).serve()


if __name__ == '__main__':
    try:
        main()
    except ManagedError as error:
        raise SystemExit(str(error))
