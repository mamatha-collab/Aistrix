"""Tool contracts and the workflow compiler: what a release promises, and the
workflow definitions that are refused before anything runs. Pure functions."""
import re

import _harness
from _harness import ok, finish
_harness.setup()
import flow_plan
import tool_contracts as tc

SECRET = re.compile(r"\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}")
KW = {"max_timeout": 180, "secret_ref": SECRET}

# ── contracts derived from a release ─────────────────────────────────────────
snap = {"ai_provider": "openai", "output_type": "json",
        "blueprint": {"input_schema": {"fields": [{"field": "email", "type": "string"}]},
                      "output_schema": {"fields": [{"field": "score", "type": "number"}]}},
        "tools": [{"name": "look", "type": "fetch", "config": {}},
                  {"name": "crm", "type": "http", "config": {"method": "GET", "url": "https://crm.example.com/x",
                                                             "headers": {"Authorization": "Bearer {{ secrets.crm_key }}"}}}]}
c = tc.build_contract(snap, **KW)
ok("a release's contract lists its input and structured output", c["input"]["fields"][0]["field"] == "email"
   and c["output"] == {"fields": [{"field": "score", "type": "number"}], "structured": True})
ok("read-only tools make the contract external_read", c["side_effects"] == "external_read")
ok("the secrets it needs are named, never valued", c["auth"]["secrets"] == ["CRM_KEY"])
ok("fixed tool destinations are listed for privacy review", c["privacy"]["external_destinations"] == ["crm.example.com"])
ok("the provider and default timeout are recorded", c["privacy"]["provider"] == "openai" and c["execution"]["timeout_seconds"] == 180)
write = tc.build_contract({**snap, "tools": [{"type": "http", "config": {"method": "POST"}}]}, **KW)
ok("a writing HTTP tool makes the contract external_write", write["side_effects"] == "external_write")
ok("an unknown tool type counts as writing", tc.build_contract({"tools": [{"type": "mystery"}]}, **KW)["side_effects"] == "external_write")
ok("markdown output isn't offered as fields", tc.build_contract({**snap, "output_type": "markdown"}, **KW)["output"]["structured"] is False)
declared = tc.build_contract({**snap, "blueprint": {**snap["blueprint"], "contract": {"timeout_seconds": 30, "data_class": "confidential", "side_effects": "none"}}}, **KW)
ok("declarations set the timeout and data class, but can't hide side effects",
   declared["execution"]["timeout_seconds"] == 30 and declared["privacy"]["data_class"] == "confidential" and declared["side_effects"] == "external_read")
ok("a custom model counts as private only on an approved host",
   tc.model_route("https://llm.internal.example/v1", frozenset({"llm.internal.example"})) == "private"
   and tc.model_route("https://llm.other.example/v1", frozenset({"llm.internal.example"})) == "external"
   and tc.model_route(None, frozenset({"llm.internal.example"})) == "external")
old = {"blueprint": {"input_schema": {"fields": [{"field": "x"}]}}}
ok("releases saved before contracts get one derived on read", tc.contract_for_release(old, **KW)["input"]["fields"] == [{"field": "x"}])
stored = {**old, "contract": {"contract_version": 1, "input": {"fields": []}, "marker": True}}
ok("a stored supported contract is used as saved", tc.contract_for_release(stored, **KW).get("marker") is True)
future = {**old, "contract": {"contract_version": 99}}
ok("an unsupported stored contract version falls back to deriving", tc.contract_for_release(future, **KW)["contract_version"] == 1)
ok("contract hashes are stable and change with the contract",
   tc.contract_hash(c) == tc.contract_hash(dict(c)) and tc.contract_hash(c) != tc.contract_hash(write))

# ── what can't be released ───────────────────────────────────────────────────
def problems(blueprint, tools=()):
    return tc.contract_problems({"blueprint": blueprint, "tools": list(tools)}, **KW)
ok("a clean draft has no contract problems", problems(snap["blueprint"]) == [])
ok("enum fields need text choices", any("choice field" in p for p in problems({"input_schema": {"fields": [{"field": "tier", "type": "enum"}]}})))
ok("nested object fields are checked too", any("unknown type" in p for p in problems(
    {"output_schema": {"fields": [{"field": "o", "type": "object", "nested_fields": [{"field": "n", "type": "blob"}]}]}})))
ok("a field needs a usable name", any("needs a name" in p for p in problems({"input_schema": {"fields": [{"type": "string"}]}})))
ok("a schema must be an object", problems({"input_schema": ["x"]}) == ["Input schema must be an object with a list of fields"])
ok("side effects can't be declared lower than the tools'", any("declares side effects" in p for p in problems(
    {"contract": {"side_effects": "none"}}, [{"type": "email"}])))

# ── workflow compiler ────────────────────────────────────────────────────────
scorer = {"input": {"fields": [{"field": "company", "type": "string"}]},
          "output": {"structured": True, "fields": [{"field": "score", "type": "number"}, {"field": "email", "type": "string"}]}}
writer = {"input": {"fields": [{"field": "to", "type": "string"}, {"field": "score", "type": "number"},
                               {"field": "note", "type": "string", "required": False}]},
          "output": {"structured": False, "fields": []}}
