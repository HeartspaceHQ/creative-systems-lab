"""The backend contract. A backend turns a recipe into an image file and says what it is.

Local models and hosted APIs implement the same protocol, so they are equal sources of image
assets. A hosted backend additionally reports the cost of each call.

Swapping models means swapping the object that implements this protocol; nothing else in the
pipeline knows which model produced an image.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Cost, ModelPin, Recipe


class BackendError(RuntimeError):
    """Raised when a backend cannot produce an image (missing tool, failed run, no output)."""


class Backend(Protocol):
    """A generation backend."""

    def pin(self) -> ModelPin:
        """Identify the exact model and tool versions this backend would use right now."""
        ...

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Render ``recipe`` to ``output`` (PNG) and say what it cost.

        Raise ``BackendError`` on failure.
        """
        ...
