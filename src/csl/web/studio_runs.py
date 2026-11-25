"""Turn what a designer typed into the inputs of a generation run.

A project's brief becomes a ``Brief`` (its shape chooses the size) and its brand becomes a
``BrandContext``: palette from the four colours, a style sentence per kind from a sensible
default plus the brand's own note, and the default thresholds. Neither is written to a file;
the run keeps its own snapshots, as for any run.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from csl.canonical import sha256_json
from csl.schema import BrandContext, Brief
from csl.web.problems import refuse
from csl.web.studio_models import SHAPE_PIXELS

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Kind
    from csl.web.studio_models import Brand, Project

_STYLE: dict[Kind, str] = {
    "photo": "Natural light photograph, calm composition, generous empty space, no text.",
    "illustration": (
        "Flat editorial illustration, simple shapes, limited palette, "
        "generous empty space, no text, no gradients."
    ),
}
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


def project_brief(project: Project, candidates: int | None = None) -> Brief:
    """The project's brief as a ``Brief``; the subject may still be empty (to list models)."""
    width, height = SHAPE_PIXELS[project.brief.shape]
    return Brief(
        id=project.id,
        subject=project.brief.subject,
        kind=project.brief.kind,
        width=width,
        height=height,
        candidates=candidates or project.brief.candidates,
        commercial_use=True,
    )


def runnable_brief(project: Project, candidates: int | None) -> Brief:
    """The brief for a run: it must say what the images should show."""
    if not project.brief.subject.strip():
        refuse(
            "Write what the image should show before generating.",
            fields={"subject": "Write what the image should show"},
        )
    return project_brief(project, candidates)


def has_references(refs_dir: Path) -> bool:
    """True when the brand's reference folder holds at least one image."""
    return refs_dir.is_dir() and any(
        path.suffix.lower() in _IMAGE_SUFFIXES for path in refs_dir.iterdir()
    )


def brand_context(brand: Brand, *, references: bool) -> BrandContext:
    """The brand profile as the checks and the prompt need it."""
    colours = brand.colours
    style = {
        kind: " ".join(part for part in (default, brand.style_note) if part)
        for kind, default in _STYLE.items()
    }
    return BrandContext(
        name=brand.name,
        version=sha256_json(brand.model_dump(mode="json"))[:12],
        palette={
            "ground": colours.ground,
            "text": colours.text,
            "quiet": colours.quiet,
            "accent": colours.accent,
        },
        style_prompt=style,
        reference_dir="refs" if references else None,
    )
