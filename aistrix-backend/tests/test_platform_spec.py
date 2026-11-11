"""Resource spec and compiler (aistrix_platform). Pure: no network, no database."""
import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from aistrix_platform import compiler, spec

EXAMPLE = Path(__file__).resolve().parents[2] / "examples" / "invoice-pipeline" / "aistrix.yaml"


def example() -> dict:
    return spec.parse_text(EXAMPLE.read_text(encoding="utf-8"))


def messages(problems) -> str:
    return " | ".join(f"{p.path}: {p.message}" for p in problems)


def test_example_validates_and_compiles():
    doc = spec.load(EXAMPLE.read_text(encoding="utf-8"))
    plan, problems = compiler.compile_workload(doc)
    assert not problems, messages(problems)
    assert plan["order"] == ["read", "fields", "review", "post"]
    assert plan["nodes"]["post"]["sideEffect"] is True
    assert plan["nodes"]["fields"]["sideEffect"] is False
    assert plan["nodes"]["fields"]["config"]["schema"]["required"] == ["vendor", "total", "currency", "needs_review"]
    assert plan["policies"]["budgetUsd"] == 0.05
    assert plan["surfaces"] == {"granted": ["rest", "sdk", "hosted-ui"], "refused": []}
    assert len(plan["planId"]) == 64


def test_yaml_and_json_give_the_same_canonical_hash():
    doc = example()
    as_json = json.dumps(doc, indent=2)
    assert spec.content_hash(spec.parse_text(as_json)) == spec.content_hash(doc)
    reordered = dict(reversed(list(doc.items())))
    assert spec.canonical_json(reordered) == spec.canonical_json(doc)


def test_plan_id_is_stable_and_changes_with_the_spec():
    a, _ = compiler.compile_workload(example())
    b, _ = compiler.compile_workload(example())
    assert a["planId"] == b["planId"]
    doc = example()
    doc["spec"]["workloads"][0]["nodes"][1]["prompt"] += " Be brief."
    c, _ = compiler.compile_workload(doc)
    assert c["planId"] != a["planId"]


@pytest.mark.parametrize("text, fragment", [
    ('{"a": NaN}', "not allowed"),
    ("a: 1\n---\nb: 2\n", "one resource"),
    ("- 1\n- 2\n", "must be an object"),
])
def test_unreadable_specs_are_refused(text, fragment):
    with pytest.raises(spec.SpecError) as e:
        spec.load(text)
    assert fragment in str(e.value)


def test_yaml_dates_stay_strings():
    doc = spec.parse_text("when: 2026-10-27\n")
    assert doc["when"] == "2026-10-27"


def test_envelope_problems_name_their_path():
    doc = example()
    doc["metadata"]["name"] = "Bad Name"
    doc["extra"] = 1
    problems = spec.validate(doc)
    text = messages(problems)
    assert "metadata.name" in text and "extra" in text


def test_kinds_not_built_yet_are_refused_with_a_reason():
    doc = example()
    doc["kind"] = "Model"
    problems = spec.validate(doc)
    assert problems and "not available on this platform yet" in problems[0].message


def test_other_workload_types_are_refused_for_now():
    doc = example()
    doc["spec"]["workloads"].append({"name": "site", "type": "web"})
    assert "not available yet" in messages(spec.validate(doc))


def test_references_are_parsed_and_checked():
    ref = spec.parse_ref("EvalSuite/acme/invoice-regression@1.0.0")
    assert (ref.kind, ref.namespace, ref.name, ref.version) == ("EvalSuite", "acme", "invoice-regression", "1.0.0")
    assert ref.key == "EvalSuite/acme/invoice-regression"
    for bad in ["EvalSuite/acme/x", "Nope/acme/x@1", "EvalSuite/Acme/x@1", "EvalSuite/acme/x@01"]:
        with pytest.raises(ValueError):
            spec.parse_ref(bad)
    doc = example()
    doc["tests"] = ["Dataset/acme/rows@1"]
    assert "EvalSuite" in messages(spec.validate(doc))


