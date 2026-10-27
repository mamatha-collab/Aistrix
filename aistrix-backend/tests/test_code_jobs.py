"""No Docker, cloud, real accounts or customer source execution in these tests."""
import asyncio
import io
import json
import os
import sys
import threading
import zipfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import code_apps
from code_job_spec import MAX_FILE, RUNNER, SPEC, STARTER, dockerfile, read_archive, validate_bundle, validate_input
from code_worker import Worker, WorkerError, execute, runtime_command

APP = '00000000-0000-0000-0000-000000009003'
USER = '00000000-0000-0000-0000-000000009001'


@pytest.mark.parametrize('path', ['../main.py','/main.py','a/../main.py','a//main.py','.env','Dockerfile','aistrix_runner.py','C:/main.py','a\\main.py'])
def test_unsafe_source_paths_are_refused(path):
    with pytest.raises(ValueError):
        validate_bundle({'main.py': STARTER, path: 'bad'}, {})


def test_source_versions_are_canonical_and_manifest_limits_are_enforced():
    files, manifest, first = validate_bundle({'main.py': STARTER}, {})
    assert len(first) == 64
    assert validate_bundle(files, manifest)[2] == first
    assert manifest['network'] == 'none'
    for config in [{'network':'all'},{'runtime':'node'},{'timeout_seconds':121},{'timeout_seconds':True},
                   {'memory_mb':8192},{'entrypoint':'missing:run'},{'build_command':'curl bad'}, {'version':True}]:
        with pytest.raises(ValueError):
            validate_bundle(files, config)
    with pytest.raises(ValueError):
        validate_bundle({'main.py': 'x'*(MAX_FILE+1)}, {})


@pytest.mark.parametrize('requirements', ['requests','requests>=2','-r remote.txt','https://bad.invalid/a.whl','pkg==1.0', 'pkg==1 --hash=sha256:nope'])
def test_dependencies_need_pinned_hashes_and_disallow_execution_options(requirements):
    with pytest.raises(ValueError):
        validate_bundle({'main.py':STARTER,'requirements.txt':requirements}, {})


def test_accepts_hashed_dependency_and_bounded_root_zip():
    data = io.BytesIO()
    with zipfile.ZipFile(data,'w') as archive:
        archive.writestr('main.py',STARTER)
        archive.writestr('aistrix.json',json.dumps(SPEC))
        archive.writestr('requirements.txt','example==1.0 --hash=sha256:'+'a'*64)
    assert read_archive(data.getvalue())[1] == SPEC
    bad = io.BytesIO()
    with zipfile.ZipFile(bad,'w') as archive:
        archive.writestr('../main.py',STARTER)
    with pytest.raises(ValueError):
        read_archive(bad.getvalue())


def test_input_must_be_finite_bounded_object():
    assert validate_input({'items':[]}) == {'items':[]}
    for value in [[], None, {'x':float('nan')}, {'x':'a'*65536}]:
        with pytest.raises(ValueError):
            validate_input(value)


def test_only_immutable_base_images_and_fixed_runtime_flags_are_used():
    with pytest.raises(ValueError):
        dockerfile('python:latest')
    text = dockerfile('python@sha256:'+'a'*64)
    assert '--require-hashes' in text and '--only-binary=:all:' in text and 'compileall' in text
    assert 'USER 10001:10001' in text and 'aistrix_runner.py' in text
    args = runtime_command('/usr/bin/docker','aistrix-fixture','image@sha256:'+'a'*64,SPEC)
    for flag in ['--network=none','--runtime=runsc','--read-only','--cap-drop=ALL','--pids-limit=64','--cpus=1','--memory=256m','--log-driver=none']:
        assert flag in args
    assert not any(arg in ('--privileged','--volume','--env','-v','-e') for arg in args)
    assert any(arg.startswith('--label=ai.aistrix.expires=') for arg in args)


def test_process_capture_enforces_timeout_and_output_caps():
    # Fixed test programs only; never compile or run a submitted source file on the host.
    with pytest.raises(WorkerError, match='deadline'):
        execute([sys.executable,'-c','import time; time.sleep(10)'],timeout=0.2,cancelled=threading.Event())
    with pytest.raises(WorkerError, match='64 KiB'):
        execute([sys.executable,'-c','print("a"*100000)'],timeout=5,cancelled=threading.Event())


def test_worker_cannot_run_unconfigured_or_on_workstation():
    with pytest.raises(WorkerError):
        Worker('run',env={})
    worker = Worker('run',env={'CODE_IMAGE_PREFIX':'registry.example.com/code'})
    with pytest.raises(WorkerError):
        worker.preflight()


