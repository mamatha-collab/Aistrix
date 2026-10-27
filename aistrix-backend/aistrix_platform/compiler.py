"""Spec compiler (control plane): turns a validated Application's pipeline
workload into a plan the AEX orchestrator runs, or explains why it can't.

Checks: node types and their config, edge endpoints, cycles, typed edges,
templates (only earlier values, secrets only where declared and allowed),
outbound hosts, idempotency keys on writes, provider restrictions and which
invocation surfaces the release may expose. Pure functions, no I/O.
"""
import hashlib
from typing import Any, Optional
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator

from . import node_types, spec, templates
from .node_types import ANY, BOOLEAN, FILE, LIST, NUMBER, OBJECT, TEXT
from .spec import Problem

PLAN_VERSION = 1
DEFAULT_RUN_BUDGET_USD = 1.00
DEFAULT_SURFACES = ("rest", "sdk")
RESERVED_IDS = ("input", "output", "secrets")
NODE_KEYS = ("id", "use", "when", "retry", "timeoutSeconds")

_SCHEMA_KIND = {"string": TEXT, "number": NUMBER, "integer": NUMBER, "boolean": BOOLEAN,
                "array": LIST, "object": OBJECT}


def _kind_of_schema(schema: Any) -> str:
    if not isinstance(schema, dict):
        return ANY
    if schema.get("$ref") == spec.FILE_TYPE_URI:
        return FILE
    t = schema.get("type")
    return _SCHEMA_KIND.get(t, ANY) if isinstance(t, str) else ANY


def host_matches(host: str, patterns) -> bool:
    host = host.lower().rstrip(".")
    for p in patterns or ():
        p = p.lower()
        if p.startswith("*.") and host.endswith(p[1:]) and host != p[2:]:
            return True
        if host == p:
            return True
    return False


def surfaces_for(doc: dict) -> tuple[list[str], list[dict]]:
    """(granted, refused) invocation surfaces for an Application release."""
    requested = list(doc.get("surfaces") or DEFAULT_SURFACES)
    exposure = (doc.get("policies") or {}).get("exposure") or {}
    granted, refused = [], []
    for s in requested:
        if s == "mcp" and not exposure.get("mcp"):
            refused.append({"surface": s, "reason": "MCP exposes the app outside its workspace; set policies.exposure.mcp: true"})
        elif s == "embed" and not exposure.get("embed"):
            refused.append({"surface": s, "reason": "Embeds run on other sites; set policies.exposure.embed: true"})
        elif s == "embed" and "hosted-ui" not in requested:
            refused.append({"surface": s, "reason": "An embed shows the hosted interface; request hosted-ui too"})
        else:
            granted.append(s)
    return granted, refused


def _parse_endpoint(text: str) -> tuple[str, list[str]]:
    head, *path = text.split(".")
    return head, path