def test_file_inputs_use_the_file_descriptor():
    schema = example()["spec"]["workloads"][0]["input"]
    ok = {"invoice_id": "7", "file": {"name": "a.pdf", "content_base64": "JVBERg=="}}
    assert not spec.validate_value(schema, ok)
    assert spec.validate_value(schema, {"invoice_id": "7", "file": "a.pdf"})


def test_dataset_rows_match_their_schema_and_captured_runs_need_consent():
    doc = {"apiVersion": spec.API_VERSION, "kind": "Dataset",
           "metadata": {"name": "invoices", "namespace": "acme", "version": "1"},
           "spec": {"schema": {"type": "object", "required": ["total"], "properties": {"total": {"type": "number"}}},
                    "rows": [{"total": 10}, {"total": "ten"}],
                    "lineage": {"source": "captured-runs"}}}
    assert "consent" in messages(spec.validate(doc))
    doc["spec"]["lineage"]["consent"] = {"grantedBy": "owner", "grantedAt": "2026-10-27"}
    assert "spec.rows[1].total" in messages(spec.validate(doc))
    doc["spec"]["rows"].pop()
    assert not spec.validate(doc)


def test_eval_suite_needs_checks():
    doc = {"apiVersion": spec.API_VERSION, "kind": "EvalSuite",
           "metadata": {"name": "invoice-regression", "namespace": "acme", "version": "1.0.0"},
           "spec": {"target": {"ref": "Application/acme/invoice-extractor@1.0.0", "workload": "extract"},
                    "cases": [{"name": "simple", "input": {"invoice_id": "1"}}]}}
    assert "expect" in messages(spec.validate(doc))
    doc["spec"]["checks"] = [{"type": "not_empty", "path": "vendor"}]
    assert not spec.validate(doc)


def _wl(doc):
    return doc["spec"]["workloads"][0]


def compile_problems(doc) -> str:
    plan, problems = compiler.compile_workload(doc)
    assert plan is None
    return messages(problems)


def test_unknown_node_and_bad_config():
    doc = example()
    _wl(doc)["nodes"][0]["use"] = "parse.magic"
    assert "Unknown node type" in compile_problems(doc)
    doc = example()
    _wl(doc)["nodes"][1]["model"] = "acme/my-model"
    assert "nodes[1].model" in compile_problems(doc)


def test_edges_must_point_at_real_things():
    doc = example()
    _wl(doc)["edges"].append(["ghost", "post"])
    assert "doesn't exist" in compile_problems(doc)
    doc = example()
    _wl(doc)["edges"].append(["input.nope", "read"])
    assert "isn't a field" in compile_problems(doc)


def test_cycles_are_refused():
    doc = example()
    _wl(doc)["edges"].append(["post", "fields"])
    assert "cycle" in compile_problems(doc)


def test_exactly_one_output_source():
    doc = example()
    _wl(doc)["edges"].append(["post", "output"])
    assert "exactly one source to output" in compile_problems(doc)


def test_typed_edges():
    doc = example()
    _wl(doc)["edges"][0] = ["input.invoice_id", "read"]
    assert compiler.compile_workload(doc)[1] == []        # text is fine for parse.document
    doc = example()
    _wl(doc)["edges"].append(["fields.total", "read"])
    _wl(doc)["edges"].remove(["input.file", "read"])
    assert "cycle" in compile_problems(doc)               # reading fields from read's own child
    doc = example()
    _wl(doc)["edges"][-1] = ["read", "output"]
    assert "expects object but the wired source gives text" in compile_problems(doc)


def test_templates_only_read_earlier_values():
    doc = example()
    _wl(doc)["nodes"][1]["prompt"] = "Use {{post.status}}"
    assert "isn't the input, a secret or an earlier node" in compile_problems(doc)


