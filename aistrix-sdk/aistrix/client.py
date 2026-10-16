"""Aistrix Python client."""
from __future__ import annotations

import base64
import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Union

import httpx

DEFAULT_API_URL = "https://api.aistrix.com"
FileArg = Union[str, Path, "tuple[str, bytes]"]


# ── Errors ───────────────────────────────────────────────────────────────────

class AistrixError(Exception):
    """Base error. `status` is the HTTP status (or None for stream errors)."""

    def __init__(self, message: str, status: Optional[int] = None, errors: Optional[list[str]] = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.errors = errors or []

    def __str__(self) -> str:
        return f"{self.message}: {'; '.join(self.errors)}" if self.errors else self.message


class AuthenticationError(AistrixError):
    """401/403 — missing, invalid or revoked API key, or key not allowed for this app."""


class PaymentRequiredError(AistrixError):
    """402 — the app is paid and the key owner has no active purchase, or the quota is used up."""


class NotFoundError(AistrixError):
    """404 — app or batch doesn't exist, isn't published, or isn't yours."""


class ContractError(AistrixError):
    """422 — the input didn't match the app's fields, or the output failed its schema."""


class RateLimitError(AistrixError):
    """429 — platform rate limit reached. Add your own provider key in Aistrix to remove it."""


class APIError(AistrixError):
    """Any other failure (5xx, provider errors, timeouts)."""


_STATUS_ERRORS = {401: AuthenticationError, 402: PaymentRequiredError, 403: AuthenticationError,
                  404: NotFoundError, 413: ContractError, 415: ContractError, 422: ContractError,
                  429: RateLimitError}


def _error_from_response(resp: httpx.Response) -> AistrixError:
    try:
        body = resp.json()
    except ValueError:
        body = {"error": resp.text or resp.reason_phrase}
    detail = body.get("detail", body.get("error"))
    errors = body.get("errors") or []
    if isinstance(detail, dict):
        errors = detail.get("errors") or errors
        detail = detail.get("message")
    cls = _STATUS_ERRORS.get(resp.status_code, APIError)
    return cls(str(detail or f"HTTP {resp.status_code}"), resp.status_code, errors)


# ── Results ──────────────────────────────────────────────────────────────────

@dataclass
class RunResult:
    output: str
    """Raw model output."""
    data: Any = None
    """Parsed JSON for structured output formats (json/table/cards/key_value/chart), else None."""
    usage: Optional[dict] = None
    provider: Optional[str] = None
    model: Optional[str] = None


@dataclass
class Batch:
    id: str
    app_id: str
    status: str
    """queued | running | completed | completed_with_errors | stopped | cancelled | failed"""
    total: int
    completed: int
    failed: int
    progress: float
    stop_reason: Optional[str] = None
    warnings: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict, repr=False)

    @property
    def finished(self) -> bool:
        return self.status not in ("queued", "running")

    @classmethod
    def _from(cls, d: dict) -> "Batch":
        return cls(id=d["id"], app_id=d["app_id"], status=d["status"], total=d.get("total") or 0,
                   completed=d.get("completed") or 0, failed=d.get("failed") or 0,
                   progress=d.get("progress") or 0, stop_reason=d.get("stop_reason"),
                   warnings=d.get("warnings") or [], raw=d)


def _encode_file(file: FileArg) -> dict:
    if isinstance(file, tuple):
        name, content = file
    else:
        path = Path(file)
        name, content = path.name, path.read_bytes()
    return {"file_name": name, "content_b64": base64.b64encode(content).decode()}


# ── Client ───────────────────────────────────────────────────────────────────

