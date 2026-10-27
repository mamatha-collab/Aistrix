"""Dedicated Linux worker. Never run on the API host or a developer workstation.

Build workers use an isolated, mutually authenticated remote BuildKit service.
Run workers require rootless Docker, cgroup v2/systemd and gVisor (runsc).
No platform credentials, source paths or host volumes enter customer containers.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path

from supabase import create_client
from supabase.lib.client_options import SyncClientOptions
import httpx
from code_job_spec import RUNNER, dockerfile, json_bytes, validate_bundle, validate_input

LIMIT = 65536


class WorkerError(RuntimeError):
    def __init__(self, message, logs=b''):
        super().__init__(message)
        self.logs = logs


def execute(command, *, timeout, cancelled, stdin=None, progress=None):
    """Bounded streaming capture; no shell, no user-controlled environment."""
    process = subprocess.Popen(command, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, logs = bytearray(), bytearray()
    overflow = threading.Event()

    def read(stream, target):
        while True:
            chunk = stream.read1(4096)
            if not chunk:
                break
            if len(target) + len(chunk) > LIMIT:
                overflow.set()
            target.extend(chunk[:max(0, LIMIT - len(target))])

    def write():
        try:
            process.stdin.write(stdin)
            process.stdin.close()
        except (BrokenPipeError, OSError):
            pass

    readers = [threading.Thread(target=read, args=(process.stdout, output), daemon=True),
               threading.Thread(target=read, args=(process.stderr, logs), daemon=True)]
    for thread in readers:
        thread.start()
    if stdin is not None:
        threading.Thread(target=write, daemon=True).start()
    start = time.monotonic()
    problem = None
    while process.poll() is None:
        if progress:
            progress(bytes(output), bytes(logs))
        if cancelled.is_set():
            problem = 'Job cancelled or worker ownership lost.'
        elif overflow.is_set():
            problem = 'Job output exceeded 64 KiB.'
        elif time.monotonic() - start >= timeout:
            problem = 'Job exceeded its execution deadline.'
        if problem:
            process.kill()
            break
        time.sleep(0.1)
    process.wait(timeout=10)
    for thread in readers:
        thread.join(timeout=2)
    if overflow.is_set():
        problem = problem or 'Job output exceeded 64 KiB.'
    if problem:
        raise WorkerError(problem, bytes(logs))
    if process.returncode:
        # Logs belong to this private job. They are never sent to platform logs.
        raise WorkerError((logs or output).decode('utf-8', 'replace')[-2000:] or 'Job process failed.', bytes(logs or output))
    return bytes(output), bytes(logs)


def registry_prefix(env):
    prefix = env.get('CODE_IMAGE_PREFIX', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.:-]+/[a-z0-9][a-z0-9/_-]*', prefix):
        raise WorkerError('Configure CODE_IMAGE_PREFIX as a private registry/repository prefix.')
    return prefix


def runtime_command(binary, name, image, manifest):
    # Entrypoint cannot be overridden by customer configuration.
    return [binary, 'run', '--name', name, '--rm', '--pull=never', '--runtime=runsc', '--network=none',
            '--label=ai.aistrix.code-job=true', f'--label=ai.aistrix.expires={int(time.time()) + manifest["timeout_seconds"] + 5}',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=10001:10001',
            '--pids-limit=64', f'--memory={manifest["memory_mb"]}m', f'--memory-swap={manifest["memory_mb"]}m',
            '--cpus=1', '--ulimit=nofile=128:128', '--ulimit=core=0', '--stop-timeout=1',
            '--log-driver=none', '--tmpfs=/tmp:rw,noexec,nosuid,size=32m,mode=1777', '--interactive', image]


class Worker:
    def __init__(self, kind, env=None, client=None):
        self.env = dict(os.environ if env is None else env)
        self.kind = kind
        self.id = f'{kind}-{uuid.uuid4()}'
        self.prefix = registry_prefix(self.env)
        self.client = client
        self.cancelled = threading.Event()
        self.stopping = threading.Event()
        self.task = None
        self.binary = None
        self.logs = b''

    def preflight(self):
        if os.name != 'posix':
            raise WorkerError('Code workers require a dedicated Linux host.')
        if self.env.get('CODE_WORKER_DEDICATED') != '1':
            raise WorkerError('Dedicated worker hosts must be explicitly configured; never use the API host.')
        if self.kind == 'build':
            self.binary = shutil.which('buildctl')
            dockerfile(self.env.get('CODE_PYTHON_BASE_IMAGE', ''))
            if not self.binary or self.env.get('CODE_BUILD_ISOLATION') != 'dedicated-vm':
                raise WorkerError('BuildKit must run inside a dedicated disposable build VM with resource limits.')
            if not self.env.get('BUILDKIT_HOST', '').startswith('tcp://'):
                raise WorkerError('Configure a remote BuildKit service over mutual TLS.')
            for key in ('BUILDKIT_CA', 'BUILDKIT_CERT', 'BUILDKIT_KEY'):
                if not Path(self.env.get(key, '')).is_file():
                    raise WorkerError(f'Configure the BuildKit TLS file {key}.')
        else:
            self.binary = shutil.which('docker')
            if not self.binary:
                raise WorkerError('Docker and gVisor must be installed on this worker.')
            raw, _ = execute([self.binary, 'info', '--format', '{{json .}}'], timeout=15, cancelled=self.cancelled)
            info = json.loads(raw)
            if (info.get('OSType') != 'linux' or 'runsc' not in info.get('Runtimes', {})
                or not any('rootless' in str(item) for item in info.get('SecurityOptions', []))
                or str(info.get('CgroupVersion')) != '2' or info.get('CgroupDriver') != 'systemd'):
                raise WorkerError('Rootless Linux Docker with runsc, cgroup v2 and systemd resource enforcement is required.')
            # An independent timer enforces container expiry if this process dies.
            systemctl = shutil.which('systemctl')
            if not systemctl:
                raise WorkerError('Configure the independent code-job reaper timer.')
            execute([systemctl, '--user', 'is-active', '--quiet', 'aistrix-code-reaper.timer'],
                    timeout=5, cancelled=self.cancelled)
        if self.client is None:
            if not self.env.get('SUPABASE_URL', '').startswith('https://') or not self.env.get('SUPABASE_SERVICE_ROLE_KEY'):
                raise WorkerError('Configure the worker database connection through the host secret manager.')
            self.client = create_client(self.env['SUPABASE_URL'], self.env['SUPABASE_SERVICE_ROLE_KEY'],
                                        options=SyncClientOptions(httpx_client=httpx.Client(http2=False,timeout=20)))

    def rpc(self, name, params):
        return self.client.rpc(name, params).execute().data

    def announce(self):
        from datetime import datetime, timezone
        self.client.table('code_workers').upsert({'id': self.id, 'kind': self.kind,
            'seen_at': datetime.now(timezone.utc).isoformat()}).execute()

    def keep_alive(self):
        while not self.stopping.wait(10):
            try:
                self.announce()
                task = self.task
                if task:
                    owned = self.rpc('heartbeat_code_task', {'p_id': task['id'], 'p_token': task['lease_token']})
                    if task is not self.task:
                        continue
                    if owned is not True:
                        self.cancelled.set()
                    elif self.logs:
                        updated = self.rpc('update_code_task_logs', {'p_id':task['id'],'p_token':task['lease_token'],
                            'p_logs':self.logs[:LIMIT].decode('utf-8','ignore')})
                        if task is self.task and updated is not True:
                            self.cancelled.set()
            except Exception:
                # Database uncertainty must stop execution, not renew authority locally.
                self.cancelled.set()

    def build(self, task, source):
        files, manifest, digest = validate_bundle(source['files'], source['manifest'])
        if digest != source['source_hash']:
            raise WorkerError('Source integrity verification failed.')
        tag = f'{self.prefix}/{uuid.UUID(task["app_id"])}:{uuid.UUID(task["id"])}'
        with tempfile.TemporaryDirectory(prefix='aistrix-build-') as directory:
            root = Path(directory)
            context = root / 'context'
            context.mkdir()
            for name, content in files.items():
                path = context / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding='utf-8')
            (context / 'Dockerfile').write_text(dockerfile(self.env['CODE_PYTHON_BASE_IMAGE']), encoding='utf-8')
            (context / 'aistrix_runner.py').write_text(RUNNER, encoding='utf-8')
            (context / 'aistrix.json').write_bytes(json_bytes(manifest))
            metadata = root / 'metadata.json'
            command = [self.binary, '--addr', self.env['BUILDKIT_HOST'], '--tlscacert', self.env['BUILDKIT_CA'],
                       '--tlscert', self.env['BUILDKIT_CERT'], '--tlskey', self.env['BUILDKIT_KEY'], 'build',
                       '--frontend=dockerfile.v0', '--local', f'context={context}', '--local', f'dockerfile={context}',
                       '--opt', 'platform=linux/amd64', '--output', f'type=image,name={tag},push=true',
                       '--metadata-file', str(metadata), '--progress=plain']
            out, logs = execute(command, timeout=570, cancelled=self.cancelled,
                                progress=lambda out, err: setattr(self, 'logs', (err+out)[:LIMIT]))
            image_digest = json.loads(metadata.read_text())['containerimage.digest']
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', image_digest):
                raise WorkerError('The builder did not return a valid image digest.')
            image = f'{self.prefix}/{task["app_id"]}@{image_digest}'
            return {'image': image, 'source_hash': digest}, (logs + out)[:LIMIT].decode('utf-8', 'replace')

    def run(self, task, source):
        _, manifest, digest = validate_bundle(source['files'], source['manifest'])
        if digest != source['source_hash']:
            raise WorkerError('Source integrity verification failed.')
        image = task.get('image', '')
        if not re.fullmatch(re.escape(f'{self.prefix}/{task["app_id"]}@') + r'sha256:[a-f0-9]{64}', image):
            raise WorkerError('The deployment image is outside this app\'s approved registry path.')
        payload = json_bytes(validate_input(task['input']))
        execute([self.binary, 'pull', image], timeout=45, cancelled=self.cancelled)
        name = f'aistrix-{uuid.UUID(task["id"])}'
        try:
            raw, logs = execute(runtime_command(self.binary, name, image, manifest),
                                timeout=manifest['timeout_seconds'], cancelled=self.cancelled, stdin=payload,
                                progress=lambda out, err: setattr(self, 'logs', err[:LIMIT]))
            result = json.loads(raw)
            if len(json_bytes(result)) > LIMIT:
                raise WorkerError('Structured output exceeds 64 KiB.')
            return {'output': result, 'limits': {'memory_mb': manifest['memory_mb'], 'cpu': 1,
                                                'timeout_seconds': manifest['timeout_seconds']}}, logs.decode('utf-8', 'ignore')
        finally:
            # Killing the CLI alone may leave its container alive.
            subprocess.run([self.binary, 'rm', '--force', name], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=15, check=False)

    def reap(self):
        """Also run from an independent systemd timer, even when this worker dies."""
        raw, _ = execute([self.binary, 'ps', '--filter', 'label=ai.aistrix.code-job=true', '--format', '{{.ID}}'],
                         timeout=15, cancelled=threading.Event())
        for container_id in raw.decode().splitlines():
            if not re.fullmatch(r'[a-f0-9]{12,64}', container_id):
                continue
            details, _ = execute([self.binary, 'inspect', container_id], timeout=10, cancelled=threading.Event())
            info = json.loads(details)[0]
            expiry = info.get('Config', {}).get('Labels', {}).get('ai.aistrix.expires', '0')
            if not expiry.isdecimal() or int(expiry) <= time.time():
                subprocess.run([self.binary, 'rm', '--force', container_id], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=15, check=False)

    def once(self):
        self.cancelled.clear()
        self.logs = b''
        self.announce()
        rows = self.rpc('claim_code_task', {'p_worker': self.id, 'p_kind': self.kind})
        if not rows:
            return False
        task = self.task = rows[0]
        start = time.monotonic()
        result, logs, error, status = None, '', None, 'succeeded'
        try:
            source = self.client.table('code_sources').select('*').eq('id', task['source_id']).eq('app_id', task['app_id']).single().execute().data
            result, logs = self.build(task, source) if self.kind == 'build' else self.run(task, source)
            if self.cancelled.is_set():
                raise WorkerError('Worker ownership was lost.')
        except Exception as problem:
            status = 'failed'
            # Internal SDK exceptions may contain credentials/SQL; expose only known failures.
            error = str(problem)[:2000] if isinstance(problem, WorkerError) else 'Worker failed to process the job. Check its source, dependencies and worker configuration.'
            logs = problem.logs.decode('utf-8', 'ignore') if isinstance(problem, WorkerError) else ''
        try:
            self.rpc('finish_code_task', {'p_id': task['id'], 'p_token': task['lease_token'], 'p_status': status,
                'p_result': result, 'p_logs': logs.encode('utf-8')[:LIMIT].decode('utf-8', 'ignore'),
                'p_error': error, 'p_elapsed': int((time.monotonic()-start)*1000)})
        finally:
            self.task = None
        return True

    def serve(self):
        self.preflight()
        self.announce()
        keeper = threading.Thread(target=self.keep_alive, daemon=True)
        keeper.start()
        print(f'Code {self.kind} worker ready; customer logs remain private.', flush=True)
        try:
            while True:
                try:
                    if not self.once():
                        if self.kind == 'run':
                            self.reap()
                        time.sleep(3)
                except Exception:
                    print('Worker storage unavailable; waiting before retrying.', flush=True)
                    time.sleep(10)
        finally:
            self.cancelled.set()
            self.stopping.set()
            self.client.table('code_workers').delete().eq('id', self.id).execute()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['build', 'run'], required=True)
    parser.add_argument('--check', action='store_true', help='Verify prerequisites without claiming jobs.')
    parser.add_argument('--reap', action='store_true', help='Remove expired run containers; invoke from an independent timer.')
    args = parser.parse_args()
    try:
        worker = Worker(args.kind)
        if args.reap:
            if args.kind != 'run':
                raise WorkerError('Only execution workers have containers to reap.')
            worker.preflight()
            worker.reap()
        elif args.check:
            worker.preflight()
            print('Worker prerequisites verified; no jobs were claimed.')
        else:
            worker.serve()
    except WorkerError as error:
        raise SystemExit(str(error))
