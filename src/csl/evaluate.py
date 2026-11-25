"""Automated evaluation of a candidate against the brand and the brief.

Checks, in order of how hard the gate is:

* ``forbidden_colour_area`` (hard): area within a small colour distance of any forbidden colour.
* ``palette_fit``: area-weighted share of dominant colours that sit within
  ``palette_max_delta_e`` of a palette colour (or of the neutral axis if neutrals are allowed).
  Hard for illustrations, which are drawn in the brand palette. Soft for photographs: a photo of
  tea is brown, amber and green by nature, and the brand lives in the finished composition (type,
  colour fields, grading), which the composition renderer checks. Forbidden colours stay hard.
* ``overlay_contrast`` (hard, only if the brief reserves a text zone): worst-case WCAG contrast
  of the overlay text colour against the pixels in that zone (5th percentile).
* ``colour_drift`` and ``tone_drift`` (soft): distance from the brand reference set.

Hard failures keep a candidate out of review. Soft failures are shown to the reviewer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

from csl import drift as drift_mod
from csl.colour import (
    contrast_ratio,
    delta_e76,
    hex_to_lab,
    hex_to_rgb,
    relative_luminance,
    rgb_to_lab,
)
from csl.imaging import load_rgb
from csl.schema import Check, Evaluation

if TYPE_CHECKING:
    from pathlib import Path

    from numpy.typing import NDArray

    from csl.schema import BrandContext, Brief, OverlayZone

    FloatArray = NDArray[np.float64]

_DOMINANT_COLOURS = 8
_MIN_DOMINANT_AREA = 0.03
_NEUTRAL_CHROMA = 12.0
_CONTRAST_PERCENTILE = 5
_CONTRAST_AA_NORMAL = 4.5
_CONTRAST_AA_LARGE = 3.0


def dominant_colours(path: Path) -> list[tuple[FloatArray, float]]:
    """Median-cut quantisation: ``(rgb, area share)`` for the largest colour clusters."""
    with Image.open(path) as source:
        image = source.convert("RGB")
        image.thumbnail((256, 256))
        quant = image.quantize(colors=_DOMINANT_COLOURS, method=Image.Quantize.MEDIANCUT)
        palette = np.asarray(quant.getpalette(), dtype=np.float64).reshape(-1, 3)
        counts = np.bincount(np.asarray(quant, dtype=np.intp).flatten(), minlength=len(palette))
    total = counts.sum()
    return [
        (palette[i], counts[i] / total)
        for i in np.argsort(counts)[::-1]
        if counts[i] / total >= _MIN_DOMINANT_AREA
    ]


@dataclass(frozen=True)
class ColourMatch:
    """One dominant colour of an image and the brand colour closest to it."""

    hex: str
    share: float
    nearest: str
    delta_e: float
    neutral: bool
    within: bool


def palette_matches(path: Path, brand: BrandContext) -> list[ColourMatch]:
    """The image's dominant colours, largest first, each matched to the nearest palette colour.

    A neutral (low-chroma) colour counts as matched when the brand allows neutrals; its
    ``delta_e`` is still the distance to the nearest palette colour, so it can be shown.
    """
    names = list(brand.palette)
    targets = np.stack([hex_to_lab(c) for c in brand.palette.values()])
    dominant = dominant_colours(path)
    total = sum(share for _, share in dominant)
    matches: list[ColourMatch] = []
    for rgb, share in dominant:
        lab = rgb_to_lab(rgb)
        distances = delta_e76(lab, targets)
        index = int(np.argmin(distances))
        neutral = brand.neutrals_allowed and float(np.hypot(lab[1], lab[2])) <= _NEUTRAL_CHROMA
        distance = float(distances[index])
        matches.append(
            ColourMatch(
                hex="#{:02x}{:02x}{:02x}".format(*(round(v) for v in rgb)),
                share=float(share / total) if total else 0.0,
                nearest=names[index],
                delta_e=distance,
                neutral=neutral,
                within=neutral or distance <= brand.thresholds.palette_max_delta_e,
            )
        )
    return matches


def palette_fit(
    path: Path,
    brand: BrandContext,
) -> tuple[float, float]:
    """Return ``(covered area share, worst ΔE among dominant colours)``."""
    matches = palette_matches(path, brand)
    covered = sum(m.share for m in matches if m.within)
    worst = max((0.0 if m.neutral else m.delta_e for m in matches), default=0.0)
    return covered, worst


def forbidden_area(rgb: FloatArray, brand: BrandContext) -> float:
    """Share of pixels within ``forbidden_delta_e`` of any forbidden colour."""
    if not brand.forbidden_colours:
        return 0.0
    lab = rgb_to_lab(rgb).reshape(-1, 3)
    hit = np.zeros(len(lab), dtype=bool)
    for colour in brand.forbidden_colours:
        hit |= delta_e76(lab, hex_to_lab(colour)) <= brand.thresholds.forbidden_delta_e
    return float(hit.mean())


def overlay_contrast(rgb: FloatArray, zone: OverlayZone) -> float:
    """Worst-case contrast (5th percentile) of the text colour against the zone's pixels."""
    height, width = rgb.shape[:2]
    y0, y1 = int(zone.y * height), max(int((zone.y + zone.h) * height), int(zone.y * height) + 1)
    x0, x1 = int(zone.x * width), max(int((zone.x + zone.w) * width), int(zone.x * width) + 1)
    region = rgb[y0:y1, x0:x1]
    text_lum = relative_luminance(np.array(hex_to_rgb(zone.text_colour), dtype=np.float64))
    ratios = contrast_ratio(relative_luminance(region), text_lum)
    return float(np.percentile(ratios, _CONTRAST_PERCENTILE))


