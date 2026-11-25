from __future__ import annotations

import pytest

from csl import registry
from csl.schema import Brief


def _brief(**kwargs: object) -> Brief:
    base: dict[str, object] = {"id": "b", "subject": "s", "kind": "illustration"}
    return Brief.model_validate({**base, **kwargs})


def test_commercial_brief_excludes_non_commercial_model() -> None:
    reason = registry.exclusion_reason(registry.get("flux2-klein-9b-q6"), _brief())
    assert reason is not None
    assert "commercial" in reason


def test_non_commercial_brief_does_not_trip_licence_rule() -> None:
    reason = registry.exclusion_reason(
        registry.get("flux2-klein-9b-q6"),
        _brief(commercial_use=False),
    )
    assert reason is None or "commercial" not in reason


def test_photo_brief_excludes_procedural() -> None:
    reason = registry.exclusion_reason(registry.get("procedural"), _brief(kind="photo"))
    assert reason is not None
    assert "photo" in reason


def test_memory_limit_excludes_large_models() -> None:
    reason = registry.exclusion_reason(registry.get("flux2-klein-4b-q8"), _brief(max_memory_gb=8))
    assert reason is not None
    assert "GB" in reason


def test_requested_model_is_reported_not_overridden() -> None:
    selection = registry.select(_brief(), ("procedural", "flux2-klein-9b-q6"))
    assert [e.key for e in selection.chosen] == ["procedural"]
    assert selection.excluded[0][0] == "flux2-klein-9b-q6"


def test_auto_selection_skips_negative_control() -> None:
    selection = registry.select(_brief())
    assert "procedural-offbrand" not in {e.key for e in selection.chosen}


def test_unknown_model_key() -> None:
    with pytest.raises(KeyError, match="unknown model"):
        registry.get("nope")


@pytest.mark.parametrize(
    ("width", "height", "fragment"),
    [
        (320, 320, "at least 1024"),
        (1024, 992, "at least 1024"),
    ],
)
def test_openai_sizes_are_checked_before_any_call(width: int, height: int, fragment: str) -> None:
    reason = registry.exclusion_reason(
        registry.get("gpt-image-2.6-sunburst"), _brief(width=width, height=height)
    )
    assert reason is not None
    assert fragment in reason


@pytest.mark.parametrize("size", [(1024, 1024), (1536, 1024), (2048, 1024)])
def test_openai_accepts_documented_sizes(size: tuple[int, int]) -> None:
    reason = registry.exclusion_reason(
        registry.get("gpt-image-2.6-sunburst"), _brief(width=size[0], height=size[1])
    )
    assert reason is None or "pixels" not in reason


def test_a_small_brief_still_works_for_local_models() -> None:
    brief = _brief(width=320, height=320)
    assert registry.exclusion_reason(registry.get("procedural"), brief) is None


def test_the_size_rule_names_every_kind_of_refusal() -> None:
    rule = registry.SizeRule(min_pixels=1024 * 1024, max_edge=2048, multiple_of=16)
    assert rule.problem(1030, 1030) is not None
    assert "steps of 16" in str(rule.problem(1030, 1030))
    assert "up to 2048" in str(rule.problem(4096, 1024))
    assert rule.problem(1280, 1280) is None
