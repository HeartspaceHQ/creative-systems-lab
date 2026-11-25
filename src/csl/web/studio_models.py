"""The records of CSL Studio: brands, projects, images, designs and deliveries.

All models are frozen and reject unknown fields, like the rest of the data model. The messages
of the validators are written for the designer who typed the value, not for an engineer: the
API shows them as they are, next to the field they belong to.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, StringConstraints, ValidationInfo, field_validator

from csl.colour import is_hex
from csl.schema import Kind, _Model

# The families the engine bundles; a brand may only name these, so a render never falls back.
SLUG = r"^[a-z0-9][a-z0-9-]*$"
SLUG_RE = re.compile(SLUG)

Slug = Annotated[str, Field(pattern=SLUG, max_length=64)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
BrandName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
# Limits of the engine's design rules (studio-design.ts), checked here so a form says so at once.
MAX_CANDIDATES = 16
HEADLINE_LINES = 5
HEADLINE_LINE_CHARS = 60
Shape = Literal["square", "portrait", "landscape"]
Layout = Literal["editorial", "cinema"]
FormatKey = Literal["linkedin-portrait", "linkedin-square", "linkedin-landscape", "story", "wide"]
Extra = Literal["mp4", "gif", "pdf"]
OutputKind = Literal["png", "mp4", "gif", "pdf"]
Verdict = Literal["approve", "reject"]
DeliveryState = Literal["running", "done", "failed"]


def headline_lines(headline: str) -> list[str]:
    """The lines of a headline: split on line breaks, trimmed, empty lines dropped."""
    return [line.strip() for line in headline.split("\n") if line.strip()]


SHAPE_PIXELS: dict[Shape, tuple[int, int]] = {
    "square": (1024, 1024),
    "portrait": (1024, 1536),
    "landscape": (1536, 1024),
}


class Colours(_Model):
    """The four colours a design is built from."""

    ground: str
    text: str
    quiet: str
    accent: str

    @field_validator("ground", "text", "quiet", "accent")
    @classmethod
    def _hex(cls, value: str) -> str:
        if not is_hex(value):
            msg = "Use a colour like #1d2a3a"
            raise ValueError(msg)
        return value.lower()


class BrandType(_Model):
    """The two type families of a brand."""

    display: str
    body: str

    @field_validator("body")
    @classmethod
    def _two_voices(cls, value: str, info: ValidationInfo) -> str:
        if value == info.data.get("display"):
            msg = "Pick a different font than the headline font, so the two read as two voices"
            raise ValueError(msg)
        return value


class BrandInput(_Model):
    """What a designer fills in to describe a brand."""

    name: BrandName
    colours: Colours
    type: BrandType
    style_note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=400)] = ""


class Reference(_Model):
    """A visual reference image kept with a brand."""

    id: Slug
    name: str
    file: str


class Brand(BrandInput):
    """A brand as stored."""

    id: Slug
    references: list[Reference] = Field(default_factory=list)
    updated_at: datetime


class BriefInput(_Model):
    """What the project's images should show."""

    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=800)]
    kind: Kind
    shape: Shape
    candidates: int = Field(ge=1, le=MAX_CANDIDATES)


class ProjectBrief(_Model):
    """The brief as stored: a new project has not got a subject yet."""

    subject: str = ""
    kind: Kind = "photo"
    shape: Shape = "portrait"
    candidates: int = Field(default=4, ge=1, le=MAX_CANDIDATES)


class AssetSource(_Model):
    """Where an image came from. Generated images name their run, candidate and model."""

    run_id: str | None = None
    candidate_id: str | None = None
    model: str | None = None
    model_id: str | None = None
    recipe_hash: str | None = None
    licence: str | None = None
    file_name: str | None = None


class AssetDecision(_Model):
    """Who approved or rejected an image, and whether they confirmed the right to use it."""

    verdict: Verdict
    reviewer: str
    note: str = ""
    decided_at: datetime
    rights_confirmed: bool


class Asset(_Model):
    """An image the project may use. Only approved ones can go into a design."""

    id: Slug
    width: int
    height: int
    sha256: str
    origin: Literal["generated", "imported"]
    source: AssetSource
    status: Literal["pending", "approved", "rejected"]
    decision: AssetDecision | None = None
    created_at: datetime


class DecisionInput(_Model):
    """A designer's decision on an imported image."""

    verdict: Verdict
    reviewer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=400)] = ""
    rights_confirmed: bool = False


def _text(limit: int) -> object:
    return StringConstraints(strip_whitespace=True, max_length=limit)


