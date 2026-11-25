"""Regression tests for tamper evidence: each kind of change must fail with a clear reason."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from csl import integrity, pipeline
from csl.cli import main
from csl.export import export_approved
from csl.reproduce import verify
from csl.review import ReviewError, decide

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import BrandContext, Brief
    from csl.store import RunStore


def _clock() -> datetime:
    return datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


@pytest.fixture
def decided(brand: BrandContext, brief: Brief, runs_dir: Path) -> RunStore:
    """A run with three decisions and an export, all verifying cleanly."""
    store = pipeline.run(brief, brand, runs_dir, ("procedural",), clock=_clock)
    first, second = [v.id for v in store.candidates()]
    decide(store, first, "approve", "ana", "good")
    decide(store, second, "reject", "ana", "too busy")
    decide(store, second, "approve", "bo", "second look is fine")
    export_approved(store)
    assert verify(store).problems == []
    return store


def _lines(store: RunStore) -> list[str]:
    return store.decisions_path.read_text(encoding="utf-8").splitlines()


def _write_lines(store: RunStore, lines: list[str]) -> None:
    store.decisions_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_clean_run_verifies_without_warnings(decided: RunStore) -> None:
    result = verify(decided)
    assert result.intact
    assert result.warnings == []


def test_every_decision_carries_the_hash_of_the_previous_line(decided: RunStore) -> None:
    decisions = decided.decisions()
    assert decisions[0].prev_hash == "0" * 64
    assert all(d.prev_hash is not None for d in decisions)
    assert len({d.prev_hash for d in decisions}) == len(decisions)


def test_modified_decision_is_detected(decided: RunStore) -> None:
    lines = _lines(decided)
    lines[0] = lines[0].replace('"approve"', '"reject"')
    _write_lines(decided, lines)
    problems = verify(decided).problems
    assert any("decision 2: prev_hash does not match decision 1" in p for p in problems)


def test_modified_last_decision_is_detected_by_the_sealed_head(decided: RunStore) -> None:
    lines = _lines(decided)
    lines[-1] = lines[-1].replace("second look is fine", "forged note")
    _write_lines(decided, lines)
    assert any("sealed head" in p for p in verify(decided).problems)


def test_removed_middle_decision_is_detected(decided: RunStore) -> None:
    lines = _lines(decided)
    del lines[1]
    _write_lines(decided, lines)
    problems = verify(decided).problems
    assert any("prev_hash does not match decision 1" in p for p in problems)
    assert any("2 line(s) but 3 were sealed" in p for p in problems)


def test_removed_last_decision_is_detected(decided: RunStore) -> None:
    _write_lines(decided, _lines(decided)[:-1])
    assert any("2 line(s) but 3 were sealed" in p for p in verify(decided).problems)


def test_removed_first_decision_is_detected(decided: RunStore) -> None:
    _write_lines(decided, _lines(decided)[1:])
    assert any("start of the log" in p for p in verify(decided).problems)


def test_reordered_decisions_are_detected(decided: RunStore) -> None:
    lines = _lines(decided)
    lines[1], lines[2] = lines[2], lines[1]
    _write_lines(decided, lines)
    assert any("changed, removed or reordered" in p for p in verify(decided).problems)


def test_unchained_line_in_a_sealed_run_is_detected(decided: RunStore) -> None:
    record = json.loads(_lines(decided)[0])
    del record["prev_hash"]
    _write_lines(decided, [json.dumps(record), *_lines(decided)[1:]])
    assert any("carries no prev_hash" in p for p in verify(decided).problems)


def test_modified_evaluation_is_detected(decided: RunStore) -> None:
    view = decided.candidates()[0]
    path = view.directory / "evaluation.json"
    path.write_text(
        path.read_text(encoding="utf-8").replace('"hard_pass": true', '"hard_pass": false'),
        encoding="utf-8",
    )
    assert any(
        f"candidates/{view.id}/evaluation.json: changed since it was sealed" in p
        for p in verify(decided).problems
    )


def test_modified_export_sidecar_is_detected(decided: RunStore) -> None:
    sidecar = next(p for p in decided.export_dir.glob("*.json") if p.name != "index.json")
    record = json.loads(sidecar.read_text(encoding="utf-8"))
    record["decision"]["reviewer"] = "mallory"
    sidecar.write_text(json.dumps(record), encoding="utf-8")
    assert any(f"export/{sidecar.name}: changed" in p for p in verify(decided).problems)


def test_modified_image_is_detected(decided: RunStore) -> None:
    image = decided.candidates()[0].image
    image.write_bytes(image.read_bytes() + b"\x00")
    problems = verify(decided).problems
    assert any("image bytes differ from manifest sha256" in p for p in problems)
    assert any("image.png: changed since it was sealed" in p for p in problems)


def test_added_and_deleted_files_are_detected(decided: RunStore) -> None:
    (decided.root / "candidates" / "stray.txt").write_text("x", encoding="utf-8")
    next(decided.export_dir.glob("*.png")).unlink()
    problems = verify(decided).problems
    assert any("stray.txt: not in the sealed manifest" in p for p in problems)
    assert any(".png: missing (exported)" in p for p in problems)


def test_decision_for_unknown_candidate_is_detected(decided: RunStore) -> None:
    lines = _lines(decided)
    forged = json.loads(lines[-1])
    forged["candidate_id"] = "no-such-candidate"
    # A forger who also fixes the chain and the seal is not stopped: see docs/integrity.md.
    forged["prev_hash"] = decided.decision_head()
    _write_lines(decided, [*lines, json.dumps(forged)])
    assert any("unknown candidate" in p for p in verify(decided).problems)


def test_a_tampered_run_cannot_be_extended(decided: RunStore) -> None:
    lines = _lines(decided)
    lines[0] = lines[0].replace("good", "evil")
    _write_lines(decided, lines)
    cid = decided.candidates()[0].id
    with pytest.raises(ReviewError, match="not intact"):
        decide(decided, cid, "reject", "ana")


def test_a_later_decision_does_not_legitimise_a_tampered_evaluation(decided: RunStore) -> None:
    view = decided.candidates()[0]
    path = view.directory / "evaluation.json"
    path.write_text(path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    with pytest.raises(ReviewError, match=r"evaluation\.json: changed since it was sealed"):
        decide(decided, view.id, "reject", "ana", "after the fact")
    assert any(
        "evaluation.json: changed since it was sealed" in p for p in verify(decided).problems
    )


def test_legacy_run_verifies_with_a_warning_and_migrates(decided: RunStore) -> None:
    unchained = [
        json.dumps({k: v for k, v in json.loads(line).items() if k != "prev_hash"})
        for line in _lines(decided)
    ]
    _write_lines(decided, unchained)
    integrity.manifest_path(decided).unlink()

    legacy = verify(decided)
    assert legacy.intact
    assert legacy.warnings == [integrity.LEGACY_WARNING]
    with pytest.raises(ReviewError, match="csl migrate"):
        decide(decided, decided.candidates()[0].id, "reject", "ana")

    integrity.migrate(decided)
    migrated = verify(decided)
    assert migrated.intact
    assert any("sealed by `csl migrate`" in w for w in migrated.warnings)
    with pytest.raises(integrity.IntegrityError, match="already sealed"):
        integrity.migrate(decided)
    _write_lines(decided, _lines(decided)[:-1])
    assert not verify(decided).intact


def test_cli_verify_reports_tampering_and_strict_warnings(
    decided: RunStore, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["verify", str(decided.root)]) == 0
    _write_lines(decided, _lines(decided)[:-1])
    assert main(["verify", str(decided.root)]) == 1
    assert "were sealed" in capsys.readouterr().out
