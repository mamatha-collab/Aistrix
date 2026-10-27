"""Errors the AEX data plane raises. A node failure says whether retrying
could help (transient) and whether an outside effect may already have
happened (uncertain), so the orchestrator never repeats an unsafe write."""


class NodeError(Exception):
    def __init__(self, message: str, *, transient: bool = False, uncertain: bool = False, code: str = "node_failed"):
        super().__init__(message)
        self.message = message
        self.transient = transient
        self.uncertain = uncertain
        self.code = code


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
