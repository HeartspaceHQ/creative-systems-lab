"""Exclusive advisory file locks, so concurrent writers (threads or processes) take turns."""

from __future__ import annotations

import fcntl
from contextlib import contextmanager
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


@contextmanager
def exclusive(path: Path) -> Iterator[None]:
    """Hold an exclusive ``flock`` on ``path`` (created if missing) for the ``with`` block.

    The lock belongs to the open file, so two threads of one process exclude each other too.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
