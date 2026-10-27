"""Aistrix Resource Specification, v1alpha1.

One envelope for every resource kind (apiVersion, kind, metadata, spec,
dependencies, policies, surfaces, tests) and a JSON Schema (2020-12) per
kind. Authors write YAML or strict JSON; the stored form is canonical JSON
and its sha256 is the resource's content hash. Pure functions, no I/O.
"""
import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Any, Optional

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

API_VERSION = "aistrix.ai/v1alpha1"
SUPPORTED_API_VERSIONS = (API_VERSION,)

# The nine user-facing kinds and the supporting ones.
USER_KINDS = ("Application", "Workflow", "Agent", "Model", "Node", "MCPServer", "KnowledgeBase", "Dataset", "EvalSuite")
SUPPORTING_KINDS = ("SecretRef", "Connector", "Environment")
KINDS = USER_KINDS + SUPPORTING_KINDS
# What this release of the platform can validate, release and run. The other
# kinds parse as envelopes and are refused with a clear reason.
IMPLEMENTED_KINDS = ("Application", "EvalSuite", "Dataset", "SecretRef", "Environment")

WORKLOAD_TYPES = ("pipeline", "web", "api", "worker", "job")
IMPLEMENTED_WORKLOADS = ("pipeline",)
SURFACES = ("rest", "sdk", "mcp", "webhook", "schedule", "hosted-ui", "embed")
ENVIRONMENTS = ("dev", "staging", "production")

MAX_SPEC_BYTES = 256 * 1024
MAX_DEPTH = 32
FILE_TYPE_URI = "aistrix://types/file"

NAME = r"^[a-z][a-z0-9-]{0,62}$"
VERSION = r"^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*))?$"
SECRET_NAME = r"^[A-Z][A-Z0-9_]{0,63}$"
REF = r"^(?P<kind>[A-Za-z]+)/(?P<namespace>[a-z][a-z0-9-]{0,62})/(?P<name>[a-z][a-z0-9-]{0,62})@(?P<version>[0-9][0-9.]*)$"
HOST_PATTERN = r"^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$"
_REF_RE = re.compile(REF)

FILE_SCHEMA = {
    "$id": FILE_TYPE_URI,
    "type": "object",
    "required": ["name", "content_base64"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 255},
        "mime": {"type": "string", "maxLength": 100},
        "content_base64": {"type": "string", "maxLength": 14_000_000},
    },
}

_REF_STRING = {"type": "string", "pattern": REF}

ENVELOPE_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["apiVersion", "kind", "metadata", "spec"],
    "additionalProperties": False,
    "properties": {
        "apiVersion": {"enum": list(SUPPORTED_API_VERSIONS)},
        "kind": {"enum": list(KINDS)},
        "metadata": {
            "type": "object",
            "required": ["name", "namespace", "version"],
            "additionalProperties": False,
            "properties": {
                "name": {"type": "string", "pattern": NAME},
                "namespace": {"type": "string", "pattern": NAME},
                "version": {"type": "string", "pattern": VERSION},
                "description": {"type": "string", "maxLength": 500},
                "labels": {"type": "object", "maxProperties": 20,
                           "additionalProperties": {"type": "string", "maxLength": 63}},
            },
        },
        "spec": {"type": "object"},
        "dependencies": {"type": "array", "maxItems": 50, "uniqueItems": True, "items": _REF_STRING},
        "policies": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "secrets": {"type": "array", "maxItems": 20, "uniqueItems": True,
                            "items": {"type": "string", "pattern": SECRET_NAME}},
                "outboundHosts": {"type": "array", "maxItems": 20, "uniqueItems": True,
                                  "items": {"type": "string", "pattern": HOST_PATTERN}},
                "budget": {"type": "object", "additionalProperties": False,
                           "properties": {"perRunUsd": {"type": "number", "exclusiveMinimum": 0, "maximum": 100}}},
                "providers": {"type": "array", "uniqueItems": True,
                              "items": {"enum": ["claude", "openai", "gemini"]}},
                "exposure": {"type": "object", "additionalProperties": False,
                             "properties": {"mcp": {"type": "boolean"}, "embed": {"type": "boolean"}}},
                "maxConcurrentRuns": {"type": "integer", "minimum": 1, "maximum": 100},
            },
        },
        "surfaces": {"type": "array", "uniqueItems": True, "items": {"enum": list(SURFACES)}},
        "tests": {"type": "array", "maxItems": 10, "uniqueItems": True, "items": _REF_STRING},
    },
}

