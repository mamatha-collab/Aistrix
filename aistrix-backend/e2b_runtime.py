"""Managed execution adapter. This process uploads files; Python runs only in E2B."""
import json
import re
import threading
from uuid import UUID

from code_job_spec import json_bytes, validate_bundle, validate_input
import code_studio

LIMIT = 65536
ROOT = '/home/user/aistrix-project'
CONTROL = '/home/user/aistrix-control.json'
BOOTSTRAP_PATH = '/home/user/aistrix-bootstrap.py'

# Trusted harness, executed remotely as root only long enough to impose limits
# and drop to nobody. Customer modules are imported after no-new-privileges/UID drop.
BOOTSTRAP = '''import os, sys, json, resource, ctypes, importlib, inspect, asyncio, contextlib, platform
with open("/home/user/aistrix-control.json") as f:
    settings = json.load(f)
manifest = settings["manifest"]
os.chmod("/home/user", 0o755)
for directory, dirs, names in os.walk("/home/user/aistrix-project"):
    os.chmod(directory, 0o755)
    for name in names:
        os.chmod(os.path.join(directory, name), 0o644)
seconds = settings["seconds"]
memory = manifest["memory_mb"] * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds))
resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
resource.setrlimit(resource.RLIMIT_FSIZE, (16*1024*1024, 16*1024*1024))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
    raise RuntimeError("Could not restrict process privileges")
os.setgroups([])
os.setgid(65534)
os.setuid(65534)
os.environ.clear()
os.environ.update({"PATH":"/usr/bin:/bin", "HOME":"/tmp", "PYTHONDONTWRITEBYTECODE":"1"})
sys.dont_write_bytecode = True
os.chdir("/home/user/aistrix-project")
sys.path.insert(0, os.getcwd())
if settings["mode"] == "build":
    for name in settings["files"]:
        if name.endswith(".py"):
            with open(name) as f:
                compile(f.read(), name, "exec")
    result = {"validated": True, "python": platform.python_version()}
else:
    module, function = manifest["entrypoint"].split(":")
    with contextlib.redirect_stdout(sys.stderr):
        result = getattr(importlib.import_module(module), function)(settings["input"])
        if inspect.isawaitable(result):
            result = asyncio.run(result)
encoded = json.dumps(result, allow_nan=False, ensure_ascii=False)
if len(encoded.encode("utf-8")) > 65536:
    raise RuntimeError("Structured output exceeded 64 KiB")
sys.stdout.write(encoded)
'''


class ManagedError(RuntimeError):
    def __init__(self, message, logs=''):
        super().__init__(message)
        self.logs = logs[:LIMIT]


def template_is_pinned(reference):
    if not isinstance(reference, str) or ':' not in reference:
        return False
    name, build = reference.rsplit(':', 1)
    try:
        UUID(build)
    except ValueError:
        return False
    return bool(re.fullmatch(r'[A-Za-z0-9_/-]+', name))


def artifact(reference, digest):
    if not template_is_pinned(reference) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ManagedError('The managed build must pin its template and source hash.')
    return f'e2b://{reference}@sha256:{digest}'


def parse_artifact(value, digest):
    if not isinstance(value, str) or not value.startswith('e2b://') or not value.endswith(f'@sha256:{digest}'):
        raise ManagedError('The managed artifact does not match this source version.')
    reference = value[len('e2b://'):].split('@sha256:')[0]
    if not template_is_pinned(reference):
        raise ManagedError('The E2B runtime template is not pinned.')
    return reference


def check_source(source):
    files, manifest, digest = validate_bundle(source['files'], source['manifest'])
    if digest != source['source_hash']:
        raise ManagedError('Source integrity verification failed.')
    if any(line.strip() and not line.strip().startswith('#') for line in files.get('requirements.txt', '').splitlines()):
        raise ManagedError('The E2B development runtime currently supports the Python standard library only. Custom dependency templates are not enabled.')
    return files, manifest, digest


