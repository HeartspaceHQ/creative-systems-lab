"""ElevenLabs Image & Video API (``/v1/flows/image``): one key for several vendors' models.

The API is asynchronous (create, then poll until ``completed``) and reports no credits, so the
cost of a call cannot be read from the response. It is recorded as unknown and has to be taken
from the account's usage page.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from csl.backends.hosted import (
    HostedError,
    PollSpec,
    Transport,
    UrllibTransport,
    after_submission,
    api_key,
    nearest_aspect,
    poll_until,
    save_image,
    send_json,
    size_tier,
    text_at,
)
from csl.schema import Cost, ModelPin

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from csl.schema import Recipe

KEY_VARIABLE = "ELEVENLABS_API_KEY"
_URL = "https://api.elevenlabs.io/v1/flows/image"
_POLL = PollSpec(
    status_path=("status",),
    ready=frozenset({"completed"}),
    failed=frozenset({"failed"}),
)
_ASPECTS = ("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9")
_TIERS: tuple[tuple[int, str], ...] = ((1024, "1K"), (2048, "2K"), (4096, "4K"))


class ElevenLabsImages:
    """One model reached through ElevenLabs, e.g. ``gpt-image-2.5-sunburst``.

    ``quality`` is sent only for the GPT Image variants, which are the ones that accept it.
    """

    def __init__(
        self,
        model_id: str,
        name: str,
        transport: Transport | None = None,
        *,
        quality: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._model_id = model_id
        self._name = name
        self._quality = quality
        self._transport = transport or UrllibTransport()
        self._sleep = sleep

    def pin(self) -> ModelPin:
        """The vendor model id behind ElevenLabs is the pin."""
        return ModelPin(
            backend=self._name,
            model_id=f"elevenlabs/{self._model_id}",
            revision=None,
            tool_versions={"api": "elevenlabs/v1/flows/image"},
        )

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Create a generation, poll it, download the image."""
        headers = {"xi-api-key": api_key(KEY_VARIABLE)}
        aspect = nearest_aspect(recipe.width, recipe.height, _ASPECTS)
        resolution = size_tier(max(recipe.width, recipe.height), _TIERS)
        body: dict[str, object] = {
            "model_id": self._model_id,
            "prompt": recipe.prompt,
            "aspect_ratio": aspect,
            "resolution": resolution,
        }
        usage: dict[str, str] = {"aspect_ratio": aspect, "resolution": resolution}
        if self._quality is not None:
            body["quality"] = self._quality
            usage["quality"] = self._quality
        job = send_json(self._transport, "POST", _URL, headers, body)
        job_id = text_at(job, ["id"])
        if job_id is None:
            msg = f"ElevenLabs returned no generation id: {job}"
            raise HostedError(msg)
        with after_submission():
            done = poll_until(
                lambda: send_json(self._transport, "GET", f"{_URL}/{job_id}", headers),
                _POLL,
                self._sleep,
            )
            content_url = text_at(done, ["content_url"])
            if content_url is None:
                msg = "ElevenLabs generation completed without content_url"
                raise HostedError(msg)
            save_image(self._transport.send("GET", content_url, {}, None), output)
        return Cost(
            usd=None,
            basis="ElevenLabs reports no credits per call; read the account usage page",
            estimated=True,
            usage={**usage, "generation_id": job_id},
        )
