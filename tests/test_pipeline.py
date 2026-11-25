from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from csl import integrity, pipeline
from csl.export import export_approved
from csl.reproduce import replay, verify
from csl.review import ReviewError, decide
from csl.schema import Brief

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import BrandContext
    from csl.store import RunStore


def _clock() -> datetime:
    return datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


@pytest.fixture
def store(brand: BrandContext, brief: Brief, runs_dir: Path) -> RunStore:
    return pipeline.run(
        brief,
        brand,
        runs_dir,
        ("procedural", "procedural-offbrand"),
        clock=_clock,
    )


def test_run_layout_and_statuses(store: RunStore) -> None:
    views = {v.id: v for v in store.candidates()}
    assert len(views) == 4
    on = [v for v in views.values() if v.manifest.recipe.pin.backend == "procedural"]
    off = [v for v in views.values() if v.manifest.recipe.pin.backend == "procedural-offbrand"]
    assert all(v.status == "pending" for v in on)
    assert all(v.status == "auto_rejected" for v in off)
    assert (store.root / "selection.json").is_file()
    assert store.root.name == "test-brief-20260102T030405"


def test_seeds_derive_from_brief_hash_and_are_stable(
    brand: BrandContext,
    brief: Brief,
    runs_dir: Path,
) -> None:
    a = pipeline.run(brief, brand, runs_dir / "a", ("procedural",), clock=_clock)
    b = pipeline.run(brief, brand, runs_dir / "b", ("procedural",), clock=_clock)
    seeds_a = [v.manifest.recipe.seed for v in a.candidates()]
    seeds_b = [v.manifest.recipe.seed for v in b.candidates()]
    assert seeds_a == seeds_b
    assert seeds_a[1] == seeds_a[0] + 1
    assert [v.manifest.output.sha256 for v in a.candidates()] == [
        v.manifest.output.sha256 for v in b.candidates()
    ]


def test_auto_rejected_cannot_be_approved_without_justified_override(store: RunStore) -> None:
    bad = next(v.id for v in store.candidates() if v.status == "auto_rejected")
    with pytest.raises(ReviewError, match="--override"):
        decide(store, bad, "approve", "tester")
    with pytest.raises(ReviewError, match="justification"):
        decide(store, bad, "approve", "tester", override=True)
    decision = decide(
        store, bad, "approve", "tester", "brand lead accepts this once", override=True
    )
    assert decision.override
    assert store.candidate(bad).status == "approved"


def test_review_flow_export_and_verify(store: RunStore) -> None:
    first, second = [v.id for v in store.candidates() if v.status == "pending"]
    decide(store, first, "approve", "tester", "good")
    decide(store, second, "reject", "tester", "too busy")
    assert export_approved(store) == [f"test-brief-{first}.png"]
    assert verify(store).problems == []
    assert verify(store).warnings == []
    sidecar = (store.export_dir / f"test-brief-{first}.json").read_text(encoding="utf-8")
    assert '"reviewer": "tester"' in sidecar
    assert "recipe_hash" in sidecar


def test_latest_decision_wins(store: RunStore) -> None:
    cid = next(v.id for v in store.candidates() if v.status == "pending")
    decide(store, cid, "approve", "a")
    decide(store, cid, "reject", "b", "changed my mind")
    assert store.candidate(cid).status == "rejected"
    assert len(store.decisions()) == 2


def test_verify_detects_tampering(store: RunStore) -> None:
    cid = next(v.id for v in store.candidates() if v.status == "pending")
    image = store.candidate(cid).image
    image.write_bytes(image.read_bytes() + b"\x00")
    assert any("differ" in p for p in verify(store).problems)


def test_verify_detects_edited_brand_snapshot(store: RunStore) -> None:
    path = store.root / "brand.json"
    path.write_text(
        path.read_text(encoding="utf-8").replace("#1f2a44", "#1f2a45"), encoding="utf-8"
    )
    assert any("brand snapshot" in p for p in verify(store).problems)


def test_replay_is_bit_identical(store: RunStore) -> None:
    cid = store.candidates()[0].id
    result = replay(store, cid)
    assert result.status == "bit_identical"


def test_replay_refuses_when_pin_changed(store: RunStore) -> None:
    cid = next(v.id for v in store.candidates() if v.manifest.recipe.pin.backend == "procedural")
    manifest_path = store.candidate(cid).directory / "manifest.json"
    text = manifest_path.read_text(encoding="utf-8").replace(
        "csl-flat-shapes-v1", "csl-flat-shapes-v0"
    )
    manifest_path.write_text(text, encoding="utf-8")
    integrity.seal_generation(store)  # a re-sealed run: only the pin differs from this machine
    assert replay(store, cid).status == "pin_mismatch"
    assert replay(store, cid, force=True).status == "bit_identical"


def test_no_model_for_brief_is_an_error(brand: BrandContext, runs_dir: Path) -> None:
    photo = Brief(id="p", subject="s", kind="photo")
    with pytest.raises(RuntimeError, match="no model can serve"):
        pipeline.run(photo, brand, runs_dir, ("procedural",))
