"""The similarity measure behind ``perceptually_close`` needs structure and colour."""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

from csl.imaging import dhash, hamming, mean_delta_e
from csl.reproduce import PERCEPTUAL_BITS, compare_images

if TYPE_CHECKING:
    from pathlib import Path


def _structure() -> np.ndarray:
    """Luminance with real structure: a diagonal ramp, a bright disc and a dark bar."""
    y, x = np.mgrid[0:96, 0:96] / 95.0
    lum = 0.15 + 0.5 * (x + y) / 2
    lum[(x - 0.3) ** 2 + (y - 0.4) ** 2 < 0.04] = 0.95
    lum[70:80, 10:90] = 0.05
    return np.asarray(lum, dtype=np.float64)


def _save(lum: np.ndarray, weights: tuple[float, float, float], path: Path) -> Path:
    rgb = np.stack([lum * w for w in weights], axis=-1) * 255
    Image.fromarray(rgb.astype(np.uint8)).save(path)
    return path


def test_recoloured_image_with_same_structure_is_not_close(tmp_path: Path) -> None:
    warm = _save(_structure(), (1.0, 0.6, 0.3), tmp_path / "warm.png")
    cold = _save(_structure(), (0.3, 0.6, 1.0), tmp_path / "cold.png")
    # The old, structure-only measure called this close; that is the defect being fixed.
    assert hamming(dhash(warm), dhash(cold)) <= PERCEPTUAL_BITS
    assert mean_delta_e(warm, cold) > 15
    status, detail = compare_images(warm, cold)
    assert status == "diverged"
    assert "mean colour difference" in detail


def test_slightly_noisy_copy_is_still_close(tmp_path: Path) -> None:
    base = _structure()
    noise = np.random.default_rng(1).normal(0, 0.01, base.shape)
    a = _save(base, (1.0, 0.6, 0.3), tmp_path / "a.png")
    b = _save(np.clip(base + noise, 0, 1), (1.0, 0.6, 0.3), tmp_path / "b.png")
    status, _ = compare_images(a, b)
    assert status == "perceptually_close"


def test_identical_files_are_bit_identical(tmp_path: Path) -> None:
    a = _save(_structure(), (1.0, 0.6, 0.3), tmp_path / "a.png")
    assert compare_images(a, a)[0] == "bit_identical"


def test_same_colours_with_different_layout_is_not_close(tmp_path: Path) -> None:
    base = _structure()
    a = _save(base, (1.0, 0.6, 0.3), tmp_path / "a.png")
    b = _save(base[::-1, ::-1].copy(), (1.0, 0.6, 0.3), tmp_path / "b.png")
    assert compare_images(a, b)[0] == "diverged"
