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


# ── platform: specs, releases, environments, evals, runs ─────────────────────

spec_app = typer.Typer(help="Check resource specs before releasing them.", no_args_is_help=True)
runs_app = typer.Typer(help="Follow and control platform runs.", no_args_is_help=True)
secrets_app = typer.Typer(help="Secrets a resource declares in policies.secrets.", no_args_is_help=True)
app.add_typer(spec_app, name="spec")
app.add_typer(runs_app, name="runs")
app.add_typer(secrets_app, name="secrets")

STAGES = ("dev", "staging", "production")


def _print_problems(problems: list) -> None:
    for p in problems:
        console.print(f"  [red]✗[/red] {p.get('path') or '(root)'}: {p.get('message')}")


def _print_json(value) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def _read_input(value: Optional[str]):
    """--input: a .json file, '-' for stdin, or inline JSON."""
    if value is None:
        raise typer.BadParameter("Give --input as a .json file, - for stdin, or inline JSON")
    text = sys.stdin.read() if value == "-" else Path(value).read_text(encoding="utf-8") if value.endswith(".json") else value
    try:
        return json.loads(text)
    except ValueError as e:
        raise typer.BadParameter(f"Input isn't valid JSON: {e}")


def _stage(env: str) -> str:
    if env not in STAGES:
        raise typer.BadParameter(f"--env is one of {', '.join(STAGES)}")
    return env


def _show_run(run: dict) -> None:
    color = {"succeeded": "green", "waiting_approval": "yellow", "running": "cyan", "queued": "cyan"}.get(run["status"], "red")
    console.print(f"Run [bold]{run['id']}[/bold] [{color}]{run['status']}[/{color}]  cost ${run.get('cost_usd', 0):.4f}")
    for nid, step in run.get("steps", {}).items():
        extra = f" — {step['error']}" if step.get("error") else (f" — {step['reason']}" if step.get("reason") else "")
        console.print(f"  {nid}: {step['status']}{extra}")
    if run.get("error"):
        console.print(f"[red]{run['error']}[/red]")
    waiting = [n for n, s in run.get("steps", {}).items() if s["status"] == "waiting_approval"]
    for nid in waiting:
        console.print(f"Approve with: aistrix runs approve {run['id']} {nid}   (or --reject)")
    if run.get("output") is not None:
        _print_json(run["output"])


@spec_app.command("validate")
def spec_validate(file: Path = typer.Argument(..., help="Spec file (.yaml or .json)")):
    """Check a spec against the resource schema."""
    try:
        result = _client().validate_spec(file)
    except AistrixError as e:
        _fail(e)
    if result["valid"]:
        console.print(f"[green]✓ {result['ref']}[/green]  sha256 {result['contentHash'][:12]}…")
    else:
        console.print(f"[red]{file} has {len(result['problems'])} problem(s):[/red]")
        _print_problems(result["problems"])
        raise typer.Exit(1)


@spec_app.command("plan")
def spec_plan(file: Path = typer.Argument(...), workload: Optional[str] = typer.Option(None, "--workload", "-w"),
              as_json: bool = typer.Option(False, "--json", help="Print the full plans")):
    """Compile a spec: node order, typed edges, policies and surfaces."""
    try:
        result = _client().plan_spec(file, workload=workload)
    except AistrixError as e:
        _fail(e)
    if result["problems"]:
        console.print("[red]The spec doesn't compile:[/red]")
        _print_problems(result["problems"])
        raise typer.Exit(1)
    if as_json:
        _print_json(result["plans"])
        return
    for name, plan in result["plans"].items():
        console.print(f"[bold]{name}[/bold]  plan {plan['planId'][:12]}…  budget/run "
                      f"{'$%.2f' % plan['policies']['budgetUsd'] if plan['policies']['budgetUsd'] else 'none'}")
        for nid in plan["order"]:
            node = plan["nodes"][nid]
            flags = " [yellow](outside effect)[/yellow]" if node["sideEffect"] else ""
            console.print(f"  {nid}: {node['use']}{flags}")
        surfaces = plan["surfaces"]
        console.print(f"  surfaces: {', '.join(surfaces['granted']) or 'none'}")
        for refused in surfaces["refused"]:
            console.print(f"  [yellow]not exposed: {refused['surface']} — {refused['reason']}[/yellow]")


@app.command()
def release(file: Path = typer.Argument(..., help="Spec file"),
            promote: Optional[str] = typer.Option(None, "--promote", "-p", help="Also point this environment at it")):
    """Release a spec at its metadata.version (immutable)."""
    try:
        result = _client().release(file, promote=_stage(promote) if promote else None)
    except AistrixError as e:
        _fail(e)
    rel = result["release"]
    console.print(f"[green]✓ Released {rel['ref']}[/green]")
    if result.get("environment"):
        console.print(f"  {result['environment']['stage']} → {result['environment']['version']}")


@app.command()
def promote(resource: str = typer.Argument(..., help="Kind/namespace/name"), version: str = typer.Argument(...),
            env: str = typer.Option(..., "--env", "-e", help="dev, staging or production")):
    """Point an environment at a released version."""
    try:
        e = _client().promote(resource, version, _stage(env))
    except AistrixError as err:
        _fail(err)
    console.print(f"[green]✓ {env} → {e['version']}[/green]")


@app.command()
def rollback(resource: str = typer.Argument(..., help="Kind/namespace/name"),
             env: str = typer.Option(..., "--env", "-e")):
    """Return an environment to its previous release."""
    try:
        e = _client().rollback(resource, _stage(env))
    except AistrixError as err:
        _fail(err)
    console.print(f"[green]✓ {env} → {e['version']}[/green]")


