"""Model gateway (AEX data plane): every model call in a pipeline goes
through here. It resolves the model, checks the run's budget and the
platform's spending controls before calling the provider, streams tokens,
and settles the real cost afterwards.

Provider access, keys, prices and spending controls are injected, so the
same gateway runs inside the backend (main.py's providers and Supabase
spend reservations) and in tests or the local runner.
"""
import asyncio
import json
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

    # One tool-calling turn (agents). messages and tools use the provider-
    # neutral shapes below; returns {"text": str, "tool_calls": [{"id",
    # "name", "arguments"}], "stop": str} and fills usage.
    async def chat(self, *, provider: str, model: str, api_key: str, system: str, messages: list,
                   tools: list, max_tokens: int, temperature: float, usage: dict) -> dict: ...


# Provider-neutral conversation, as agents keep it:
#   {"role": "user", "content": str}
#   {"role": "assistant", "text": str, "tool_calls": [{"id", "name", "arguments": dict}]}
#   {"role": "tool", "results": [{"id", "name", "content": str, "is_error": bool}]}
# Tools: {"name", "description", "parameters": JSON Schema}.


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


def claude_messages(messages: list) -> list:
    """The neutral conversation in Anthropic Messages API form."""
    out = []
    for m in messages:
        if m["role"] == "user":
            out.append({"role": "user", "content": m["content"]})
        elif m["role"] == "assistant":
            blocks = [{"type": "text", "text": m["text"]}] if m.get("text") else []
            blocks += [{"type": "tool_use", "id": c["id"], "name": c["name"], "input": c["arguments"]}
                       for c in m.get("tool_calls") or []]
            out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": "(no answer)"}]})
        elif m["role"] == "tool":
            out.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": r["id"], "content": r["content"],
                                                     "is_error": bool(r.get("is_error"))} for r in m["results"]]})
    return out


def openai_messages(system: str, messages: list) -> list:
    """The neutral conversation in OpenAI Chat Completions form (also Gemini's
    OpenAI-compatible endpoint)."""
    out = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] == "user":
            out.append({"role": "user", "content": m["content"]})
        elif m["role"] == "assistant":
            msg = {"role": "assistant", "content": m.get("text") or None}
            if m.get("tool_calls"):
                msg["tool_calls"] = [{"id": c["id"], "type": "function",
                                      "function": {"name": c["name"], "arguments": json.dumps(c["arguments"], ensure_ascii=False)}}
                                     for c in m["tool_calls"]]
            out.append(msg)
        elif m["role"] == "tool":
            out += [{"role": "tool", "tool_call_id": r["id"], "content": r["content"]} for r in m["results"]]
    return out


def parse_arguments(text: Optional[str]) -> dict:
    try:
        value = json.loads(text or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


async def sdk_chat(client, *, provider: str, model: str, system: str, messages: list, tools: list,
                   max_tokens: int, temperature: float, usage: dict,
                   on_text: Optional[Callable[[str], Awaitable[None]]] = None) -> dict:
    """One tool-calling turn on an official SDK client: anthropic.AsyncAnthropic
    for claude, openai.AsyncOpenAI (or Gemini's compatible endpoint) otherwise.
    Shared by the hosted and local adapters. on_text: streams the answer's
    text as it arrives (tool calls still come whole at the end)."""
    if provider == "claude":
        extra = {"tools": [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]}
                           for t in tools]} if tools else {}
        kwargs = dict(model=model, max_tokens=max_tokens, temperature=temperature, system=system,
                      messages=claude_messages(messages), **extra)
        if on_text:
            async with client.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    await on_text(text)
                resp = await stream.get_final_message()
        else:
            resp = await client.messages.create(**kwargs)
        usage.update(input_tokens=resp.usage.input_tokens, output_tokens=resp.usage.output_tokens)
        return {"text": "".join(b.text for b in resp.content if b.type == "text"),
                "tool_calls": [{"id": b.id, "name": b.name, "arguments": b.input if isinstance(b.input, dict) else {}}
                               for b in resp.content if b.type == "tool_use"],
                "stop": resp.stop_reason}
    extra = {"tools": [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                         "parameters": t["parameters"]}} for t in tools]} if tools else {}
    kwargs = dict(model=model, max_tokens=max_tokens, temperature=temperature,
                  messages=openai_messages(system, messages), **extra)
    if on_text:
        return await _openai_streamed(client, kwargs, usage, on_text)
    resp = await client.chat.completions.create(**kwargs)
    if resp.usage:
        usage.update(input_tokens=resp.usage.prompt_tokens, output_tokens=resp.usage.completion_tokens)
    choice = resp.choices[0]
    return {"text": choice.message.content or "",
            "tool_calls": [{"id": c.id, "name": c.function.name, "arguments": parse_arguments(c.function.arguments)}
                           for c in choice.message.tool_calls or []],
            "stop": choice.finish_reason}


