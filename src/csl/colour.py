"""Colour maths: sRGB to CIE Lab, colour differences and WCAG contrast.

Everything is vectorised numpy. Lab uses the D65 white point. The colour difference is
CIE76 (Euclidean distance in Lab): simple, monotonic and good enough for a pass/fail
palette check, but less uniform than CIEDE2000 in saturated blues. See docs/evaluation.md.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

    FloatArray = NDArray[np.float64]

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_D65 = np.array([0.95047, 1.0, 1.08883])
_RGB_TO_XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ],
)
_EPS = 216 / 24389
_SRGB_KNEE = 0.04045
_KAPPA = 24389 / 27


def is_hex(value: str) -> bool:
    """Return True for a ``#rrggbb`` colour string."""
    return _HEX.match(value) is not None


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    """Parse ``#rrggbb`` into 8-bit channels."""
    if not is_hex(value):
        msg = f"not a #rrggbb colour: {value!r}"
        raise ValueError(msg)
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def _linearise(srgb01: FloatArray) -> FloatArray:
    return np.where(srgb01 <= _SRGB_KNEE, srgb01 / 12.92, ((srgb01 + 0.055) / 1.055) ** 2.4)


def rgb_to_lab(rgb: FloatArray) -> FloatArray:
    """Convert sRGB values in 0..255, shape ``(..., 3)``, to Lab."""
    xyz = _linearise(rgb / 255.0) @ _RGB_TO_XYZ.T / _D65
    f = np.where(xyz > _EPS, np.cbrt(xyz), (_KAPPA * xyz + 16) / 116)
    lightness = 116 * f[..., 1] - 16
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.stack([lightness, a, b], axis=-1)


def hex_to_lab(value: str) -> FloatArray:
    """Lab coordinates of a ``#rrggbb`` colour."""
    return rgb_to_lab(np.array(hex_to_rgb(value), dtype=np.float64))


def delta_e76(lab_a: FloatArray, lab_b: FloatArray) -> FloatArray:
    """CIE76 colour difference, broadcast over leading dimensions."""
    return np.asarray(np.linalg.norm(lab_a - lab_b, axis=-1), dtype=np.float64)


def relative_luminance(rgb: FloatArray) -> FloatArray:
    """WCAG relative luminance of sRGB values in 0..255, shape ``(..., 3)``."""
    lin = _linearise(rgb / 255.0)
    return np.asarray(lin @ np.array([0.2126, 0.7152, 0.0722]), dtype=np.float64)


def contrast_ratio(lum_a: FloatArray, lum_b: FloatArray) -> FloatArray:
    """WCAG contrast ratio between two relative luminances (1..21)."""
    hi = np.maximum(lum_a, lum_b)
    lo = np.minimum(lum_a, lum_b)
    return np.asarray((hi + 0.05) / (lo + 0.05), dtype=np.float64)
