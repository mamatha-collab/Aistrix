"""Aistrix CLI — run AI apps from your terminal."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import List, Optional

import typer
from rich.console import Console
from rich.table import Table

from .client import AistrixClient, AistrixError

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
    return AistrixClient(api_key=token, api_url=api_url)


def _fail(e: Exception) -> None:
    console.print(f"\n[red]Error:[/red] {e}")
    raise typer.Exit(1)


# ── configure ─────────────────────────────────────────────────────────────────

@app.command()
def configure(
    api_url: str = typer.Option(..., prompt="API URL (e.g. https://your-backend.railway.app)"),
    token: str = typer.Option(..., prompt="API key (ak_live_…)", hide_input=True),
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

def _parse_fields(pairs: Optional[List[str]]) -> Optional[dict]:
    if not pairs:
        return None
    out = {}
    for pair in pairs:
        if "=" not in pair:
            console.print(f"[red]--field must be key=value, got:[/red] {pair}")
            raise typer.Exit(1)
        k, v = pair.split("=", 1)
        try:
            out[k] = json.loads(v)       # numbers, booleans, lists
        except json.JSONDecodeError:
            out[k] = v
    return out


@app.command()
def run(
    app_id: str = typer.Argument(..., help="App ID to run (from `aistrix apps`)"),
    input_text: Optional[str] = typer.Option(None, "--input", "-i", help="Input text"),
    field: Optional[List[str]] = typer.Option(None, "--field", "-f", help="App parameter as key=value (repeatable)"),
    file: Optional[Path] = typer.Option(None, "--file", help="PDF / XLSX / DOCX / CSV / TXT file to send"),
    no_stream: bool = typer.Option(False, "--no-stream", help="Wait for the full result"),
    as_json: bool = typer.Option(False, "--json", help="Print the parsed JSON result (structured apps)"),
):
    """Run an app."""
    fields = _parse_fields(field)
    if not input_text and fields is None and file is None:
        input_text = sys.stdin.read().strip() if not sys.stdin.isatty() else typer.prompt("Input")
    client = _client()
    try:
        if no_stream or as_json:
            result = client.run(app_id, input_text, fields=fields, file=file)
            print(json.dumps(result.data, indent=2) if as_json and result.data is not None else result.output)
        else:
            for token in client.stream(app_id, input_text, fields=fields, file=file):
                print(token, end="", flush=True)
            print()
    except AistrixError as e:
        _fail(e)


# ── batch ─────────────────────────────────────────────────────────────────────

@app.command()
def batch(
    app_id: str = typer.Argument(..., help="App ID"),
    csv_file: Path = typer.Argument(..., help="CSV with a header row (one run per data row)"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Write results CSV here"),
    no_wait: bool = typer.Option(False, "--no-wait", help="Queue and print the batch id only"),
):
    """Run every row of a CSV through an app (server-side batch)."""
    client = _client()
    try:
        b = client.create_batch(app_id, csv=csv_file.read_text(encoding="utf-8-sig"))
        for w in b.warnings:
            console.print(f"[yellow]⚠ {w}[/yellow]")
        console.print(f"Batch [bold]{b.id}[/bold] queued — {b.total} rows")
        if no_wait:
            return
        b = client.wait_for_batch(b.id, on_progress=lambda x: console.print(
            f"  {x.status}: {x.completed} done, {x.failed} failed / {x.total}", end="\r"))
        console.print()
        color = "green" if b.status == "completed" else "yellow"
        console.print(f"[{color}]{b.status}[/{color}] — {b.completed} done, {b.failed} failed"
                      + (f" — {b.stop_reason}" if b.stop_reason else ""))
        if out:
            out.write_text(client.batch_results_csv(b.id), encoding="utf-8")
            console.print(f"Results written to {out}")
        if b.status == "stopped":
            console.print(f"Resume later with: aistrix batch-retry {b.id}")
    except AistrixError as e:
        _fail(e)


@app.command("batch-retry")
def batch_retry(batch_id: str = typer.Argument(...)):
    """Re-run rows of a batch that failed or never ran."""
    try:
        b = _client().retry_batch(batch_id)
        console.print(f"Batch {b.id} re-queued ({b.status})")
    except AistrixError as e:
        _fail(e)


# ── usage ─────────────────────────────────────────────────────────────────────

@app.command()
def usage():
    """Show remaining platform runs."""
    try:
        u = _client().usage()
    except AistrixError as e:
        _fail(e)
    console.print(f"This hour: {u['hourly']['used']}/{u['hourly']['limit']} · today: {u['daily']['used']}/{u['daily']['limit']}")
    console.print(f"Own provider keys: {', '.join(u['own_provider_keys']) or 'none'} (runs on those providers are unlimited)")


# ── version ───────────────────────────────────────────────────────────────────

@app.command()
def version():
    """Print the SDK version."""
    from . import __version__
    console.print(f"aistrix {__version__}")
