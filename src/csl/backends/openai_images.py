"""OpenAI GPT Image (2.6 Sunburst and Flare) through ``POST /v1/images/generations``.

Cost is computed from the ``usage`` token counts in the response and OpenAI's published token
rates. The API has no seed, so a repeat call gives a different image; the asset is kept by hash.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from csl.backends.hosted import (
    HostedError,
    Transport,
    UrllibTransport,
    api_key,
    decode_base64,
    find_inline_image,
    number_at,
    save_image,
    send_json,
)
from csl.schema import Cost, ModelPin

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Recipe

KEY_VARIABLE = "OPENAI_API_KEY"
_URL = "https://api.openai.com/v1/images/generations"
# USD per token, https://developers.openai.com/api/docs/pricing, read 2026-11-22.
_TEXT_INPUT_RATE = 5.0 / 1_000_000
_IMAGE_OUTPUT_RATE = 30.0 / 1_000_000


class OpenAIImages:
    """One GPT Image model at one quality setting."""

    def __init__(
        self,
        model_id: str,
        quality: str,
        name: str,
        transport: Transport | None = None,
    ) -> None:
        self._model_id = model_id
        self._quality = quality
        self._name = name
        self._transport = transport or UrllibTransport()

    def pin(self) -> ModelPin:
        """Hosted models have no inspectable revision; the model id and quality are the pin."""
        return ModelPin(
            backend=self._name,
            model_id=self._model_id,
            revision=None,
            tool_versions={"api": "openai/v1/images/generations", "quality": self._quality},
        )

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Request one image at the recipe's exact size."""
        response = send_json(
            self._transport,
            "POST",
            _URL,
            {"Authorization": f"Bearer {api_key(KEY_VARIABLE)}"},
            {
                "model": self._model_id,
                "prompt": recipe.prompt,
                "n": 1,
                "size": f"{recipe.width}x{recipe.height}",
                "quality": self._quality,
                "output_format": "png",
            },
        )
        payload = find_inline_image(response)
        if payload is None:
            msg = "OpenAI response holds no image"
            raise HostedError(msg)
        save_image(decode_base64(payload), output)
        return _cost(response)


def _cost(response: dict[str, object]) -> Cost:
    output_tokens = number_at(response, ["usage", "output_tokens"])
    text_tokens = number_at(response, ["usage", "input_tokens_details", "text_tokens"])
    if text_tokens is None:
        text_tokens = number_at(response, ["usage", "input_tokens"])
    usage: dict[str, float | int | str] = {"seed": "not supported by this API"}
    if output_tokens is None:
        return Cost(usd=None, basis="response carried no usage", estimated=True, usage=usage)
    usage["output_tokens"] = int(output_tokens)
    usage["input_text_tokens"] = int(text_tokens or 0)
    usd = output_tokens * _IMAGE_OUTPUT_RATE + (text_tokens or 0) * _TEXT_INPUT_RATE
    return Cost(
        usd=round(usd, 6),
        basis="response usage tokens x published rates ($30/1M image out, $5/1M text in)",
        estimated=False,
        usage=usage,
    )
