"""Perceptual drift against a brand reference set.

A reference set is a handful of approved images. Each image becomes a feature pair:

* a joint Lab colour histogram (where the colour mass is), and
* tone statistics: mean/std of lightness, mean/std of chroma, edge density.

Colour drift is the Jensen-Shannon distance (0..1) between a candidate's histogram and the
reference centroid. Its threshold is calibrated from the set itself: the largest
leave-one-out distance among the references, times a margin, with a floor. Tone drift is the
worst z-score of the tone statistics against the references, with a floor on the spread so
a very uniform set does not make every candidate look like an outlier.

With only a few references this is a smoke detector for obvious style breaks (a different
palette, a photo among flat illustrations), not a statistical test. Fewer than three
references is reported as uncalibrated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, get_args

import numpy as np

from csl.colour import rgb_to_lab
from csl.imaging import load_rgb
from csl.schema import Kind

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

    from numpy.typing import NDArray

    FloatArray = NDArray[np.float64]

_BINS = (3, 3, 3)
_LAB_RANGE = ((0.0, 100.0), (-80.0, 80.0), (-80.0, 80.0))
MIN_CALIBRATED_REFERENCES = 3
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
_STD_FLOOR = np.array([4.0, 3.0, 4.0, 3.0, 0.02])
_EPSILON = 1e-12
_EDGE_STEP = 8.0


@dataclass(frozen=True)
class Features:
    """Colour histogram and tone statistics of one image."""

    histogram: FloatArray
    tone: FloatArray


@dataclass(frozen=True)
class ReferenceSet:
    """Reference features plus the thresholds calibrated from them."""

    centroid: FloatArray
    tone_mean: FloatArray
    tone_std: FloatArray
    colour_limit: float
    size: int

    @property
    def calibrated(self) -> bool:
        """True when there are enough references for the leave-one-out threshold to mean much."""
        return self.size >= MIN_CALIBRATED_REFERENCES


@dataclass(frozen=True)
class Drift:
    """Drift of one candidate against a reference set."""

    colour: float
    colour_limit: float
    tone_z: float


def extract(rgb: FloatArray) -> Features:
    """Compute features from float RGB pixels, shape ``(h, w, 3)``."""
    lab = rgb_to_lab(rgb)
    hist, _ = np.histogramdd(lab.reshape(-1, 3), bins=_BINS, range=_LAB_RANGE)
    histogram = hist.flatten() / max(hist.sum(), 1.0)
    chroma = np.hypot(lab[..., 1], lab[..., 2])
    lightness = lab[..., 0]
    grad_y = np.abs(np.diff(lightness, axis=0))
    grad_x = np.abs(np.diff(lightness, axis=1))
    edge_density = float((grad_y > _EDGE_STEP).mean() + (grad_x > _EDGE_STEP).mean()) / 2
    tone = np.array(
        [lightness.mean(), lightness.std(), chroma.mean(), chroma.std(), edge_density],
    )
    return Features(histogram=histogram, tone=tone)


def js_distance(p: FloatArray, q: FloatArray) -> float:
    """Jensen-Shannon distance (base 2) between two histograms: 0 identical, 1 disjoint."""
    m = (p + q) / 2

    def kl(a: FloatArray, b: FloatArray) -> float:
        mask = a > 0
        return float(np.sum(a[mask] * np.log2(a[mask] / (b[mask] + _EPSILON))))

    return float(np.sqrt(max((kl(p, m) + kl(q, m)) / 2, 0.0)))


def build_reference_set(
    features: Sequence[Features],
    margin: float,
    floor: float,
) -> ReferenceSet:
    """Calibrate thresholds from reference features."""
    if not features:
        msg = "a reference set needs at least one image"
        raise ValueError(msg)
    hists = np.stack([f.histogram for f in features])
    tones = np.stack([f.tone for f in features])
    centroid = hists.mean(axis=0)
    if len(features) > 1:
        loo = [
            js_distance(hists[i], np.delete(hists, i, axis=0).mean(axis=0))
            for i in range(len(features))
        ]
        limit = max(max(loo) * margin, floor)
    else:
        limit = floor
    return ReferenceSet(
        centroid=centroid,
        tone_mean=tones.mean(axis=0),
        tone_std=np.maximum(tones.std(axis=0), _STD_FLOOR),
        colour_limit=limit,
        size=len(features),
    )


def reference_dir_for(base: Path | None, kind: str) -> Path | None:
    """The reference directory for one kind of image.

    A brand keeps one folder per kind (``references/photo``, ``references/illustration``), so a
    photograph is never measured against illustrations. A folder without kind subfolders is the
    older flat layout and serves every kind. A kind with no folder of its own gets none.
    """
    if base is None or not base.is_dir():
        return None
    if any((base / name).is_dir() for name in get_args(Kind)):
        own = base / kind
        return own if own.is_dir() else None
    return base


def load_reference_set(directory: Path, margin: float, floor: float) -> ReferenceSet | None:
    """Build a reference set from the PNG/JPEG files in a directory, or None if it is empty."""
    paths = sorted(p for p in directory.glob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    if not paths:
        return None
    return build_reference_set([extract(load_rgb(p)) for p in paths], margin, floor)


def measure(features: Features, reference: ReferenceSet) -> Drift:
    """Drift of one candidate against a reference set."""
    colour = js_distance(features.histogram, reference.centroid)
    z = np.abs(features.tone - reference.tone_mean) / reference.tone_std
    return Drift(colour=colour, colour_limit=reference.colour_limit, tone_z=float(np.max(z)))
