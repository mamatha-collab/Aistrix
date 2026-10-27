"""Errors the AEX data plane raises. A node failure says whether retrying
could help (transient) and whether an outside effect may already have
happened (uncertain), so the orchestrator never repeats an unsafe write."""
from typing import Optional


class NodeError(Exception):
    def __init__(self, message: str, *, transient: bool = False, uncertain: bool = False, code: str = "node_failed",
                 repeat_safe: Optional[bool] = None, detail: Optional[dict] = None):
        """repeat_safe: whether this attempt can be repeated without repeating an
        outside effect; None leaves it to the node's plan (side effect and key).
        detail: kept on the step, like a successful step's detail."""
        super().__init__(message)
        self.message = message
        self.transient = transient
        self.uncertain = uncertain
        self.code = code
        self.repeat_safe = repeat_safe
        self.detail = detail or {}


class BudgetExceeded(NodeError):
    def __init__(self, message: str):
        super().__init__(message, code="budget_exceeded")


class PolicyRefused(NodeError):
    def __init__(self, message: str):
        super().__init__(message, code="policy_refused")


class InputError(ValueError):
    def __init__(self, problems: list):
        self.problems = problems
        super().__init__("; ".join(f"{p.path or 'input'}: {p.message}" for p in problems[:5]))


class LeaseHeld(RuntimeError):
    """Another worker owns this run right now."""


class LeaseLost(RuntimeError):
    """This worker lost the run's lease; it must stop before more work."""


class Conflict(RuntimeError):
    """The record changed since it was read."""
