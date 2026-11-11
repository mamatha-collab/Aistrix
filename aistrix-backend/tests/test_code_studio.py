import asyncio
import copy
import json
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import code_studio
from code_job_spec import SPEC
from test_code_jobs import APP, USER, Host, call

FILES = {'main.py': 'def run(payload):\n    return {"total": round(payload["amount"], 2)}\n', 'custom.py': '# preserve this manual helper\nROUNDING = 2\n', 'schemas.json': '{"input":{"type":"object"},"output":{"type":"object"}}', 'tests.json': '[{"name":"Basic","input":{"amount":100},"expected":{"total":100}}]'}


def proposal(files=FILES):
    return {'summary': 'Add optional discount while preserving rounding.', 'changes': [{'path': 'main.py', 'before_sha256': code_studio.file_hash(files['main.py']), 'content': 'def run(payload):\n    return {"total": round(payload["amount"] - payload.get("discount", 0), 2)}\n'}]}


def test_incremental_proposals_preserve_unrelated_manual_code_and_require_exact_base():
    candidate = code_studio.apply_proposal(FILES, SPEC, proposal())
    assert candidate['files']['custom.py'] == FILES['custom.py']
    edited = {**FILES, 'main.py': FILES['main.py'] + '# manual edit\n'}
    with pytest.raises(ValueError, match='current file'):
        code_studio.apply_proposal(edited, SPEC, proposal())


def test_proposals_validate_syntax_schema_and_tests_without_running_code(tmp_path):
    marker = tmp_path / 'must-not-exist'
    malicious = {**FILES, 'main.py': f'from pathlib import Path\nPath({str(marker)!r}).write_text("executed")\ndef run(payload): return {{}}\n'}
    code_studio.validate_project(malicious, SPEC)
    assert not marker.exists()
    for bad in [{'main.py': 'def broken('}, {'schemas.json': '{"input":{"$ref":"http://127.0.0.1/private"},"output":{}}'}, {'tests.json': '[]'}, {'main.py': None}]:
        with pytest.raises(Exception):
            code_studio.validate_project({**FILES, **bad}, SPEC)
    invalid = proposal(); invalid['changes'].append(copy.deepcopy(invalid['changes'][0]))
    with pytest.raises(ValueError, match='Duplicate'):
        code_studio.apply_proposal(FILES, SPEC, invalid)


def test_preview_input_and_output_are_checked_against_the_project_schema():
    files = {**FILES, 'schemas.json': json.dumps({'input': {'type': 'object', 'properties': {'amount': {'type': 'number', 'minimum': 0}}, 'required': ['amount']}, 'output': {'type': 'object', 'required': ['total']}})}
    code_studio.validate_data(files, SPEC, {'amount': 100}, 'input')
    with pytest.raises(ValueError, match='Input does not match'):
        code_studio.validate_data(files, SPEC, {'amount': -1}, 'input')
    with pytest.raises(ValueError, match='Output does not match'):
        code_studio.validate_data(files, SPEC, {}, 'output')


def test_worker_checks_studio_output_without_changing_legacy_source_behavior(monkeypatch):
    import code_worker
    from code_job_spec import validate_bundle
    worker = object.__new__(code_worker.Worker)
    worker.prefix, worker.binary, worker.cancelled = 'registry.invalid/code', 'docker', threading.Event()
    files, manifest, digest = validate_bundle(FILES, SPEC)
    source = {'files': files, 'manifest': manifest, 'source_hash': digest, 'studio_contract': True}
    task = {'id': APP, 'app_id': APP, 'input': {}, 'image': f'registry.invalid/code/{APP}@sha256:' + 'a' * 64}
    monkeypatch.setattr(code_worker, 'execute', lambda *a, **k: (b'null', b'private fixture logs'))
    monkeypatch.setattr(code_worker.subprocess, 'run', lambda *a, **k: None)
    with pytest.raises(code_worker.WorkerError, match='project schema'):
        worker.run(task, source)
    source['studio_contract'] = False
    assert worker.run(task, source)[0]['output'] is None