def compile_workload(doc: dict, workload: Optional[str] = None, *, target: str = "hosted") -> tuple[Optional[dict], list[Problem]]:
    """(plan, problems). A plan is returned only when there are no problems.
    target: "hosted" (AEX workers) or "local" (the CLI's local runner)."""
    problems = spec.validate(doc)
    if problems:
        return None, problems
    if doc["kind"] != "Application":
        return None, [Problem("kind", "Only Application resources compile to a runnable plan")]
    workloads = doc["spec"]["workloads"]
    index = next((i for i, w in enumerate(workloads) if workload in (None, w["name"])), None)
    if index is None:
        return None, [Problem("spec.workloads", f"No workload named {workload!r}")]
    w = workloads[index]
    at = f"spec.workloads[{index}]"
    policies = doc.get("policies") or {}
    declared_secrets = set(policies.get("secrets") or [])
    hosts = policies.get("outboundHosts") or []
    providers = policies.get("providers")

    nodes: dict[str, dict] = {}
    order_index: dict[str, int] = {}
    for i, n in enumerate(w["nodes"]):
        p = f"{at}.nodes[{i}]"
        if n["id"] in RESERVED_IDS:
            problems.append(Problem(f"{p}.id", f"{n['id']!r} is reserved; pick another node id"))
            continue
        if n["id"] in nodes:
            problems.append(Problem(f"{p}.id", f"Node id {n['id']!r} is used twice"))
            continue
        nt = node_types.get(n["use"])
        if not nt:
            problems.append(Problem(f"{p}.use", f"Unknown node type {n['use']!r}"))
            continue
        config = {k: v for k, v in n.items() if k not in NODE_KEYS}
        for err in Draft202012Validator(nt.config_schema).iter_errors(config):
            where = ".".join(str(x) for x in err.absolute_path)
            problems.append(Problem(f"{p}{'.' + where if where else ''}", err.message))
        if n["use"] == "code.python" and "entry" in config and target == "hosted":
            problems.append(Problem(f"{p}.entry", "entry runs only in the local runner; deploy the code as a Code Application and set app"))
        if n["use"] == "code.python" and "app" in config and target == "local":
            problems.append(Problem(f"{p}.app", "Deployed code apps run on the hosted platform; give the local runner an entry file"))
        nodes[n["id"]] = {"use": n["use"], "config": config, "when": n.get("when"),
                          "retry": (n.get("retry") or {}).get("attempts", 1),
                          "timeoutSeconds": n.get("timeoutSeconds", 120), "sources": []}
        order_index[n["id"]] = i

    input_props = (w["input"].get("properties") or {}) if isinstance(w["input"], dict) else {}
    output_sources: list[dict] = []
    incoming: dict[str, set] = {nid: set() for nid in nodes}
    for i, (src, dst) in enumerate(w["edges"]):
        p = f"{at}.edges[{i}]"
        s_head, s_path = _parse_endpoint(src)
        d_head, d_path = _parse_endpoint(dst)
        if s_head == "output":
            problems.append(Problem(p, "Nothing can read from output"))
            continue
        if s_head == "input":
            if len(s_path) > 1 or (s_path and s_path[0] not in input_props):
                problems.append(Problem(p, f"{src!r} isn't a field of the workload's input"))
                continue
        elif s_head not in nodes:
            problems.append(Problem(p, f"{src!r} reads from a node that doesn't exist"))
            continue
        if d_head == "input":
            problems.append(Problem(p, "Nothing can write to input"))
            continue
        if d_path:
            problems.append(Problem(p, f"An edge ends at a node or output, not a field ({dst!r})"))
            continue
        if d_head != "output" and d_head not in nodes:
            problems.append(Problem(p, f"{dst!r} isn't a node"))
            continue
        source = {"from": src, "node": None if s_head == "input" else s_head, "path": s_path}
        if d_head == "output":
            output_sources.append(source)
        else:
            if any(x["from"] == src for x in nodes[d_head]["sources"]):
                problems.append(Problem(p, f"{src!r} is wired to {dst!r} twice"))
                continue
            nodes[d_head]["sources"].append(source)
            if source["node"]:
                incoming[d_head].add(source["node"])

    if problems:
        return None, problems
    if len(output_sources) != 1:
        problems.append(Problem(f"{at}.edges", "Wire exactly one source to output"))
    for nid, n in nodes.items():
        if not n["sources"]:
            problems.append(Problem(f"{at}.nodes", f"Node {nid!r} has no incoming edge, so it would never run"))

    # Topological order, ties broken by declaration order.
    remaining = {nid: set(deps) for nid, deps in incoming.items()}
    order: list[str] = []
    while remaining:
        ready = sorted((nid for nid, deps in remaining.items() if not deps), key=order_index.__getitem__)
        if not ready:
            problems.append(Problem(f"{at}.edges", f"The graph has a cycle through: {', '.join(sorted(remaining))}"))
            break
        nid = ready[0]
        order.append(nid)
        del remaining[nid]
        for deps in remaining.values():
            deps.discard(nid)
    if problems:
        return None, problems

    ancestors: dict[str, set] = {}
    for nid in order:
        acc = set()
        for dep in incoming[nid]:
            acc |= {dep} | ancestors[dep]
        ancestors[nid] = acc

    out_kind: dict[str, str] = {}
    out_schema: dict[str, Any] = {}

    def source_kind(source: dict) -> str:
        if source["node"] is None:
            if not source["path"]:
                return OBJECT
            return _kind_of_schema(input_props.get(source["path"][0]))
        kind = out_kind[source["node"]]
        if not source["path"]:
            return kind
        schema = out_schema.get(source["node"])
        for part in source["path"]:
            if not isinstance(schema, dict):
                return ANY
            schema = (schema.get("properties") or {}).get(part)
        return _kind_of_schema(schema) if schema is not None else ANY

    for nid in order:
        n = nodes[nid]
        nt = node_types.get(n["use"])
        p = f"{at}.nodes[{order_index[nid]}]"
        kinds = [source_kind(s) for s in n["sources"]]
        incoming_kind = kinds[0] if len(kinds) == 1 else OBJECT
        if ANY not in nt.accepts and incoming_kind != ANY and incoming_kind not in nt.accepts:
            problems.append(Problem(p, f"{n['use']} accepts {', '.join(sorted(nt.accepts))} but gets {incoming_kind}"))
        if n["use"] == "llm.structured":
            schema = w["output"] if n["config"]["schema"] == "$output" else n["config"]["schema"]
            problems += spec.schema_problems(schema, f"{p}.schema")
            out_schema[nid] = schema
            n["config"]["schema"] = schema
        if nt.output == "same":
            out_kind[nid] = incoming_kind
            if len(n["sources"]) == 1 and n["sources"][0]["node"] in out_schema and not n["sources"][0]["path"]:
                out_schema[nid] = out_schema[n["sources"][0]["node"]]
        else:
            out_kind[nid] = nt.output

        allowed_heads = {"input", "secrets"} | ancestors[nid]
        for field, ref in templates.references(n["config"]):
            head = ref.split(".", 1)[0]
            if head not in allowed_heads:
                problems.append(Problem(f"{p}.{field}", f"{{{{{ref}}}}} reads {head!r}, which isn't the input, a secret or an earlier node"))
            elif head == "secrets":
                name = ref.split(".", 1)[1] if "." in ref else ""
                if field.split(".", 1)[0].split("[", 1)[0] not in nt.secret_fields:
                    problems.append(Problem(f"{p}.{field}", f"Secrets can't be used in {n['use']} {field}; credentials go only where a node sends them"))
                elif name not in declared_secrets:
                    problems.append(Problem(f"{p}.{field}", f"Secret {name!r} isn't declared in policies.secrets"))
        if n["when"]:
            head = n["when"].split(".", 1)[0]
            if head not in ancestors[nid]:
                problems.append(Problem(f"{p}.when", f"when reads {head!r}, which isn't an earlier node of {nid!r}"))

        if n["use"] == "http":
            cfg = n["config"]
            authority = cfg["url"].split("//", 1)[1].split("/", 1)[0].split("?", 1)[0]
            if "{{" in authority:
                problems.append(Problem(f"{p}.url", "The host part of the URL must be written out, not filled in at run time"))
            else:
                host = urlsplit(cfg["url"]).hostname or ""
                if not host_matches(host, hosts):
                    problems.append(Problem(f"{p}.url", f"{host} isn't in policies.outboundHosts"))
            if cfg["method"] in node_types.WRITE_METHODS and not cfg.get("idempotencyKey"):
                problems.append(Problem(f"{p}.idempotencyKey",
                                        "Writes need an idempotencyKey so a retry or resumed run can't repeat them"))
        if nt.model_call:
            model = n["config"]["model"]
            if providers and not model.startswith("policy:") and model.split("/", 1)[0] not in providers:
                problems.append(Problem(f"{p}.model", f"Provider {model.split('/', 1)[0]} isn't allowed by policies.providers"))

    out_source = output_sources[0]
    o_kind = source_kind(out_source)
    want = _kind_of_schema(w["output"])
    if want not in (ANY, o_kind) and o_kind != ANY:
        problems.append(Problem(f"{at}.output", f"The output schema expects {want} but the wired source gives {o_kind}"))
    if problems:
        return None, problems

    granted, refused = surfaces_for(doc)
    has_models = any(node_types.get(n["use"]).model_call for n in nodes.values())
    budget = ((policies.get("budget") or {}).get("perRunUsd")) or (DEFAULT_RUN_BUDGET_USD if has_models else None)
    plan = {
        "planVersion": PLAN_VERSION,
        "target": target,
        "resource": str(spec.ref_of(doc)),
        "contentHash": spec.content_hash(doc),
        "workload": w["name"],
        "input": w["input"],
        "output": w["output"],
        "order": order,
        "nodes": {nid: {**nodes[nid], "sideEffect": node_types.is_side_effecting(nodes[nid]["use"], nodes[nid]["config"]),
                        "ancestors": sorted(ancestors[nid])} for nid in order},
        "outputSource": out_source,
        "policies": {"secrets": sorted(declared_secrets), "outboundHosts": list(hosts),
                     "providers": providers, "budgetUsd": budget},
        "surfaces": {"granted": granted, "refused": refused},
    }
    plan["planId"] = hashlib.sha256(spec.canonical_json(plan).encode("utf-8")).hexdigest()
    return plan, []


def compile_all(doc: dict, *, target: str = "hosted") -> tuple[dict, list[Problem]]:
    """Plans for every pipeline workload of an Application, keyed by name."""
    problems = spec.validate(doc)
    if problems:
        return {}, problems
    plans: dict[str, dict] = {}
    for w in doc["spec"]["workloads"]:
        plan, found = compile_workload(doc, w["name"], target=target)
        problems += found
        if plan:
            plans[w["name"]] = plan
    return (plans if not problems else {}), problems
