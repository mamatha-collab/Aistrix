"""E2B runtime capabilities for imported working code: pinned dependency
templates, declared outbound hosts and model calls through the gateway with
a run token. E2B is faked; no sandbox or template is created."""
import json
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from code_job_spec import STARTER, validate_bundle
from e2b_runtime import (BOOTSTRAP, ManagedError, Runtime, artifact, check_source, dependency_template_name,
                         install_command, mint_run_token, parse_artifact)

PIN = "aistrix-python-dev:00000000-0000-4000-8000-000000000001"
DEP = "requests==2.32.3 --hash=sha256:" + "a" * 64
BUILD_ID = "00000000-0000-4000-8000-0000000000aa"
FERNET = Fernet(Fernet.generate_key())
GATEWAY = "https://api.aistrix.example"


def source(manifest=None, requirements=""):
    files, man, digest = validate_bundle({"main.py": STARTER, "requirements.txt": requirements}, manifest or {})
    return dict(files=files, manifest=man, source_hash=digest)


def task(kind, src, **over):
    return {"kind": kind, "reserved_seconds": 90, "id": "11111111-1111-1111-1111-111111111111", "app_id": "app",
            "user_id": "owner-1", "input": {"items": []}, "image": None, **over}


class Sandbox:
    def __init__(self, info_network=None, internet=False):
        self.uploads, self.killed = None, False
        self.info = SimpleNamespace(cpu_count=1, memory_mb=512, allow_internet_access=internet,
                                    network={"allow_public_traffic": False, **(info_network or {})})
        self.files = SimpleNamespace(make_dir=lambda *a, **k: None, write_files=self.write)
        self.commands = SimpleNamespace(run=self.run)

    def write(self, files, **kw):
        self.uploads = files

    def get_info(self, **kw):
        return self.info

    def run(self, command, **kw):
        control = json.loads(next(f["data"] for f in self.uploads if f["path"].endswith("aistrix-control.json")))
        self.control = control
        kw["on_stdout"]('{"python":"3.12","validated":true}' if control["mode"] == "build" else '{"ok": true}')
        return SimpleNamespace(exit_code=0, stdout="")

    def kill(self, **kw):
        self.killed = True


class Templates:
    """Template builder fake: records builds; get_tags finds what was built."""
    built: dict = {}

    def __init__(self):
        self.steps = []

    def from_template(self, name):
        self.steps.append(("from", name))
        return self

    def run_cmd(self, command, user=None):
        self.steps.append(("run", command, user))
        return self

    @classmethod
    def get_tags(cls, name, **kw):
        if name not in cls.built:
            raise Exception("not found")
        return [SimpleNamespace(tag="default", build_id=cls.built[name])]

    @classmethod
    def build(cls, template, name, **kw):
        cls.last = (template.steps, name, kw)
        if "FAIL" in json.dumps(template.steps):
            raise RuntimeError("pip failed: secret-ish provider output")
        cls.built[name] = BUILD_ID
        return SimpleNamespace(build_id=BUILD_ID, template_id="tmpl", name=name)


def runtime(sandbox, **kw):
    created = []

    def create(reference, **options):
        created.append({"reference": reference, **options})
        return sandbox
    Templates.built = {}
    rt = Runtime("e2b-key", PIN, sandbox_type=SimpleNamespace(create=create), template_type=Templates, **kw)
    rt.created = created
    return rt


# ── Capability gates ─────────────────────────────────────────────────────────

def test_capabilities_are_refused_until_the_server_enables_them():
    with pytest.raises(ManagedError, match="dependency templates"):
        check_source(source(requirements=DEP))
    with pytest.raises(ManagedError, match="Outbound network"):
        check_source(source({"network": {"allow": ["api.example.com"]}}))
    with pytest.raises(ManagedError, match="gateway"):
        check_source(source({"models": True}))
    check_source(source(requirements=DEP), dependencies=True)
    check_source(source({"network": {"allow": ["api.example.com"]}, "models": True}), egress=True, models=True)


@pytest.mark.parametrize("manifest", [
    {"network": "all"}, {"network": {"allow": []}}, {"network": {"allow": ["1.2.3.4"]}},
    {"network": {"allow": ["API.example.com"]}}, {"network": {"allow": ["a.example.com"], "deny": []}},
    {"models": False}, {"models": "yes"},
])
def test_network_and_model_settings_are_validated(manifest):
    with pytest.raises(ValueError):
        validate_bundle({"main.py": STARTER}, manifest)


# ── Dependencies ─────────────────────────────────────────────────────────────

