"""E2B coordinator heartbeat and logging. Fakes only: no Supabase, no E2B."""
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from e2b_worker import Coordinator, describe


class FakeQuery:
    def __init__(self, client):
        self.client = client
    def upsert(self, row): return self
    def delete(self): return self
    def eq(self, *a): return self
    def execute(self):
        self.client.calls += 1
        if self.client.down():
            raise ConnectionError("Server disconnected without sending a response.")
        return self


class FakeRpc:
    def __init__(self, value): self.data = value
    def execute(self): return self


class FakeClient:
    """Storage that is unreachable while down() is true."""
    def __init__(self, down=lambda: False, heartbeat=True):
        self.down, self.heartbeat, self.calls = down, heartbeat, 0
    def table(self, name): return FakeQuery(self)
    def rpc(self, name, params):
        if self.down():
            raise ConnectionError("Server disconnected without sending a response.")
        return FakeRpc(self.heartbeat if name == "heartbeat_code_task" else None)


class FakeRuntime:
    def __init__(self): self.cancels = 0
    def cancel(self): self.cancels += 1


def run_keeper(coordinator, seconds):
    keeper = threading.Thread(target=coordinator.keep_alive, daemon=True)
    keeper.start()
    time.sleep(seconds)
    coordinator.stopping.set()
    keeper.join(2)


def test_describe_keeps_the_error_and_redacts_tokens():
    text = describe(RuntimeError("401 for key eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0 sent"))
    assert text.startswith("RuntimeError: 401 for key [redacted] sent")
    assert "eyJ" not in text
    assert describe(ConnectionError()) == "ConnectionError"


def test_a_short_outage_does_not_cancel_the_running_job(capsys):
    start = time.monotonic()
    client = FakeClient(down=lambda: time.monotonic() - start < 0.15)   # down for 0.15s
    runtime = FakeRuntime()
    c = Coordinator(client, runtime, beat_seconds=0.03, lost_after=0.5)
    c.task = {"id": "job", "lease_token": "t"}
    run_keeper(c, 0.4)
    out = capsys.readouterr().out
    assert not c.cancelled.is_set() and runtime.cancels == 0
    assert "Heartbeat failed (ConnectionError: Server disconnected" in out and "Heartbeat restored" in out


def test_a_long_outage_stops_the_job_before_the_lease_runs_out(capsys):
    client = FakeClient(down=lambda: True)
    runtime = FakeRuntime()
    c = Coordinator(client, runtime, beat_seconds=0.03, lost_after=0.15)
    c.task = {"id": "job", "lease_token": "t"}
    run_keeper(c, 0.35)
    assert c.cancelled.is_set() and runtime.cancels >= 1
    assert "stopping the job before its lease runs out" in capsys.readouterr().out


def test_an_idle_outage_only_logs():
    client = FakeClient(down=lambda: True)
    runtime = FakeRuntime()
    c = Coordinator(client, runtime, beat_seconds=0.03, lost_after=0.05)
    run_keeper(c, 0.2)
    assert not c.cancelled.is_set() and runtime.cancels == 0


def test_a_refused_heartbeat_stops_the_job_at_once(capsys):
    client = FakeClient(heartbeat=False)
    runtime = FakeRuntime()
    c = Coordinator(client, runtime, beat_seconds=0.03, lost_after=10)
    c.task = {"id": "job", "lease_token": "t"}
    run_keeper(c, 0.15)
    assert c.cancelled.is_set() and runtime.cancels >= 1
    assert "refused the job heartbeat" in capsys.readouterr().out
