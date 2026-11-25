"""The case specification: what each image is meant to be, kept apart from any rating."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from csl.canonical import sha256_text

if TYPE_CHECKING:
    from pathlib import Path

Category = Literal[
    "good",
    "subtle_composition",
    "subtle_subject",
    "subtle_expression",
    "near_tone",
    "wrong_light",
    "clear_wrong",
]
CATEGORIES: tuple[Category, ...] = (
    "good",
    "subtle_composition",
    "subtle_subject",
    "subtle_expression",
    "near_tone",
    "wrong_light",
    "clear_wrong",
)
_BLIND_ID_LENGTH = 12


class _Frozen(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Case(_Frozen):
    """One image to generate. ``category`` is the intended class, a hypothesis to be checked."""

    id: str
    category: Category
    seed: int = Field(ge=0)
    prompt: str
    intent: str


class ValidationSpec(_Frozen):
    """A set of cases generated with one model against one brief and brand."""

    set_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    brief: str
    brand: str
    model: str
    width: int
    height: int
    cases: list[Case]


def load_spec(path: Path) -> ValidationSpec:
    """Read and validate a case specification."""
    return ValidationSpec.model_validate_json(path.read_text(encoding="utf-8"))


def blind_id(spec: ValidationSpec, case: Case) -> str:
    """Opaque identifier used for file names and in the rating UI; reveals no category."""
    return sha256_text(f"{spec.set_id}:{case.id}")[:_BLIND_ID_LENGTH]