_NODE = {
    "type": "object",
    "required": ["id", "use"],
    "properties": {
        "id": {"type": "string", "pattern": r"^[a-z][a-z0-9_]{0,40}$"},
        "use": {"type": "string", "pattern": r"^[a-z]+(\.[a-z_]+)*$"},
        "when": {"type": "string", "pattern": r"^[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+)+$"},
        "retry": {"type": "object", "additionalProperties": False,
                  "properties": {"attempts": {"type": "integer", "minimum": 1, "maximum": 5}}},
        "timeoutSeconds": {"type": "integer", "minimum": 1, "maximum": 900},
    },
}

_IO_SCHEMA = {"type": "object"}

_PIPELINE = {
    "type": "object",
    "required": ["name", "type", "input", "output", "nodes", "edges"],
    "additionalProperties": False,
    "properties": {
        "name": {"type": "string", "pattern": NAME},
        "type": {"const": "pipeline"},
        "description": {"type": "string", "maxLength": 500},
        "input": _IO_SCHEMA,
        "output": _IO_SCHEMA,
        "nodes": {"type": "array", "minItems": 1, "maxItems": 50, "items": _NODE},
        "edges": {"type": "array", "minItems": 1, "maxItems": 200,
                  "items": {"type": "array", "minItems": 2, "maxItems": 2,
                            "items": {"type": "string", "maxLength": 100}}},
    },
}

_OTHER_WORKLOAD = {
    "type": "object",
    "required": ["name", "type"],
    "properties": {
        "name": {"type": "string", "pattern": NAME},
        "type": {"enum": [t for t in WORKLOAD_TYPES if t != "pipeline"]},
    },
}

_CHECK = {
    "type": "object",
    "required": ["type"],
    "additionalProperties": False,
    "properties": {
        "type": {"enum": ["equals", "contains", "not_empty", "number_close", "json_schema"]},
        "path": {"type": "string", "maxLength": 200},
        "value": {},
        "tolerance": {"type": "number", "minimum": 0},
        "schema": {"type": "object"},
    },
    "allOf": [
        {"if": {"properties": {"type": {"enum": ["equals", "contains"]}}}, "then": {"required": ["value"]}},
        {"if": {"properties": {"type": {"const": "number_close"}}}, "then": {"required": ["value", "tolerance"]}},
        {"if": {"properties": {"type": {"const": "json_schema"}}}, "then": {"required": ["schema"]}},
    ],
}

KIND_SCHEMAS = {
    "Application": {
        "type": "object",
        "required": ["workloads"],
        "additionalProperties": False,
        "properties": {
            "workloads": {
                "type": "array", "minItems": 1, "maxItems": 10,
                "items": {"if": {"properties": {"type": {"const": "pipeline"}}},
                          "then": _PIPELINE, "else": _OTHER_WORKLOAD},
            },
        },
    },
    "EvalSuite": {
        "type": "object",
        "required": ["target"],
        "additionalProperties": False,
        "properties": {
            "target": {"type": "object", "required": ["ref", "workload"], "additionalProperties": False,
                       "properties": {"ref": _REF_STRING, "workload": {"type": "string", "pattern": NAME}}},
            "requiredPassRate": {"type": "number", "minimum": 0, "maximum": 1},
            "dataset": _REF_STRING,
            "checks": {"type": "array", "maxItems": 20, "items": _CHECK},
            "cases": {
                "type": "array", "maxItems": 200,
                "items": {"type": "object", "required": ["name", "input"], "additionalProperties": False,
                          "properties": {"name": {"type": "string", "maxLength": 120},
                                         "input": {"type": "object"},
                                         "expect": {"type": "array", "maxItems": 20, "items": _CHECK}}},
            },
        },
        "anyOf": [{"required": ["cases"]}, {"required": ["dataset"]}],
    },
    "Dataset": {
        "type": "object",
        "required": ["schema", "rows", "lineage"],
        "additionalProperties": False,
        "properties": {
            "schema": {"type": "object"},
            "rows": {"type": "array", "maxItems": 2000},
            "lineage": {
                "type": "object", "required": ["source"], "additionalProperties": False,
                "properties": {
                    "source": {"enum": ["manual", "upload", "derived", "captured-runs"]},
                    "parents": {"type": "array", "items": _REF_STRING, "maxItems": 10},
                    "transform": {"type": "string", "maxLength": 500},
                    "consent": {"type": "object", "required": ["grantedBy", "grantedAt"],
                                "properties": {"grantedBy": {"type": "string"}, "grantedAt": {"type": "string"}}},
                },
                "allOf": [
                    {"if": {"properties": {"source": {"const": "derived"}}}, "then": {"required": ["parents", "transform"]}},
                    {"if": {"properties": {"source": {"const": "captured-runs"}}}, "then": {"required": ["consent"]}},
                ],
            },
        },
    },
    "SecretRef": {
        "type": "object",
        "required": ["key"],
        "additionalProperties": False,
        "properties": {"key": {"type": "string", "pattern": SECRET_NAME},
                       "description": {"type": "string", "maxLength": 300}},
    },
    "Environment": {
        "type": "object",
        "required": ["stage"],
        "additionalProperties": False,
        "properties": {"stage": {"enum": list(ENVIRONMENTS)},
                       "requireTests": {"type": "boolean"}},
    },
}

