"""Local runner: run a spec on your own machine with the same compiler and
orchestrator the platform uses.

    python -m aistrix_platform.local examples/invoice-pipeline/aistrix.yaml --input input.json

Differences from hosted runs, by design:
- Model calls use your own keys from the environment (ANTHROPIC_API_KEY,
  OPENAI_API_KEY, GEMINI_API_KEY). Prices come from the same table, but no
  platform spending limits apply; the run's budget still does.
- Secrets come from environment variables of the same name.
- code.python nodes run their `entry` file with your Python, in the spec's
  folder, without the gVisor sandbox: only run code you trust.
- Outbound HTTP uses the same host rules as hosted runs.
- Runs and events live in memory and are printed, not stored.
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

import outbound

from . import compiler, spec
from .errors import NodeError
from .gateway import CallContext, ModelGateway
from .nodes import HttpResponse, Services
from .orchestrator import Engine
from .store import MemoryStore

# The platform's published prices (USD per million tokens in, out).
PRICES = {
    "claude-opus-5-5": (4.00, 20.00), "claude-sonnet-5-5": (2.00, 10.00), "claude-haiku-5-5": (0.10, 0.50),
    "gpt-4o-mini": (0.15, 0.60), "gpt-4o": (2.50, 10.00),
}
ENV_KEYS = {"claude": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


class EnvProviders:
    """Provider adapter on the official SDKs, keyed from the environment."""

    async def stream(self, *, provider, model, api_key, system, prompt, max_tokens, temperature, usage):
        if provider == "claude":
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=api_key)
            async with client.messages.stream(model=model, max_tokens=max_tokens, system=system, temperature=temperature,
                                              messages=[{"role": "user", "content": prompt}]) as stream:
                async for text in stream.text_stream:
                    yield text
                final = await stream.get_final_message()
                usage.update(input_tokens=final.usage.input_tokens, output_tokens=final.usage.output_tokens)
            return
        import openai
        client = openai.AsyncOpenAI(api_key=api_key, base_url=GEMINI_BASE_URL if provider == "gemini" else None)
        stream = await client.chat.completions.create(
            model=model, max_tokens=max_tokens, temperature=temperature, stream=True,
            stream_options={"include_usage": True},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}])
        async for chunk in stream:
            if chunk.usage:
                usage.update(input_tokens=chunk.usage.prompt_tokens, output_tokens=chunk.usage.completion_tokens)
            for choice in chunk.choices or []:
                if choice.delta and choice.delta.content:
                    yield choice.delta.content


def local_services(spec_dir: Path) -> Services:
    root = spec_dir.resolve()

    async def run_local_code(entry: str, payload: Any, timeout: int) -> Any:
        path = (root / entry).resolve()
        if root not in path.parents:
            raise NodeError(f"{entry} is outside the spec's folder")
        if not path.is_file():
            raise NodeError(f"No file at {entry}")
        env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE") if k in os.environ}

        def run():
            return subprocess.run([sys.executable, str(path)], input=json.dumps(payload), capture_output=True,
                                  text=True, encoding="utf-8", cwd=str(root), env=env, timeout=timeout)
        try:
            proc = await asyncio.to_thread(run)
        except subprocess.TimeoutExpired:
            raise NodeError(f"{entry} didn't finish within {timeout}s")
        if proc.returncode != 0:
            raise NodeError(f"{entry} exited with {proc.returncode}: {proc.stderr.strip()[-500:]}")
        lines = [line for line in proc.stdout.strip().splitlines() if line.strip()]
        if not lines:
            raise NodeError(f"{entry} printed nothing; print one JSON value as the last line")
        try:
            return json.loads(lines[-1])
        except ValueError:
            raise NodeError(f"{entry}'s last line isn't JSON")

    async def http(method, url, headers, body, allowed_hosts, timeout):
        kwargs = {"json": body} if body is not None else {}
        resp = await outbound.fetch_safely(method, url, timeout=min(timeout, 60), max_redirects=0 if method != "GET" else 3,
                                           allowed_hosts=allowed_hosts, headers=headers, **kwargs)
        try:
            parsed = resp.json()
        except ValueError:
            parsed = resp.text[:20000]
        return HttpResponse(resp.status_code, parsed, dict(resp.headers))

    async def secrets(owner_id, resource_key, names):
        return {n: os.environ[n] for n in names if os.environ.get(n)}

    return Services(run_local_code=run_local_code, http=http, secrets=secrets)


def local_gateway(adapter=None) -> ModelGateway:
    async def key_for(ctx: CallContext, provider: str) -> Optional[str]:
        return os.environ.get(ENV_KEYS[provider])
    return ModelGateway(adapter or EnvProviders(), prices=PRICES, key_for=key_for)


async def run_local(doc: dict, input_value: Any, *, spec_dir: Path, workload: Optional[str] = None,
                    approvals: Optional[str] = None, mocks: Optional[dict] = None, adapter=None,
                    services: Optional[Services] = None, on_event=None, ask=None) -> dict:
    """Compile for the local target and run to the end. ask(node, pending) -> bool
    decides approvals interactively when approvals is None."""
    plan, problems = compiler.compile_workload(doc, workload, target="local")
    if problems:
        raise spec.SpecError(problems)
    engine = Engine(MemoryStore(), local_gateway(adapter), services or local_services(spec_dir), worker_id="local")
    run = await engine.start(plan, input_value, owner_id=None, trigger="local", mocks=mocks, auto_approval=approvals)
    run = await engine.execute(run["id"], on_event=on_event)
    while run["status"] == "waiting_approval" and ask:
        nid = next(n for n, s in run["steps"].items() if s["status"] == "waiting_approval")
        await engine.approve(run["id"], nid, approved=ask(nid, run["steps"][nid].get("pending")), by="local")
        run = await engine.execute(run["id"], on_event=on_event)
    return run


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m aistrix_platform.local", description="Run an Aistrix spec locally.")
    p.add_argument("spec", type=Path)
    p.add_argument("--input", "-i", required=True, help="a .json file, - for stdin, or inline JSON")
    p.add_argument("--workload", "-w")
    decide = p.add_mutually_exclusive_group()
    decide.add_argument("--approve", action="store_true", help="approve every approval step")
    decide.add_argument("--reject", action="store_true", help="reject every approval step")
    p.add_argument("--mock", action="append", default=[], metavar="NODE=JSON", help="replace a step's output")
    p.add_argument("--quiet", "-q", action="store_true", help="print only the final run record")
    args = p.parse_args(argv)

    try:
        doc = spec.load(args.spec.read_text(encoding="utf-8"))
        raw = sys.stdin.read() if args.input == "-" else (
            Path(args.input).read_text(encoding="utf-8") if args.input.endswith(".json") else args.input)
        input_value = json.loads(raw)
        mocks = {}
        for m in args.mock:
            node, _, value = m.partition("=")
            mocks[node] = json.loads(value)
    except spec.SpecError as e:
        print(f"{args.spec} has problems:", file=sys.stderr)
        for prob in e.problems:
            print(f"  {prob.path or '(root)'}: {prob.message}", file=sys.stderr)
        return 2
    except (OSError, ValueError) as e:
        print(f"Couldn't read the input: {e}", file=sys.stderr)
        return 2

    async def show(event):
        if args.quiet:
            return
        if event["type"] == "node.token":
            print(event["data"]["text"], end="", flush=True, file=sys.stderr)
        else:
            print(f"\n[{event['type']}] {event.get('node') or ''}", file=sys.stderr)

    def ask(node, pending):
        print(f"\nStep {node} needs approval:\n{json.dumps(pending, indent=2)}", file=sys.stderr)
        return input("Approve? [y/N] ").strip().lower() in ("y", "yes")

    approvals = "approve" if args.approve else "reject" if args.reject else None
    try:
        run = asyncio.run(run_local(doc, input_value, spec_dir=args.spec.parent, workload=args.workload,
                                    approvals=approvals, mocks=mocks or None, on_event=show,
                                    ask=ask if sys.stdin.isatty() else None))
    except spec.SpecError as e:
        for prob in e.problems:
            print(f"  {prob.path or '(root)'}: {prob.message}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"Run stopped: {e}", file=sys.stderr)
        return 1
    print(json.dumps({k: v for k, v in run.items() if k != "plan"}, indent=2, default=str))
    return 0 if run["status"] == "succeeded" else 1


if __name__ == "__main__":
    sys.exit(main())