def test_a_build_with_dependencies_uses_a_pinned_template_built_once():
    sandbox = Sandbox()
    rt = runtime(sandbox, dependencies=True)
    src = source(requirements=DEP)
    result, _ = rt.execute(task("build", src), src, threading.Event())
    name = dependency_template_name([DEP], PIN)
    steps, built_name, options = Templates.last
    assert built_name == name and steps[0] == ("from", "aistrix-python-dev")
    assert "--require-hashes" in steps[1][1] and "--only-binary=:all:" in steps[1][1] and steps[1][2] == "root"
    assert rt.created[0]["reference"] == f"{name}:{BUILD_ID}"
    assert parse_artifact(result["image"], src["source_hash"]) == f"{name}:{BUILD_ID}"
    assert result["limits"]["dependencies"] == 1
    assert rt.created[0]["allow_internet_access"] is False            # builds never get network
    # A second build with the same requirements reuses the template.
    Templates.last = None
    rt.execute(task("build", src), src, threading.Event())
    assert Templates.last is None and rt.created[1]["reference"] == f"{name}:{BUILD_ID}"


def test_failed_dependency_installs_are_reported_without_provider_output():
    rt = runtime(Sandbox(), dependencies=True)
    src = source(requirements="FAIL==1.0 --hash=sha256:" + "b" * 64)
    with pytest.raises(ManagedError, match="could not be installed") as error:
        rt.execute(task("build", src), src, threading.Event())
    assert "secret-ish" not in str(error.value) and rt.created == []


def test_the_install_command_only_quotes_validated_lines():
    assert install_command([DEP]).count("'") == 4                    # the printf format and one requirement
    assert dependency_template_name([DEP], PIN) != dependency_template_name([DEP], PIN.replace("1", "2"))


# ── Network and models ───────────────────────────────────────────────────────

def test_a_run_reaches_only_its_declared_hosts():
    sandbox = Sandbox(info_network={"allow_out": ["api.example.com"]}, internet=True)
    rt = runtime(sandbox, egress=True)
    src = source({"network": {"allow": ["api.example.com"]}})
    result, _ = rt.execute(task("run", src, image=artifact(PIN, src["source_hash"])), src, threading.Event())
    options = rt.created[0]
    assert options["allow_internet_access"] is True
    assert options["network"] == {"allow_out": ["api.example.com"], "deny_out": ["0.0.0.0/0"], "allow_public_traffic": False}
    assert result["limits"]["network"] == ["api.example.com"] and sandbox.control["env"] == {}


def test_a_run_that_calls_models_gets_the_gateway_and_a_run_token():
    sandbox = Sandbox(info_network={"allow_out": ["api.aistrix.example"]}, internet=True)
    rt = runtime(sandbox, gateway_url=GATEWAY, fernet=FERNET)
    src = source({"models": True})
    t = task("run", src, image=artifact(PIN, src["source_hash"]))
    rt.execute(t, src, threading.Event())
    assert rt.created[0]["network"]["allow_out"] == ["api.aistrix.example"] and rt.created[0]["envs"] == {}
    env = sandbox.control["env"]
    assert env["OPENAI_BASE_URL"] == f"{GATEWAY}/v1/gateway/openai" and env["ANTHROPIC_BASE_URL"] == f"{GATEWAY}/v1/gateway/anthropic"
    assert env["OPENAI_API_KEY"] == env["ANTHROPIC_API_KEY"] and env["OPENAI_API_KEY"].startswith("ak_run_")
    claims = json.loads(FERNET.decrypt(env["OPENAI_API_KEY"][len("ak_run_"):].encode()))
    assert claims["o"] == "owner-1" and claims["t"] == t["id"] and claims["b"] == 0.5
    assert time.time() < claims["exp"] <= time.time() + 121
    # The job's process sees these variables only after the privilege drop.
    assert BOOTSTRAP.index('os.environ.update(settings.get("env") or {})') > BOOTSTRAP.index("os.setuid(65534)")


def test_a_sandbox_that_doesnt_confirm_the_allow_list_is_refused():
    sandbox = Sandbox(info_network={"allow_out": ["evil.example.com"]}, internet=True)
    rt = runtime(sandbox, egress=True)
    src = source({"network": {"allow": ["api.example.com"]}})
    with pytest.raises(ManagedError, match="did not confirm"):
        rt.execute(task("run", src, image=artifact(PIN, src["source_hash"])), src, threading.Event())
    assert sandbox.killed


def test_the_gateway_url_must_be_https():
    with pytest.raises(ManagedError, match="https"):
        Runtime("k", PIN, sandbox_type=SimpleNamespace(), template_type=Templates, gateway_url="http://localhost:8001", fernet=FERNET)


def test_run_tokens_expire_with_the_sandbox():
    token = mint_run_token(FERNET, {"user_id": "u", "id": "t", "app_id": "a"}, 10)
    assert json.loads(FERNET.decrypt(token[7:].encode()))["exp"] <= time.time() + 10