_REGISTRY = Registry().with_resource(FILE_TYPE_URI, Resource(contents=FILE_SCHEMA, specification=DRAFT202012))
_ENVELOPE_VALIDATOR = Draft202012Validator(ENVELOPE_SCHEMA)
_KIND_VALIDATORS = {kind: Draft202012Validator(schema) for kind, schema in KIND_SCHEMAS.items()}


@dataclass(frozen=True)
class Problem:
    path: str
    message: str

    def as_dict(self) -> dict:
        return {"path": self.path, "message": self.message}


@dataclass(frozen=True)
class Ref:
    kind: str
    namespace: str
    name: str
    version: str

    def __str__(self) -> str:
        return f"{self.kind}/{self.namespace}/{self.name}@{self.version}"

    @property
    def key(self) -> str:
        """Identity without the version: Kind/namespace/name."""
        return f"{self.kind}/{self.namespace}/{self.name}"


class SpecError(ValueError):
    def __init__(self, problems: list[Problem]):
        self.problems = problems
        super().__init__("; ".join(f"{p.path or '(root)'}: {p.message}" for p in problems[:5]))


def parse_ref(text: str) -> Ref:
    m = _REF_RE.match(text or "")
    if not m or m["kind"] not in KINDS or not re.match(VERSION, m["version"]):
        raise ValueError(f"Not a resource reference: {text!r}. Use Kind/namespace/name@version")
    return Ref(m["kind"], m["namespace"], m["name"], m["version"])


def ref_of(doc: dict) -> Ref:
    meta = doc["metadata"]
    return Ref(doc["kind"], meta["namespace"], meta["name"], meta["version"])


def _check_json_values(value: Any, depth: int = 0) -> None:
    if depth > MAX_DEPTH:
        raise ValueError(f"Nested more than {MAX_DEPTH} levels deep")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Numbers must be finite")
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise ValueError("Object keys must be strings")
            _check_json_values(v, depth + 1)
    elif isinstance(value, list):
        for v in value:
            _check_json_values(v, depth + 1)
    elif not isinstance(value, (str, int, float, bool)) and value is not None:
        raise ValueError(f"Unsupported value of type {type(value).__name__}; use plain JSON values")


class _StrictLoader(yaml.SafeLoader):
    """YAML without implicit timestamps, so dates stay strings like in JSON."""


_StrictLoader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def _refuse_constant(name: str):
    raise ValueError(f"{name} is not allowed in strict JSON")


def parse_text(text: str, fmt: Optional[str] = None) -> dict:
    """A spec document from YAML or strict JSON text. fmt: 'json', 'yaml' or
    None (JSON when the text starts with '{')."""
    if len(text.encode("utf-8")) > MAX_SPEC_BYTES:
        raise ValueError(f"A spec can be at most {MAX_SPEC_BYTES // 1024} KiB")
    fmt = fmt or ("json" if text.lstrip().startswith("{") else "yaml")
    if fmt == "json":
        doc = json.loads(text, parse_constant=_refuse_constant)
    elif fmt == "yaml":
        docs = list(yaml.load_all(text, Loader=_StrictLoader))
        if len(docs) != 1:
            raise ValueError("Put one resource in each file")
        doc = docs[0]
    else:
        raise ValueError("Format must be json or yaml")
    if not isinstance(doc, dict):
        raise ValueError("A spec must be an object")
    _check_json_values(doc)
    return doc


