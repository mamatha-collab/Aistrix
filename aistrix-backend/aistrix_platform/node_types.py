"""The node catalog: what each pipeline node type accepts, returns and is
allowed to touch. The compiler checks graphs against it; the runtime
(nodes.py) implements it. Pure data, no I/O.
"""
from dataclasses import dataclass, field
from typing import Optional

# Value kinds carried along edges.
TEXT, OBJECT, FILE, LIST, NUMBER, BOOLEAN, ANY = "text", "object", "file", "list", "number", "boolean", "any"

_MODEL = {"type": "string", "pattern": r"^(policy:(fast|balanced|best)|(claude|openai|gemini)/[A-Za-z0-9][A-Za-z0-9._:-]{0,99})$"}
_PROMPT = {"type": "string", "minLength": 1, "maxLength": 20000}


@dataclass(frozen=True)
class NodeType:
    use: str
    summary: str
    config_schema: dict
    accepts: frozenset
    output: str                       # a kind, or "same" (passes its input through)
    side_effect: str = "none"         # "none" or "external"
    secret_fields: frozenset = field(default_factory=frozenset)   # config keys that may read {{secrets.X}}
    model_call: bool = False
    hosted: bool = True               # False: only the local runner can execute it


CATALOG: dict[str, NodeType] = {t.use: t for t in [
    NodeType(
        use="parse.document",
        summary="Extract the text of a PDF, Word, Excel or text file.",
        config_schema={"type": "object", "additionalProperties": False,
                       "properties": {"maxChars": {"type": "integer", "minimum": 100, "maximum": 400000}}},
        accepts=frozenset({FILE, TEXT}), output=TEXT,
    ),
    NodeType(
        use="llm.chat",
        summary="Ask a model; returns its text.",
        config_schema={"type": "object", "required": ["model", "prompt"], "additionalProperties": False,
                       "properties": {"model": _MODEL, "prompt": _PROMPT, "system": _PROMPT,
                                      "temperature": {"type": "number", "minimum": 0, "maximum": 1},
                                      "maxTokens": {"type": "integer", "minimum": 16, "maximum": 4096}}},
        accepts=frozenset({TEXT, OBJECT, LIST, NUMBER, BOOLEAN}), output=TEXT, model_call=True,
    ),
    NodeType(
        use="llm.structured",
        summary="Ask a model for JSON that matches a schema.",
        config_schema={"type": "object", "required": ["model", "prompt", "schema"], "additionalProperties": False,
                       "properties": {"model": _MODEL, "prompt": _PROMPT, "system": _PROMPT,
                                      "schema": {"oneOf": [{"type": "object"}, {"const": "$output"}]},
                                      "maxTokens": {"type": "integer", "minimum": 16, "maximum": 4096}}},
        accepts=frozenset({TEXT, OBJECT, LIST, NUMBER, BOOLEAN}), output=OBJECT, model_call=True,
    ),
    NodeType(
        use="code.python",
        summary="Run Python in the isolated code workers (a deployed Code Application).",
        config_schema={"type": "object", "additionalProperties": False,
                       "properties": {"app": {"type": "string", "format": "uuid",
                                              "pattern": r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},
                                      "entry": {"type": "string", "pattern": r"^[A-Za-z0-9_./-]{1,200}\.py$"},
                                      "input": {}},
                       "oneOf": [{"required": ["app"]}, {"required": ["entry"]}]},
        accepts=frozenset({OBJECT, TEXT, LIST, NUMBER, BOOLEAN}), output=OBJECT,
    ),
    NodeType(
        use="http",
        summary="Call an outside API. Writes need an idempotency key.",
        config_schema={"type": "object", "required": ["method", "url"], "additionalProperties": False,
                       "properties": {"method": {"enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
                                      # https://, or the owner's private test destination,
                                      # which captures the request instead of sending it.
                                      "url": {"type": "string", "maxLength": 2000,
                                              "pattern": r"^(https://|aistrix-test://destinations/[a-z0-9][a-z0-9-]{0,39}$)"},
                                      "headers": {"type": "object", "maxProperties": 20,
                                                  "additionalProperties": {"type": "string", "maxLength": 2000}},
                                      "body": {},
                                      "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 200}}},
        accepts=frozenset({OBJECT, TEXT, LIST, NUMBER, BOOLEAN}), output=OBJECT,
        side_effect="external", secret_fields=frozenset({"headers", "url"}),
    ),
    NodeType(
        use="human.approve",
        summary="Wait for a person to approve; `when` limits it to the cases that need review.",
        config_schema={"type": "object", "additionalProperties": False,
                       "properties": {"message": {"type": "string", "maxLength": 1000},
                                      "expiresHours": {"type": "integer", "minimum": 1, "maximum": 720}}},
        accepts=frozenset({ANY}), output="same",
    ),
    NodeType(
        use="data.template",
        summary="Build an object or text from earlier values.",
        config_schema={"type": "object", "required": ["value"], "additionalProperties": False,
                       "properties": {"value": {}}},
        accepts=frozenset({ANY}), output=ANY,
    ),
]}

WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
TEST_DESTINATION = "aistrix-test://destinations/"


def get(use: str) -> Optional[NodeType]:
    return CATALOG.get(use)


def is_side_effecting(use: str, config: dict) -> bool:
    nt = CATALOG.get(use)
    if not nt or nt.side_effect != "external":
        return False
    return use != "http" or (config.get("method") or "GET").upper() in WRITE_METHODS


def describe() -> list[dict]:
    """The catalog as the API and CLI show it."""
    return [{"use": t.use, "summary": t.summary, "config": t.config_schema, "accepts": sorted(t.accepts),
             "output": t.output, "sideEffect": t.side_effect, "hosted": t.hosted} for t in CATALOG.values()]