class Runtime:
    def __init__(self, api_key, template='base', sandbox_type=None, template_type=None):
        if not api_key:
            raise ManagedError('Configure E2B_API_KEY before starting managed execution.')
        if sandbox_type is None:
            from e2b import Sandbox, Template
            sandbox_type, template_type = Sandbox, Template
        self.sdk, self.templates, self.key, self.template = sandbox_type, template_type, api_key, template
        self.active = None
        self.lock = threading.Lock()

    def preflight(self):
        # Read-only provider check; no sandbox is created and no guest code runs.
        try:
            self.sdk.list(api_key=self.key, limit=1, request_timeout=15, retries=0).next_items()
            if not template_is_pinned(self.template):
                name, _, tag = self.template.partition(':')
                tags = self.templates.get_tags(name, api_key=self.key, request_timeout=15, retries=0)
                build = next(item.build_id for item in tags if item.tag == (tag or 'default'))
                self.template = f'{name}:{build}'
            if not template_is_pinned(self.template):
                raise ValueError('Unpinned template')
        except Exception as error:
            raise ManagedError('E2B authentication or template lookup failed. Check the API key and template setting.') from error
        return self.template

    def cancel(self):
        with self.lock:
            active = self.active
        if active is not None:
            try:
                active.kill(api_key=self.key, request_timeout=10, retries=0)
            except Exception:
                # The provider TTL still bounds lifetime if termination is unavailable.
                pass

    def execute(self, task, source, cancelled):
        files, manifest, digest = check_source(source)
        building = task['kind'] == 'build'
        reference = self.template if building else parse_artifact(task.get('image'), digest)
        ttl = task['reserved_seconds']
        seconds = 60 if building else manifest['timeout_seconds']
        if not 31 <= ttl <= 150 or ttl < seconds + 30:
            raise ManagedError('Invalid sandbox lifetime reservation.')
        sandbox = None
        stdout, stderr = [], []
        sizes = [0, 0]
        def capture(index, chunks, value):
            sizes[index] += len(value.encode('utf-8'))
            if sizes[index] > LIMIT:
                raise ManagedError('Sandbox output exceeded 64 KiB.', ''.join(stderr))
            chunks.append(value)
            if cancelled.is_set():
                raise ManagedError('Job cancelled or worker ownership lost.')
        try:
            sandbox = self.sdk.create(reference, api_key=self.key, timeout=ttl,
                allow_internet_access=False, network={'deny_out': ['0.0.0.0/0'], 'allow_public_traffic': False},
                lifecycle={'on_timeout': 'kill', 'auto_resume': False}, envs={},
                metadata={'aistrix_app': task['app_id'], 'aistrix_job': task['id']},
                idempotency_key=task['id'], request_timeout=15, retries=0)
            with self.lock:
                self.active = sandbox
            if cancelled.is_set():
                raise ManagedError('Job cancelled or worker ownership lost.')
            info = sandbox.get_info(request_timeout=10, retries=0)
            if info.cpu_count > 2 or info.memory_mb > 4096 or info.allow_internet_access is not False or (info.network or {}).get('allow_public_traffic') is not False:
                raise ManagedError('E2B did not confirm the configured resource/network limits.')
            sandbox.files.make_dir(ROOT, user='root', request_timeout=10)
            sandbox.files.write_files([{'path': f'{ROOT}/{name}', 'data': text} for name, text in files.items()] + [
                {'path': CONTROL, 'data': json_bytes({'mode': 'build' if building else 'run', 'manifest': manifest,
                    'seconds': seconds, 'files': list(files), 'input': None if building else validate_input(task['input'])}).decode()},
                {'path': BOOTSTRAP_PATH, 'data': BOOTSTRAP}], user='root', request_timeout=15)
            # Fixed command only. All user source and input travel as file contents.
            response = sandbox.commands.run(f'python3 -I {BOOTSTRAP_PATH}', user='root', timeout=seconds,
                request_timeout=seconds + 10,
                on_stdout=lambda value: capture(0, stdout, value), on_stderr=lambda value: capture(1, stderr, value))
            if cancelled.is_set():
                raise ManagedError('Job cancelled or worker ownership lost.')
            if getattr(response, 'exit_code', 0) != 0:
                raise ManagedError('Python execution failed. Inspect this job’s private logs.', ''.join(stderr))
            output = json.loads(''.join(stdout) if stdout else response.stdout)
            if len(json_bytes(output)) > LIMIT:
                raise ManagedError('Structured output exceeded 64 KiB.')
            limits = {'provider': 'e2b', 'sandbox_cpus': info.cpu_count, 'sandbox_memory_mb': info.memory_mb,
                'process_memory_mb': manifest['memory_mb'], 'process_limit': 32, 'timeout_seconds': seconds, 'network': 'none'}
            if building:
                return {'provider': 'e2b', 'image': artifact(reference, digest), 'template': reference,
                    'source_hash': digest, 'python': output['python'], 'limits': limits}, ''.join(stderr)
            if source.get('studio_contract'):
                code_studio.validate_data(files, manifest, output, 'output')
            return {'output': output, 'limits': limits}, ''.join(stderr)
        except ManagedError:
            raise
        except Exception as error:
            # Provider exceptions can contain authenticated URLs. Never persist them.
            raise ManagedError('The E2B job failed or timed out. Check the provider account and job limits.', ''.join(stderr)) from error
        finally:
            if sandbox is not None:
                try:
                    sandbox.kill(api_key=self.key, request_timeout=10, retries=0)
                except Exception:
                    pass
            with self.lock:
                self.active = None
