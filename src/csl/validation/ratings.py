"""Blind rating storage.

This module knows only the image files and the ratings file. It has no access to the case
specification, the intended categories or the system's scores, so nothing built on it (the
rating UI) can leak them.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict

from csl.canonical import sha256_text

if TYPE_CHECKING:
    from pathlib import Path

RATINGS = "ratings.jsonl"
IMAGES = "images"
Verdict = Literal["approve", "reject"]


class Rating(BaseModel):
    """One human verdict on one image. The latest rating per image counts."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    blind_id: str
    verdict: Verdict
    note: str = ""
    rated_at: datetime


class BlindSet:
    """The images of a validation set and the ratings given so far."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def ids(self) -> list[str]:
        """Image ids in a fixed pseudo-random order, so category blocks are not adjacent."""
        stems = [p.stem for p in (self.directory / IMAGES).glob("*.png")]
        return sorted(stems, key=lambda stem: sha256_text(f"order:{stem}"))

    def image_path(self, blind_id: str) -> Path | None:
        """Path of an image, or None if the id is unknown."""
        if blind_id not in self.ids():
            return None
        return self.directory / IMAGES / f"{blind_id}.png"

    def ratings(self) -> dict[str, Rating]:
        """Latest rating per image."""
        path = self.directory / RATINGS
        if not path.is_file():
            return {}
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        return {r.blind_id: r for r in (Rating.model_validate_json(line) for line in lines)}

    def rate(self, blind_id: str, verdict: Verdict, note: str = "") -> Rating:
        """Append a rating. Raises ``KeyError`` for an unknown image."""
        if self.image_path(blind_id) is None:
            msg = f"no image {blind_id!r} in this set"
            raise KeyError(msg)
        rating = Rating(
            blind_id=blind_id, verdict=verdict, note=note.strip(), rated_at=datetime.now(UTC)
        )
        with (self.directory / RATINGS).open("a", encoding="utf-8") as handle:
            handle.write(rating.model_dump_json() + "\n")
        return rating
