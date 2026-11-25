"""Price per generated image, with where the number comes from and whether it is confirmed.

Quotes are used before any paid call: to show the cost of a brief (``csl quote``) and to check
it against an approved budget. A price that is not published by the provider is marked
unconfirmed, and the budget reserves a safety margin on top of it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

_UNCONFIRMED_MARGIN = 1.5
_PIXELS_PER_MEGAPIXEL = 1_000_000


@dataclass(frozen=True)
class Price:
    """USD per image by size tier (largest side in pixels), plus any per-megapixel surcharge."""

    tiers: tuple[tuple[int, float], ...]
    source: str
    confirmed: bool
    per_extra_megapixel: float = 0.0

    def per_image(self, width: int, height: int) -> float:
        """Best known price of one image of this size."""
        long_side = max(width, height)
        base = next((usd for limit, usd in self.tiers if long_side <= limit), self.tiers[-1][1])
        extra = max(0, math.ceil(width * height / _PIXELS_PER_MEGAPIXEL) - 1)
        return round(base + extra * self.per_extra_megapixel, 6)

    def reserve(self, width: int, height: int) -> float:
        """What a budget holds back for one image: the price, plus a margin when unconfirmed."""
        margin = 1.0 if self.confirmed else _UNCONFIRMED_MARGIN
        return round(self.per_image(width, height) * margin, 6)

    @property
    def free(self) -> bool:
        """True for local generation, which never touches a budget."""
        return all(usd == 0 for _, usd in self.tiers) and self.per_extra_megapixel == 0


LOCAL = Price(tiers=((8192, 0.0),), source="runs on this machine", confirmed=True)
