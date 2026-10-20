"""Durable outcomes: retries, crash replay, idempotency and scoped health."""
import asyncio
import json
import time
import uuid
from types import SimpleNamespace as NS
import _harness
from _harness import ok, finish
_harness.setup()
import main
from telemetry import RunOutbox

sent = {}
state = {'offline': True, 'ack_lost': False}
class Q:
    def upsert(self, row, on_conflict, ignore_duplicates):
        assert on_conflict == 'event_id' and ignore_duplicates
        self.row = dict(row)
        return self
    def execute(self):
        if state['offline']: raise ConnectionError('SIMULATED SECRET DATABASE ERROR')
        sent.setdefault(self.row['event_id'], self.row)
        if state['ack_lost']:
            state['ack_lost'] = False
            raise ConnectionError('Acknowledgement lost after commit')
        return NS(data=[])
main._service_client = lambda: NS(table=lambda _: Q())
main._telemetry_service_client = main._service_client
outbox = main._telemetry_outbox
event = str(uuid.uuid4())
start = {'event_id': event, 'app_id': 'mine', 'source': 'app', 'created_at': '2026-10-19T10:00:00Z'}
outbox.begin(start)
asyncio.run(main._log_app_run('mine', None, 'app', {'input_tokens': 1, 'output_tokens': 2}, event_id=event, created_at=start['created_at'], latency_ms=120))
ok('outcomes remain durable through a database outage', outbox.health(['mine'], 1)['pending'] == 1 and len(sent) == 0)
with outbox.connection() as con:
    payload = con.execute('select payload from outcomes where id=?', (event,)).fetchone()[0]
    con.execute('update outcomes set next_attempt=0')
ok('outbox contains only telemetry, no customer content', 'input"' not in payload and 'output"' not in payload and 'SIMULATED SECRET' not in payload)
main._telemetry_outbox = RunOutbox(outbox.path)
state['offline'] = False
state['ack_lost'] = True
asyncio.run(main._flush_telemetry())
ok('lost acknowledgement retains the committed event for retry', len(sent) == 1 and main._telemetry_outbox.health(['mine'], 1)['pending'] == 1)
with outbox.connection() as con: con.execute('update outcomes set next_attempt=0')
asyncio.run(main._flush_telemetry())
ok('restart replay does not duplicate committed runs', len(sent) == 1 and main._telemetry_outbox.health(['mine'], 1)['pending'] == 0)
ok('original event time survives replay', sent[event]['created_at'] == start['created_at'])

interrupted = {**start, 'event_id': str(uuid.uuid4())}
outbox.begin(interrupted)
with outbox.connection() as con: con.execute('update outcomes set started=? where id=?', (time.time() - 10000, interrupted['event_id']))
ok('stale in-flight runs surface before recovery', outbox.health(['mine'], 10)['pending'] == 1)
asyncio.run(main._flush_telemetry())
recovered = sent[interrupted['event_id']]
ok('a crashed run recovers as interrupted, with no invented latency', recovered['status'] == 'error' and recovered['error_kind'] == 'interrupted' and recovered['latency_ms'] is None)
foreign = {**start, 'app_id': 'theirs', 'event_id': str(uuid.uuid4())}
outbox.begin(foreign); outbox.finish({**foreign, 'status': 'ok'})
ok('health does not disclose another app queue', outbox.health(['mine'], 1)['pending'] == 0 and outbox.health(['theirs'], 1)['pending'] == 1)
outbox.finish({**foreign, 'status': 'error'})
with outbox.connection() as con: row = json.loads(con.execute('select payload from outcomes where id=?', (foreign['event_id'],)).fetchone()[0])
ok('finalized outcomes cannot be overwritten by racing cancellation', row['status'] == 'ok')
from concurrent.futures import ThreadPoolExecutor
def concurrent_outcome(i):
    row = {**start, 'app_id': 'bulk', 'event_id': str(uuid.uuid4()), 'status': 'ok'}
    outbox.begin(row); outbox.finish(row)
with ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(concurrent_outcome, range(120)))
ok('concurrent local writers retain every outcome', outbox.health(['bulk'], 1)['pending'] == 120)
for _ in range(4): asyncio.run(main._flush_telemetry())
ok('bounded recovery batches drain the queue without duplicate deliveries', outbox.health(['bulk'], 1)['pending'] == 0
   and len([r for r in sent.values() if r['app_id'] == 'bulk']) == 120)
try:
    RunOutbox(outbox.path, project='a-different-project.invalid').health(['mine'], 1)
    ok('a recovery queue cannot be replayed into a different database project', False)
except RuntimeError:
    ok('a recovery queue cannot be replayed into a different database project', True)
finish()
