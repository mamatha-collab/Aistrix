import threading
from types import SimpleNamespace

import pytest
from code_job_spec import validate_bundle, STARTER
from e2b_runtime import Runtime, ManagedError, artifact, parse_artifact, BOOTSTRAP

PIN = 'test:00000000-0000-4000-8000-000000000001'

def fixture(kind='build'):
    files, manifest, digest = validate_bundle({'main.py': STARTER}, {})
    source = dict(files=files, manifest=manifest, source_hash=digest)
    task = dict(kind=kind, reserved_seconds=90, id='job', app_id='app', input={}, image=artifact(PIN, digest))
    return task, source

class Sandbox:
    def __init__(self, fail=False):
        self.killed = False
        self.fail = fail
        self.files = SimpleNamespace(make_dir=lambda *a, **k: None, write_files=self.write)
        self.commands = SimpleNamespace(run=self.run)
    def write(self, files, **kwargs):
        self.uploads = files
    def get_info(self, **kwargs):
        return SimpleNamespace(cpu_count=1, memory_mb=512, allow_internet_access=False, network={'allow_public_traffic': False})
    def run(self, command, **kwargs):
        assert command == 'python3 -I /home/user/aistrix-bootstrap.py'
        if self.fail:
            raise RuntimeError('secret provider URL')
        kwargs['on_stdout']('{"python":"3.12","validated":true}')
        return SimpleNamespace(exit_code=0, stdout='')
    def kill(self, **kwargs):
        self.killed = True

@pytest.mark.parametrize('fail', [False, True])
def test_remote_limits_and_cleanup(fail):
    sandbox = Sandbox(fail)
    calls = []
    def create(*args, **kwargs):
        calls.append(kwargs)
        return sandbox
    runtime = Runtime('private-key', PIN, sandbox_type=SimpleNamespace(create=create))
    task, source = fixture()
    if fail:
        with pytest.raises(ManagedError, match='failed or timed out') as error:
            runtime.execute(task, source, threading.Event())
        assert 'secret' not in str(error.value)
    else:
        result, _ = runtime.execute(task, source, threading.Event())
        assert parse_artifact(result['image'], source['source_hash']) == PIN
    assert sandbox.killed
    assert calls[0]['allow_internet_access'] is False
    assert calls[0]['network']['allow_public_traffic'] is False
    assert calls[0]['lifecycle'] == {'on_timeout': 'kill', 'auto_resume': False}
    assert calls[0]['timeout'] == 90
    assert calls[0]['envs'] == {}

def test_integrity_fails_before_any_provider_request():
    task, source = fixture()
    source['source_hash'] = 'a' * 64
    runtime = Runtime('key', PIN, sandbox_type=SimpleNamespace())
    with pytest.raises(ManagedError, match='integrity'):
        runtime.execute(task, source, threading.Event())

def test_privileges_drop_before_customer_module_import():
    assert BOOTSTRAP.index('os.setuid(65534)') < BOOTSTRAP.index('importlib.import_module(module)')
    assert BOOTSTRAP.index('prctl(38, 1') < BOOTSTRAP.index('os.setuid(65534)')
