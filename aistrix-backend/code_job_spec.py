"""Version-one code job contract. Never imports or evaluates customer source."""
import hashlib
import io
import json
import re
import stat
import zipfile
from pathlib import PurePosixPath

MAX_SOURCE = 512 * 1024
MAX_FILE = 128 * 1024
MAX_FILES = 32
MAX_INPUT = 64 * 1024
SPEC = {"version": 1, "runtime": "python", "mode": "job", "entrypoint": "main:run",
        "timeout_seconds": 30, "memory_mb": 256, "network": "none"}
# Optional settings, present in a manifest only when the developer sets them
# (so sources saved before they existed keep their exact hash):
#   "network": {"allow": ["api.example.com", "*.example.org"]}  outbound HTTPS to these hosts only
#   "models": true   model calls through the Aistrix gateway (OPENAI_BASE_URL / ANTHROPIC_BASE_URL set for the job)
OPTIONAL = ("models",)
MAX_HOSTS = 20
_HOST = re.compile(r"^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")
STARTER = '''def run(payload):
    """Receive a JSON object and return a JSON-serializable result."""
    rows = payload.get("items", [])
    total = sum(float(row.get("quantity", 0)) * float(row.get("price", 0)) for row in rows)
    print(f"Processed {len(rows)} items")
    return {"items_processed": len(rows), "total": round(total, 2)}
'''


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def validate_bundle(files, manifest):
    if not isinstance(files, dict) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError("Provide between 1 and 32 text files.")
    clean = {}
    for name, content in files.items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_/-]+\.(py|txt|json|toml|md)", name):
            raise ValueError("Source paths must be relative text-file paths; hidden files and Dockerfiles are not accepted.")
        path = PurePosixPath(name)
        if path.is_absolute() or any(part in (".", "..") for part in name.split('/')) or name.startswith('/') or '//' in name:
            raise ValueError("Unsafe source path.")
        if not isinstance(content, str) or '\0' in content or len(content.encode('utf-8')) > MAX_FILE:
            raise ValueError("Each source file must be UTF-8 text of at most 128 KiB.")
        if name in ('aistrix_runner.py', 'aistrix.json'):
            raise ValueError("aistrix_runner.py and aistrix.json are reserved platform files.")
        clean[name] = content.replace('\r\n', '\n')
    if len(json_bytes(clean)) > MAX_SOURCE:
        raise ValueError("Source bundle exceeds 512 KiB.")
    if not isinstance(manifest, dict) or set(manifest) - set(SPEC) - set(OPTIONAL):
        raise ValueError("The manifest contains unsupported settings.")
    config = {**SPEC, **manifest}
    for key, expected in (("version", 1), ("runtime", "python"), ("mode", "job")):
        if type(config[key]) is not type(expected) or config[key] != expected:
            raise ValueError("This release supports version 1 Python jobs.")
    network = config["network"]
    if network != "none":
        hosts = network.get("allow") if isinstance(network, dict) and set(network) == {"allow"} else None
        if (not isinstance(hosts, list) or not 1 <= len(hosts) <= MAX_HOSTS or len(set(hosts)) != len(hosts)
                or not all(isinstance(h, str) and _HOST.fullmatch(h) and not h.rsplit(".", 1)[-1].isdigit() for h in hosts)):
            raise ValueError('network is "none" or {"allow": [hostnames]} with 1 to 20 lowercase hostnames (no IP addresses).')
    if "models" in config:
        if config["models"] is not True:
            raise ValueError('Set "models": true to call models through the Aistrix gateway, or leave it out.')
    if type(config['timeout_seconds']) is not int or not 1 <= config['timeout_seconds'] <= 120:
        raise ValueError("Timeout must be an integer between 1 and 120 seconds.")
    if type(config['memory_mb']) is not int or config['memory_mb'] not in (128, 256, 512, 1024):
        raise ValueError("Memory must be 128, 256, 512 or 1024 MiB.")
    entry = config['entrypoint']
    if not isinstance(entry, str) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*:[a-zA-Z_][a-zA-Z0-9_]*", entry):
        raise ValueError("Entrypoint must be module:function, for example main:run.")
    if entry.split(':')[0].replace('.', '/') + '.py' not in clean:
        raise ValueError("The entrypoint module is missing from the source files.")
    # No options, VCS URLs, local paths or floating versions. Require wheel hashes.
    for line in clean.get('requirements.txt', '').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*==[A-Za-z0-9][A-Za-z0-9_.!+-]*(?: --hash=sha256:[a-f0-9]{64})+", line):
            raise ValueError("Dependencies must be pinned as package==version --hash=sha256:<wheel hash>, one per line.")
    clean.setdefault('requirements.txt', '')
    digest = hashlib.sha256(json_bytes({"files": clean, "manifest": config})).hexdigest()
    return clean, config, digest


