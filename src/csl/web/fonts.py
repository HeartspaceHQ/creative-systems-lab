"""The fonts a brand can use: the engine's bundled ones and the ones a designer uploads.

The bundled fonts are listed in the engine's ``fonts/catalog.json``, each with how it is set as a
headline, as body text and as a label. An uploaded font is kept in the studio folder (never in the
repository) with the family name the designer gave it and their confirmation that they may use it;
it gets neutral role settings and covers every weight, so a single static file is never made bold
or thin by the browser. A file is only kept when its first bytes say it is WOFF2, WOFF, TrueType or
OpenType; whether the browser can draw it shows in the preview, which loads it before drawing.
"""

from __future__ import annotations

import json
import re
import secrets
import shutil
import threading
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict

from csl.store import read_model, write_json
from csl.web.problems import ApiError, not_found, refuse

if TYPE_CHECKING:
    from pathlib import Path

MAX_FONT_BYTES = 10 * 1024 * 1024
MAX_UPLOADED_FONTS = 32
_MIN_FONT_BYTES = 256
FAMILY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .&'-]{0,59}$")
_ID = re.compile(r"^f[0-9a-f]{6}$")
_MAGIC: tuple[tuple[bytes, str], ...] = (
    (b"wOF2", "woff2"),
    (b"wOFF", "woff"),
    (b"\x00\x01\x00\x00", "ttf"),
    (b"true", "ttf"),
    (b"OTTO", "otf"),
)
FONT_TYPES = {
    "woff2": "font/woff2",
    "woff": "font/woff",
    "ttf": "font/ttf",
    "otf": "font/otf",
}
_ALL_WEIGHTS = (1, 1000)
_ROLES = ("display", "body", "label")
# How an uploaded family is set: the same as the bundled sans fonts, which suit most faces.
_UPLOADED_ROLES: dict[str, dict[str, float]] = {
    "display": {"weight": 600, "tracking": -0.015, "leading": 1.04},
    "body": {"weight": 400, "tracking": 0, "leading": 1.38},
    "label": {"weight": 600, "tracking": 0.12, "leading": 1.2},
}

Kind = Literal["serif", "sans", "uploaded"]


class UploadedFont(BaseModel):
    """What the studio keeps about an uploaded font, beside its file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    family: str
    file: str
    added_at: datetime
    rights_confirmed: bool


def font_format(data: bytes) -> str:
    """``woff2``, ``woff``, ``ttf`` or ``otf`` from the file's first bytes, or ``ApiError``."""
    if len(data) < _MIN_FONT_BYTES:
        refuse("That file is too small to be a font.")
    found = next((extension for magic, extension in _MAGIC if data.startswith(magic)), None)
    if found is None:
        refuse("That file is not a font. Upload a WOFF2, WOFF, TTF or OTF file.")
    return found


