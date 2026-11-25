"""xAI Grok Imagine through ``POST /v1/images/generations`` (OpenAI-compatible shape).

xAI charges a flat price per image and returns no cost, so cost is the published flat price.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from csl.backends.hosted import (
    HostedError,
    Transport,
    UrllibTransport,
    after_submission,
    api_key,
    decode_base64,
    find_inline_image,
    save_image,
    send_json,
    text_at,
)
from csl.schema import Cost, ModelPin

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Recipe

KEY_VARIABLE = "XAI_API_KEY"
_URL = "https://api.x.ai/v1/images/generations"


class XaiImages:
    """One Grok Imagine model at a flat per-image price."""

    def __init__(
        self,
        model_id: str,
        name: str,
        usd_per_image: float,
        transport: Transport | None = None,
    ) -> None:
        self._model_id = model_id
        self._name = name
        self._usd = usd_per_image
        self._transport = transport or UrllibTransport()

    def pin(self) -> ModelPin:
        """Hosted models have no inspectable revision; the model id is the pin."""
        return ModelPin(
            backend=self._name,
            model_id=self._model_id,
            revision=None,
            tool_versions={"api": "xai/v1/images/generations"},
        )

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Request one image. Size control on this API is not documented, so none is sent."""
        response = send_json(
            self._transport,
            "POST",
            _URL,
            {"Authorization": f"Bearer {api_key(KEY_VARIABLE)}"},
            {
                "model": self._model_id,
                "prompt": recipe.prompt,
                "n": 1,
                "response_format": "b64_json",
            },
        )
        payload = find_inline_image(response)
        if payload is not None:
            save_image(decode_base64(payload), output)
        else:
            url = text_at(response, ["data", 0, "url"])
            if url is None:
                msg = "xAI response holds no image"
                raise HostedError(msg)
            with after_submission():
                save_image(self._transport.send("GET", url, {}, None), output)
        return Cost(
            usd=self._usd,
            basis="xAI flat price per image, docs.x.ai models page 2026-11-22",
            estimated=True,
            usage={"requested_size": f"{recipe.width}x{recipe.height}", "seed": "not used"},
        )
