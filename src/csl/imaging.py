"""Small image helpers shared by evaluation and drift measurement."""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

from csl.colour import delta_e76, rgb_to_lab

if TYPE_CHECKING:
    from pathlib import Path

    from numpy.typing import NDArray

    FloatArray = NDArray[np.float64]

ANALYSIS_SIDE = 128
COLOUR_GRID = 16


def load_rgb(path: Path, max_side: int = ANALYSIS_SIDE) -> FloatArray:
    """Load an image as float RGB (0..255), shape ``(h, w, 3)``, longest side <= ``max_side``.

    Downsampling with a box filter averages out sensor-like noise, so the checks measure
    composition and colour rather than pixel-level grain.
    """
    with Image.open(path) as source:
        image = source.convert("RGB")
        scale = max_side / max(image.size)
        if scale < 1:
            size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
            image = image.resize(size, Image.Resampling.BOX)
        return np.asarray(image, dtype=np.float64)


def dhash(path: Path, hash_size: int = 8) -> int:
    """Difference hash: a 64-bit fingerprint that survives small pixel-level changes."""
    with Image.open(path) as source:
        gray = source.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.BOX)
        pixels = np.asarray(gray, dtype=np.int16)
    bits = (pixels[:, 1:] > pixels[:, :-1]).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return value


def hamming(a: int, b: int) -> int:
    """Number of differing bits between two hashes."""
    return (a ^ b).bit_count()


def mean_delta_e(a: Path, b: Path, grid: int = COLOUR_GRID) -> float:
    """Mean CIE76 colour difference between two images on a ``grid`` x ``grid`` thumbnail.

    Both images are box-averaged to the same small grid and compared cell by cell in Lab, so
    the value reflects where which colour sits, not fine texture. dHash ignores colour; this
    does not.
    """
    labs = []
    for path in (a, b):
        with Image.open(path) as source:
            small = source.convert("RGB").resize((grid, grid), Image.Resampling.BOX)
            labs.append(rgb_to_lab(np.asarray(small, dtype=np.float64)))
    return float(np.mean(delta_e76(labs[0], labs[1])))