def outbound_hosts(manifest):
    """Hosts a job may reach directly ([] when networking is off)."""
    network = manifest.get("network")
    return list(network["allow"]) if isinstance(network, dict) else []


def needs_egress(manifest):
    return bool(outbound_hosts(manifest)) or manifest.get("models") is True


def requirement_lines(files):
    return [line.strip() for line in files.get("requirements.txt", "").splitlines()
            if line.strip() and not line.strip().startswith("#")]


def read_archive(data):
    if len(data) > MAX_SOURCE:
        raise ValueError("ZIP upload exceeds 512 KiB.")
    files, manifest = {}, {}
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = [entry for entry in archive.infolist() if not entry.is_dir()]
            if not 1 <= len(entries) <= MAX_FILES + 1:
                raise ValueError("ZIP must contain at most 32 source files and aistrix.json.")
            if sum(entry.file_size for entry in entries) > MAX_SOURCE:
                raise ValueError("Expanded ZIP exceeds 512 KiB.")
            for entry in entries:
                if stat.S_ISLNK(entry.external_attr >> 16) or entry.file_size > MAX_FILE or entry.flag_bits & 1:
                    raise ValueError("Links, encrypted ZIPs and oversized files are not accepted.")
                if entry.filename in files:
                    raise ValueError("Duplicate ZIP paths are not accepted.")
                with archive.open(entry) as stream:
                    raw = stream.read(MAX_FILE + 1)
                if len(raw) > MAX_FILE:
                    raise ValueError('Expanded source file exceeds 128 KiB.')
                files[entry.filename] = raw.decode('utf-8')
            if 'aistrix.json' in files:
                manifest = json.loads(files.pop('aistrix.json'))
    except (zipfile.BadZipFile, UnicodeError, json.JSONDecodeError, RuntimeError, NotImplementedError) as error:
        raise ValueError("Upload a valid UTF-8 source ZIP.") from error
    return validate_bundle(files, manifest)


def validate_input(value):
    if not isinstance(value, dict) or len(json_bytes(value)) > MAX_INPUT:
        raise ValueError("Input must be a JSON object of at most 64 KiB.")
    return value


# Trusted harness added by the platform, not supplied by the developer.
RUNNER = '''import asyncio, contextlib, importlib, inspect, json, sys
with open("/app/aistrix.json") as f:
    config = json.load(f)
payload = json.load(sys.stdin)
module, function = config["entrypoint"].split(":")
with contextlib.redirect_stdout(sys.stderr):
    result = getattr(importlib.import_module(module), function)(payload)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
sys.stdout.write(json.dumps(result, allow_nan=False, ensure_ascii=False))
'''


def dockerfile(base_image):
    if not re.fullmatch(r"[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}", base_image):
        raise ValueError("The operator must configure an approved Python base image pinned by digest.")
    return f'''FROM {base_image}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --only-binary=:all: --require-hashes -r /app/requirements.txt
COPY . /app
RUN python -m compileall -q /app
USER 10001:10001
ENTRYPOINT ["python", "-u", "/app/aistrix_runner.py"]
'''
