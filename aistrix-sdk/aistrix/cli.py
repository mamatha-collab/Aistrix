"""Aistrix CLI — run AI apps from your terminal."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from .client import AistrixClient

app = typer.Typer(
    name="aistrix",
    help="Run and manage Aistrix AI apps from your terminal.",
    no_args_is_help=True,
)
console = Console()

CONFIG_PATH = Path.home() / ".aistrix" / "config.json"


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text())
    return {}


def _save_config(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def _client() -> AistrixClient:
    cfg = _load_config()
    api_url = cfg.get("api_url")
    token = cfg.get("token")
    if not api_url or not token:
        console.print("[red]Not configured.[/red] Run [bold]aistrix configure[/bold] first.")
        raise typer.Exit(1)
    return AistrixClient(api_url=api_url, token=token)


# ── configure ─────────────────────────────────────────────────────────────────

@app.command()
def configure(
    api_url: str = typer.Option(..., prompt="API URL (e.g. https://your-backend.railway.app)"),
    token: str = typer.Option(..., prompt="Bearer token (paste your Supabase JWT or API key)"),
):
    """Save API URL and auth token to ~/.aistrix/config.json."""
    _save_config({"api_url": api_url.rstrip("/"), "token": token})
    console.print(f"[green]✓ Saved config to {CONFIG_PATH}[/green]")


# ── apps ──────────────────────────────────────────────────────────────────────

@app.command()
def apps():
    """List your Aistrix apps."""
    client = _client()
    try:
        items = client.list_apps()
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(1)

    if not items:
        console.print("[dim]No apps found.[/dim]")
        return

    table = Table(show_header=True, header_style="bold cyan")
    table.add_column("ID", style="dim", width=36)
    table.add_column("Name")
    table.add_column("Model", style="dim")
    table.add_column("Updated", style="dim")

    for a in items:
        updated = (a.get("updated_at") or "")[:10]
        model = a.get("ai_model") or a.get("ai_provider") or "—"
        table.add_row(a["id"], a["name"], model, updated)

    console.print(table)


# ── run ───────────────────────────────────────────────────────────────────────

@app.command()
def run(
    app_id: str = typer.Argument(..., help="App ID to run (from `aistrix apps`)"),
    input_text: Optional[str] = typer.Option(None, "--input", "-i", help="Input text"),
    no_stream: bool = typer.Option(False, "--no-stream", help="Buffer output and print all at once"),
):
    """Run an app and stream its output."""
    if not input_text:
        if not sys.stdin.isatty():
            input_text = sys.stdin.read().strip()
        else:
            input_text = typer.prompt("Input")

    client = _client()
    try:
        for token in client.run(app_id, input_text, stream=not no_stream):
            if no_stream:
                console.print(token, end="")
            else:
                print(token, end="", flush=True)
        print()
    except RuntimeError as e:
        console.print(f"\n[red]Error:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"\n[red]Error:[/red] {e}")
        raise typer.Exit(1)


# ── version ───────────────────────────────────────────────────────────────────

@app.command()
def version():
    """Print the SDK version."""
    from . import __version__
    console.print(f"aistrix {__version__}")
