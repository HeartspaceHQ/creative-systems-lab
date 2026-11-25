"""Google Gemini image models (Nano Banana family) through ``models.generateContent``.

The response reports tokens but no price, so cost comes from Google's per-image table for the
size tier that was requested. Google adds a SynthID watermark to every generated image.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from csl.backends.hosted import (
    HostedError,
    Transport,
    UrllibTransport,
    api_key,
    decode_base64,
    dig,
    find_inline_image,
    nearest_aspect,
    save_image,
    send_json,
    size_tier,
)
from csl.schema import Cost, ModelPin

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Recipe

KEY_VARIABLE = "GEMINI_API_KEY"
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_ASPECTS = ("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")
SIZE_TIERS: tuple[tuple[int, str], ...] = ((1024, "1K"), (2048, "2K"), (4096, "4K"))


class GeminiImages:
    """One Gemini image model. ``prices`` maps a size tier (1K, 2K, 4K) to USD per image."""

    def __init__(
        self,
        model_id: str,
        name: str,
        prices: dict[str, float],
        transport: Transport | None = None,
    ) -> None:
        self._model_id = model_id
        self._name = name
        self._prices = prices
        self._transport = transport or UrllibTransport()

    def pin(self) -> ModelPin:
        """Hosted models have no inspectable revision; the model id is the pin."""
        return ModelPin(
            backend=self._name,
            model_id=self._model_id,
            revision=None,
            tool_versions={"api": "gemini/v1beta/generateContent"},
        )

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Request one image at the nearest supported aspect ratio and size tier."""
        aspect = nearest_aspect(recipe.width, recipe.height, _ASPECTS)
        tier = size_tier(max(recipe.width, recipe.height), SIZE_TIERS)
        response = send_json(
            self._transport,
            "POST",
            f"{_BASE}/{self._model_id}:generateContent",
            {"x-goog-api-key": api_key(KEY_VARIABLE)},
            {
                "contents": [{"parts": [{"text": recipe.prompt}]}],
                "generationConfig": {
                    "responseModalities": ["IMAGE"],
                    "imageConfig": {"aspectRatio": aspect, "imageSize": tier},
                },
            },
        )
        payload = find_inline_image(response)
        if payload is None:
            reason = dig(response, ["candidates", 0, "finishReason"]) or "no image in response"
            msg = f"Gemini returned no image: {reason}"
            raise HostedError(msg)
        save_image(decode_base64(payload), output)
        usage: dict[str, float | int | str] = {
            "aspect_ratio": aspect,
            "image_size": tier,
            "watermark": "SynthID (applied by Google)",
            "seed": "not used",
        }
        tokens = dig(response, ["usageMetadata", "totalTokenCount"])
        if isinstance(tokens, int):
            usage["total_tokens"] = tokens
        return Cost(
            usd=self._prices.get(tier),
            basis=f"Google per-image price for {tier}, Gemini API pricing page 2026-11-22",
            estimated=True,
            usage=usage,
        )
