"""Model registry and selection: which models exist, what they allow, which one serves a brief.

Local models and hosted APIs are equal entries. A hosted entry carries a price and is never
auto-selected: it runs only when asked for by key, and only inside an approved budget.

Selection is rule-based and explains itself. For each registered model it returns either a
place in the ranking or a concrete reason for exclusion (licence, memory, unsupported kind,
not installed). The licence rule is the one that matters most in practice: FLUX.2 Klein 4B is
Apache-2.0, the 9B variant is non-commercial, and a commercial brief must never reach it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from csl.backends import bfl, elevenlabs_images, gemini_images, mflux, openai_images, xai_images
from csl.backends.hosted import key_missing
from csl.backends.procedural import ProceduralBackend
from csl.pricing import LOCAL, Price

if TYPE_CHECKING:
    from collections.abc import Callable

    from csl.backends.base import Backend
    from csl.schema import BrandContext, Brief, Kind


@dataclass(frozen=True)
class SizeRule:
    """The image sizes a provider accepts, checked before any request is made.

    A refused size costs nothing but wastes the designer's time, and some providers ignore the
    requested size instead of refusing it, so the rule is stated here, once, per model.
    """

    min_pixels: int = 0
    max_edge: int | None = None
    multiple_of: int = 1

    def problem(self, width: int, height: int) -> str | None:
        """A plain sentence on why ``width`` x ``height`` is not accepted, or None."""
        if width * height < self.min_pixels:
            side = math.isqrt(self.min_pixels)
            return (
                f"This model needs images of at least {side} x {side} pixels "
                "(or the same area in another shape); choose a larger size in the brief."
            )
        if self.max_edge is not None and max(width, height) > self.max_edge:
            return (
                f"This model makes images up to {self.max_edge} pixels on the long side; "
                "choose a smaller size in the brief."
            )
        if width % self.multiple_of or height % self.multiple_of:
            return (
                f"This model needs width and height in steps of {self.multiple_of} pixels; "
                "adjust the size in the brief."
            )
        return None


ANY_SIZE = SizeRule()
# OpenAI refused a real 320x320 request (HTTP 400, "below the current minimum pixel budget");
# 1280x1280 and 1536x1024 are known to work. The edge limits are the documented ones.
_OPENAI_SIZE = SizeRule(min_pixels=1024 * 1024, max_edge=2048, multiple_of=16)


@dataclass(frozen=True)
class ModelEntry:
    """A registered model: what it is, what it permits and how to build its backend."""

    key: str
    description: str
    licence: str
    commercial_use: bool
    kinds: frozenset[Kind]
    memory_gb: float
    steps: int
    make: Callable[[BrandContext], Backend]
    unavailable: Callable[[], str | None]
    auto_select: bool = True
    is_generative_model: bool = True
    location: Literal["local", "hosted"] = "local"
    price: Price = LOCAL
    key_variable: str | None = None
    size: SizeRule = ANY_SIZE


def _never_unavailable() -> str | None:
    return None


def _procedural(brand: BrandContext) -> Backend:
    return ProceduralBackend(list(brand.palette.values()))


def _off_brand(_: BrandContext) -> Backend:
    return ProceduralBackend.off_brand()


def _mflux(model_id: str, quantize: int | None, key: str) -> Callable[[BrandContext], Backend]:
    def make(_: BrandContext) -> Backend:
        return mflux.MfluxBackend(model_id, quantize, key)

    return make


_KLEIN_4B = "black-forest-labs/FLUX.2-klein-4B"
_KLEIN_9B_Q6 = "mflux-community/flux2-klein-9b-mflux-q6"
_BOTH: frozenset[Kind] = frozenset({"illustration", "photo"})

_PRICES_READ = "read 2026-11-22"
_GPT_IMAGE_HIGH = Price(
    tiers=((1024, 0.07), (1280, 0.07), (1536, 0.07), (2048, 0.20)),
    source=(
        "estimate: OpenAI publishes token rates, not a per-image table for 2.6. Measured from "
        "response usage on 2026-11-22 at quality high: 1280x1280 $0.0636, 1536x1024 $0.0421; "
        "2048 not measured"
    ),
    confirmed=False,
)
_NANO_BANANA_21 = {"1K": 0.0336, "2K": 0.0504, "4K": 0.113}
_NANO_BANANA_PRO = {"1K": 0.134, "2K": 0.134, "4K": 0.24}


def _tiers(prices: dict[str, float]) -> tuple[tuple[int, float], ...]:
    limits = dict(gemini_images.SIZE_TIERS)
    return tuple((limit, prices[label]) for limit, label in limits.items())


def _hosted(  # one place that fills the fields every hosted entry shares
    key: str,
    description: str,
    terms: str,
    key_variable: str,
    price: Price,
    make: Callable[[BrandContext], Backend],
    size: SizeRule = ANY_SIZE,
) -> ModelEntry:
    return ModelEntry(
        key=key,
        description=description,
        licence=terms,
        commercial_use=True,
        kinds=frozenset({"photo", "illustration"}),
        memory_gb=0.0,
        steps=1,
        make=make,
        unavailable=lambda: key_missing(key_variable),
        auto_select=False,
        location="hosted",
        price=price,
        key_variable=key_variable,
        size=size,
    )


_HOSTED: tuple[ModelEntry, ...] = (
    _hosted(
        "gpt-image-2.6-sunburst",
        "OpenAI GPT Image 2.6 Sunburst, quality high (detailed visual work)",
        "OpenAI terms (unreviewed)",
        openai_images.KEY_VARIABLE,
        _GPT_IMAGE_HIGH,
        lambda _: openai_images.OpenAIImages(
            "gpt-image-2.6-sunburst", "high", "gpt-image-2.6-sunburst"
        ),
        _OPENAI_SIZE,
    ),
    _hosted(
        "gpt-image-2.6-flare",
        "OpenAI GPT Image 2.6 Flare, quality high (fast iteration)",
        "OpenAI terms (unreviewed)",
        openai_images.KEY_VARIABLE,
        _GPT_IMAGE_HIGH,
        lambda _: openai_images.OpenAIImages("gpt-image-2.6-flare", "high", "gpt-image-2.6-flare"),
        _OPENAI_SIZE,
    ),
    _hosted(
        "nano-banana-2.1",
        "Google Gemini Nano Banana 2.1 (SynthID watermark)",
        "Google Gemini API terms (unreviewed)",
        gemini_images.KEY_VARIABLE,
        Price(_tiers(_NANO_BANANA_21), f"Gemini API pricing page, {_PRICES_READ}", confirmed=True),
        lambda _: gemini_images.GeminiImages(
            "gemini-nano-banana-2.1", "nano-banana-2.1", _NANO_BANANA_21
        ),
    ),
    _hosted(
        "nano-banana-pro",
        "Google Gemini 3 Pro Image, Nano Banana Pro (SynthID watermark)",
        "Google Gemini API terms (unreviewed)",
        gemini_images.KEY_VARIABLE,
        Price(_tiers(_NANO_BANANA_PRO), f"Gemini API pricing page, {_PRICES_READ}", confirmed=True),
        lambda _: gemini_images.GeminiImages(
            "gemini-3-pro-image", "nano-banana-pro", _NANO_BANANA_PRO
        ),
    ),
    _hosted(
        "grok-imagine-image-2.0",
        "xAI Grok Imagine Image 2.0",
        "xAI terms (unreviewed)",
        xai_images.KEY_VARIABLE,
        Price(
            ((8192, 0.04),), f"docs.x.ai model page, flat per image, {_PRICES_READ}", confirmed=True
        ),
        lambda _: xai_images.XaiImages("grok-imagine-image-2.0", "grok-imagine-image-2.0", 0.04),
    ),
    _hosted(
        "flux-2-pro",
        "Black Forest Labs FLUX.2 [pro] (fixed snapshot, seed supported)",
        "BFL API terms (unreviewed)",
        bfl.KEY_VARIABLE,
        Price(
            ((8192, 0.03),),
            f"bfl.ai/pricing, $0.015 per extra MP, {_PRICES_READ}",
            confirmed=True,
            per_extra_megapixel=0.015,
        ),
        lambda _: bfl.BflFlux("flux-2-pro", "flux-2-pro"),
    ),
    _hosted(
        "flux-3-image",
        "Black Forest Labs FLUX 3 Image",
        "BFL API terms (unreviewed)",
        bfl.KEY_VARIABLE,
        Price(
            ((1024, 0.048), (1536, 0.07), (2048, 0.10)),
            f"bfl.ai/pricing, {_PRICES_READ}",
            confirmed=True,
        ),
        lambda _: bfl.BflFlux("flux-3-image", "flux-3-image"),
    ),
    _hosted(
        "elevenlabs-nano-banana-pro",
        "Nano Banana Pro reached through ElevenLabs Image & Video (needs Pro plan or above)",
        "ElevenLabs terms (unreviewed)",
        elevenlabs_images.KEY_VARIABLE,
        Price(
            ((8192, 0.20),), "no per-image credit table published; assumed ceiling", confirmed=False
        ),
        lambda _: elevenlabs_images.ElevenLabsImages(
            "gemini-3-pro-image", "elevenlabs-nano-banana-pro"
        ),
    ),
    _hosted(
        "elevenlabs-gpt-image-2.5-sunburst",
        "OpenAI GPT Image 2.5 Sunburst reached through ElevenLabs Image & Video, quality high",
        "ElevenLabs terms (unreviewed)",
        elevenlabs_images.KEY_VARIABLE,
        Price(
            ((8192, 0.20),), "no per-image credit table published; assumed ceiling", confirmed=False
        ),
        lambda _: elevenlabs_images.ElevenLabsImages(
            "gpt-image-2.5-sunburst", "elevenlabs-gpt-image-2.5-sunburst", quality="high"
        ),
    ),
)


REGISTRY: tuple[ModelEntry, ...] = (
    ModelEntry(
        key="flux2-klein-4b-q8",
        description="FLUX.2 Klein 4B, 8-bit quantised, via mflux (MLX)",
        licence="Apache-2.0",
        commercial_use=True,
        kinds=_BOTH,
        memory_gb=24.0,
        steps=8,
        make=_mflux(_KLEIN_4B, 8, "flux2-klein-4b-q8"),
        unavailable=lambda: mflux.unavailable_reason(_KLEIN_4B),
    ),
    ModelEntry(
        key="flux2-klein-4b-q4",
        description="FLUX.2 Klein 4B, 4-bit quantised, via mflux (MLX)",
        licence="Apache-2.0",
        commercial_use=True,
        kinds=_BOTH,
        memory_gb=25.0,
        steps=8,
        make=_mflux(_KLEIN_4B, 4, "flux2-klein-4b-q4"),
        unavailable=lambda: mflux.unavailable_reason(_KLEIN_4B),
    ),
    ModelEntry(
        key="flux2-klein-9b-q6",
        description="FLUX.2 Klein 9B, pre-quantised 6-bit mflux export",
        licence="FLUX Non-Commercial License",
        commercial_use=False,
        kinds=_BOTH,
        memory_gb=25.0,
        steps=8,
        make=_mflux(_KLEIN_9B_Q6, None, "flux2-klein-9b-q6"),
        unavailable=lambda: mflux.unavailable_reason(_KLEIN_9B_Q6),
    ),
    ModelEntry(
        key="procedural",
        description="Deterministic flat-shape renderer (not a generative model; CPU, no weights)",
        licence="n/a",
        commercial_use=True,
        kinds=frozenset({"illustration"}),
        memory_gb=0.1,
        steps=1,
        make=_procedural,
        unavailable=_never_unavailable,
        is_generative_model=False,
    ),
    ModelEntry(
        key="procedural-offbrand",
        description="Negative control: same renderer with a palette no brand contains",
        licence="n/a",
        commercial_use=True,
        kinds=frozenset({"illustration"}),
        memory_gb=0.1,
        steps=1,
        make=_off_brand,
        unavailable=_never_unavailable,
        auto_select=False,
        is_generative_model=False,
    ),
    *_HOSTED,
)


@dataclass(frozen=True)
class Selection:
    """Result of model selection: ranked choices and why every other model was excluded."""

    chosen: tuple[ModelEntry, ...]
    excluded: tuple[tuple[str, str], ...]


def get(key: str) -> ModelEntry:
    """Look up a model by key."""
    for entry in REGISTRY:
        if entry.key == key:
            return entry
    known = ", ".join(e.key for e in REGISTRY)
    msg = f"unknown model {key!r}; known: {known}"
    raise KeyError(msg)


def exclusion_reason(entry: ModelEntry, brief: Brief) -> str | None:
    """Why ``entry`` may not serve ``brief``, or None."""
    if brief.commercial_use and not entry.commercial_use:
        return f"licence '{entry.licence}' does not allow commercial use"
    if brief.kind not in entry.kinds:
        return f"does not support kind '{brief.kind}'"
    if brief.max_memory_gb is not None and entry.memory_gb > brief.max_memory_gb:
        return f"needs about {entry.memory_gb:g} GB, brief allows {brief.max_memory_gb:g} GB"
    return entry.size.problem(brief.width, brief.height) or entry.unavailable()


def select(brief: Brief, requested: tuple[str, ...] = ()) -> Selection:
    """Choose models for a brief.

    With ``requested`` keys, only those are considered, in the given order, and a request the
    rules reject is reported as excluded rather than overridden. Without it, every
    auto-selectable model that passes the rules is chosen, generative models first.
    """
    pool = [get(key) for key in requested] if requested else [e for e in REGISTRY if e.auto_select]
    chosen: list[ModelEntry] = []
    excluded: list[tuple[str, str]] = []
    for entry in pool:
        reason = exclusion_reason(entry, brief)
        if reason is None:
            chosen.append(entry)
        else:
            excluded.append((entry.key, reason))
    if not requested:
        chosen.sort(key=lambda e: not e.is_generative_model)
    return Selection(chosen=tuple(chosen), excluded=tuple(excluded))