class FontLibrary:
    """The bundled catalog of the engine and the fonts uploaded to the studio folder."""

    def __init__(self, engine_fonts: Path, uploaded: Path) -> None:
        self._engine_fonts = engine_fonts
        self._uploaded = uploaded
        self._lock = threading.Lock()
        self._bundled = self._read_catalog()

    def _read_catalog(self) -> list[dict[str, object]]:
        try:
            catalog = json.loads((self._engine_fonts / "catalog.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []  # no engine here: only uploaded fonts are offered
        return [
            {
                "family": entry["family"],
                "url": f"fonts/{entry['file']}",
                "weights": entry["weights"],
                "kind": entry["style"],
                **{role: entry[role] for role in _ROLES},
            }
            for entry in catalog["fonts"]
        ]

    # --- reading ---------------------------------------------------------------------------

    def _records(self) -> list[UploadedFont]:
        if not self._uploaded.is_dir():
            return []
        records = []
        for path in sorted(self._uploaded.glob("f*.json")):
            try:
                records.append(read_model(path, UploadedFont))
            except (OSError, ValueError):
                continue
        return sorted(records, key=lambda record: record.family.lower())

    @staticmethod
    def _entry(record: UploadedFont) -> dict[str, object]:
        return {
            "family": record.family,
            "url": f"/api/fonts/{record.id}/file",
            "weights": list(_ALL_WEIGHTS),
            "kind": "uploaded",
            **_UPLOADED_ROLES,
        }

    def entries(self) -> list[dict[str, object]]:
        """Every font on offer, bundled first, as the engine and the browser take it."""
        return [*self._bundled, *(self._entry(record) for record in self._records())]

    def families(self) -> list[str]:
        """The family names on offer."""
        return [str(entry["family"]) for entry in self.entries()]

    def require(self, display: str, body: str) -> None:
        """Refuse a brand that names a family not on offer, at the field it came from."""
        known = self.families()
        families = (display, body)
        fields = {
            f"type.{role}": f"Pick one of the available fonts: {', '.join(known)}"
            for role, family in zip(("display", "body"), families, strict=True)
            if family not in known
        }
        if fields:
            msg = "One of the fonts is not available."
            raise ApiError(msg, fields=fields)

    def file(self, font_id: str) -> tuple[bytes, str]:
        """An uploaded font's bytes and media type."""
        record = self._record(font_id)
        path = self._uploaded / record.file
        if not path.is_file() or path.is_symlink():
            not_found("font")
        return path.read_bytes(), FONT_TYPES[path.suffix.lstrip(".")]

    def _record(self, font_id: str) -> UploadedFont:
        if not _ID.match(font_id):
            not_found("font")
        path = self._uploaded / f"{font_id}.json"
        if not path.is_file() or path.is_symlink():
            not_found("font")
        return read_model(path, UploadedFont)

    # --- delivering ------------------------------------------------------------------------

    def for_delivery(self, families: tuple[str, str], folder: Path) -> list[dict[str, object]]:
        """A brand's two families for ``source.json``; uploaded files are copied to ``fonts/``."""
        self.require(*families)
        by_family = {str(entry["family"]): entry for entry in self.entries()}
        records = {record.family: record for record in self._records()}
        faces = []
        for family in families:
            entry = dict(by_family[family])
            record = records.get(family)
            if record is not None:
                target = folder / "fonts" / record.file
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(self._uploaded / record.file, target)
                entry["url"] = f"fonts/{record.file}"
            faces.append(entry)
        return faces

    # --- uploading -------------------------------------------------------------------------

    def add(self, family: str, data: bytes, *, rights_confirmed: bool) -> dict[str, object]:
        """Keep an uploaded font under the family name the designer gave it."""
        name = " ".join(family.split())
        if not FAMILY.match(name):
            msg = "Name the font with letters, digits, spaces, dots, dashes or &, up to 60."
            raise ApiError(msg, fields={"family": msg})
        if not rights_confirmed:
            msg = "Confirm that you may use this font in what you make."
            raise ApiError(msg, fields={"rights": msg})
        extension = font_format(data)
        with self._lock:
            if name.casefold() in {known.casefold() for known in self.families()}:
                msg = f"There is already a font called {name}. Give this one another name."
                raise ApiError(msg, fields={"family": msg})
            if len(self._records()) >= MAX_UPLOADED_FONTS:
                refuse(f"The studio keeps up to {MAX_UPLOADED_FONTS} uploaded fonts.")
            font_id = f"f{secrets.token_hex(3)}"
            while (self._uploaded / f"{font_id}.json").exists():
                font_id = f"f{secrets.token_hex(3)}"
            self._uploaded.mkdir(parents=True, exist_ok=True)
            file = f"{font_id}.{extension}"
            (self._uploaded / file).write_bytes(data)
            record = UploadedFont(
                id=font_id,
                family=name,
                file=file,
                added_at=datetime.now(UTC),
                rights_confirmed=True,
            )
            write_json(self._uploaded / f"{font_id}.json", record)
        return self._entry(record)
