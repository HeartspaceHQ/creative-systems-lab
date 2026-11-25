"""Approved budgets for paid generation, and the ledger that spends them.

No hosted model is called without an approval file written by a person. Before each call the
ledger reserves the quoted amount and refuses when the approval would be exceeded; after the
call the reservation is settled with the cost the provider reported. Every reservation has its
own id, so two runs that overlap, or reuse a candidate name, never settle each other's holds.
A failed call keeps its reservation: whether a provider charged for it cannot be known from
here, so the ledger errs towards overstating spend. The one exception is a call the provider
refused with an HTTP 4xx before generating anything (an invalid size, a missing permission): it
is settled at 0. The ledger is append-only JSON lines next to the approval file, so the spend of
a budget survives across runs; how a settlement counts (charged, uncertain) is read from its
detail text, so ledgers written before that distinction stay readable.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Literal

from pydantic import Field

from csl.locking import exclusive
from csl.schema import _Model

if TYPE_CHECKING:
    from contextlib import AbstractContextManager
    from pathlib import Path


_UNREPORTED = "cost not reported, kept reservation"
REFUSED_DETAIL = "refused by provider (HTTP 4xx) before generation, counted as not charged"


class BudgetError(RuntimeError):
    """A paid call was refused: no approval, or not enough of it left."""


class Approval(_Model):
    """A spending limit a person approved for hosted generation."""

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    approved_usd: float = Field(gt=0)
    approved_by: str = Field(min_length=1)
    approved_on: date
    note: str = ""


class LedgerLine(_Model):
    """One reservation or settlement.

    ``reservation_id`` pairs a settlement with its reservation. Ledgers written before it
    existed have it empty and pair by ``candidate_id``, as they did then.
    """

    budget_id: str
    kind: Literal["reserve", "settle"]
    candidate_id: str
    reservation_id: str = ""
    usd: float = Field(ge=0)
    detail: str = ""
    at: datetime


@dataclass(frozen=True)
class Reservation:
    """A hold on the budget for one call, returned by ``Budget.reserve``."""

    id: str
    label: str
    usd: float


@dataclass(frozen=True)
class Spend:
    """Where an approval stands: what was charged, what is unknown, what is held, what is left.

    ``charged`` is settled with a cost the provider reported. ``uncertain`` is settled at the
    reserved sum because the charge cannot be known. ``held`` is open reservations of calls
    still running.
    """

    charged: float
    uncertain: float
    held: float
    remaining: float


class Budget:
    """An approval and its ledger."""

    def __init__(self, approval: Approval, ledger: Path) -> None:
        self.approval = approval
        self._ledger = ledger

    @classmethod
    def load(cls, approval_path: Path) -> Budget:
        """Read an approval file; its ledger is ``<name>.ledger.jsonl`` beside it."""
        approval = Approval.model_validate_json(approval_path.read_text(encoding="utf-8"))
        return cls(approval, approval_path.with_suffix(".ledger.jsonl"))

    def _lines(self) -> list[LedgerLine]:
        if not self._ledger.is_file():
            return []
        text = self._ledger.read_text(encoding="utf-8")
        return [LedgerLine.model_validate_json(line) for line in text.splitlines() if line]

    def spend(self) -> Spend:
        """Charged, uncertain and held amounts, and what is left of the approval."""
        open_reservations: dict[str, float] = {}
        charged = 0.0
        uncertain = 0.0
        for line in self._lines():
            if line.budget_id != self.approval.id:
                continue
            key = line.reservation_id or line.candidate_id
            if line.kind == "reserve":
                open_reservations[key] = line.usd
                continue
            open_reservations.pop(key, None)
            if line.detail.startswith(_UNREPORTED):
                uncertain += line.usd
            else:
                charged += line.usd
        held = sum(open_reservations.values())
        return Spend(
            charged=round(charged, 6),
            uncertain=round(uncertain, 6),
            held=round(held, 6),
            remaining=round(self.approval.approved_usd - charged - uncertain - held, 6),
        )

    def committed(self) -> float:
        """Settled spend plus reservations that were never settled or released."""
        spend = self.spend()
        return round(spend.charged + spend.uncertain + spend.held, 6)

    def remaining(self) -> float:
        """What is left of the approval."""
        return self.spend().remaining

    def require(self, usd: float, what: str) -> None:
        """Refuse up front if ``usd`` does not fit in what is left."""
        if usd > self.remaining():
            msg = (
                f"{what} needs up to ${usd:.2f}, budget {self.approval.id!r} has "
                f"${self.remaining():.2f} of ${self.approval.approved_usd:.2f} left"
            )
            raise BudgetError(msg)

    def _append(
        self, kind: Literal["reserve", "settle"], held: Reservation, usd: float, detail: str = ""
    ) -> None:
        line = LedgerLine(
            budget_id=self.approval.id,
            kind=kind,
            candidate_id=held.label,
            reservation_id=held.id,
            usd=usd,
            detail=detail,
            at=datetime.now(UTC),
        )
        with self._ledger.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line.model_dump(mode="json")) + "\n")

    def _lock(self) -> AbstractContextManager[None]:
        return exclusive(self._ledger.with_name(self._ledger.name + ".lock"))

    def reserve(self, label: str, usd: float) -> Reservation:
        """Hold ``usd`` for one call, or refuse. Check and append happen under one lock."""
        held = Reservation(uuid.uuid4().hex, label, usd)
        with self._lock():
            self.require(usd, label)
            self._append("reserve", held, usd)
        return held

    def settle(self, held: Reservation, usd: float | None, basis: str) -> None:
        """Replace the reservation with the reported cost. Unknown cost keeps the reserved sum."""
        amount = held.usd if usd is None else usd
        detail = basis if usd is not None else f"{_UNREPORTED}; {basis}"
        with self._lock():
            self._append("settle", held, amount, detail)

    def refuse(self, held: Reservation) -> None:
        """Settle at zero a call the provider refused with an HTTP 4xx before generating."""
        with self._lock():
            self._append("settle", held, 0.0, REFUSED_DETAIL)
