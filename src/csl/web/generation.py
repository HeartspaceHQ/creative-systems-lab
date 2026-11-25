"""What the UI needs before a run starts: which models can run here, and what a run would cost.

Key values never leave the process: the setup only says whether each provider's variable is set.
A quote prices a run exactly as ``pipeline.check_budget`` will, so the number the designer sees
before pressing start is the number the budget is checked against.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from csl import registry
from csl.backends.hosted import key_missing
from csl.keys import key_source

if TYPE_CHECKING:
    from csl.budget import Budget
    from csl.registry import ModelEntry
    from csl.schema import Brief


@dataclass(frozen=True)
class _Provider:
    variable: str
    name: str


_PROVIDER_NAMES = {
    "OPENAI_API_KEY": "OpenAI",
    "GEMINI_API_KEY": "Google Gemini",
    "XAI_API_KEY": "xAI",
    "BFL_API_KEY": "Black Forest Labs",
    "ELEVENLABS_API_KEY": "ElevenLabs",
}


def _providers() -> list[_Provider]:
    seen: dict[str, _Provider] = {}
    for entry in registry.REGISTRY:
        variable = entry.key_variable
        if variable is not None and variable not in seen:
            seen[variable] = _Provider(variable, _PROVIDER_NAMES.get(variable, variable))
    return list(seen.values())


def budget_status(budget: Budget | None) -> dict[str, object] | None:
    """The approved budget and what is left of it, or None when the server runs without one."""
    if budget is None:
        return None
    spend = budget.spend()
    return {
        "id": budget.approval.id,
        "approved_usd": budget.approval.approved_usd,
        "charged_usd": spend.charged,
        "uncertain_usd": spend.uncertain,
        "held_usd": spend.held,
        "remaining_usd": spend.remaining,
        "approved_by": budget.approval.approved_by,
        "approved_on": budget.approval.approved_on.isoformat(),
    }


def setup(budget: Budget | None) -> dict[str, object]:
    """Local models, provider keys (set or not, never the value) and the budget."""
    local = [
        {"key": entry.key, "description": entry.description, "reason": entry.unavailable()}
        for entry in registry.REGISTRY
        if entry.location == "local" and entry.is_generative_model
    ]
    providers = [
        {
            "variable": provider.variable,
            "name": provider.name,
            "set": key_missing(provider.variable) is None,
            "source": key_source(provider.variable),
            "models": [
                entry.key for entry in registry.REGISTRY if entry.key_variable == provider.variable
            ],
        }
        for provider in _providers()
    ]
    return {"local": local, "providers": providers, "budget": budget_status(budget)}


def _no_budget(entry: ModelEntry, budget: Budget | None) -> str | None:
    if entry.price.free or budget is not None:
        return None
    return "needs an approved budget: set a spending limit"


def models(brief: Brief | None, budget: Budget | None) -> list[dict[str, object]]:
    """Every registered model: can it run here, may it serve this brief, and its price."""
    rows: list[dict[str, object]] = []
    for entry in registry.REGISTRY:
        unavailable = entry.unavailable() or _no_budget(entry, budget)
        excluded = registry.exclusion_reason(entry, brief) if brief else None
        rows.append(
            {
                "key": entry.key,
                "description": entry.description,
                "licence": entry.licence,
                "location": entry.location,
                "available": unavailable is None,
                "unavailable_reason": unavailable,
                "excluded_reason": excluded,
                "reason": excluded or unavailable,
                "generative": entry.is_generative_model,
                "per_image_usd": (
                    entry.price.per_image(brief.width, brief.height) if brief else None
                ),
                "price_confirmed": entry.price.confirmed,
                "price_source": entry.price.source,
            }
        )
    return rows


def quote(brief: Brief, keys: tuple[str, ...], budget: Budget | None) -> dict[str, object]:
    """Price a run of ``brief`` on ``keys``: per model, in total, and against the budget."""
    lines: list[dict[str, object]] = []
    total = 0.0
    for key in keys:
        entry = registry.get(key)
        held = round(entry.price.reserve(brief.width, brief.height) * brief.candidates, 6)
        total += held
        lines.append(
            {
                "key": key,
                "free": entry.price.free,
                "per_image_usd": entry.price.per_image(brief.width, brief.height),
                "held_usd": held,
                "confirmed": entry.price.confirmed,
            }
        )
    total = round(total, 6)
    remaining = budget.remaining() if budget is not None else None
    return {
        "candidates": brief.candidates,
        "images": brief.candidates * len(keys),
        "lines": lines,
        "total_held_usd": total,
        "budget": budget_status(budget),
        "fits": total == 0 or (remaining is not None and total <= remaining),
    }
