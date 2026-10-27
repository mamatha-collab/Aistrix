"""`{{ path }}` templates in node config. A path reads the run's input
(input.field), an upstream node's output (node or node.field.sub) or a
declared secret (secrets.NAME). No expressions, no code. Pure functions.
"""
import json
import re
from typing import Any, Callable, Iterator

TEMPLATE = re.compile(r"\{\{\s*([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\s*\}\}")
_WHOLE = re.compile(r"^\s*\{\{\s*([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\s*\}\}\s*$")


class MissingValue(KeyError):
    pass


def references(value: Any) -> Iterator[tuple[str, str]]:
    """(config path, template path) for every template in a config value."""
    def walk(v: Any, at: str):
        if isinstance(v, str):
            for m in TEMPLATE.finditer(v):
                yield at, m.group(1)
        elif isinstance(v, dict):
            for k, sub in v.items():
                yield from walk(sub, f"{at}.{k}" if at else k)
        elif isinstance(v, list):
            for i, sub in enumerate(v):
                yield from walk(sub, f"{at}[{i}]")
    yield from walk(value, "")


def lookup(path: str, context: dict) -> Any:
    head, *rest = path.split(".")
    if head not in context:
        raise MissingValue(path)
    value = context[head]
    for part in rest:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise MissingValue(path)
    return value


def _text(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def render(value: Any, resolve: Callable[[str], Any]) -> Any:
    """A config value with its templates filled in. A string that is exactly
    one template keeps the value's type; otherwise values become text."""
    if isinstance(value, str):
        whole = _WHOLE.match(value)
        if whole:
            return resolve(whole.group(1))
        return TEMPLATE.sub(lambda m: _text(resolve(m.group(1))), value)
    if isinstance(value, dict):
        return {k: render(v, resolve) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, resolve) for v in value]
    return value