def flow(steps, **extra): return {"kind": "developer", "steps": steps, **extra}
good = flow([{"id": "s1", "app_id": "a", "input_map": {"company": {"from": "trigger.company"}}},
             {"id": "s2", "app_id": "b", "input_map": {"to": {"from": "s1.email"}, "score": {"from": "s1.score"}}}])
plan, errs = flow_plan.compile_flow(good, {0: scorer, 1: writer})
ok("a well-wired workflow compiles to a plan", errs == [] and plan["id"].startswith("plan_"))
again, _ = flow_plan.compile_flow({**good, "steps": [dict(s, app_name="Renamed") for s in good["steps"]], "name": "Other"}, {0: scorer, 1: writer})
ok("the plan id ignores names and depends only on what runs", again["id"] == plan["id"])
changed, _ = flow_plan.compile_flow(good, {0: scorer, 1: {**writer, "input": {"fields": writer["input"]["fields"][:2] + [{"field": "x"}]}}})
ok("a different release contract gives a different plan id", changed is None or changed["id"] != plan["id"])

def errors_of(definition, contracts=None):
    return [p["text"] for p in flow_plan.compile_flow(definition, contracts or {})[1]]
ok("duplicate step ids are refused", any("reuses the step id" in e for e in errors_of(flow([{"id": "s1", "app_id": "a"}, {"id": "s1", "app_id": "b"}]))))
ok("a step can't read a later step", any("later step" in e for e in errors_of(flow([
    {"id": "s1", "app_id": "a", "input_map": {"x": {"from": "s2.text"}}}, {"id": "s2", "app_id": "b"}]))))
ok("a step can't read a missing step", any("doesn't exist" in e for e in errors_of(flow([
    {"id": "s1", "app_id": "a", "input_map": {"x": {"from": "s9.text"}}}]))))
ok("a step can't read itself", any("later step" in e for e in errors_of(flow([
    {"id": "s1", "app_id": "a", "run_if": {"from": "s1.text", "op": "equals", "value": "x"}}]))))
ok("conditions use known comparisons", any("comparison" in e for e in errors_of(flow([
    {"id": "s1", "app_id": "a"}, {"id": "s2", "app_id": "b", "run_if": {"from": "s1.text", "op": "roughly"}}]))))
ok("conversions must be known", any("unknown conversion" in e for e in errors_of(flow([
    {"id": "s1", "app_id": "a", "input_map": {"x": {"from": "trigger.text", "transform": "uppercase"}}}]))))
mismatch = flow([{"id": "s1", "app_id": "a"}, {"id": "s2", "app_id": "b",
                 "input_map": {"to": {"from": "s1.score"}, "score": {"from": "s1.email"}}}])
errs = errors_of(mismatch, {0: scorer, 1: writer})
ok("incompatible types are refused (number → text, text → number)",
   sum("expects" in e for e in errs) == 2)
fixed = flow([{"id": "s1", "app_id": "a"}, {"id": "s2", "app_id": "b",
              "input_map": {"to": {"from": "s1.score", "transform": "to_text"}, "score": {"from": "s1.email", "transform": "to_number"}}}])
ok("a conversion makes the types fit", errors_of(fixed, {0: scorer, 1: writer}) == [])
ok("reading an output field the release doesn't produce is refused", any("doesn't produce" in e for e in errors_of(flow([
    {"id": "s1", "app_id": "a"}, {"id": "s2", "app_id": "b", "input_map": {"to": {"from": "s1.phone"}, "score": {"from": "s1.score"}}}]),
    {0: scorer, 1: writer})))
ok("required inputs must be connected unless AI fills them",
   any('"score" is required' in e for e in errors_of(flow([{"id": "s1", "app_id": "b", "input_map": {"to": {"value": "x"}}}]), {0: writer}))
   and errors_of(flow([{"id": "s1", "app_id": "b", "ai_fill": True, "input_map": {"to": {"value": "x"}}}]), {0: writer}) == [])
ok("an unwired step (previous output as text) has nothing to connect", errors_of(flow([{"id": "s1", "app_id": "b", "input_map": {}}]), {0: writer}) == [])
ok("an unresolved release skips type checks (reported when the step runs)", errors_of(mismatch, {}) == [])
ok("unsupported workflow format versions are refused", any("format version 7" in e for e in errors_of({**good, "schema_version": 7})))
ok("unknown step types are refused", any("unknown step type" in e for e in errors_of(flow([{"id": "s1", "step_type": "shell"}]))))
ok("an app step needs an app", any("needs an app" in e for e in errors_of(flow([{"id": "s1"}]))))
ok("an empty workflow is refused", errors_of(flow([])) == ["has no steps"])
ok("old workflows without step ids still compile", errors_of(flow([{"app_id": "a"}, {"app_id": "b"}])) == [])
ok("typed trigger fields are checked too", any("expects number" in e for e in errors_of(
    {**flow([{"id": "s1", "app_id": "b", "input_map": {"to": {"from": "trigger.name"}, "score": {"from": "trigger.name"}}}]),
     "trigger": {"fields": [{"field": "name", "type": "string"}]}}, {0: writer})))
finish()