class DesignCopy(_Model):
    """The words of a design. A headline is needed to deliver, not to save a draft."""

    label: Annotated[str, _text(60)] = ""
    headline: Annotated[str, _text(HEADLINE_LINES * (HEADLINE_LINE_CHARS + 1))] = ""
    body: Annotated[str, _text(400)] = ""
    cta: Annotated[str, _text(120)] = ""
    sender: Annotated[str, _text(60)] = ""

    @field_validator("headline")
    @classmethod
    def _lines(cls, value: str) -> str:
        lines = headline_lines(value)
        if len(lines) > HEADLINE_LINES or any(len(line) > HEADLINE_LINE_CHARS for line in lines):
            msg = f"Use at most {HEADLINE_LINES} lines of {HEADLINE_LINE_CHARS} characters"
            raise ValueError(msg)
        return value


class Focus(_Model):
    """The point of the image that must stay in view, as fractions of its size."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class Design(_Model):
    """One design per project: the single source of the preview and of every delivery.

    The words are ``copy`` on the wire; ``BaseModel.copy`` is taken, so the attribute is ``words``.
    """

    model_config = ConfigDict(serialize_by_alias=True)

    asset: Slug
    layout: Layout
    words: DesignCopy = Field(alias="copy")
    focus: Focus
    zoom: float = Field(ge=0.5, le=2)
    headline_scale: float = Field(ge=0.5, le=2)
    night: float = Field(ge=0, le=1)


class RunInput(_Model):
    """Which models to generate with, and how many candidates each (the brief's count if absent)."""

    models: list[Annotated[str, StringConstraints(max_length=64)]] = Field(
        default_factory=list, max_length=16
    )
    candidates: int | None = Field(default=None, ge=1, le=MAX_CANDIDATES)


class FromRunInput(_Model):
    """An approved candidate of a run, to use as an image of the project."""

    run: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    candidate: Annotated[str, StringConstraints(min_length=1, max_length=120)]


class KeyInput(_Model):
    """A provider key typed in the browser: it lives in this process only."""

    variable: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    value: Annotated[str, StringConstraints(min_length=1, max_length=512)]


MAX_LIMIT_USD = 1000


class BudgetInput(_Model):
    """A spending limit a person approves in the studio, under their own name."""

    approved_usd: Annotated[float, Field(gt=0, le=MAX_LIMIT_USD)]
    approved_by: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ]


class DeliveryInput(_Model):
    """Which formats to render, and which extra media to make from the first one."""

    formats: list[FormatKey] = Field(min_length=1)
    extras: list[Extra] = Field(default_factory=list)


class Output(_Model):
    """One finished file of a delivery."""

    name: str
    kind: OutputKind
    format: str
    width: int
    height: int
    bytes: int


class DeliveryCheck(_Model):
    """One technical check, in words a designer can act on."""

    name: str
    passed: bool
    detail: str = ""


class Delivery(_Model):
    """One render of the design into files."""

    id: Slug
    created_at: datetime
    state: DeliveryState
    error: str | None = None
    formats: list[FormatKey]
    extras: list[Extra]
    outputs: list[Output] = Field(default_factory=list)
    checks: list[DeliveryCheck] = Field(default_factory=list)


class ProjectInput(_Model):
    """What a designer fills in to start a project."""

    name: Name
    brand: Slug


class ProjectChange(_Model):
    """A change to a project's name or brand."""

    name: Name | None = None
    brand: Slug | None = None


class Project(_Model):
    """A project as stored: one brief, its images, one design and its deliveries."""

    id: Slug
    name: str
    brand: str
    created_at: datetime
    updated_at: datetime
    brief: ProjectBrief = Field(default_factory=ProjectBrief)
    runs: list[str] = Field(default_factory=list)
    assets: list[Asset] = Field(default_factory=list)
    design: Design | None = None
    deliveries: list[Delivery] = Field(default_factory=list)


class FormatSpec(_Model):
    """A delivery format: its key, its label and its size in pixels."""

    key: FormatKey
    label: str
    width: int
    height: int


FORMATS: tuple[FormatSpec, ...] = (
    FormatSpec(key="linkedin-portrait", label="LinkedIn portrait", width=1080, height=1350),
    FormatSpec(key="linkedin-square", label="LinkedIn square", width=1080, height=1080),
    FormatSpec(key="linkedin-landscape", label="LinkedIn link image", width=1200, height=627),
    FormatSpec(key="story", label="Story", width=1080, height=1920),
    FormatSpec(key="wide", label="Wide 16:9", width=1920, height=1080),
)