def canonical_json(doc: Any) -> str:
    _check_json_values(doc)
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def content_hash(doc: Any) -> str:
    return hashlib.sha256(canonical_json(doc).encode("utf-8")).hexdigest()


def _path(parts) -> str:
    return "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in parts).lstrip(".")


def _problems(validator: Draft202012Validator, value: Any, prefix: list) -> list[Problem]:
    found = []
    for err in sorted(validator.iter_errors(value), key=lambda e: list(e.absolute_path)):
        # Branching keywords report every branch; the deepest error says most.
        best = max(err.context, key=lambda e: len(e.absolute_path), default=err) if err.context else err
        found.append(Problem(_path(prefix + list(best.absolute_path)), best.message))
    return found


def schema_problems(schema: Any, path: str) -> list[Problem]:
    """Problems with a JSON Schema the author wrote (a workload's input or
    output, a dataset's row schema)."""
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as e:
        return [Problem(path, f"Not a valid JSON Schema: {getattr(e, 'message', str(e))[:200]}")]
    return []


def schema_validator(schema: dict) -> Draft202012Validator:
    """A validator for an author's schema that understands aistrix://types/file."""
    return Draft202012Validator(schema, registry=_REGISTRY)


def validate_value(schema: dict, value: Any, path: str = "") -> list[Problem]:
    return _problems(schema_validator(schema), value, [path] if path else [])


def validate(doc: Any) -> list[Problem]:
    """Every problem with a resource document. Empty means it can be released."""
    if not isinstance(doc, dict):
        return [Problem("", "A spec must be an object")]
    problems = _problems(_ENVELOPE_VALIDATOR, doc, [])
    if problems:
        return problems
    kind = doc["kind"]
    if kind not in IMPLEMENTED_KINDS:
        return [Problem("kind", f"{kind} resources are part of the spec but not available on this platform yet")]
    problems = _problems(_KIND_VALIDATORS[kind], doc["spec"], ["spec"])
    if problems:
        return problems
    if kind == "Application":
        names = [w["name"] for w in doc["spec"]["workloads"]]
        for i, w in enumerate(doc["spec"]["workloads"]):
            if names.count(w["name"]) > 1:
                problems.append(Problem(f"spec.workloads[{i}].name", f"Workload name {w['name']!r} is used twice"))
            if w["type"] not in IMPLEMENTED_WORKLOADS:
                problems.append(Problem(f"spec.workloads[{i}].type",
                                        f"{w['type']} workloads are part of the spec but not available yet; use pipeline"))
            else:
                problems += schema_problems(w["input"], f"spec.workloads[{i}].input")
                problems += schema_problems(w["output"], f"spec.workloads[{i}].output")
    elif kind == "Dataset":
        spec = doc["spec"]
        problems += schema_problems(spec["schema"], "spec.schema")
        if not problems:
            row_check = schema_validator(spec["schema"])
            for i, row in enumerate(spec["rows"]):
                problems += _problems(row_check, row, ["spec", "rows", i])
                if len(problems) >= 20:
                    break
    elif kind == "EvalSuite":
        for i, case in enumerate(doc["spec"].get("cases") or []):
            if not case.get("expect") and not doc["spec"].get("checks"):
                problems.append(Problem(f"spec.cases[{i}]", "Give the case expect checks, or the suite shared checks"))
    for field in ("dependencies", "tests"):
        for i, text in enumerate(doc.get(field) or []):
            try:
                parse_ref(text)
            except ValueError as e:
                problems.append(Problem(f"{field}[{i}]", str(e)))
    for i, text in enumerate(doc.get("tests") or []):
        if text.split("/", 1)[0] != "EvalSuite":
            problems.append(Problem(f"tests[{i}]", "tests must reference EvalSuite resources"))
    return problems


def load(text: str, fmt: Optional[str] = None) -> dict:
    """Parse and validate. Raises SpecError with every problem found."""
    try:
        doc = parse_text(text, fmt)
    except (ValueError, yaml.YAMLError, RecursionError) as e:
        raise SpecError([Problem("", f"Could not read the spec: {str(e)[:300]}")])
    problems = validate(doc)
    if problems:
        raise SpecError(problems)
    return doc