async def _openai_streamed(client, kwargs: dict, usage: dict, on_text) -> dict:
    """Chat Completions with stream=True: text deltas go to on_text; tool call
    fragments are joined by index."""
    stream = await client.chat.completions.create(stream=True, stream_options={"include_usage": True}, **kwargs)
    text, calls, stop = [], {}, None
    async for chunk in stream:
        if getattr(chunk, "usage", None):
            usage.update(input_tokens=chunk.usage.prompt_tokens, output_tokens=chunk.usage.completion_tokens)
        for choice in chunk.choices or []:
            stop = choice.finish_reason or stop
            delta = choice.delta
            if delta is None:
                continue
            if delta.content:
                text.append(delta.content)
                await on_text(delta.content)
            for part in delta.tool_calls or []:
                call = calls.setdefault(part.index, {"id": None, "name": "", "arguments": ""})
                if part.id:
                    call["id"] = part.id
                if part.function and part.function.name:
                    call["name"] += part.function.name
                if part.function and part.function.arguments:
                    call["arguments"] += part.function.arguments
    return {"text": "".join(text),
            "tool_calls": [{"id": c["id"], "name": c["name"], "arguments": parse_arguments(c["arguments"])}
                           for _, c in sorted(calls.items())],
            "stop": stop}


@dataclass
class ToolTurn:
    text: str
    tool_calls: list
    stop: str
    provider: str
    model: str
    usage: dict = field(default_factory=dict)
    cost_usd: Optional[float] = None


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

    async def _admit(self, ctx: CallContext, provider: str, model: str, estimate: Optional[float]):
        """Budget and key checks, then the spend reservation: (api key, reservation id)."""
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
        return api_key, rid

    async def converse(self, ctx: CallContext, *, model_ref: str, providers: Optional[list], system: str,
                       messages: list, tools: list, max_tokens: int = 1024, temperature: float = 0.0,
                       stream: bool = False) -> ToolTurn:
        """One model turn that may ask for tool calls (agents, the compatible
        API). Same budget, key and spend rules as invoke. stream: text goes to
        ctx.on_token as it arrives."""
        provider, model = self.resolve(model_ref, providers)
        if not hasattr(self.adapter, "chat"):
            raise NodeError("This server can't run agents: its model adapter has no tool calling", code="agent_unavailable")
        size = len(system) + len(json.dumps(messages, ensure_ascii=False)) + len(json.dumps(tools, ensure_ascii=False))
        estimate = spend_guard.estimate_usd(self.prices.get(model), prompt_chars=size, calls=1, max_output=max_tokens)
        api_key, rid = await self._admit(ctx, provider, model, estimate)
        usage: dict = {}
        finished, failure = False, None
        try:
            extra = {"on_text": ctx.on_token} if stream and ctx.on_token else {}
            reply = await self.adapter.chat(provider=provider, model=model, api_key=api_key, system=system,
                                            messages=messages, tools=tools, max_tokens=max_tokens,
                                            temperature=temperature, usage=usage, **extra)
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
        return ToolTurn(text=reply.get("text") or "", tool_calls=list(reply.get("tool_calls") or []),
                        stop=reply.get("stop") or "end", provider=provider, model=model,
                        usage={k: v for k, v in usage.items() if not k.startswith("_")},
                        cost_usd=cost if cost is not None else estimate)

    async def invoke(self, ctx: CallContext, *, model_ref: str, providers: Optional[list], system: str, prompt: str,
                     max_tokens: int = 1024, temperature: float = 0.0, calls: int = 1) -> ModelResult:
        provider, model = self.resolve(model_ref, providers)
        estimate = spend_guard.estimate_usd(self.prices.get(model), prompt_chars=len(system) + len(prompt),
                                            calls=calls, max_output=max_tokens)
        api_key, rid = await self._admit(ctx, provider, model, estimate)
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
