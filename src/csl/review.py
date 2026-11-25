"""Human review: the only path to an approved image.

A hard-failed candidate cannot be approved unless the reviewer passes ``override`` and
writes a note. The override is recorded in the decision, so the exception stays visible in
the audit trail instead of disappearing into a changed threshold.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from csl import integrity
from csl.schema import Decision

if TYPE_CHECKING:
    from csl.store import RunStore


class ReviewError(ValueError):
    """Raised for a decision the review rules do not allow."""


def decide(
    store: RunStore,
    candidate_id: str,
    verdict: Literal["approve", "reject"],
    reviewer: str,
    note: str = "",
    *,
    override: bool = False,
) -> Decision:
    """Record a decision for a candidate and return it.

    The whole read-check-append-seal sequence runs under the run's lock, so concurrent
    callers (web threads, the CLI) queue up instead of forking the hash chain.
    """
    with store.lock():
        return _decide_locked(store, candidate_id, verdict, reviewer, note, override=override)


def _decide_locked(
    store: RunStore,
    candidate_id: str,
    verdict: Literal["approve", "reject"],
    reviewer: str,
    note: str,
    *,
    override: bool,
) -> Decision:
    try:
        integrity.require_intact(store)
    except integrity.IntegrityError as error:
        raise ReviewError(str(error)) from error
    view = store.candidate(candidate_id)
    if not reviewer.strip():
        msg = "a reviewer name is required"
        raise ReviewError(msg)
    if verdict == "approve" and not view.evaluation.hard_pass:
        failed = ", ".join(c.name for c in view.evaluation.checks if c.hard and not c.passed)
        if not override:
            msg = f"{candidate_id} failed hard checks ({failed}); approving needs --override"
            raise ReviewError(msg)
        if not note.strip():
            msg = "an override needs a written justification (--note)"
            raise ReviewError(msg)
    decision = Decision(
        candidate_id=candidate_id,
        verdict=verdict,
        reviewer=reviewer.strip(),
        note=note.strip(),
        override=override and verdict == "approve" and not view.evaluation.hard_pass,
        decided_at=datetime.now(UTC),
    )
    chained = store.append_decision(decision)
    integrity.seal_decisions(store)
    return chained
