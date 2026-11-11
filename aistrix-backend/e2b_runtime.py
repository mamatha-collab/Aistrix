"""Managed execution adapter. This process uploads files; Python runs only in E2B."""
import hashlib
import json
import re
import threading
import time
from urllib.parse import urlsplit
from uuid import UUID

from code_job_spec import json_bytes, outbound_hosts, requirement_lines, validate_bundle, validate_input
import code_studio

LIMIT = 65536
RUN_MODEL_BUDGET_USD = 0.50          # model spend one job run may make through the gateway
TOKEN_PREFIX = 'ak_run_'
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
os.environ.update(settings.get("env") or {})
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


def check_source(source, *, dependencies=False, egress=False, models=False):
    """Integrity, then the capabilities this runtime has switched on."""
    files, manifest, digest = validate_bundle(source['files'], source['manifest'])
    if digest != source['source_hash']:
        raise ManagedError('Source integrity verification failed.')
    if requirement_lines(files) and not dependencies:
        raise ManagedError('Dependencies (requirements.txt) need dependency templates, which are not enabled on this server.')
    if outbound_hosts(manifest) and not egress:
        raise ManagedError('Outbound network access is not enabled on this server; set "network": "none".')
    if manifest.get('models') and not models:
        raise ManagedError('Model calls from code need the Aistrix gateway, which is not configured on this server.')
    return files, manifest, digest


def dependency_template_name(lines, base):
    """One template per exact pinned dependency set and base image."""
    digest = hashlib.sha256(json.dumps([base, sorted(lines)]).encode('utf-8')).hexdigest()[:20]
    return f'aistrix-deps-{digest}'


def install_command(lines):
    # Every line was validated as name==version --hash=sha256:<hex>: no quotes,
    # no options, so it is safe inside single quotes. Wheels only, hashes required.
    quoted = ' '.join(f"'{line}'" for line in lines)
    return ("mkdir -p /opt/aistrix && printf '%s\\n' " + quoted + " > /opt/aistrix/requirements.txt && "
            "python3 -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /opt/aistrix/requirements.txt")


def mint_run_token(fernet, task, seconds, budget=RUN_MODEL_BUDGET_USD):
    """A gateway key for one job run: the owner's account, this task's trace,
    a spend budget, expiring with the sandbox."""
    claims = {'o': task['user_id'], 't': task['id'], 'a': task['app_id'], 'b': budget, 'exp': int(time.time()) + seconds}
    return TOKEN_PREFIX + fernet.encrypt(json.dumps(claims).encode('utf-8')).decode('ascii')


class Runtime:
    def __init__(self, api_key, template='base', sandbox_type=None, template_type=None, *,
                 dependencies=False, egress=False, gateway_url=None, fernet=None):
        """dependencies: build a template per pinned requirements.txt. egress:
        allow jobs' declared outbound hosts. gateway_url + fernet: jobs with
        "models": true call models through the gateway with a run token."""
        if not api_key:
            raise ManagedError('Configure E2B_API_KEY before starting managed execution.')
        if sandbox_type is None:
            from e2b import Sandbox, Template
            sandbox_type, template_type = Sandbox, Template
        self.sdk, self.templates, self.key, self.template = sandbox_type, template_type, api_key, template
        self.dependencies, self.egress = dependencies, egress
        self.gateway_url = (gateway_url or '').rstrip('/') or None
        self.fernet = fernet
        if self.gateway_url and not self.gateway_url.startswith('https://'):
            raise ManagedError('GATEWAY_PUBLIC_URL must be an https:// URL that sandboxes can reach.')
        self.active = None
        self.lock = threading.Lock()

    @property
    def models(self):
        return bool(self.gateway_url and self.fernet)

    def dependency_template(self, lines):
        """A pinned template with these dependencies installed, built once."""
        base = self.template.split(':', 1)[0]
        name = dependency_template_name(lines, self.template)
        try:
            tags = self.templates.get_tags(name, api_key=self.key, request_timeout=15, retries=0)
            build = next((item.build_id for item in tags if item.tag == 'default'), None)
        except Exception:
            build = None                              # not built yet
        if not build:
            try:
                template = self.templates().from_template(base).run_cmd(install_command(lines), user='root')
                build = self.templates.build(template, name, cpu_count=1, memory_mb=1024, api_key=self.key).build_id
            except Exception as error:
                raise ManagedError('The dependencies could not be installed. Check that every requirement is a wheel '
                                   'for Linux x86_64 and Python 3.12, pinned with its hash.') from error
        reference = f'{name}:{build}'
        if not template_is_pinned(reference):
            raise ManagedError('The dependency template could not be pinned.')
        return reference

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
        files, manifest, digest = check_source(source, dependencies=self.dependencies, egress=self.egress, models=self.models)
        building = task['kind'] == 'build'
        lines = requirement_lines(files)
        if building:
            reference = self.dependency_template(lines) if lines else self.template
        else:
            reference = parse_artifact(task.get('image'), digest)
        # Builds only check syntax: never any network. Runs reach the declared
        # hosts, and the gateway when the job calls models.
        hosts = [] if building else outbound_hosts(manifest)
        env = {}
        if not building and manifest.get('models'):
            hosts = hosts + [urlsplit(self.gateway_url).hostname]
            token = mint_run_token(self.fernet, task, task['reserved_seconds'] + 30)
            gateway = f'{self.gateway_url}/v1/gateway'
            env = {'AISTRIX_GATEWAY_URL': gateway, 'OPENAI_BASE_URL': f'{gateway}/openai', 'OPENAI_API_KEY': token,
                   'ANTHROPIC_BASE_URL': f'{gateway}/anthropic', 'ANTHROPIC_API_KEY': token,
                   'AISTRIX_TRACE': f'code-task:{task["id"]}'}
        network = ({'allow_out': hosts, 'deny_out': ['0.0.0.0/0'], 'allow_public_traffic': False} if hosts
                   else {'deny_out': ['0.0.0.0/0'], 'allow_public_traffic': False})
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
                allow_internet_access=bool(hosts), network=network,
                lifecycle={'on_timeout': 'kill', 'auto_resume': False}, envs={},
                metadata={'aistrix_app': task['app_id'], 'aistrix_job': task['id']},
                idempotency_key=task['id'], request_timeout=15, retries=0)
            with self.lock:
                self.active = sandbox
            if cancelled.is_set():
                raise ManagedError('Job cancelled or worker ownership lost.')
            info = sandbox.get_info(request_timeout=10, retries=0)
            granted = info.network or {}
            if (info.cpu_count > 2 or info.memory_mb > 4096 or granted.get('allow_public_traffic') is not False
                    or (not hosts and info.allow_internet_access is not False)
                    or (hosts and 'allow_out' in granted and sorted(granted['allow_out']) != sorted(hosts))):
                raise ManagedError('E2B did not confirm the configured resource/network limits.')
            sandbox.files.make_dir(ROOT, user='root', request_timeout=10)
            sandbox.files.write_files([{'path': f'{ROOT}/{name}', 'data': text} for name, text in files.items()] + [
                {'path': CONTROL, 'data': json_bytes({'mode': 'build' if building else 'run', 'manifest': manifest,
                    'seconds': seconds, 'files': list(files), 'input': None if building else validate_input(task['input']),
                    'env': env}).decode()},
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
                'process_memory_mb': manifest['memory_mb'], 'process_limit': 32, 'timeout_seconds': seconds,
                'network': hosts or 'none', 'models': 'gateway' if env else 'none',
                'dependencies': len(lines)}
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