class StudioHost(Host):
    def __init__(self):
        self.revision = 1
        self.generation_calls = 0
        self.change_during_generation = False
        self.has_key = True
        super().__init__()
        self.app.state.platform_parts = lambda: (SimpleNamespace(gateway=SimpleNamespace(invoke=self.generate)), None)
    async def check_rate_limit(self, *args): return True, ''
    async def fetch_user_api_key_by_id(self, *args): return 'fake-own-key' if self.has_key else None
    async def generate(self, context, **options):
        self.generation_calls += 1
        data = json.loads(options['prompt'])
        assert data['files']['custom.py'] == FILES['custom.py']
        assert set(data) == {'instruction', 'files', 'file_hashes', 'manifest'}
        assert context.owner_id == USER and context.budget_remaining == 1
        if self.change_during_generation: self.revision += 1
        return SimpleNamespace(text=json.dumps(proposal()), provider='claude', model='test', cost_usd=0.01)
    async def db(self, query):
        if query.table == 'code_tasks':
            return SimpleNamespace(data=[{'source_id': APP}])
        if query.table == 'code_sources':
            return SimpleNamespace(data=[{'files': FILES, 'manifest': SPEC}])
        if query.table == 'code_studio_drafts':
            return SimpleNamespace(data=[{'app_id': APP, 'revision': self.revision, 'source_id': APP}])
        if query.rpc == 'save_code_studio_draft':
            self.calls.append(query)
            if query.params['p_expected'] != self.revision:
                raise RuntimeError('Draft revision changed')
            self.revision += 1
            return SimpleNamespace(data=[{'app_id': APP, 'revision': self.revision, 'source_id': APP}])
        if query.rpc == 'enqueue_code_preview':
            self.calls.append(query)
            return SimpleNamespace(data=[{'id': APP, 'source_id': APP, 'status': 'queued', 'lease_token': 'private'}])
        return await super().db(query)


def test_proposal_api_requires_owner_and_current_revision_and_does_not_save_or_run_source():
    host = StudioHost()
    path = f'/v1/apps/{APP}/code/studio/proposals'
    body = {'revision': 1, 'instruction': 'Add optional discount', 'files': FILES, 'manifest': SPEC}
    headers = {'Authorization': 'Bearer fixture'}
    assert call(host, 'POST', path, json=body).status_code == 401
    assert call(host, 'POST', path, headers=headers, json={**body, 'revision': 0}).status_code == 409
    assert host.generation_calls == 0
    response = call(host, 'POST', path, headers=headers, json=body)
    assert response.status_code == 200 and response.json()['proposal']['base_revision'] == 1
    assert not any(query.rpc in ('save_code_studio_draft', 'enqueue_code_task', 'enqueue_code_preview') for query in host.calls)
    host.change_during_generation = True
    assert call(host, 'POST', path, headers=headers, json=body).status_code == 409
    host.has_key = False
    assert call(host, 'POST', path, headers=headers, json={**body, 'revision': host.revision}).status_code == 412
    assert call(host, 'POST', path, headers=headers, content='x' * (1024 * 1024 + 1)).status_code == 413


def test_draft_save_is_revision_fenced_and_preview_never_deploys(monkeypatch):
    monkeypatch.setenv('CODE_APPS_ENABLED', '1')
    host = StudioHost()
    headers = {'Authorization': 'Bearer fixture'}
    path = f'/v1/apps/{APP}/code'
    body = {'revision': 1, 'files': FILES, 'manifest': SPEC}
    assert call(host, 'PUT', path + '/studio/draft', headers=headers, json=body).json()['draft']['revision'] == 2
    assert call(host, 'PUT', path + '/studio/draft', headers=headers, json=body).status_code == 409
    response = call(host, 'POST', path + '/preview', headers=headers, json={'build_id': APP, 'input': {'amount': 100}})
    assert response.status_code == 202 and 'lease_token' not in response.json()['task']
    assert host.calls[-1].rpc == 'enqueue_code_preview'
    assert not any(query.rpc == 'deploy_code_build' for query in host.calls)
    host.caller.via_key = True
    assert call(host, 'POST', path + '/preview', headers=headers, json={'build_id': APP, 'input': {}}).status_code == 403
