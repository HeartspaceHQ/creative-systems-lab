"""Plain-language explanations of automated checks, for a designer rather than an engineer.

Every explanation says what was measured, what the result means here, and what the check
cannot tell. Wording stays within what the code computes: colour and tone against numbers, not
whether an image follows a brand.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from csl.schema import Check


@dataclass(frozen=True)
class Explanation:
    """What a check measured and why it passed or raised a warning."""

    measured: str
    outcome: str
    consequence: str
    blind_spot: str


_MEASURED = {
    "forbidden_colour_area": "How much of the image is a colour the brand has forbidden.",
    "palette_fit": "How much of the image's main colours lie close to a brand palette colour.",
    "overlay_contrast": "How readable the planned text colour would be over the reserved area.",
    "colour_drift": "How far the image's overall colour mix is from the approved references.",
    "tone_drift": (
        "How far the image's lightness, colour intensity and amount of edges are from "
        "the approved references."
    ),
}
_BLIND_SPOT = {
    "forbidden_colour_area": "Only the listed colours are checked, nothing else that looks wrong.",
    "palette_fit": "Says nothing about subject, composition or mood.",
    "overlay_contrast": "Measures the worst pixels in the zone, not how busy the area looks.",
    "colour_drift": "Experimental. A new but legitimate direction also scores as drift.",
    "tone_drift": "Experimental. Calibrated on a handful of images, so treat it as a hint.",
}


def _percent(value: float) -> str:
    return f"{value:.0%}"


def _outcome(check: Check) -> str:
    name, value, limit = check.name, check.value, check.threshold
    if name == "forbidden_colour_area":
        return (
            f"{_percent(value)} of the pixels are close to a forbidden colour "
            f"(allowed: up to {_percent(limit)})."
        )
    if name == "palette_fit":
        return (
            f"{_percent(value)} of the main-colour area is near the palette "
            f"(needs at least {_percent(limit)}). {check.detail}."
        )
    if name == "overlay_contrast":
        return (
            f"Contrast ratio {value:g}:1 in the worst part of the text area "
            f"(needs at least {limit:g}:1)."
        )
    if name == "colour_drift":
        return f"Colour distance {value:g} against a limit of {limit:g} (0 means identical mix)."
    if name == "tone_drift":
        return (
            f"The most unusual tone statistic is {value:g} standard deviations from the "
            f"references (limit {limit:g})."
        )
    return f"Measured {value:g}, limit {limit:g}."


def explain(check: Check) -> Explanation:
    """Explain one check result."""
    if check.passed:
        consequence = "Within the limit."
    elif check.hard:
        consequence = (
            "Hard check failed: the image is held back from review, and approving it needs "
            "an override with a written reason."
        )
    else:
        consequence = "Warning only: nothing is blocked. Look at the image and decide."
    return Explanation(
        measured=_MEASURED.get(check.name, check.name),
        outcome=_outcome(check),
        consequence=consequence,
        blind_spot=_BLIND_SPOT.get(check.name, ""),
    )
