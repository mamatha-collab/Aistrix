"""Worst-case cost of a model run, reserved before the provider is called and
settled to real usage afterwards (supabase reserve_spend / settle_spend).
Pure functions, no I/O.

The estimate is deliberately high: every call is assumed to use its full
output allowance, tool loops their full step budget, and structured output its
repair retry. Settlement replaces it with the provider's reported usage.
"""
import math
from typing import Optional

CHARS_PER_TOKEN = 3.0          # conservative: real text averages about 4
IMAGE_TOKENS = 1600            # an upper bound per attached image
MAX_OUTPUT_TOKENS = 4096       # what every run path asks the provider for
TOOL_RESULT_TOKENS = 1000      # each tool round adds its call and result to the context

# Provider refusals that happen before any tokens are processed.
NOT_CHARGED = ("auth", "permission", "bad_request")


def calls_for(*, tools: bool, max_tool_steps: int, structured: bool) -> int:
    if tools:
        return max(1, min(int(max_tool_steps or 10), 20)) + 1
    return 2 if structured else 1


def estimate_usd(prices: Optional[tuple[float, float]], *, prompt_chars: int, images: int = 0,
                 calls: int = 1, max_output: int = MAX_OUTPUT_TOKENS) -> Optional[float]:
    """None when the model's price isn't known."""
    if not prices:
        return None
    price_in, price_out = prices
    base_in = math.ceil(prompt_chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS
    total = 0.0
    for call in range(calls):
        tokens_in = base_in + call * (TOOL_RESULT_TOKENS + max_output)
        total += (tokens_in * price_in + max_output * price_out) / 1_000_000
    return round(total, 6)


def settle_outcome(*, finished: bool, failure_kind: Optional[str], actual: Optional[float], has_usage: bool) -> str:
    """How a reservation ends: settled (usage known), released (the provider
    refused before working) or uncertain (it may have run; keep it counted)."""
    if finished or has_usage:
        return "settled"
    if failure_kind in NOT_CHARGED:
        return "released"
    return "uncertain"


def refusal_message(result: dict, *, payer: str, label: str) -> str:
    code, scope = result.get("code"), result.get("scope")
    whose = {"platform": "The platform's", "workspace": "This workspace's"}.get(scope) or (
        "Your" if payer == "own" else "The app developer's")
    if code == "unknown_price":
        return (f"{whose} spending limit can't be checked for this model because its price isn't known. "
                f"Pick a model with a listed price, or remove the limit.")
    period = "today's" if result.get("period") == "day" else "this month's"
    limit = result.get("limit_usd")
    amount = f" of ${float(limit):.2f}" if limit is not None else ""
    return f"{whose} {period} AI spending limit{amount} has been reached for {label}. Raise the limit or try again later."
