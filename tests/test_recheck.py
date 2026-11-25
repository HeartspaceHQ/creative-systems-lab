"""Rechecking earlier candidates: same images, new evaluation, source runs untouched."""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from csl import cli, pipeline
from csl.canonical import sha256_file
from csl.drift import reference_dir_for
from csl.integrity import IntegrityError
from csl.recheck import RecheckError, recheck
from csl.reproduce import verify
from csl.schema import BrandContext, Thresholds
from csl.store import SOURCE_NAME, write_json

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Brief
    from csl.store import RunStore


def _clock(minute: int) -> datetime:
    return datetime(2026, 11, 22, 12, minute, tzinfo=UTC)


def _two_runs(brief: Brief, brand: BrandContext, runs_dir: Path) -> list[RunStore]:
    first = pipeline.run(brief, brand, runs_dir, ("procedural",), clock=lambda: _clock(0))
    second = pipeline.run(
        brief.model_copy(update={"base_seed": 900}),
        brand,
        runs_dir,
        ("procedural",),
        clock=lambda: _clock(1),
    )
    return [first, second]


def _snapshot(store: RunStore) -> dict[str, str]:
    return {
        str(path.relative_to(store.root)): sha256_file(path)
        for path in sorted(store.root.rglob("*"))
        if path.is_file()
    }


def test_recheck_keeps_images_and_manifests_and_seals_a_new_run(
    brief: Brief, brand: BrandContext, runs_dir: Path, tmp_path: Path
) -> None:
    sources = _two_runs(brief, brand, runs_dir)
    before = [_snapshot(store) for store in sources]
    stricter = brand.model_copy(update={"thresholds": Thresholds(palette_min_covered_area=0.99)})

    store = recheck(sources, stricter, tmp_path / "rechecked", clock=lambda: _clock(5))

    assert [_snapshot(s) for s in sources] == before
    assert store.root.name == f"{brief.id}-recheck-20261122T120500"
    assert store.brief().candidates == 4
    assert store.brand() == stricter
    for source in sources:
        for view in source.candidates():
            copied = store.candidate(view.id)
            assert sha256_file(copied.image) == sha256_file(view.image)
            assert copied.manifest == view.manifest
            assert (copied.directory / SOURCE_NAME).is_file()
    record = json.loads((store.root / "run.json").read_text(encoding="utf-8"))
    assert record["rechecked_from"] == [s.root.name for s in sources]
    result = verify(store)
    assert result.intact, result.problems


def test_verify_finds_a_changed_source_snapshot(
    brief: Brief, brand: BrandContext, runs_dir: Path, tmp_path: Path
) -> None:
    store = recheck(_two_runs(brief, brand, runs_dir), brand, tmp_path / "r")
    view = store.candidates()[0]
    path = view.directory / SOURCE_NAME
    source = json.loads(path.read_text(encoding="utf-8"))
    source["brief"]["subject"] = "something else"
    path.write_text(json.dumps(source), encoding="utf-8")
    assert not verify(store).intact


def test_recheck_refuses_runs_for_different_briefs(
    brief: Brief, brand: BrandContext, runs_dir: Path, tmp_path: Path
) -> None:
    first = pipeline.run(brief, brand, runs_dir, ("procedural",), clock=lambda: _clock(0))
    other = brief.model_copy(update={"subject": "A different subject"})
    second = pipeline.run(other, brand, runs_dir, ("procedural",), clock=lambda: _clock(1))
    with pytest.raises(RecheckError, match="another brief"):
        recheck([first, second], brand, tmp_path / "r")


def test_recheck_refuses_the_same_candidate_twice(
    brief: Brief, brand: BrandContext, runs_dir: Path, tmp_path: Path
) -> None:
    store = pipeline.run(brief, brand, runs_dir, ("procedural",))
    with pytest.raises(RecheckError, match="more than one"):
        recheck([store, store], brand, tmp_path / "r")


def test_recheck_refuses_an_altered_source(
    brief: Brief, brand: BrandContext, runs_dir: Path, tmp_path: Path
) -> None:
    store = pipeline.run(brief, brand, runs_dir, ("procedural",))
    image = store.candidates()[0].image
    image.write_bytes(image.read_bytes() + b"\0")
    with pytest.raises(IntegrityError):
        recheck([store], brand, tmp_path / "r")


def test_references_are_chosen_by_kind(tmp_path: Path) -> None:
    flat = tmp_path / "flat"
    flat.mkdir()
    assert reference_dir_for(flat, "photo") == flat
    split = tmp_path / "split"
    (split / "illustration").mkdir(parents=True)
    assert reference_dir_for(split, "illustration") == split / "illustration"
    assert reference_dir_for(split, "photo") is None
    assert reference_dir_for(None, "photo") is None


def test_run_ignores_references_of_another_kind(
    brief: Brief, brand: BrandContext, runs_dir: Path, tmp_path: Path
) -> None:
    """An illustration brief is not measured against the brand's photographs."""
    photos = tmp_path / "references" / "photo"
    photos.mkdir(parents=True)
    source = pipeline.run(brief, brand, runs_dir, ("procedural",), clock=lambda: _clock(0))
    for view in source.candidates():
        shutil.copyfile(view.image, photos / f"{view.id}.png")
    store = pipeline.run(
        brief,
        brand,
        runs_dir,
        ("procedural",),
        reference_dir=tmp_path / "references",
        clock=lambda: _clock(1),
    )
    record = json.loads((store.root / "run.json").read_text(encoding="utf-8"))
    assert record["reference_hashes"] == {}
    assert all(
        "no reference set: drift not evaluated" in view.evaluation.warnings
        for view in store.candidates()
    )


def test_cli_recheck(
    brief: Brief,
    brand: BrandContext,
    runs_dir: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sources = _two_runs(brief, brand, runs_dir)
    brand_file = tmp_path / "brand.json"
    write_json(brand_file, brand)
    out = tmp_path / "rechecked"
    code = cli.main(
        [
            "recheck",
            *(str(s.root) for s in sources),
            "--brand",
            str(brand_file),
            "--runs-dir",
            str(out),
        ]
    )
    assert code == 0
    assert "run:" in capsys.readouterr().out
    assert len(list(out.iterdir())) == 1
