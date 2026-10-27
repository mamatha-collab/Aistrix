"""Explicit, opt-in acceptance against dedicated staging workers and app.

Does not run when settings are absent. Does not provision hosts or execute
customer code on this machine. The token stays in the process environment.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from code_job_spec import SPEC, STARTER


def verify(api, token, app_id):
    with httpx.Client(base_url=api.rstrip('/'), headers={'Authorization':f'Bearer {token}'}, timeout=30, follow_redirects=False) as client:
        base = f'/v1/apps/{app_id}/code'

        def call(method, path, body=None):
            response = client.request(method,path,**({'json':body} if body is not None else {}))
            if not response.is_success:
                raise RuntimeError(f'Staging code API returned HTTP {response.status_code}; inspect the dedicated app in Developer.')
            return response.json()

        def wait(task):
            deadline = time.monotonic()+660
            while time.monotonic() < deadline:
                current = call('GET',f'{base}/tasks/{task["id"]}')['task']
                if current['status'] == 'succeeded':
                    return current
                if current['status'] not in ('queued','running'):
                    raise RuntimeError(f'Acceptance job ended as {current["status"]}; inspect its private logs.')
                time.sleep(3)
            raise RuntimeError('Acceptance timed out; inspect or cancel the staging job before retrying.')

        status = call('GET',base)
        if not all(status['capabilities'].get(key) for key in ('enabled','build','run')):
            raise RuntimeError('Both isolated workers must be available before running acceptance.')
        previous = status.get('deployment')
        deployed = None
        try:
            source = call('PUT',base+'/source',{'files':{'main.py':STARTER,'requirements.txt':''},'manifest':SPEC})['source']
            build = wait(call('POST',base+'/builds',{'source_id':source['id']})['task'])
            deployed = call('POST',base+'/deploy',{'build_id':build['id'],'expected_build_id':previous['build_id'] if previous else None})['deployment']
            run = wait(call('POST',base+'/runs',{'items':[{'quantity':2,'price':12.5}]})['task'])
            if run['result']['output'] != {'items_processed':1,'total':25.0}:
                raise RuntimeError('The deployed Python job did not produce the expected result.')
            return {'status':'build_deploy_run_passed','app_id':app_id,'build_id':build['id'],'run_id':run['id'],
                    'pending':['Isolation/resource exhaustion probes','Kill-worker recovery exercise','Registry/storage retention','Capacity and billing reconciliation']}
        finally:
            if previous and deployed:
                call('POST',base+'/deploy',{'build_id':previous['build_id'],'expected_build_id':deployed['build_id']})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-id', required=True, type=UUID, help='Existing code app owned by a dedicated staging test account.')
    parser.add_argument('--execute', action='store_true', help='Authorize one real staging build and one Python run; consumes resources and quotas.')
    args = parser.parse_args()
    api = os.getenv('CODE_ACCEPTANCE_API','')
    token = os.getenv('CODE_ACCEPTANCE_TOKEN','')
    url = urlsplit(api)
    if not args.execute or os.getenv('CODE_ACCEPTANCE_ENVIRONMENT') != 'staging' or not token or url.scheme != 'https' or not url.netloc or url.username or url.password or url.query or url.fragment:
        raise SystemExit('NOT RUN: configure staging HTTPS CODE_ACCEPTANCE_API, CODE_ACCEPTANCE_TOKEN and CODE_ACCEPTANCE_ENVIRONMENT=staging, then pass --execute for a dedicated test app.')
    try:
        print(json.dumps(verify(api,token,str(args.app_id)),indent=2))
    except Exception as error:
        # HTTP/SDK exceptions can contain headers or URL credentials; never echo them.
        raise SystemExit(str(error) if isinstance(error,RuntimeError) else 'Code-hosting acceptance failed. Inspect the dedicated staging app and worker logs.')
