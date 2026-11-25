"""Data model: the brief, the brand context and the records the pipeline writes.

All models are frozen and reject unknown fields, so a typo in a brief or brand file is an
error at load time instead of a silently ignored setting.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from csl.colour import is_hex

HexColour = Annotated[str, Field(description="#rrggbb")]
Kind = Literal["illustration", "photo"]


class _Model(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


def _check_hex(value: str) -> str:
    if not is_hex(value):
        msg = f"not a #rrggbb colour: {value!r}"
        raise ValueError(msg)
    return value.lower()


class OverlayZone(_Model):
    """A region reserved for text placed over the image, as fractions of the frame."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)
    text_colour: HexColour
    large_text: bool = False

    _hex = field_validator("text_colour")(_check_hex)


class Thresholds(_Model):
    """Pass/fail limits for the automated checks. Values live in the brand, not the code."""

    palette_max_delta_e: float = Field(default=22.0, gt=0)
    palette_min_covered_area: float = Field(default=0.8, ge=0, le=1)
    forbidden_max_area: float = Field(default=0.01, ge=0, le=1)
    forbidden_delta_e: float = Field(default=12.0, gt=0)
    drift_margin: float = Field(default=1.25, ge=1)
    drift_floor: float = Field(default=0.05, ge=0)
    tone_max_z: float = Field(default=3.5, gt=0)


class BrandContext(_Model):
    """What a brand fixes: palette, forbidden colours, style language, references."""

    name: str
    version: str
    palette: dict[str, HexColour]
    neutrals_allowed: bool = True
    forbidden_colours: list[HexColour] = Field(default_factory=list)
    style_prompt: dict[Kind, str]
    reference_dir: str | None = None
    thresholds: Thresholds = Field(default_factory=Thresholds)

    @field_validator("palette")
    @classmethod
    def _palette_hex(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            msg = "palette must not be empty"
            raise ValueError(msg)
        return {name: _check_hex(colour) for name, colour in value.items()}

    @field_validator("forbidden_colours")
    @classmethod
    def _forbidden_hex(cls, value: list[str]) -> list[str]:
        return [_check_hex(colour) for colour in value]


class Brief(_Model):
    """A request for one image, with the constraints that decide which models may serve it."""

    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    subject: str
    kind: Kind
    width: int = Field(default=512, ge=64, le=2048, multiple_of=16)
    height: int = Field(default=512, ge=64, le=2048, multiple_of=16)
    candidates: int = Field(default=2, ge=1, le=16)
    commercial_use: bool = True
    max_memory_gb: float | None = Field(default=None, gt=0)
    base_seed: int | None = Field(default=None, ge=0)
    overlay: OverlayZone | None = None

    def with_candidates(self, count: int) -> Brief:
        """A copy with another candidate count, validated like any brief (not ``model_copy``)."""
        return Brief.model_validate({**self.model_dump(), "candidates": count})


class ModelPin(_Model):
    """Everything that identifies the model side of a generation, resolved at run time."""

    backend: str
    model_id: str
    revision: str | None
    quantize: int | None = None
    tool_versions: dict[str, str] = Field(default_factory=dict)


class Recipe(_Model):
    """The full input of one generation. Same recipe plus same pin should give the same image."""

    pin: ModelPin
    prompt: str
    width: int
    height: int
    steps: int
    seed: int


class Artefact(_Model):
    """A file produced by the system, identified by content."""

    path: str
    sha256: str
    bytes: int
    width: int
    height: int


class Environment(_Model):
    """Where the generation ran. Informational: not part of the recipe hash."""

    python: str
    platform: str
    machine: str


class Cost(_Model):
    """What one generation cost, and how sure that number is.

    ``usd`` is None when the provider reports nothing that can be priced (the account's own
    usage page is then the only source). ``estimated`` is True when the figure comes from the
    price table instead of the provider's response.
    """

    usd: float | None = Field(ge=0)
    basis: str
    estimated: bool
    usage: dict[str, float | int | str] = Field(default_factory=dict)


class Manifest(_Model):
    """The reproducibility record written next to every candidate image."""

    schema_version: Literal[1] = 1
    candidate_id: str
    brief_hash: str
    brand_hash: str
    recipe: Recipe
    recipe_hash: str
    output: Artefact
    environment: Environment
    generation_seconds: float
    created_at: datetime
    cost: Cost | None = None


class SourceRecord(_Model):
    """Where a rechecked candidate was generated: the original run, brief and brand.

    The candidate's manifest is copied unchanged, so its ``brief_hash`` and ``brand_hash`` refer
    to these snapshots, not to the rechecking run's own brief and brand.
    """

    run_id: str
    candidate_id: str
    brief: Brief
    brand: BrandContext


class Check(_Model):
    """One automated check on one image."""

    name: str
    value: float
    threshold: float
    comparison: Literal["<=", ">="]
    passed: bool
    hard: bool
    detail: str = ""


class Evaluation(_Model):
    """All checks for one candidate. ``hard_pass`` gates review; soft failures only warn."""

    checks: list[Check]
    hard_pass: bool
    warnings: list[str] = Field(default_factory=list)


class Decision(_Model):
    """A human review decision. Append-only: the latest decision per candidate wins."""

    candidate_id: str
    verdict: Literal["approve", "reject"]
    reviewer: str
    note: str = ""
    override: bool = False
    decided_at: datetime
    prev_hash: str | None = Field(
        default=None,
        description="sha256 of the previous line of decisions.jsonl; the first line uses zeros",
    )


class DecisionHead(_Model):
    """Length and last-line hash of the decision log at the time it was last sealed."""

    count: int = Field(ge=0)
    head: str


class IntegrityManifest(_Model):
    """Hashes of every artefact of a run, so a later change is detected by ``verify``.

    ``generated`` is written once when generation ends and ``exported`` when the export is
    written; neither is touched by a later review decision, so a tampered file cannot be
    legitimised by making another decision. ``decisions`` is advanced by each decision.
    """

    schema_version: Literal[1] = 1
    origin: Literal["created", "migrated"] = "created"
    generated: dict[str, str]
    exported: dict[str, str] | None = None
    decisions: DecisionHead