class Query:
    def __init__(self, host, table=None, rpc=None, params=None):
        self.host, self.table, self.rpc, self.params = host, table, rpc, params
        self.body = None
    def __getattr__(self, name):
        return lambda *args, **kwargs: self
    def insert(self, body):
        self.body = body
        return self


class Host:
    def __init__(self):
        self.app = FastAPI()
        self.calls = []
        self.caller = SimpleNamespace(user_id=USER, user_jwt='fake', workspace_id=None, via_key=False)
        self.row = {'id':APP,'app_type':'code_job','created_by':USER}
        self.client = SimpleNamespace(table=lambda table: Query(self,table=table), rpc=lambda name, params: Query(self,rpc=name,params=params))
        code_apps.register_routes(self.app,self)
    async def resolve_api_caller(self, request, required=False):
        if request.headers.get('authorization') != 'Bearer fixture':
            raise HTTPException(401,'Sign in')
        return self.caller
    async def _editable_app(self, app_id, request):
        caller = await self.resolve_api_caller(request,True)
        if app_id != APP:
            raise HTTPException(404,'Not found')
        return caller,self.row
    def _service_client(self):
        return self.client
    def get_supabase_for_user(self, token):
        return self.client
    async def db(self, query):
        self.calls.append(query)
        if query.rpc == 'save_code_source':
            data = [{'id':APP,'files':query.params['p_files'],'manifest':query.params['p_manifest'],'source_hash':query.params['p_hash']}]
        elif query.rpc == 'enqueue_code_task':
            data = [{'id':APP,'status':'queued','lease_token':'private'}]
        elif query.table == 'apps':
            data = [{'id':APP,**query.body}]
        else:
            data = []
        return SimpleNamespace(data=data)


def call(host, method, path, **options):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=host.app),base_url='http://fixture') as client:
            return await client.request(method,path,**options)
    return asyncio.run(go())


def test_api_checks_auth_and_owner_before_storage_or_enqueue(monkeypatch):
    host = Host()
    endpoint = f'/v1/apps/{APP}/code'
    assert call(host,'GET',endpoint).status_code == 401
    host.caller.via_key = True
    assert call(host,'GET',endpoint,headers={'Authorization':'Bearer fixture'}).status_code == 403
    host.caller.via_key = False
    host.row['created_by'] = 'another-user'
    assert call(host,'GET',endpoint,headers={'Authorization':'Bearer fixture'}).status_code == 403
    assert host.calls == []


def test_api_saves_source_without_hosting_and_refuses_execution_when_disabled(monkeypatch):
    monkeypatch.delenv('CODE_APPS_ENABLED',raising=False)
    host = Host()
    headers = {'Authorization':'Bearer fixture'}
    endpoint = f'/v1/apps/{APP}/code'
    response = call(host,'PUT',endpoint+'/source',headers=headers,json={'files':{'main.py':STARTER},'manifest':{}})
    assert response.status_code == 200 and len(response.json()['source']['source_hash']) == 64
    assert response.headers['cache-control'] == 'private, no-store'
    for route, body in [('/builds',{'source_id':APP}),('/runs',{}),('/deploy',{'build_id':APP})]:
        assert call(host,'POST',endpoint+route,headers=headers,json=body).status_code == 503
    assert not any(q.rpc == 'enqueue_code_task' for q in host.calls)


def test_api_bounds_inputs_and_hides_worker_authority(monkeypatch):
    monkeypatch.setenv('CODE_APPS_ENABLED','1')
    host = Host()
    headers = {'Authorization':'Bearer fixture'}
    endpoint = f'/v1/apps/{APP}/code'
    assert call(host,'PUT',endpoint+'/source',headers=headers,json={'files':{'../main.py':'x'},'manifest':{}}).status_code == 422
    assert call(host,'POST',endpoint+'/runs',headers=headers,json=[]).status_code == 422
    result = call(host,'POST',endpoint+'/runs',headers=headers,json={'x':1})
    assert result.status_code == 202 and 'lease_token' not in result.json()['task']
    assert call(host,'POST',endpoint+'/runs',headers=headers,content='x'*65537).status_code == 413


def test_creating_code_app_uses_owner_rls_and_does_not_require_provider_key():
    host = Host()
    result = call(host,'POST','/v1/code-apps',headers={'Authorization':'Bearer fixture'},json={'name':'Code service'})
    assert result.status_code == 201
    assert result.json()['app']['app_type'] == 'code_job'
    assert result.json()['app']['visibility'] == 'private'
    assert result.json()['app']['ai_provider'] is None
