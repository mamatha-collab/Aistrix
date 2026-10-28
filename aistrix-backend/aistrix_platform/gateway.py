"""Model gateway (AEX data plane): every model call in a pipeline goes
through here. It resolves the model, checks the run's budget and the
platform's spending controls before calling the provider, streams tokens,
and settles the real cost afterwards.

Provider access, keys, prices and spending controls are injected, so the
same gateway runs inside the backend (main.py's providers and Supabase
spend reservations) and in tests or the local runner.
"""
import asyncio
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Optional, Protocol

import spend_guard

from .errors import BudgetExceeded, NodeError, PolicyRefused

# policy:<tier> → (provider, model), per provider. Pinned versions, so a
# release always calls the same model.
POLICY_MODELS = {
    "claude": {"fast": "claude-haiku-5-5", "balanced": "claude-sonnet-5-5", "best": "claude-opus-5-5"},
    "openai": {"fast": "gpt-4o-mini", "balanced": "gpt-4o", "best": "gpt-4o"},
    "gemini": {"fast": "gemini-3.8-flash", "balanced": "gemini-3.8-flash", "best": "gemini-3.8-flash"},
}
PROVIDER_ORDER = ("claude", "openai", "gemini")


class ProviderAdapter(Protocol):
    def stream(self, *, provider: str, model: str, api_key: str, system: str, prompt: str,
               max_tokens: int, temperature: float, usage: dict) -> AsyncIterator[str]: ...


@dataclass
class CallContext:
    owner_id: Optional[str]
    workspace_id: Optional[str]
    resource: str
    budget_remaining: Optional[float]           # None: no run budget
    on_token: Optional[Callable[[str], Awaitable[None]]] = None
    on_status: Optional[Callable[[dict], Awaitable[None]]] = None   # progress a node reports (e.g. repairing output)


@dataclass
class ModelResult:
    text: str
    provider: str
    model: str
    usage: dict = field(default_factory=dict)
    cost_usd: Optional[float] = None
    reserved_usd: Optional[float] = None


# reserve(ctx, provider, model, amount) -> (reservation id or None, refusal dict or None)
Reserve = Callable[[CallContext, str, str, Optional[float]], Awaitable[tuple[Optional[str], Optional[dict]]]]
# settle(reservation id, actual cost, outcome)
Settle = Callable[[Optional[str], Optional[float], str], Awaitable[None]]
# key_for(ctx, provider) -> api key or None
KeyFor = Callable[[CallContext, str], Awaitable[Optional[str]]]


def _failure_kind(e: BaseException) -> str:
    status = getattr(e, "status_code", None) or getattr(getattr(e, "response", None), "status_code", None)
    name = type(e).__name__.lower()
    if isinstance(e, (asyncio.TimeoutError, TimeoutError)) or "timeout" in name:
        return "timeout"
    if status == 429 or "ratelimit" in name:
        return "rate_limit"
    if status in (401,) or "authentication" in name:
        return "auth"
    if status in (403,) or "permission" in name:
        return "permission"
    if status in (400, 404, 422) or "badrequest" in name or "notfound" in name:
        return "bad_request"
    if (isinstance(status, int) and status >= 500) or "connection" in name or "overloaded" in name or "internalserver" in name:
        return "unavailable"
    return "unknown"


class ModelGateway:
    def __init__(self, adapter: ProviderAdapter, *, prices: dict[str, tuple[float, float]], key_for: KeyFor,
                 reserve: Optional[Reserve] = None, settle: Optional[Settle] = None):
        self.adapter = adapter
        self.prices = prices
        self.key_for = key_for
        self.reserve = reserve
        self.settle = settle

    def resolve(self, model_ref: str, providers: Optional[list] = None) -> tuple[str, str]:
        """(provider, model) for "policy:<tier>" or "<provider>/<model>"."""
        if model_ref.startswith("policy:"):
            tier = model_ref.split(":", 1)[1]
            for provider in PROVIDER_ORDER:
                if not providers or provider in providers:
                    return provider, POLICY_MODELS[provider][tier]
            raise PolicyRefused("No allowed provider can serve this model policy")
        provider, model = model_ref.split("/", 1)
        if providers and provider not in providers:
            raise PolicyRefused(f"Provider {provider} isn't allowed for this resource")
        return provider, model

    def cost(self, model: str, usage: dict) -> Optional[float]:
        prices = self.prices.get(model)
        if not prices or not usage:
            return None
        pin, pout = prices
        return round(((usage.get("input_tokens") or 0) * pin + (usage.get("output_tokens") or 0) * pout) / 1_000_000, 6)

    async def invoke(self, ctx: CallContext, *, model_ref: str, providers: Optional[list], system: str, prompt: str,
                     max_tokens: int = 1024, temperature: float = 0.0, calls: int = 1) -> ModelResult:
        provider, model = self.resolve(model_ref, providers)
        estimate = spend_guard.estimate_usd(self.prices.get(model), prompt_chars=len(system) + len(prompt),
                                            calls=calls, max_output=max_tokens)
        if ctx.budget_remaining is not None:
            if estimate is None:
                raise BudgetExceeded(f"{model} has no listed price, so the run's budget can't be checked")
            if estimate > ctx.budget_remaining:
                raise BudgetExceeded(f"This call could cost up to ${estimate:.4f}, more than the "
                                     f"${ctx.budget_remaining:.4f} left in the run's budget")
        api_key = await self.key_for(ctx, provider)
        if not api_key:
            raise NodeError(f"No {provider} API key is available. Add one in Settings → AI providers.", code="no_key")
        rid = None
        if self.reserve:
            rid, refusal = await self.reserve(ctx, provider, model, estimate)
            if refusal:
                raise BudgetExceeded(refusal.get("message") or "A spending limit has been reached")
        usage: dict = {}
        chunks: list[str] = []
        finished = False
        failure = None
        try:
            async for token in self.adapter.stream(provider=provider, model=model, api_key=api_key, system=system,
                                                   prompt=prompt, max_tokens=max_tokens, temperature=temperature,
                                                   usage=usage):
                chunks.append(token)
                if ctx.on_token:
                    await ctx.on_token(token)
            finished = True
        except Exception as e:
            failure = _failure_kind(e)
            transient = failure in ("timeout", "rate_limit", "unavailable")
            raise NodeError(f"The {provider} call failed ({failure})", transient=transient, code=f"model_{failure}") from e
        finally:
            actual = self.cost(model, usage)
            if self.settle and rid:
                outcome = spend_guard.settle_outcome(finished=finished, failure_kind=failure, actual=actual,
                                                     has_usage=bool(usage))
                await self.settle(rid, actual if actual is not None else (None if outcome == "released" else estimate), outcome)
        cost = self.cost(model, usage)
        return ModelResult(text="".join(chunks), provider=provider, model=model, usage={
            k: v for k, v in usage.items() if not k.startswith("_")}, cost_usd=cost if cost is not None else estimate,
            reserved_usd=estimate)
