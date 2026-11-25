from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

from csl.cli import _parser, main

if TYPE_CHECKING:
    import pytest

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "aster-lane"


def test_cli_flow(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    runs = tmp_path / "runs"
    spec = json.loads((EXAMPLE / "brief.json").read_text(encoding="utf-8"))
    del spec["overlay"]  # the flat-shape stub cannot satisfy the example's text-zone contrast
    brief = tmp_path / "brief.json"
    brief.write_text(json.dumps(spec), encoding="utf-8")
    code = main(
        [
            "run",
            "--brief",
            str(brief),
            "--brand",
            str(EXAMPLE / "brand.json"),
            "--runs-dir",
            str(runs),
            "--models",
            "procedural,procedural-offbrand",
        ]
    )
    assert code == 0
    run_dir = next(runs.iterdir())
    assert (run_dir / "report.html").is_file()
    candidates = sorted(p.name for p in (run_dir / "candidates").iterdir())
    good = next(c for c in candidates if c.startswith("procedural-s"))
    bad = next(c for c in candidates if c.startswith("procedural-offbrand"))

    assert main(["review", str(run_dir), good, "approve", "--reviewer", "t"]) == 0
    assert main(["review", str(run_dir), bad, "approve", "--reviewer", "t"]) == 1
    refs = tmp_path / "refs"
    assert main(["reference", str(run_dir), bad, "--to", str(refs)]) == 1
    assert main(["reference", str(run_dir), good, "--to", str(refs)]) == 0
    assert (refs / f"{run_dir.name}-{good}.png").is_file()
    assert main(["export", str(run_dir)]) == 0
    assert main(["verify", str(run_dir)]) == 0
    assert main(["replay", str(run_dir), good]) == 0
    assert main(["compare", str(run_dir)]) == 0
    out = capsys.readouterr().out
    assert "intact" in out
    assert "bit_identical" in out
    index = json.loads((run_dir / "export" / "index.json").read_text(encoding="utf-8"))
    assert len(index["items"]) == 1


def test_cli_models_lists_registry(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["models", "--brief", str(EXAMPLE / "brief.json")]) == 0
    out = capsys.readouterr().out
    assert "flux2-klein-9b-q6" in out
    assert "licence" in out.lower()


def test_a_bare_serve_needs_no_brand_or_brief() -> None:
    args = _parser().parse_args(["serve"])
    assert args.studio == Path("studio")
    assert args.engine is None
    assert args.brand is None
    assert not args.brief
    args = _parser().parse_args(
        ["serve", "--studio", "x", "--engine", "e", "--ask-key", "OPENAI_API_KEY"]
    )
    assert (args.studio, args.engine, args.ask_key) == (Path("x"), Path("e"), ["OPENAI_API_KEY"])
