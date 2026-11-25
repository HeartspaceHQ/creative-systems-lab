"""The validation flow end to end with the procedural stub (no model, no real judgement)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from csl.cli import main
from csl.validation.analysis import AnalysisError, analyse, format_analysis
from csl.validation.generate import GENERATED, SCORES, generate_set
from csl.validation.ratings import BlindSet
from csl.validation.spec import blind_id, load_spec

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "aster-lane"


@pytest.fixture
def spec_path(tmp_path: Path) -> Path:
    """A two-category spec over the example brand, small enough to run instantly."""
    root = tmp_path / "aster"
    shutil.copytree(EXAMPLE / "references", root / "references")
    shutil.copy(EXAMPLE / "brand.json", root / "brand.json")
    brief = json.loads((EXAMPLE / "brief.json").read_text(encoding="utf-8"))
    del brief["overlay"]
    (root / "brief.json").write_text(json.dumps(brief), encoding="utf-8")
    spec = {
        "set_id": "t-set",
        "brief": "brief.json",
        "brand": "brand.json",
        "model": "procedural",
        "width": 64,
        "height": 64,
        "cases": [
            {"id": "good-01", "category": "good", "seed": 1, "prompt": "p", "intent": "i"},
            {"id": "good-02", "category": "good", "seed": 2, "prompt": "p", "intent": "i"},
            {
                "id": "clear_wrong-01",
                "category": "clear_wrong",
                "seed": 3,
                "prompt": "p",
                "intent": "i",
            },
        ],
    }
    path = root / "spec.json"
    path.write_text(json.dumps(spec), encoding="utf-8")
    return path


def test_blind_ids_and_files_reveal_no_category(spec_path: Path, tmp_path: Path) -> None:
    out = tmp_path / "out"
    generate_set(spec_path, out, "test hardware")
    blind = BlindSet(out)
    names = " ".join(blind.ids()) + " ".join(p.name for p in (out / "images").iterdir())
    assert "good" not in names
    assert "wrong" not in names
    spec = load_spec(spec_path)
    assert set(blind.ids()) == {blind_id(spec, c) for c in spec.cases}


def test_analysis_refuses_unrated_images_and_counts_errors(spec_path: Path, tmp_path: Path) -> None:
    out = tmp_path / "out"
    generate_set(spec_path, out, "test hardware")
    spec = load_spec(spec_path)
    with pytest.raises(AnalysisError, match="not rated"):
        analyse(spec, out)
    blind = BlindSet(out)
    scores = json.loads((out / SCORES).read_text(encoding="utf-8"))
    for case in spec.cases:
        key = blind_id(spec, case)
        # Rate opposite to the system on purpose, to exercise FP and FN counting.
        system_accepts = scores[key]["hard_pass"]
        blind.rate(key, "reject" if system_accepts else "approve")
    gate = next(a for a in analyse(spec, out) if a.verdict == "gate")
    assert gate.overall.n == 3
    assert gate.overall.true_positive == gate.overall.true_negative == 0
    assert gate.overall.false_positive + gate.overall.false_negative == 3
    assert gate.by_category["good"].n == 2
    assert "ALL" in format_analysis([gate])
    assert json.loads((out / GENERATED).read_text(encoding="utf-8"))["hardware"] == "test hardware"


def test_latest_rating_wins_and_unknown_image_is_refused(spec_path: Path, tmp_path: Path) -> None:
    out = tmp_path / "out"
    generate_set(spec_path, out, "h")
    blind = BlindSet(out)
    first = blind.ids()[0]
    blind.rate(first, "approve")
    blind.rate(first, "reject", "second thoughts")
    assert blind.ratings()[first].verdict == "reject"
    with pytest.raises(KeyError):
        blind.rate("nope", "approve")


def test_cli_report_needs_complete_ratings(
    spec_path: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "out"
    generate_set(spec_path, out, "h")
    assert main(["validate", "report", str(spec_path), "--out", str(out)]) == 1
    assert main(["validate", "report", str(spec_path), "--out", str(out), "--partial"]) == 0
    assert "system verdict: gate" in capsys.readouterr().out
