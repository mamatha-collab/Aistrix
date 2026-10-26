"""Versioned tool contracts: what a released app promises the things that call
it (workflow steps, agents, the API). Pure functions, no I/O.

A contract is derived from a release snapshot (the app's prompt, blueprint and
tools at publish time) plus the developer's optional declarations in
blueprint["contract"]. New releases store their contract; releases saved before
contracts existed get one derived on read, so old releases keep working.
"""
import hashlib
import json
import re
from typing import Any, Optional
from urllib.parse import urlsplit

CONTRACT_VERSION = 1
SUPPORTED_CONTRACT_VERSIONS = (1,)

FIELD_TYPES = ("string", "number", "boolean", "enum", "string_array", "number_array", "object")
DATA_CLASSES = ("standard", "confidential")
MODEL_ROUTES = ("external", "private")
# Ordered: a declaration may say more than the tools do, never less.
SIDE_EFFECTS = ("none", "external_read", "external_write")
MIN_TIMEOUT_SECONDS = 5
MAX_FIELDS = 100
_FIELD_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_ \-]{0,63}$")

# What each tool type does outside the platform.
_TOOL_EFFECTS = {
    "calculator": "none", "calendar": "none", "storage": "none",
    "fetch": "external_read", "search": "external_read", "pdf": "external_read", "ocr": "external_read",
    "email": "external_write", "app": "external_write",
}


def _fields(node: Any) -> list:
    if isinstance(node, dict) and isinstance(node.get("fields"), list):
        return node["fields"]
    return []


def schema_fields(blueprint: dict, key: str) -> list:
    """Same reading as the run path: <key>.fields, or the output contract's fields."""
    fields = _fields(blueprint.get(key))
    if fields or key != "output_schema":
        return fields
    contract = blueprint.get("output_contract") or {}
    return (contract.get("fields") or contract.get("required_fields") or []) if isinstance(contract, dict) else []


def field_problems(fields: Any, where: str) -> list[str]:
    """Problems with a list of field definitions (input or output schema)."""
    if not isinstance(fields, list):
        return [f"{where} must be a list of fields"]
    if len(fields) > MAX_FIELDS:
        return [f"{where} has more than {MAX_FIELDS} fields"]
    problems, seen = [], set()
    for i, field in enumerate(fields):
        if not isinstance(field, dict):
            problems.append(f"{where} field {i + 1} isn't a field definition")
            continue
        name = field.get("field") or field.get("name")
        label = f'{where} field "{name}"' if name else f"{where} field {i + 1}"
        if not isinstance(name, str) or not _FIELD_NAME.match(name):
            problems.append(f"{label} needs a name of up to 64 letters, digits, spaces, _ or -")
            continue
        if name in seen:
            problems.append(f"{label} is defined twice")
        seen.add(name)
        ftype = field.get("type") or "string"
        if ftype not in FIELD_TYPES:
            problems.append(f"{label} has an unknown type: {ftype}")
        elif ftype == "enum":
            values = field.get("enum_values")
            if not isinstance(values, list) or not values or any(not isinstance(v, str) for v in values):
                problems.append(f"{label} is a choice field without a list of text choices")
        elif ftype == "object" and field.get("nested_fields") is not None:
            problems.extend(field_problems(field["nested_fields"], label))
    return problems


def tool_effect(tool: dict) -> str:
    kind = tool.get("type") or ""
    if kind == "http":
        method = str(((tool.get("config") or {}) if isinstance(tool.get("config"), dict) else {}).get("method") or "POST").upper()
        return "external_read" if method == "GET" else "external_write"
    return _TOOL_EFFECTS.get(kind, "external_write")     # unknown tools count as the riskiest


def _secret_names(tools: list, secret_ref: re.Pattern) -> list[str]:
    found = set()
    for tool in tools:
        found.update(m.upper() for m in secret_ref.findall(json.dumps(tool.get("config") or {}, default=str)))
    return sorted(found)


def _tool_destinations(tools: list) -> list[str]:
    hosts = set()
    for tool in tools:
        config = tool.get("config") if isinstance(tool.get("config"), dict) else {}
        url = str(config.get("url") or "")
        if url.startswith(("http://", "https://")) and "{{" not in url:
            host = urlsplit(url).hostname
            if host:
                hosts.add(host.lower())
    return sorted(hosts)


def model_route(custom_model_url: Optional[str], private_hosts: frozenset) -> str:
    """"private" only for a custom model on an explicitly approved host."""
    host = (urlsplit(custom_model_url or "").hostname or "").lower()
    return "private" if host and host in private_hosts else "external"


