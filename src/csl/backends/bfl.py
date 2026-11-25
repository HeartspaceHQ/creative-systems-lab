"""Black Forest Labs FLUX (FLUX.2 [pro], FLUX 3 Image) through the BFL API.

The API is asynchronous: a POST returns a job with a ``polling_url`` and the cost in credits
(1 credit = 0.01 USD), then the finished job holds a signed URL to the image. FLUX.2 [pro]
accepts a seed and exact size; FLUX 3 Image takes an aspect ratio and a resolution tier.
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
    number_at,
    poll_until,
    require_host,
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

KEY_VARIABLE = "BFL_API_KEY"
_BASE = "https://api.bfl.ai/v1"
_HOST = "bfl.ai"
_USD_PER_CREDIT = 0.01
_POLL = PollSpec(
    status_path=("status",),
    ready=frozenset({"Ready"}),
    failed=frozenset({"Error", "Failed", "Request Moderated", "Content Moderated"}),
)
_FLUX3_ASPECTS = ("1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9")
_FLUX3_TIERS: tuple[tuple[int, str], ...] = ((1024, "1k"), (1536, "1.5k"), (2048, "2k"))


class BflFlux:
    """One BFL endpoint, e.g. ``flux-2-pro`` or ``flux-3-image``."""

    def __init__(
        self,
        endpoint: str,
        name: str,
        transport: Transport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._endpoint = endpoint
        self._name = name
        self._transport = transport or UrllibTransport()
        self._sleep = sleep

    def pin(self) -> ModelPin:
        """The endpoint name is the pin; BFL documents ``flux-2-pro`` as a fixed snapshot."""
        return ModelPin(
            backend=self._name,
            model_id=f"bfl/{self._endpoint}",
            revision=None,
            tool_versions={"api": f"bfl/v1/{self._endpoint}"},
        )

    def _body(self, recipe: Recipe) -> dict[str, object]:
        if self._endpoint.startswith("flux-3"):
            return {
                "prompt": recipe.prompt,
                "aspect_ratio": nearest_aspect(recipe.width, recipe.height, _FLUX3_ASPECTS),
                "resolution": size_tier(max(recipe.width, recipe.height), _FLUX3_TIERS),
            }
        return {
            "prompt": recipe.prompt,
            "width": recipe.width,
            "height": recipe.height,
            "seed": recipe.seed,
            "output_format": "png",
            "safety_tolerance": 2,
        }

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Submit, poll until ready, download the image."""
        headers = {"x-key": api_key(KEY_VARIABLE)}
        body = self._body(recipe)
        job = send_json(self._transport, "POST", f"{_BASE}/{self._endpoint}", headers, body)
        polling_url = text_at(job, ["polling_url"])
        if polling_url is None:
            msg = f"BFL returned no polling_url: {job}"
            raise HostedError(msg)
        require_host(polling_url, _HOST)
        with after_submission():
            done = poll_until(
                lambda: send_json(self._transport, "GET", polling_url, headers),
                _POLL,
                self._sleep,
            )
            sample = text_at(done, ["result", "sample"])
            if sample is None:
                msg = "BFL job is ready but has no result.sample"
                raise HostedError(msg)
            # The signed result URL needs no key, and none is sent to it.
            save_image(self._transport.send("GET", sample, {}, None), output)
        credits_used = number_at(job, ["cost"])
        usage: dict[str, float | int | str] = {
            k: v for k, v in body.items() if k != "prompt" and isinstance(v, str | int)
        }
        if credits_used is None:
            return Cost(usd=None, basis="BFL response carried no cost", estimated=True, usage=usage)
        usage["credits"] = credits_used
        return Cost(
            usd=round(credits_used * _USD_PER_CREDIT, 6),
            basis="BFL response cost in credits x 0.01 USD",
            estimated=False,
            usage=usage,
        )
