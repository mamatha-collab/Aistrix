"""Private code application control plane. Customer code never runs in this API."""
import asyncio
import json
import os
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict, ValidationError

from code_job_spec import MAX_SOURCE, SPEC, STARTER, validate_bundle, read_archive, validate_input
import code_import
import code_studio
from e2b_runtime import ManagedError, check_source


class CreateCodeApp(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=100)


class BuildCodeApp(BaseModel):
    source_id: UUID


class DeployCodeApp(BaseModel):
    build_id: UUID
    expected_build_id: UUID | None = None


class StudioProposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    instruction: str = Field(min_length=1, max_length=8000)
    provider: str = Field(pattern='^(claude|openai|gemini)$', default='claude')
    files: dict[str, str]
    manifest: dict


class StudioSave(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    files: dict[str, str]
    manifest: dict


class ImportCode(BaseModel):
    model_config = ConfigDict(extra='forbid')
    repo: str = Field(min_length=3, max_length=500)       # owner/repo or a github.com link
    ref: str | None = Field(default=None, max_length=200)  # branch, tag or commit; default branch if omitted
    path: str | None = Field(default=None, max_length=300)  # a folder inside the repository


class StudioPreview(BaseModel):
    build_id: UUID
    input: dict


def public_task(row):
    return {key: row.get(key) for key in ('id','app_id','source_id','kind','status','result','logs','error',
                                         'image','executor','reserved_seconds','created_at','started_at','finished_at','elapsed_ms')}


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
            known += ('Draft revision changed', 'Daily managed runtime allowance', 'Deployment changed execution provider')
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
            raise HTTPException(503, 'Code execution is not enabled. Configure an execution provider before building or running.')
        if executor() == 'e2b' and not os.getenv('E2B_API_KEY', '').strip():
            raise HTTPException(503, 'Add E2B_API_KEY to the backend environment and start the E2B coordinator.')

    def executor():
        selected = os.getenv('CODE_EXECUTION_PROVIDER', 'dedicated')
        if selected not in ('dedicated', 'e2b'):
            raise HTTPException(503, 'CODE_EXECUTION_PROVIDER must be dedicated or e2b.')
        return selected

    def daily_seconds():
        try:
            allowance = int(os.getenv('E2B_DAILY_RUNTIME_SECONDS', '3600'))
            if not 1 <= allowance <= 86400:
                raise ValueError('Invalid allowance')
            return allowance
        except ValueError as error:
            raise HTTPException(503, 'Configure E2B_DAILY_RUNTIME_SECONDS between 1 and 86400.') from error

    async def enqueue(app_id, user_id, kind, source=None, payload=None, expected=None, preview=None):
        if executor() == 'e2b':
            if kind == 'build':
                sources = await query(store().table('code_sources').select('*').eq('app_id', app_id).eq('id', source).limit(1))
                if not sources:
                    raise HTTPException(409, 'Source version not found.')
                try:
                    check_source(sources[0], dependencies=os.getenv('E2B_DEPENDENCY_TEMPLATES') == '1',
                                 egress=os.getenv('E2B_EGRESS') == '1',
                                 models=bool(os.getenv('GATEWAY_PUBLIC_URL') and os.getenv('SECRET_ENCRYPTION_KEY')))
                except ManagedError as error:
                    raise HTTPException(422, str(error)) from error
            return await query(store().rpc('enqueue_e2b_task', {'p_app': app_id, 'p_user': user_id, 'p_kind': kind,
                'p_source': source, 'p_input': payload, 'p_expected_build': expected, 'p_preview_build': preview, 'p_daily_seconds': daily_seconds()}))
        if preview:
            return await query(store().rpc('enqueue_code_preview', {'p_app': app_id, 'p_user': user_id, 'p_build': preview, 'p_input': payload}))
        params = {'p_app': app_id, 'p_user': user_id, 'p_kind': kind, 'p_source': source, 'p_input': payload}
        if kind == 'run':
            params['p_expected_build'] = expected
        return await query(store().rpc('enqueue_code_task', params))

    async def source_save(app_id, user_id, bundle):
        files, manifest, digest = bundle
        rows = await query(store().rpc('save_code_source', {'p_app': app_id, 'p_user': user_id,
            'p_hash': digest, 'p_files': files, 'p_manifest': manifest}))
        return rows[0]

    async def studio_current(app_id):
        drafts = await query(store().table('code_studio_drafts').select('*').eq('app_id', app_id).limit(1))
        return drafts[0] if drafts else {'app_id': app_id, 'revision': 0, 'source_id': None}

    async def studio_body(request, model, limit=MAX_SOURCE * 2):
        try:
            return model.model_validate_json(await bounded_body(request, limit))
        except ValidationError as error:
            raise HTTPException(422, 'Provide a valid Studio request.') from error

    @app.get('/v1/apps/{app_id}/code/studio')
    async def studio_status(app_id: str, request: Request):
        await owner(app_id, request)
        draft = await studio_current(app_id)
        sources = await query(store().table('code_sources').select('*').eq('app_id', app_id).order('created_at', desc=True).limit(100))
        history = await query(store().table('code_studio_revisions').select('*').eq('app_id', app_id).order('revision', desc=True).limit(20))
        source = next((s for s in sources if s['id'] == draft['source_id']), None)
        if draft['source_id'] and not source:
            raise HTTPException(503, 'The current source revision could not be read.')
        if not source:
            latest = sources[0] if sources else {'files': {'main.py': STARTER, 'requirements.txt': ''}, 'manifest': SPEC}
            files, manifest, digest = validate_bundle(code_studio.starter_project(latest['files']), latest['manifest'])
            source = {'id': None, 'files': files, 'manifest': manifest, 'source_hash': digest}
        return {'draft': {**draft, 'source': source}, 'history': [{**h, 'source': next((s for s in sources if s['id'] == h['source_id']), None)} for h in history]}

    @app.put('/v1/apps/{app_id}/code/studio/draft')
    async def studio_save(app_id: str, request: Request):
        caller, _ = await owner(app_id, request)
        body = await studio_body(request, StudioSave)
        try:
            files, manifest, digest = code_studio.validate_project(body.files, body.manifest)
        except Exception as error:
            raise HTTPException(422, str(error)[:300] if isinstance(error, (ValueError, TypeError)) else 'Invalid source, JSON schema, or test fixture.') from error
        rows = await query(store().rpc('save_code_studio_draft', {'p_app': app_id, 'p_user': caller.user_id,
            'p_expected': body.revision, 'p_hash': digest, 'p_files': files, 'p_manifest': manifest}))
        return {'draft': {**rows[0], 'source': {'id': rows[0]['source_id'], 'files': files, 'manifest': manifest, 'source_hash': digest}}}

    @app.post('/v1/apps/{app_id}/code/studio/proposals')
    async def studio_propose(app_id: str, request: Request):
        caller, _ = await owner(app_id, request)
        body = await studio_body(request, StudioProposal)
        if not body.instruction.strip():
            raise HTTPException(422, 'Describe the next change.')
        current = await studio_current(app_id)
        if current['revision'] != body.revision:
            raise HTTPException(409, 'Draft revision changed. Reload before requesting changes.')
        try:
            files, manifest, digest = validate_bundle(body.files, body.manifest)
        except (ValueError, TypeError) as error:
            raise HTTPException(422, str(error)[:300]) from error
        allowed, message = await host.check_rate_limit(request, caller.user_jwt, caller.user_id)
        if not allowed:
            raise HTTPException(429, message)
        if not await host.fetch_user_api_key_by_id(caller.user_id, body.provider):
            raise HTTPException(412, f'Add your {body.provider} provider key before generating code.')
        from aistrix_platform.gateway import CallContext
        from aistrix_platform.errors import NodeError
        engine, _ = host.app.state.platform_parts()
        context = json.dumps({'instruction': body.instruction, 'files': files, 'file_hashes': {name: code_studio.file_hash(text) for name, text in files.items()}, 'manifest': manifest}, ensure_ascii=False)
        try:
            result = await asyncio.wait_for(engine.gateway.invoke(CallContext(caller.user_id, caller.workspace_id, f'CodeStudio/{app_id}', 1.0),
                model_ref='policy:balanced', providers=[body.provider], system=code_studio.SYSTEM, prompt=context, max_tokens=8192), timeout=120)
        except asyncio.TimeoutError as error:
            raise HTTPException(504, 'Code generation timed out. No source changes were applied.') from error
        except NodeError as error:
            raise HTTPException(422, error.message) from error
        if (await studio_current(app_id))['revision'] != body.revision:
            raise HTTPException(409, 'Draft revision changed during generation. No changes were applied; refresh and request a new proposal.')
        try:
            proposal = code_studio.apply_proposal(files, manifest, json.loads(result.text))
        except Exception as error:
            raise HTTPException(422, str(error)[:300] if isinstance(error, (ValueError, TypeError)) else 'The proposed files, schemas, or tests were invalid. No changes were applied.') from error
        return {'proposal': {**proposal, 'base_revision': body.revision, 'base_hash': digest}, 'usage': {'provider': result.provider, 'model': result.model, 'cost_usd': result.cost_usd}}

    @app.post('/v1/apps/{app_id}/code/preview', status_code=202)
    async def studio_preview(app_id: str, request: Request):
        caller, _ = await owner(app_id, request)
        require_enabled()
        body = await studio_body(request, StudioPreview, 69632)
        try:
            payload = validate_input(body.input)
        except (ValueError, TypeError) as error:
            raise HTTPException(422, 'Provide a finite JSON object of at most 64 KiB.') from error
        builds = await query(store().table('code_tasks').select('source_id').eq('app_id', app_id).eq('id', str(body.build_id)).eq('kind', 'build').eq('status', 'succeeded').limit(1))
        if not builds:
            raise HTTPException(409, 'Only a successful build can be previewed.')
        sources = await query(store().table('code_sources').select('files,manifest').eq('app_id', app_id).eq('id', builds[0]['source_id']).limit(1))
        if not sources:
            raise HTTPException(409, 'Source version not found.')
        try:
            code_studio.validate_data(sources[0]['files'], sources[0]['manifest'], payload, 'input')
        except Exception as error:
            raise HTTPException(422, str(error)[:300] if isinstance(error, ValueError) else 'The preview schema or test fixtures are invalid.') from error
        rows = await enqueue(app_id, caller.user_id, 'run', payload=payload, preview=str(body.build_id))
        return {'task': public_task(rows[0])}

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
        workers = await query(sb.table('code_workers').select('kind,executor').gt('seen_at', recent))
        enabled = os.getenv('CODE_APPS_ENABLED') == '1'
        selected = executor()
        ready = selected != 'e2b' or bool(os.getenv('E2B_API_KEY', '').strip())
        workers = [w for w in workers if w.get('executor', 'dedicated') == selected]
        builds = [b for b in builds if b.get('executor', 'dedicated') == selected]
        reason = None
        if selected == 'e2b':
            if not ready:
                reason = 'Add E2B_API_KEY to the backend environment to connect managed execution.'
            elif not enabled:
                reason = 'E2B is configured, but CODE_APPS_ENABLED is not enabled.'
            elif not workers:
                reason = 'Start the E2B coordinator to enable managed builds and previews.'
        deployment_matches = not deployments or (str(deployments[0].get('image', '')).startswith('e2b://') == (selected == 'e2b'))
        return {'source': sources[0] if sources else None, 'tasks': [public_task(row) for row in tasks],
                'builds': [public_task(row) for row in builds],
                'deployment': deployments[0] if deployments else None,
                'capabilities': {'enabled': enabled and ready, 'provider': selected, 'reason': reason,
                                 'build': enabled and ready and any(w['kind']=='build' for w in workers),
                                 'run': enabled and ready and any(w['kind']=='run' for w in workers), 'run_deployed': deployment_matches},
                'limits': {'daily_builds': 5, 'daily_runs': 100, 'active_jobs': 2,
                           **({'daily_reserved_sandbox_seconds': daily_seconds()} if selected == 'e2b' else {})},
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

    @app.post('/v1/apps/{app_id}/code/import')
    async def import_code(app_id: str, body: ImportCode, request: Request):
        """Import working code from GitHub as a new source version. Public
        repositories need nothing; private ones use the owner's GitHub
        connection. Nothing runs until the source is built."""
        caller, _ = await owner(app_id, request)
        try:
            src = code_import.parse_source(body.repo, body.ref, body.path)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        token = None
        try:
            row = await host._github_row(caller.user_id)
            if row and row.get('token_encrypted'):
                token = host._decrypt(row['token_encrypted'])
        except HTTPException:
            pass                     # no GitHub storage here: public repositories still import
        except Exception:
            token = None             # an unreadable token: try anonymously, GitHub will say if it's private
        try:
            data = await code_import.fetch_github(host.outbound.fetch_safely, src, token)
        except LookupError as error:
            raise HTTPException(404, str(error)) from error
        except PermissionError as error:
            raise HTTPException(403, str(error)) from error
        except ValueError as error:
            raise HTTPException(422, f'GitHub could not be reached: {str(error)[:200]}') from error
        except Exception as error:
            raise HTTPException(502, 'GitHub could not be reached. Try again shortly.') from error
        try:
            selection = code_import.select(data, src.path)
            bundle = code_import.bundle(selection)
        except ValueError as error:
            raise HTTPException(422, str(error)[:500]) from error
        saved = await source_save(app_id, caller.user_id, bundle)
        return {'source': saved, 'import': {
            'repo': f'{src.owner}/{src.repo}', 'ref': src.ref, 'path': src.path, 'commit': code_import.commit_of(selection.root),
            'private_access': bool(token), 'files': sorted(bundle[0]), 'skipped': selection.skipped,
            'manifest': bundle[1], 'requirements': [line for line in bundle[0].get('requirements.txt', '').splitlines()
                                                    if line.strip() and not line.strip().startswith('#')]}}

    @app.post('/v1/apps/{app_id}/code/builds', status_code=202)
    async def build_code_app(app_id: str, body: BuildCodeApp, request: Request):
        caller, _ = await owner(app_id, request)
        require_enabled()
        rows = await enqueue(app_id, caller.user_id, 'build', source=str(body.source_id))
        return {'task': public_task(rows[0])}

    @app.post('/v1/apps/{app_id}/code/deploy')
    async def deploy_code_app(app_id: str, body: DeployCodeApp, request: Request):
        caller, _ = await owner(app_id, request)
        require_enabled()
        builds = await query(store().table('code_tasks').select('executor').eq('app_id', app_id).eq('id', str(body.build_id)).limit(1))
        if builds and builds[0].get('executor', 'dedicated') != executor():
            raise HTTPException(409, 'Build with the selected execution provider before deploying.')
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
        rows = await enqueue(app_id, caller.user_id, 'run', payload=payload, expected=expected)
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