def declaration_problems(declared: Any, *, max_timeout: int, derived_effects: str) -> list[str]:
    if declared is None:
        return []
    if not isinstance(declared, dict):
        return ["The contract declaration must be an object"]
    problems = []
    timeout = declared.get("timeout_seconds")
    if timeout is not None and (not isinstance(timeout, int) or isinstance(timeout, bool)
                                or not MIN_TIMEOUT_SECONDS <= timeout <= max_timeout):
        problems.append(f"The timeout must be a whole number of seconds from {MIN_TIMEOUT_SECONDS} to {max_timeout}")
    if declared.get("data_class") is not None and declared["data_class"] not in DATA_CLASSES:
        problems.append(f"The data class must be one of: {', '.join(DATA_CLASSES)}")
    effects = declared.get("side_effects")
    if effects is not None:
        if effects not in SIDE_EFFECTS:
            problems.append(f"Side effects must be one of: {', '.join(SIDE_EFFECTS)}")
        elif SIDE_EFFECTS.index(effects) < SIDE_EFFECTS.index(derived_effects):
            problems.append(f'The contract declares side effects "{effects}" but its tools have "{derived_effects}"')
    return problems


def build_contract(snapshot: dict, *, custom_model_url: Optional[str] = None, max_timeout: int,
                   private_hosts: frozenset = frozenset(), secret_ref: re.Pattern) -> dict:
    """The contract for one release snapshot. Never raises on odd old data:
    unknown values fall back to the safest reading."""
    blueprint = snapshot.get("blueprint") if isinstance(snapshot.get("blueprint"), dict) else {}
    tools = [t for t in (snapshot.get("tools") or []) if isinstance(t, dict)]
    declared = blueprint.get("contract") if isinstance(blueprint.get("contract"), dict) else {}
    derived = max((tool_effect(t) for t in tools), key=SIDE_EFFECTS.index, default="none")
    effects = declared.get("side_effects") if declared.get("side_effects") in SIDE_EFFECTS else derived
    if SIDE_EFFECTS.index(effects) < SIDE_EFFECTS.index(derived):
        effects = derived
    timeout = declared.get("timeout_seconds")
    if not (isinstance(timeout, int) and not isinstance(timeout, bool) and MIN_TIMEOUT_SECONDS <= timeout <= max_timeout):
        timeout = max_timeout
    output = schema_fields(blueprint, "output_schema")
    out_contract = blueprint.get("output_contract") if isinstance(blueprint.get("output_contract"), dict) else {}
    structured = bool(output) and (snapshot.get("output_type") == "json" or out_contract.get("format") == "json")
    return {
        "contract_version": CONTRACT_VERSION,
        "input": {"fields": schema_fields(blueprint, "input_schema")},
        "output": {"fields": output if structured else [], "structured": structured},
        "execution": {"mode": "sync", "timeout_seconds": timeout},
        "auth": {"requires_caller": True, "secrets": _secret_names(tools, secret_ref)},
        "side_effects": effects,
        "privacy": {
            "data_class": declared.get("data_class") if declared.get("data_class") in DATA_CLASSES else "standard",
            "model_route": model_route(custom_model_url, private_hosts),
            "provider": snapshot.get("ai_provider") or "claude",
            "external_destinations": _tool_destinations(tools),
        },
    }


def contract_problems(snapshot: dict, *, max_timeout: int, secret_ref: re.Pattern) -> list[str]:
    """Why a draft can't be released under the current contract version."""
    blueprint = snapshot.get("blueprint") if isinstance(snapshot.get("blueprint"), dict) else {}
    tools = [t for t in (snapshot.get("tools") or []) if isinstance(t, dict)]
    derived = max((tool_effect(t) for t in tools), key=SIDE_EFFECTS.index, default="none")
    problems = []
    for key, where in (("input_schema", "Input"), ("output_schema", "Output")):
        node = blueprint.get(key)
        if node is not None and not isinstance(node, dict):
            problems.append(f"{where} schema must be an object with a list of fields")
        elif isinstance(node, dict) and node.get("fields") is not None:
            problems.extend(field_problems(node["fields"], where))
    problems.extend(declaration_problems(blueprint.get("contract"), max_timeout=max_timeout, derived_effects=derived))
    return problems


def contract_for_release(snapshot: dict, **kwargs) -> dict:
    """A release's stored contract when it has a supported one; otherwise one
    derived from the snapshot (releases saved before contracts existed)."""
    stored = snapshot.get("contract")
    if isinstance(stored, dict) and stored.get("contract_version") in SUPPORTED_CONTRACT_VERSIONS:
        return stored
    return build_contract(snapshot, **kwargs)


def contract_hash(contract: dict) -> str:
    return hashlib.sha256(json.dumps(contract, sort_keys=True, default=str).encode()).hexdigest()[:16]
