"""Local runner: compiles for the local target, runs entry files with the
developer's Python, and reads secrets from the environment. The code here is
the test's own; no model or network calls."""
import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aistrix_platform import local, spec

from test_platform_runtime import FakeModel

SPEC = """
apiVersion: aistrix.ai/v1alpha1
kind: Application
metadata: {name: quote-calc, namespace: demo, version: 0.1.0}
spec:
  workloads:
    - name: quote
      type: pipeline
      input:
        type: object
        required: [seats]
        properties: {seats: {type: integer, minimum: 1}}
      output:
        type: object
        required: [total, summary]
        properties: {total: {type: number}, summary: {type: string}}
      nodes:
        - {id: price, use: code.python, entry: price.py}
        - {id: words, use: llm.chat, model: claude/claude-haiku-5-5, prompt: "Summarise this quote: {{price}}"}
        - id: result
          use: data.template
          value: {total: "{{price.total}}", summary: "{{words}}"}
      edges: [[input, price], [price, words], [words, result], [result, output]]
"""

PRICE_PY = """
import json, sys
data = json.load(sys.stdin)
print("debug line")
print(json.dumps({"total": data["seats"] * 12.5}))
"""


def write(tmp_path: Path, code: str = PRICE_PY) -> Path:
    (tmp_path / "price.py").write_text(code, encoding="utf-8")
    path = tmp_path / "aistrix.yaml"
    path.write_text(SPEC, encoding="utf-8")
    return path


def test_local_run_executes_entry_files_and_models(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-local")
    path = write(tmp_path)
    model = FakeModel("Four seats at 12.50 each.")
    run = asyncio.run(local.run_local(spec.load(path.read_text()), {"seats": 4}, spec_dir=tmp_path, adapter=model))
    assert run["status"] == "succeeded", run["error"]
    assert run["output"] == {"total": 50.0, "summary": "Four seats at 12.50 each."}
    assert model.calls[0]["key"] == "sk-ant-local" and '{"total":50.0}' in model.calls[0]["prompt"]


def test_entry_files_cant_leave_the_spec_folder(tmp_path):
    path = write(tmp_path)
    doc = spec.load(path.read_text().replace("entry: price.py", "entry: ../price.py"))
    run = asyncio.run(local.run_local(doc, {"seats": 1}, spec_dir=tmp_path, adapter=FakeModel("x")))
    assert run["status"] == "failed" and "outside the spec's folder" in run["error"]


def test_failing_code_reports_its_error(tmp_path):
    path = write(tmp_path, "raise SystemExit('bad seats')")
    run = asyncio.run(local.run_local(spec.load(path.read_text()), {"seats": 1}, spec_dir=tmp_path, adapter=FakeModel("x")))
    assert run["status"] == "failed" and "bad seats" in run["error"]


def test_code_gets_no_secrets_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("ERP_API_KEY", "should-not-leak")
    path = write(tmp_path, "import json, os\nprint(json.dumps({'total': 1, 'leak': os.environ.get('ERP_API_KEY')}))")
    run = asyncio.run(local.run_local(spec.load(path.read_text()), {"seats": 1}, spec_dir=tmp_path,
                                      adapter=FakeModel("ok")))
    assert run["steps"]["price"]["output"]["leak"] is None


def test_hosted_code_apps_dont_compile_locally(tmp_path):
    path = write(tmp_path)
    doc = spec.load(path.read_text().replace("entry: price.py", "app: 00000000-0000-0000-0000-000000000001"))
    with pytest.raises(spec.SpecError) as e:
        asyncio.run(local.run_local(doc, {"seats": 1}, spec_dir=tmp_path))
    assert "hosted platform" in str(e.value)


def test_command_line_with_mocks_and_approvals(tmp_path, monkeypatch, capsys):
    example = Path(__file__).resolve().parents[2] / "examples" / "invoice-pipeline" / "aistrix.yaml"
    model = FakeModel(json.dumps({"vendor": "ACME", "total": 20000, "currency": "EUR", "needs_review": True}))
    monkeypatch.setattr(local, "EnvProviders", lambda: model)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-local")
    payload = json.dumps({"invoice_id": "7", "file": {"name": "a.txt", "content_base64": "SW52b2ljZQ=="}})
    code = local.main([str(example), "--input", payload, "--approve", "--quiet",
                       "--mock", 'post={"status": 201, "body": {"id": "local"}}'])
    out = json.loads(capsys.readouterr().out)
    assert code == 0 and out["status"] == "succeeded"
    assert out["steps"]["review"]["approved"] is True and out["steps"]["post"]["detail"] == {"mocked": True}


def test_command_line_reports_spec_problems(tmp_path, capsys):
    bad = tmp_path / "bad.yaml"
    bad.write_text(SPEC.replace("version: 0.1.0", "version: x"), encoding="utf-8")
    assert local.main([str(bad), "--input", "{}"]) == 2
    assert "metadata.version" in capsys.readouterr().err
