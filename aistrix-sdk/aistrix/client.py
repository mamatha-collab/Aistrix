"""Aistrix Python client."""
from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx


class AistrixClient:
    """Thin wrapper around the Aistrix REST API."""

    def __init__(self, api_url: str, token: str, timeout: int = 120):
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    # ── Apps ──────────────────────────────────────────────────────────────────

    def list_apps(self) -> list[dict]:
        """Return all apps owned by the authenticated user."""
        with httpx.Client(timeout=self.timeout) as c:
            r = c.get(f"{self.api_url}/apps", headers=self._headers)
            r.raise_for_status()
            return r.json()["apps"]

    def get_app(self, app_id: str) -> dict:
        """Return a single app by ID."""
        with httpx.Client(timeout=self.timeout) as c:
            r = c.get(f"{self.api_url}/apps/{app_id}", headers=self._headers)
            r.raise_for_status()
            return r.json()

    # ── Run ───────────────────────────────────────────────────────────────────

    def run(
        self,
        app_id: str,
        input_text: str,
        *,
        system_prompt: str | None = None,
        ai_provider: str | None = None,
        ai_model: str | None = None,
        stream: bool = True,
    ) -> Iterator[str]:
        """
        Run an app and yield output tokens as they arrive.

        If ``stream=False`` the full output string is yielded as a single item.
        """
        app = self.get_app(app_id)
        payload: dict[str, Any] = {
            "input": input_text,
            "system_prompt": system_prompt or app.get("system_prompt", ""),
            "ai_provider": ai_provider or app.get("ai_provider", "claude"),
            "ai_model": ai_model or app.get("ai_model"),
        }

        with httpx.Client(timeout=self.timeout) as c:
            with c.stream(
                "POST",
                f"{self.api_url}/run",
                headers=self._headers,
                json=payload,
            ) as resp:
                resp.raise_for_status()
                buf = ""
                full = ""
                for raw in resp.iter_text():
                    buf += raw
                    lines = buf.split("\n")
                    buf = lines.pop()
                    for line in lines:
                        if not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        if data.get("error"):
                            raise RuntimeError(data["error"])
                        token = data.get("token", "")
                        if token:
                            if stream:
                                yield token
                            else:
                                full += token
                if not stream and full:
                    yield full
