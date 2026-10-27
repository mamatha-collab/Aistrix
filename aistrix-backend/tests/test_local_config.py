from scripts.run_local import local_environment
from scripts import run_local
import errno
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest


def test_staging_secrets_do_not_fall_back_to_default_or_inherited_values():
    env = local_environment(
        {'SUPABASE_URL': 'https://staging.example.invalid', 'SUPABASE_ANON_KEY': 'staging'},
        {'SUPABASE_URL': 'https://production.example.invalid', 'OPENAI_API_KEY': 'production'},
        {'OPENAI_API_KEY': 'inherited', 'PATH': 'preserved'},
    )
    assert env['SUPABASE_URL'] == 'https://staging.example.invalid'
    assert env['OPENAI_API_KEY'] == ''
    assert env['PATH'] == 'preserved'


def test_local_origins_are_explicit_and_do_not_replace_existing_origins():
    env = local_environment({'ALLOWED_ORIGINS': 'http://localhost:5173,http://localhost:3000'}, {}, {})
    assert env['ALLOWED_ORIGINS'].split(',') == [
        'http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:3000',
    ]
    assert env['FRONTEND_URL'] == 'http://localhost:3000'
    assert env['SCHEDULER_INTERVAL_SECONDS'] == '0'


@pytest.mark.parametrize('healthy,expected', [(True,'aistrix'),(False,'other')])
def test_busy_port_distinguishes_a_verified_api_from_another_service(monkeypatch, healthy, expected):
    probe = MagicMock()
    probe.__enter__.return_value = probe
    probe.bind.side_effect = OSError(errno.EADDRINUSE, 'Address in use')
    monkeypatch.setattr(run_local.socket, 'socket', lambda *args: probe)
    monkeypatch.setattr(run_local, 'is_local_api', lambda port, brand: healthy)
    assert run_local.existing_listener(8001,'Aistrix') == expected


def test_repeat_launch_exits_before_importing_the_api_or_starting_uvicorn(monkeypatch, tmp_path, capsys):
    (tmp_path / '.env.staging').touch()
    monkeypatch.setattr(run_local,'BACKEND',tmp_path)
    monkeypatch.setattr(run_local,'dotenv_values',lambda path: {'SUPABASE_URL':'https://fixture.invalid','SUPABASE_ANON_KEY':'anon','SUPABASE_SERVICE_ROLE_KEY':'service'})
    monkeypatch.setattr(run_local,'existing_listener',lambda port,brand:'aistrix')
    monkeypatch.setattr(run_local.sys,'argv',['run_local.py'])
    server = MagicMock()
    monkeypatch.setitem(run_local.sys.modules,'uvicorn',SimpleNamespace(run=server))
    run_local.main()
    server.assert_not_called()
    output = capsys.readouterr().out
    assert 'already running' in output and 'stop the existing API first' in output