@app.command("eval")
def run_eval(suite: str = typer.Argument(..., help="EvalSuite/namespace/name@version")):
    """Run a released eval suite against its target release (calls real models)."""
    try:
        result = _client().run_eval(suite)
    except AistrixError as e:
        _fail(e)
    for case in result["cases"]:
        mark = "[green]✓[/green]" if case["passed"] else "[red]✗[/red]"
        console.print(f"  {mark} {case['name']}")
        for f in case["failures"]:
            console.print(f"      {f}")
    color = "green" if result["passed"] else "red"
    console.print(f"[{color}]{result['pass_rate']:.0%} passed (needs {result['required']:.0%})[/{color}]  cost ${result['cost_usd']:.4f}")
    if not result["passed"]:
        raise typer.Exit(1)


@app.command()
def invoke(application: str = typer.Argument(..., help="namespace/name of an Application"),
           input_value: Optional[str] = typer.Option(None, "--input", "-i", help=".json file, - for stdin, or inline JSON"),
           env: str = typer.Option("production", "--env", "-e"),
           version: Optional[str] = typer.Option(None, "--version", help="Run this release instead of the environment's"),
           workload: Optional[str] = typer.Option(None, "--workload", "-w"),
           stream: bool = typer.Option(False, "--stream", help="Show steps and tokens as they happen")):
    """Run an Application release and print its result."""
    payload = _read_input(input_value)
    client = _client()
    try:
        if stream:
            for event in client.invoke_stream(application, payload, workload=workload, environment=_stage(env), version=version):
                kind = event.get("type")
                if kind == "node.token":
                    print(event["data"]["text"], end="", flush=True)
                elif kind in ("node.started", "node.finished", "node.skipped", "node.retrying", "run.waiting"):
                    console.print(f"\n[dim]{kind} {event.get('node') or ''}[/dim]")
                elif kind == "run.state":
                    print()
                    _show_run(event["data"])
            return
        run_record = client.invoke(application, payload, workload=workload, environment=_stage(env), version=version)
    except AistrixError as e:
        _fail(e)
    _show_run(run_record)
    if run_record["status"] not in ("succeeded", "waiting_approval"):
        raise typer.Exit(1)


@app.command()
def nodes():
    """List the pipeline node types."""
    try:
        catalog = _client().nodes()
    except AistrixError as e:
        _fail(e)
    table = Table("Node", "Accepts", "Returns", "Outside effect", "What it does")
    for n in catalog["nodes"]:
        table.add_row(n["use"], ", ".join(n["accepts"]), n["output"], n["sideEffect"], n["summary"])
    console.print(table)


@runs_app.command("list")
def runs_list(resource: Optional[str] = typer.Option(None, "--resource", "-r", help="Kind/namespace/name"),
              limit: int = typer.Option(20, "--limit")):
    try:
        rows = _client().list_runs(resource, limit)
    except AistrixError as e:
        _fail(e)
    table = Table("Run", "Resource", "Status", "Created")
    for r in rows:
        table.add_row(r["id"], r["resource_key"], r["status"], r["created_at"])
    console.print(table)


@runs_app.command("show")
def runs_show(run_id: str):
    try:
        _show_run(_client().get_run(run_id))
    except AistrixError as e:
        _fail(e)


@runs_app.command("events")
def runs_events(run_id: str, after: int = typer.Option(0, "--after")):
    try:
        for e in _client().run_events(run_id, after):
            console.print(f"{e['seq']:>5} {e['at']} {e['type']} {e.get('node') or ''}")
    except AistrixError as e:
        _fail(e)


@runs_app.command("approve")
def runs_approve(run_id: str, node: str, reject: bool = typer.Option(False, "--reject"),
                 note: str = typer.Option("", "--note")):
    """Approve (or reject) a step that's waiting for a person."""
    try:
        _show_run(_client().approve(run_id, node, approved=not reject, note=note, wait=True))
    except AistrixError as e:
        _fail(e)


@runs_app.command("cancel")
def runs_cancel(run_id: str):
    try:
        _show_run(_client().cancel_run(run_id))
    except AistrixError as e:
        _fail(e)


@runs_app.command("resume")
def runs_resume(run_id: str):
    """Continue a run whose worker stopped; finished steps aren't repeated."""
    try:
        _show_run(_client().resume_run(run_id))
    except AistrixError as e:
        _fail(e)


@secrets_app.command("set")
def secrets_set(resource: str = typer.Argument(..., help="Kind/namespace/name"), name: str = typer.Argument(...),
                value: str = typer.Option(..., prompt=True, hide_input=True)):
    try:
        s = _client().set_secret(resource, name, value)
    except AistrixError as e:
        _fail(e)
    console.print(f"[green]✓ {s['key']} saved (…{s['last4']})[/green]")


@secrets_app.command("list")
def secrets_list(resource: str = typer.Argument(...)):
    try:
        for s in _client().list_secrets(resource):
            console.print(f"{s['key']}  …{s.get('last4') or ''}  {s.get('updated_at') or ''}")
    except AistrixError as e:
        _fail(e)


@secrets_app.command("delete")
def secrets_delete(resource: str = typer.Argument(...), name: str = typer.Argument(...)):
    try:
        _client().delete_secret(resource, name)
    except AistrixError as e:
        _fail(e)
    console.print(f"Deleted {name}")


# ── version ───────────────────────────────────────────────────────────────────

@app.command()
def version():
    """Print the SDK version."""
    from . import __version__
    console.print(f"aistrix {__version__}")