def evaluate(
    path: Path,
    brand: BrandContext,
    brief: Brief,
    reference: drift_mod.ReferenceSet | None,
) -> Evaluation:
    """Run every applicable check on one image."""
    thresholds = brand.thresholds
    rgb = load_rgb(path)
    checks: list[Check] = []
    warnings: list[str] = []

    forbidden = forbidden_area(rgb, brand)
    checks.append(
        Check(
            name="forbidden_colour_area",
            value=round(forbidden, 4),
            threshold=thresholds.forbidden_max_area,
            comparison="<=",
            passed=forbidden <= thresholds.forbidden_max_area,
            hard=True,
            detail="share of pixels near a forbidden colour",
        ),
    )

    covered, worst = palette_fit(path, brand)
    checks.append(
        Check(
            name="palette_fit",
            value=round(covered, 4),
            threshold=thresholds.palette_min_covered_area,
            comparison=">=",
            passed=covered >= thresholds.palette_min_covered_area,
            hard=brief.kind != "photo",
            detail=f"dominant-colour area within dE {thresholds.palette_max_delta_e} of palette; "
            f"worst dominant dE {worst:.1f}",
        ),
    )

    if brief.overlay is not None:
        floor = _CONTRAST_AA_LARGE if brief.overlay.large_text else _CONTRAST_AA_NORMAL
        ratio = overlay_contrast(rgb, brief.overlay)
        checks.append(
            Check(
                name="overlay_contrast",
                value=round(ratio, 2),
                threshold=floor,
                comparison=">=",
                passed=ratio >= floor,
                hard=True,
                detail="WCAG contrast, 5th percentile over the reserved text zone",
            ),
        )

    if reference is None:
        warnings.append("no reference set: drift not evaluated")
    else:
        if not reference.calibrated:
            warnings.append(
                f"reference set has {reference.size} image(s); drift thresholds are uncalibrated",
            )
        measured = drift_mod.measure(drift_mod.extract(rgb), reference)
        checks.append(
            Check(
                name="colour_drift",
                value=round(measured.colour, 4),
                threshold=round(measured.colour_limit, 4),
                comparison="<=",
                passed=measured.colour <= measured.colour_limit,
                hard=False,
                detail="Jensen-Shannon distance to reference colour centroid",
            ),
        )
        checks.append(
            Check(
                name="tone_drift",
                value=round(measured.tone_z, 2),
                threshold=thresholds.tone_max_z,
                comparison="<=",
                passed=measured.tone_z <= thresholds.tone_max_z,
                hard=False,
                detail="worst z-score of lightness/chroma/edge statistics vs references",
            ),
        )

    hard_pass = all(c.passed for c in checks if c.hard)
    return Evaluation(checks=checks, hard_pass=hard_pass, warnings=warnings)
