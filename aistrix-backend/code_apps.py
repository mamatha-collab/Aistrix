"""Private code application control plane. Customer code never runs in this API."""
import json
import os
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict

from code_job_spec import MAX_SOURCE, SPEC, STARTER, validate_bundle, read_archive, validate_input


class CreateCodeApp(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=100)


class BuildCodeApp(BaseModel):
    source_id: UUID


class DeployCodeApp(BaseModel):
    build_id: UUID
    expected_build_id: UUID | None = None


def public_task(row):
    return {key: row.get(key) for key in ('id','app_id','source_id','kind','status','result','logs','error',
                                         'image','created_at','started_at','finished_at','elapsed_ms')}


async def bounded_body(request, limit):
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data) > limit:
            raise HTTPException(413, 'Upload is too large.')
    return bytes(data)


def register_routes(app, host):
    @app.middleware('http')
    async def private_code_responses(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith('/v1/code-apps') or re.match(r'^/v1/apps/[^/]+/code(?:/|$)', request.url.path):
            response.headers['Cache-Control'] = 'private, no-store'
        return response

    async def query(q):
        try:
            return (await host.db(q)).data
        except Exception as error:
            # RPC business failures are fixed platform messages, never raw SQL/credentials.
            message = str(error)
            known = ('No healthy worker', 'Two jobs are already active', 'Daily code job quota',
                     'Deploy a successful build', 'Deployment changed', 'Only a successful build',
                     'Source version not found', 'Source version quota reached', 'Code app not found')
            if any(text in message for text in known):
                raise HTTPException(409, next(text for text in known if text in message)) from error
            raise HTTPException(503, 'Code hosting storage is unavailable. Check the code-job migration and server configuration.') from error

    def store():
        sb = host._service_client()
        if not sb:
            raise HTTPException(503, 'Code hosting storage is not configured.')
        return sb

    async def owner(app_id, request):
        try:
            UUID(app_id)
        except ValueError:
            raise HTTPException(404, 'Code app not found')
        caller, row = await host._editable_app(app_id, request)
        if caller.via_key or caller.user_id != row.get('created_by'):
            raise HTTPException(403, 'Sign in as the app owner to manage code hosting.')
        if row.get('app_type') != 'code_job':
            raise HTTPException(404, 'Code app not found')
        return caller, row

    def require_enabled():
        if os.getenv('CODE_APPS_ENABLED') != '1':
            raise HTTPException(503, 'Code hosting is not enabled. Source editing is available; an operator must configure isolated workers before builds or runs.')

    async def source_save(app_id, user_id, bundle):
        files, manifest, digest = bundle
        rows = await query(store().rpc('save_code_source', {'p_app': app_id, 'p_user': user_id,
            'p_hash': digest, 'p_files': files, 'p_manifest': manifest}))
        return rows[0]

    @app.post('/v1/code-apps', status_code=201)
    async def create_code_app(body: CreateCodeApp, request: Request):
        caller = await host.resolve_api_caller(request, required=True)
        if caller.via_key or not caller.user_id:
            raise HTTPException(403, 'Sign in to create a code app.')
        name = body.name.strip()
        if not name:
            raise HTTPException(422, 'Give the app a name.')
        await query(store().table('code_sources').select('id').limit(1))
        # Existing database app-count policy still applies; this uses the owner's JWT,
        # not the service role, so tier and workspace insert guards stay in force.
        client = host.get_supabase_for_user(caller.user_jwt)
        rows = await query(client.table('apps').insert({'name': name, 'created_by': caller.user_id,
            'workspace_id': caller.workspace_id, 'app_type': 'code_job', 'visibility': 'private',
            'ai_provider': None, 'ai_model': None, 'emoji': '</>', 'color': '#0984E3', 'output_type': 'json',
            'description': 'A privately deployed Python job.'}).select('id,name,created_by,workspace_id,app_type,visibility,emoji,color,description,is_published,created_at'))
        return {'app': rows[0]}

    @app.get('/v1/apps/{app_id}/code')
    async def code_status(app_id: str, request: Request):
        await owner(app_id, request)
        sb = store()
        await query(sb.rpc('recover_code_tasks', {'p_app': app_id}))
        sources = await query(sb.table('code_sources').select('*').eq('app_id', app_id).order('created_at', desc=True).limit(1))
        tasks = await query(sb.table('code_tasks').select('*').eq('app_id', app_id).order('created_at', desc=True).limit(30))
        deployments = await query(sb.table('code_deployments').select('*').eq('app_id', app_id).limit(1))
        builds = await query(sb.table('code_tasks').select('*').eq('app_id', app_id).eq('kind', 'build').eq('status', 'succeeded').order('created_at', desc=True).limit(20))
        recent = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()
        workers = await query(sb.table('code_workers').select('kind').gt('seen_at', recent))
        enabled = os.getenv('CODE_APPS_ENABLED') == '1'
        return {'source': sources[0] if sources else None, 'tasks': [public_task(row) for row in tasks],
                'builds': [public_task(row) for row in builds],
                'deployment': deployments[0] if deployments else None,
                'capabilities': {'enabled': enabled, 'build': enabled and any(w['kind']=='build' for w in workers),
                                 'run': enabled and any(w['kind']=='run' for w in workers)},
                'limits': {'daily_builds': 5, 'daily_runs': 100, 'active_jobs': 2},
                'starter': {'files': {'main.py': STARTER, 'requirements.txt': ''}, 'manifest': SPEC}}

    @app.put('/v1/apps/{app_id}/code/source')
    async def save_code_source(app_id: str, request: Request):
        caller, _ = await owner(app_id, request)
        raw = await bounded_body(request, MAX_SOURCE * 2)
        try:
            if request.headers.get('content-type', '').split(';')[0] == 'application/zip':
                bundle = read_archive(raw)
            else:
                body = json.loads(raw)
                if not isinstance(body, dict) or set(body) != {'files', 'manifest'}:
                    raise ValueError('Provide files and manifest.')
                bundle = validate_bundle(body['files'], body['manifest'])
        except (ValueError, TypeError, RecursionError) as error:
            raise HTTPException(422, str(error)[:300]) from error
        return {'source': await source_save(app_id, caller.user_id, bundle)}

    @app.post('/v1/apps/{app_id}/code/builds', status_code=202)
    async def build_code_app(app_id: str, body: BuildCodeApp, request: Request):
        caller, _ = await owner(app_id, request)
        require_enabled()
        rows = await query(store().rpc('enqueue_code_task', {'p_app': app_id, 'p_user': caller.user_id,
            'p_kind': 'build', 'p_source': str(body.source_id), 'p_input': None}))
        return {'task': public_task(rows[0])}

    @app.post('/v1/apps/{app_id}/code/deploy')
    async def deploy_code_app(app_id: str, body: DeployCodeApp, request: Request):
        caller, _ = await owner(app_id, request)
        require_enabled()
        rows = await query(store().rpc('deploy_code_build', {'p_app': app_id, 'p_user': caller.user_id,
            'p_build': str(body.build_id), 'p_expected': str(body.expected_build_id) if body.expected_build_id else None}))
        return {'deployment': rows[0]}

    @app.post('/v1/apps/{app_id}/code/runs', status_code=202)
    async def run_code_app(app_id: str, request: Request):
        caller, _ = await owner(app_id, request)
        require_enabled()
        try:
            payload = validate_input(json.loads(await bounded_body(request, 65536)))
            expected = request.headers.get('x-code-build-id')
            if expected:
                expected = str(UUID(expected))
        except (ValueError, TypeError, RecursionError) as error:
            raise HTTPException(422, 'Provide a finite JSON object of at most 64 KiB.') from error
        rows = await query(store().rpc('enqueue_code_task', {'p_app': app_id, 'p_user': caller.user_id,
            'p_kind': 'run', 'p_source': None, 'p_input': payload, 'p_expected_build': expected}))
        return {'task': public_task(rows[0])}

    @app.post('/v1/apps/{app_id}/code/tasks/{task_id}/cancel')
    async def cancel_code_task(app_id: str, task_id: UUID, request: Request):
        await owner(app_id, request)
        rows = await query(store().table('code_tasks').update({'status': 'cancelled', 'lease_token': None,
            'finished_at': datetime.now(timezone.utc).isoformat()}).eq('app_id', app_id).eq('id', str(task_id)).in_('status', ['queued','running']))
        if not rows:
            raise HTTPException(409, 'The job already finished or was not found. Refresh its status.')
        return {'task': public_task(rows[0])}

    @app.get('/v1/apps/{app_id}/code/tasks/{task_id}')
    async def get_code_task(app_id: str, task_id: UUID, request: Request):
        await owner(app_id, request)
        rows = await query(store().table('code_tasks').select('*').eq('app_id', app_id).eq('id', str(task_id)).limit(1))
        if not rows:
            raise HTTPException(404, 'Code job not found')
        return {'task': public_task(rows[0])}
