"""Regression tests for concurrency, export atomicity, integrity on use and provenance."""

from __future__ import annotations

import dataclasses
import json
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from csl import integrity, pipeline, registry
from csl.backends.base import BackendError
from csl.budget import Approval, Budget, BudgetError
from csl.cli import main
from csl.export import ExportError, add_reference, export_approved
from csl.reproduce import replay, verify
from csl.review import ReviewError, decide
from csl.store import RunStore
from csl.validation.generate import generate_set

if TYPE_CHECKING:
    from csl.backends.base import Backend
    from csl.schema import BrandContext, Brief, Cost, ModelPin, Recipe

_THREADS = 8


def _clock() -> datetime:
    return datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


@pytest.fixture
def store(brand: BrandContext, brief: Brief, runs_dir: Path) -> RunStore:
    return pipeline.run(brief, brand, runs_dir, ("procedural",), clock=_clock)


def _tamper(store: RunStore) -> None:
    image = store.candidates()[0].image
    image.write_bytes(image.read_bytes() + b"x")


def test_concurrent_decisions_keep_the_chain_intact(store: RunStore) -> None:
    candidate = store.candidates()[0].id
    barrier = threading.Barrier(_THREADS)
    errors: list[BaseException] = []

    def work(index: int) -> None:
        barrier.wait()
        try:
            decide(store, candidate, "reject", f"reviewer-{index}", "no")
        except (ReviewError, integrity.IntegrityError, OSError, ValueError) as error:
            errors.append(error)

    threads = [threading.Thread(target=work, args=(i,)) for i in range(_THREADS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    assert integrity.chain_problems(store) == []
    assert len(store.decisions()) == _THREADS
    assert verify(store).problems == []


def test_failed_export_keeps_the_previous_export(store: RunStore) -> None:
    first, second = [v.id for v in store.candidates()]
    decide(store, first, "approve", "ana")
    decide(store, second, "approve", "ana")
    export_approved(store)
    before = sorted(p.name for p in store.export_dir.iterdir())
    _tamper(store)
    with pytest.raises(integrity.IntegrityError):
        export_approved(store)
    assert sorted(p.name for p in store.export_dir.iterdir()) == before
    assert not (store.root / "export.tmp").exists()


def test_licence_failure_leaves_previous_export_and_verifies(
    store: RunStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = [v.id for v in store.candidates()]
    decide(store, first, "approve", "ana")
    export_approved(store)
    decide(store, second, "approve", "ana")
    before = sorted(p.name for p in store.export_dir.iterdir())
    real = registry.get("procedural")
    monkeypatch.setattr(
        registry,
        "get",
        lambda _key: dataclasses.replace(real, commercial_use=False, licence="test-only"),
    )
    with pytest.raises(ExportError, match="forbids commercial export"):
        export_approved(store)
    assert sorted(p.name for p in store.export_dir.iterdir()) == before
    assert not (store.root / "export.tmp").exists()
    assert verify(store).problems == []


def test_tampered_image_blocks_use(store: RunStore, tmp_path: Path) -> None:
    first, second = [v.id for v in store.candidates()]
    decide(store, first, "approve", "ana")
    _tamper(store)
    with pytest.raises(ReviewError, match="image"):
        decide(store, second, "reject", "ana")
    with pytest.raises(integrity.IntegrityError):
        export_approved(store)
    with pytest.raises(integrity.IntegrityError):
        add_reference(store, first, tmp_path / "refs")
    with pytest.raises(integrity.IntegrityError):
        replay(store, first)


def test_verify_reports_damaged_export_index_and_brief(store: RunStore) -> None:
    decide(store, store.candidates()[0].id, "approve", "ana")
    export_approved(store)
    (store.export_dir / "index.json").write_text("{not json", encoding="utf-8")
    assert any("export" in p for p in verify(store).problems)
    (store.root / "brief.json").write_text("{}", encoding="utf-8")
    assert any("brief" in p for p in verify(store).problems)


def test_cli_rejects_zero_candidates(
    tmp_path: Path, brand: BrandContext, brief: Brief, capsys: pytest.CaptureFixture[str]
) -> None:
    brief_path = tmp_path / "brief.json"
    brand_path = tmp_path / "brand.json"
    brief_path.write_text(brief.model_dump_json(), encoding="utf-8")
    brand_path.write_text(brand.model_dump_json(), encoding="utf-8")
    code = main(
        [
            "run",
            "--brief",
            str(brief_path),
            "--brand",
            str(brand_path),
            "--runs-dir",
            str(tmp_path / "runs"),
            "--models",
            "procedural",
            "--candidates",
            "0",
        ]
    )
    assert code == 1
    assert "candidates" in capsys.readouterr().err
    assert not (tmp_path / "runs").exists()


def _later() -> datetime:
    return _clock() + timedelta(seconds=5)


def _approve_all(store: RunStore) -> str:
    candidate = store.candidates()[0].id
    decide(store, candidate, "approve", "ana")
    return candidate


def test_reference_hashes_are_recorded_and_differ_after_a_reference_is_added(
    brand: BrandContext, brief: Brief, runs_dir: Path, tmp_path: Path
) -> None:
    refs = tmp_path / "refs"
    first = pipeline.run(brief, brand, runs_dir, ("procedural",), refs, clock=_clock)
    candidate = _approve_all(first)
    before = json.loads((first.root / "run.json").read_text(encoding="utf-8"))
    assert before["reference_hashes"] == {}
    add_reference(first, candidate, refs)
    second = pipeline.run(brief, brand, runs_dir, ("procedural",), refs, clock=_later)
    after = json.loads((second.root / "run.json").read_text(encoding="utf-8"))
    assert list(after["reference_hashes"]) == [f"{first.root.name}-{candidate}.png"]
    assert after["reference_hashes"] != before["reference_hashes"]
    assert verify(second).problems == []


def test_add_reference_refuses_to_overwrite(store: RunStore, tmp_path: Path) -> None:
    candidate = _approve_all(store)
    refs = tmp_path / "refs"
    target = add_reference(store, candidate, refs)
    assert target.name == f"{store.root.name}-{candidate}.png"
    with pytest.raises(ExportError, match="already"):
        add_reference(store, candidate, refs)


def test_validation_resume_regenerates_when_the_recipe_changed(tmp_path: Path) -> None:
    root = tmp_path / "set"
    root.mkdir()
    example = Path(__file__).resolve().parents[1] / "examples" / "aster-lane"
    brief = json.loads((example / "brief.json").read_text(encoding="utf-8"))
    del brief["overlay"]
    (root / "brief.json").write_text(json.dumps(brief), encoding="utf-8")
    (root / "brand.json").write_text(
        (example / "brand.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    case = {"id": "a", "category": "good", "seed": 1, "prompt": "p", "intent": "i"}
    spec = {
        "set_id": "t-set",
        "brief": "brief.json",
        "brand": "brand.json",
        "model": "procedural",
        "width": 64,
        "height": 64,
        "cases": [case],
    }
    spec_path = root / "spec.json"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    out = tmp_path / "out"
    generate_set(spec_path, out, "hw")
    first = json.loads((out / "generated.json").read_text(encoding="utf-8"))["cases"]
    (key,) = first
    assert (out / "images" / f"{key}.recipe").is_file()
    case["prompt"] = "a different prompt"
    spec_path.write_text(json.dumps(spec), encoding="utf-8")
    generate_set(spec_path, out, "hw")
    second = json.loads((out / "generated.json").read_text(encoding="utf-8"))["cases"]
    (new_key,) = second
    recorded = (out / "images" / f"{new_key}.recipe").read_text(encoding="utf-8").strip()
    assert recorded == second[new_key]["recipe_hash"]
    if new_key == key:
        assert second[key]["recipe_hash"] != first[key]["recipe_hash"]


def _budget(tmp_path: Path, usd: float) -> Budget:
    approval = Approval(
        id="b", approved_usd=usd, approved_by="ana", approved_on=datetime(2026, 1, 1, tzinfo=UTC)
    )
    return Budget(approval, tmp_path / "b.ledger.jsonl")


def test_budget_reserve_is_atomic_across_threads(tmp_path: Path) -> None:
    budget = _budget(tmp_path, 1.0)
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def work(name: str) -> None:
        barrier.wait()
        try:
            budget.reserve(name, 0.8)
            outcomes.append("ok")
        except BudgetError:
            outcomes.append("refused")

    threads = [threading.Thread(target=work, args=(n,)) for n in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(outcomes) == ["ok", "refused"]


class _Failing:
    def __init__(self, real: Backend) -> None:
        self._real = real

    def pin(self) -> ModelPin:
        return self._real.pin()

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        msg = f"boom while making {output.name} for seed {recipe.seed}"
        raise BackendError(msg)


def test_failed_generation_leaves_no_empty_candidate_directory(
    brand: BrandContext, brief: Brief, runs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = registry.get("procedural")
    failing = dataclasses.replace(real, make=lambda b: _Failing(real.make(b)))
    monkeypatch.setattr(
        registry,
        "select",
        lambda _brief, _models: registry.Selection(chosen=(failing,), excluded=()),
    )
    with pytest.raises(BackendError):
        pipeline.run(brief, brand, runs_dir, ("procedural",), clock=_clock)
    (run_dir,) = runs_dir.iterdir()
    assert [p for p in (run_dir / "candidates").iterdir() if p.is_dir()] == []
    assert RunStore(run_dir).candidates() == []