class AistrixClient:
    """Client for the Aistrix developer API.

    >>> client = AistrixClient(api_key="ak_live_…")
    >>> client.run(APP_ID, fields={"company": "Acme"}).data

    `api_key` defaults to $AISTRIX_API_KEY and `api_url` to $AISTRIX_API_URL.
    A Supabase session JWT also works as `api_key`.
    """

    def __init__(self, api_key: Optional[str] = None, api_url: Optional[str] = None,
                 timeout: float = 120, *, token: Optional[str] = None):
        key = api_key or token or os.getenv("AISTRIX_API_KEY")
        if not key:
            raise AuthenticationError("Pass api_key= or set AISTRIX_API_KEY")
        self.api_url = (api_url or os.getenv("AISTRIX_API_URL") or DEFAULT_API_URL).rstrip("/")
        self.timeout = timeout
        self._http = httpx.Client(base_url=self.api_url, timeout=timeout,
                                  headers={"Authorization": f"Bearer {key}"})

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "AistrixClient":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            resp = self._http.request(method, path, **kwargs)
        except httpx.TimeoutException as e:
            raise APIError(f"Request timed out after {self.timeout}s") from e
        except httpx.HTTPError as e:
            raise APIError(f"Could not reach Aistrix at {self.api_url}: {e}") from e
        if resp.status_code >= 400:
            raise _error_from_response(resp)
        return resp

    # ── Apps ──────────────────────────────────────────────────────────────────

    def list_apps(self) -> list[dict]:
        """Apps you own (limited to the key's apps if the key is app-restricted)."""
        return self._request("GET", "/v1/apps").json()["apps"]

    def get_app(self, app_id: str) -> dict:
        """App metadata plus `parameters`, `input_schema` and `output_schema`."""
        return self._request("GET", f"/v1/apps/{app_id}").json()

    # ── Run ───────────────────────────────────────────────────────────────────

    @staticmethod
    def _run_payload(input: Optional[str], fields: Optional[dict], file: Optional[FileArg],
                     user_context: Optional[str], temperature: Optional[float], stream: bool) -> dict:
        if input is None and fields is None and file is None:
            raise ContractError("Pass input=, fields= or file=")
        payload: dict[str, Any] = {"stream": stream}
        if input is not None:
            payload["input"] = input
        if fields is not None:
            payload["fields"] = fields
        if file is not None:
            payload["file"] = _encode_file(file)
        if user_context is not None:
            payload["user_context"] = user_context
        if temperature is not None:
            payload["temperature"] = temperature
        return payload

    def run(self, app_id: str, input: Optional[str] = None, *, fields: Optional[dict] = None,
            file: Optional[FileArg] = None, user_context: Optional[str] = None,
            temperature: Optional[float] = None) -> RunResult:
        """Run an app and wait for the full result.

        `fields` must match the app's parameters (see `get_app(...)["parameters"]`).
        `file` is a path or `(file_name, bytes)`: PDF, XLSX, DOCX, CSV, TXT, JSON or MD.
        Large files are split, analysed and combined server-side.
        """
        payload = self._run_payload(input, fields, file, user_context, temperature, stream=False)
        body = self._request("POST", f"/v1/apps/{app_id}/run", json=payload).json()
        return RunResult(output=body.get("output", ""), data=body.get("data"), usage=body.get("usage"),
                         provider=body.get("provider"), model=body.get("model"))

    def stream(self, app_id: str, input: Optional[str] = None, *, fields: Optional[dict] = None,
               file: Optional[FileArg] = None, user_context: Optional[str] = None,
               temperature: Optional[float] = None) -> Iterator[str]:
        """Run an app and yield output text as it arrives. Raises on errors,
        including ContractError when a structured response fails its schema."""
        payload = self._run_payload(input, fields, file, user_context, temperature, stream=True)
        try:
            with self._http.stream("POST", f"/v1/apps/{app_id}/run", json=payload) as resp:
                if resp.status_code >= 400:
                    resp.read()
                    raise _error_from_response(resp)
                finished = False
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        ev = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    if "token" in ev:
                        yield ev["token"]
                    elif ev.get("done"):
                        finished = True
                    elif "contract_error" in ev:
                        raise ContractError("Output contract failed", 422, ev["contract_error"])
                    elif "error" in ev:
                        msg = ev["error"]
                        raise (RateLimitError if "rate limit" in msg.lower() else APIError)(msg)
                if not finished:
                    raise APIError("Stream ended before the run finished")
        except httpx.HTTPError as e:
            raise APIError(f"Stream failed: {e}") from e

    # ── Batches ───────────────────────────────────────────────────────────────

    def create_batch(self, app_id: str, rows: Optional[list[Union[str, dict]]] = None, *,
                     csv: Optional[str] = None, webhook_url: Optional[str] = None) -> Batch:
        """Queue many inputs; they run server-side. Each row is a string
        (input) or a dict of fields. Or pass `csv=` text with a header row.
        Check `batch.warnings` for quota limits that will stop the batch early."""
        body: dict[str, Any] = {}
        if rows is not None:
            body["rows"] = [{"input": r} if isinstance(r, str) else {"fields": r} for r in rows]
        if csv is not None:
            body["csv"] = csv
        if webhook_url:
            body["webhook_url"] = webhook_url
        return Batch._from(self._request("POST", f"/v1/apps/{app_id}/batches", json=body).json())

    def get_batch(self, batch_id: str) -> Batch:
        return Batch._from(self._request("GET", f"/v1/batches/{batch_id}").json())

    def list_batches(self, limit: int = 20) -> list[Batch]:
        data = self._request("GET", "/v1/batches", params={"limit": limit}).json()
        return [Batch._from(b) for b in data["batches"]]

    def wait_for_batch(self, batch_id: str, *, poll_interval: float = 3, timeout: Optional[float] = None,
                       on_progress=None) -> Batch:
        """Poll until the batch finishes. `on_progress(batch)` is called on each poll."""
        deadline = time.monotonic() + timeout if timeout else None
        while True:
            batch = self.get_batch(batch_id)
            if on_progress:
                on_progress(batch)
            if batch.finished:
                return batch
            if deadline and time.monotonic() > deadline:
                raise APIError(f"Batch {batch_id} still {batch.status} after {timeout}s")
            time.sleep(poll_interval)

    def batch_results(self, batch_id: str, *, page_size: int = 200) -> Iterator[dict]:
        """Yield every row: {idx, input, status, output, data, error, input_tokens, output_tokens}."""
        offset = 0
        while True:
            page = self._request("GET", f"/v1/batches/{batch_id}/results",
                                 params={"offset": offset, "limit": page_size}).json()
            rows = page["rows"]
            yield from rows
            if len(rows) < page_size:
                return
            offset += page_size

    def batch_results_csv(self, batch_id: str) -> str:
        return self._request("GET", f"/v1/batches/{batch_id}/results", params={"format": "csv"}).text

    def cancel_batch(self, batch_id: str) -> Batch:
        return Batch._from(self._request("POST", f"/v1/batches/{batch_id}/cancel").json())

    def retry_batch(self, batch_id: str) -> Batch:
        """Re-run rows that failed or never ran (e.g. after a rate-limit stop)."""
        return Batch._from(self._request("POST", f"/v1/batches/{batch_id}/retry").json())

    # ── Account ───────────────────────────────────────────────────────────────

    def usage(self) -> dict:
        """Remaining platform runs this hour/day and which provider keys you've added."""
        return self._request("GET", "/v1/usage").json()
