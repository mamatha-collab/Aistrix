"""Durable, content-free run outcomes, retried until acknowledged by Postgres.

Mount the configured directory on persistent local storage in production. Each
replica must retain its own volume across restarts; SQLite WAL is not for NFS.
Database event IDs make concurrent/replayed deliveries safe.
"""
import json
import os
import sqlite3
import time
import hashlib
from urllib.parse import urlparse
from contextlib import contextmanager
from pathlib import Path


class RunOutbox:
    def __init__(self, path, project=None):
        self.path = Path(path)
        self.project = project

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        con = sqlite3.connect(self.path, timeout=5)
        try:
            con.execute('pragma journal_mode=WAL')
            con.execute('pragma synchronous=FULL')
            con.execute('create table if not exists outbox_meta (key text primary key, value text not null)')
            if self.project:
                with con:
                    con.execute("insert or ignore into outbox_meta(key,value) values('project',?)", (self.project,))
                project = con.execute("select value from outbox_meta where key='project'").fetchone()[0]
                if project != self.project:
                    raise RuntimeError('Recovery queue belongs to a different database project')
            con.execute('''create table if not exists outcomes (
                id text primary key, app_id text not null, payload text not null,
                started real not null, finished integer not null default 0,
                attempts integer not null default 0, next_attempt real not null default 0)''')
            with con:
                yield con
        finally:
            con.close()

    def begin(self, row):
        with self.connection() as con:
            con.execute('insert into outcomes(id,app_id,payload,started) values(?,?,?,?)',
                        (row['event_id'], row['app_id'], json.dumps(row), time.time()))

    def finish(self, row):
        with self.connection() as con:
            # An outcome is immutable once finalized; racing cancellation must
            # never replace an already completed run with an interrupted one.
            # Inserts when begin() didn't reach the disk (storage was down then).
            con.execute('''insert into outcomes(id,app_id,payload,started,finished) values(?,?,?,?,1)
                           on conflict(id) do update set payload=excluded.payload, finished=1, next_attempt=0
                           where outcomes.finished=0''',
                        (row['event_id'], row['app_id'], json.dumps(row), time.time()))

    def due(self, stale_seconds, batch=50):
        now = time.time()
        with self.connection() as con:
            stale = con.execute('select id,payload,started from outcomes where finished=0 and started<? limit ?', (now - stale_seconds, batch)).fetchall()
            for id_, raw, started in stale:
                row = json.loads(raw)
                row.update(status='error', error_kind='interrupted', latency_ms=None)
                con.execute('update outcomes set payload=?,finished=1 where id=? and finished=0', (json.dumps(row), id_))
            return [(id_, json.loads(raw), attempts) for id_, raw, attempts in con.execute(
                'select id,payload,attempts from outcomes where finished=1 and next_attempt<=? order by started limit ?', (now, batch)).fetchall()]

    def acknowledged(self, id_):
        with self.connection() as con:
            con.execute('delete from outcomes where id=? and finished=1', (id_,))

    def failed(self, id_, attempts):
        with self.connection() as con:
            con.execute('update outcomes set attempts=attempts+1,next_attempt=? where id=?',
                        (time.time() + min(300, 2 ** min(attempts + 1, 8)), id_))

    def health(self, app_ids, stale_seconds):
        if not app_ids:
            return {'status': 'ok', 'pending': 0, 'failed': 0}
        with self.connection() as con:
            marks = ','.join('?' for _ in app_ids)
            pending, failed, oldest = con.execute(f'''select count(*),coalesce(sum(attempts>0),0),min(started)
                from outcomes where app_id in ({marks}) and (finished=1 or started<?)''',
                [*app_ids, time.time() - stale_seconds]).fetchone()
        return {'status': 'delayed' if pending else 'ok', 'pending': pending, 'failed': failed,
                'oldest_pending_seconds': max(0, int(time.time() - oldest)) if oldest else None}


def configured_outbox():
    project = urlparse(os.getenv('SUPABASE_URL') or '').hostname or 'unconfigured'
    directory = hashlib.sha256(project.encode()).hexdigest()[:12]
    return RunOutbox(os.getenv('TELEMETRY_OUTBOX_PATH') or Path(__file__).parent / '.data' / directory / 'run-outbox.sqlite3', project=project)