def test_secrets_must_be_declared_and_only_go_where_nodes_send_them():
    doc = example()
    doc["policies"]["secrets"] = []
    assert "isn't declared" in compile_problems(doc)
    doc = example()
    _wl(doc)["nodes"][1]["prompt"] = "Key: {{secrets.ERP_API_KEY}}"
    assert "Secrets can't be used in llm.structured" in compile_problems(doc)
    doc = example()
    _wl(doc)["nodes"][3]["body"]["key"] = "{{secrets.ERP_API_KEY}}"
    assert "Secrets can't be used in http body" in compile_problems(doc)


def test_outbound_hosts_and_idempotency():
    doc = example()
    doc["policies"]["outboundHosts"] = ["*.other.com"]
    assert "isn't in policies.outboundHosts" in compile_problems(doc)
    doc = example()
    _wl(doc)["nodes"][3]["url"] = "https://{{input.invoice_id}}.example-erp.com/x"
    assert "host part" in compile_problems(doc)
    doc = example()
    del _wl(doc)["nodes"][3]["idempotencyKey"]
    assert "idempotencyKey" in compile_problems(doc)
    doc = example()
    _wl(doc)["nodes"][3]["method"] = "GET"
    del _wl(doc)["nodes"][3]["idempotencyKey"]
    plan, problems = compiler.compile_workload(doc)
    assert not problems and plan["nodes"]["post"]["sideEffect"] is False


def test_test_destinations_need_no_outbound_host_but_keep_idempotency():
    doc = example()
    _wl(doc)["nodes"][3]["url"] = "aistrix-test://destinations/erp"
    doc["policies"]["outboundHosts"] = []
    plan, problems = compiler.compile_workload(doc)
    assert not problems, messages(problems)
    assert plan["nodes"]["post"]["sideEffect"] is True
    del _wl(doc)["nodes"][3]["idempotencyKey"]
    assert "idempotencyKey" in compile_problems(doc)
    doc = example()
    _wl(doc)["nodes"][3]["url"] = "aistrix-test://destinations/Bad_Name"
    assert "nodes[3].url" in compile_problems(doc)


def test_wildcard_hosts_match_subdomains_only():
    assert compiler.host_matches("api.example.com", ["*.example.com"])
    assert not compiler.host_matches("example.com", ["*.example.com"])
    assert not compiler.host_matches("evilexample.com", ["*.example.com"])


def test_when_must_read_an_earlier_node():
    doc = example()
    _wl(doc)["nodes"][2]["when"] = "post.ok"
    assert "isn't an earlier node" in compile_problems(doc)


def test_provider_restrictions():
    doc = example()
    _wl(doc)["nodes"][1]["model"] = "openai/gpt-4o-mini"
    doc["policies"]["providers"] = ["claude"]
    assert "isn't allowed by policies.providers" in compile_problems(doc)


def test_surfaces_need_policy_to_leave_the_workspace():
    doc = example()
    doc["surfaces"] = ["rest", "mcp", "embed"]
    plan, problems = compiler.compile_workload(doc)
    assert not problems
    assert plan["surfaces"]["granted"] == ["rest"]
    assert {r["surface"] for r in plan["surfaces"]["refused"]} == {"mcp", "embed"}
    doc["policies"]["exposure"] = {"mcp": True, "embed": True}
    doc["surfaces"].append("hosted-ui")
    plan, _ = compiler.compile_workload(doc)
    assert plan["surfaces"]["granted"] == ["rest", "mcp", "embed", "hosted-ui"]


def test_local_entry_files_only_compile_for_the_local_runner():
    doc = example()
    _wl(doc)["nodes"].insert(2, {"id": "check", "use": "code.python", "entry": "src/validate.py"})
    _wl(doc)["edges"] = [["input.file", "read"], ["read", "fields"], ["fields", "check"], ["check", "review"],
                         ["review", "post"], ["fields", "output"]]
    assert "local runner" in compile_problems(doc)
    plan, problems = compiler.compile_workload(copy.deepcopy(doc), target="local")
    assert not problems, messages(problems)
    assert plan["order"] == ["read", "fields", "check", "review", "post"]
