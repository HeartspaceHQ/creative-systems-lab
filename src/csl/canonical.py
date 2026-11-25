"""Canonical JSON and content hashing: the basis of every identity in the system."""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pathlib import Path

_CHUNK = 1 << 20


def canonical_json(value: object) -> str:
    """Serialise to a stable string: sorted keys, no whitespace, UTF-8 characters kept."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(text: str) -> str:
    """Hex SHA-256 of a UTF-8 string."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_json(value: object) -> str:
    """Hex SHA-256 of the canonical JSON form of a value."""
    return sha256_text(canonical_json(value))


def sha256_file(path: Path) -> str:
    """Hex SHA-256 of a file's bytes, streamed."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()
