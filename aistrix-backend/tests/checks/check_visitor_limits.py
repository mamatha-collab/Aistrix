"""Shared visitor-limit RPC contract, privacy and fail-closed behaviour."""
import asyncio
from types import SimpleNamespace as NS
import _harness
from _harness import ok, finish
_harness.setup()
import main
from fastapi import HTTPException
calls=[]
class Fake:
    def rpc(self,name,args):
        calls.append((name,args)); return self
    def execute(self): return NS(data=True)
main._visitor_limit_client=lambda:Fake()
ok('shared database RPC is used', asyncio.run(main.check_anon_rate_limit('192.0.2.1'))[0])
ok('raw visitor IP never enters the database call', '192.0.2.1' not in str(calls) and len(calls[0][1]['p_bucket'])==64)
first=calls[0][1]['p_bucket']
asyncio.run(main.check_anon_rate_limit('192.0.2.1'))
ok('different API clients derive the same bucket', calls[-1][1]['p_bucket']==first)
asyncio.run(main.check_embed_visitor_rate_limit('192.0.2.1','app1'))
a=calls[-1][1]['p_bucket']
asyncio.run(main.check_embed_visitor_rate_limit('192.0.2.1','app2'))
ok('embed apps and anonymous access have independent buckets', len({first,a,calls[-1][1]['p_bucket']})==3)
class Denied(Fake):
    def execute(self): return NS(data=False)
main._visitor_limit_client=lambda:Denied()
ok('global exhaustion returns the limit message', not asyncio.run(main.check_anon_rate_limit('192.0.2.1'))[0])
class Broken(Fake):
    def execute(self): raise RuntimeError('database down with sensitive context')
for source in [lambda:Broken(),lambda:None]:
    main._visitor_limit_client=source
    try:
        asyncio.run(main.check_anon_rate_limit('192.0.2.1')); ok('outage refuses access',False)
    except HTTPException as error:
        ok('outage refuses access without leaking infrastructure details',error.status_code==503 and 'sensitive' not in error.detail)
finish()
