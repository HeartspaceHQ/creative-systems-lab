"""A deterministic CPU backend that draws flat shapes in the brand palette.

This is **not** a generative model. It exists for three reasons: it exercises the whole
pipeline without a GPU or weights (so CI and a fresh clone can run end to end), it is
bit-exact reproducible (so the manifest/verify/replay logic can be tested for real), and,
with a deliberately wrong palette, it is a negative control that the evaluation must reject.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

import PIL
from PIL import Image, ImageDraw

from csl.colour import hex_to_rgb
from csl.schema import Cost, ModelPin

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

    from csl.schema import Recipe

_SHAPES = 14
_MIN_COLOURS = 2
_MASK64 = (1 << 64) - 1


class _SplitMix64:
    """Tiny seeded generator with a fixed algorithm, so output never depends on library versions."""

    def __init__(self, seed: int) -> None:
        self._state = seed & _MASK64

    def next_u64(self) -> int:
        self._state = (self._state + 0x9E3779B97F4A7C15) & _MASK64
        z = self._state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK64
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK64
        return z ^ (z >> 31)

    def randint(self, low: int, high: int) -> int:
        """Integer in ``[low, high]``."""
        return low + self.next_u64() % (high - low + 1)

    def choice(self, items: Sequence[tuple[int, int, int]]) -> tuple[int, int, int]:
        return items[self.randint(0, len(items) - 1)]


_OFFBRAND = ("#ff00ff", "#00ff00", "#ffff00")


class ProceduralBackend:
    """Flat-shape compositions in a given palette."""

    def __init__(self, colours: Sequence[str], name: str = "procedural") -> None:
        if len(colours) < _MIN_COLOURS:
            msg = "need at least two colours"
            raise ValueError(msg)
        self._colours = tuple(colours)
        self._name = name

    @classmethod
    def off_brand(cls) -> ProceduralBackend:
        """Negative control: saturated colours that no sane brand palette contains."""
        return cls(_OFFBRAND, name="procedural-offbrand")

    def pin(self) -> ModelPin:
        """Identify the generator by its palette and the Pillow version that renders it."""
        palette_id = hashlib.sha256("".join(self._colours).encode()).hexdigest()[:12]
        return ModelPin(
            backend=self._name,
            model_id="csl-flat-shapes-v1",
            revision=palette_id,
            tool_versions={"pillow": PIL.__version__},
        )

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Draw a seeded composition: palette background, overlapping circles and rectangles."""
        rng = _SplitMix64(recipe.seed)
        rgb = [hex_to_rgb(c) for c in self._colours]
        image = Image.new("RGB", (recipe.width, recipe.height), rgb[0])
        draw = ImageDraw.Draw(image)
        for _ in range(_SHAPES):
            colour = rng.choice(rgb[1:])
            w = rng.randint(recipe.width // 8, recipe.width // 2)
            h = rng.randint(recipe.height // 8, recipe.height // 2)
            x = rng.randint(-w // 4, recipe.width - w // 2)
            y = rng.randint(-h // 4, recipe.height - h // 2)
            box = (x, y, x + w, y + h)
            if rng.randint(0, 1) == 0:
                draw.ellipse(box, fill=colour)
            else:
                draw.rectangle(box, fill=colour)
        image.save(output, format="PNG")
        return Cost(usd=0.0, basis="local renderer, no charge", estimated=False)
