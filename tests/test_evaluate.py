from __future__ import annotations

from typing import TYPE_CHECKING

from PIL import Image

from csl import drift
from csl.backends.procedural import ProceduralBackend
from csl.evaluate import evaluate
from csl.imaging import load_rgb
from csl.schema import OverlayZone, Recipe

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import BrandContext, Brief, Check, Evaluation

ON_BRAND = ["#f4efe6", "#c4623f", "#1f2a44", "#5f7a4f"]


def _render(backend: ProceduralBackend, path: Path, seed: int = 3) -> None:
    recipe = Recipe(pin=backend.pin(), prompt="", width=192, height=192, steps=1, seed=seed)
    backend.generate(recipe, path)


def _check(evaluation: Evaluation, name: str) -> Check:
    return next(c for c in evaluation.checks if c.name == name)


def test_on_brand_image_passes_hard_checks(
    tmp_path: Path, brand: BrandContext, brief: Brief
) -> None:
    _render(ProceduralBackend(ON_BRAND), tmp_path / "ok.png")
    result = evaluate(tmp_path / "ok.png", brand, brief, None)
    assert result.hard_pass
    assert "no reference set: drift not evaluated" in result.warnings


def test_off_brand_image_fails_palette_and_forbidden(
    tmp_path: Path,
    brand: BrandContext,
    brief: Brief,
) -> None:
    _render(ProceduralBackend.off_brand(), tmp_path / "bad.png")
    result = evaluate(tmp_path / "bad.png", brand, brief, None)
    assert not result.hard_pass
    assert not _check(result, "palette_fit").passed
    assert not _check(result, "forbidden_colour_area").passed


def test_overlay_contrast_detects_unreadable_text(
    tmp_path: Path,
    brand: BrandContext,
    brief: Brief,
) -> None:
    Image.new("RGB", (100, 100), "#1f2a44").save(tmp_path / "dark.png")
    zone = OverlayZone(x=0.1, y=0.1, w=0.5, h=0.5, text_colour="#1f2a44")
    result = evaluate(
        tmp_path / "dark.png", brand, brief.model_copy(update={"overlay": zone}), None
    )
    contrast = _check(result, "overlay_contrast")
    assert not contrast.passed
    assert contrast.value < 1.5

    Image.new("RGB", (100, 100), "#f4efe6").save(tmp_path / "light.png")
    result = evaluate(
        tmp_path / "light.png", brand, brief.model_copy(update={"overlay": zone}), None
    )
    assert _check(result, "overlay_contrast").passed


def test_drift_separates_on_brand_from_off_brand(
    tmp_path: Path,
    brand: BrandContext,
    brief: Brief,
) -> None:
    refs = []
    for seed in range(1, 6):
        path = tmp_path / f"ref{seed}.png"
        _render(ProceduralBackend(ON_BRAND), path, seed)
        refs.append(drift.extract(load_rgb(path)))
    reference = drift.build_reference_set(refs, margin=1.25, floor=0.05)
    assert reference.calibrated

    _render(ProceduralBackend(ON_BRAND), tmp_path / "new_ok.png", seed=99)
    _render(ProceduralBackend.off_brand(), tmp_path / "new_bad.png", seed=99)
    good = evaluate(tmp_path / "new_ok.png", brand, brief, reference)
    bad = evaluate(tmp_path / "new_bad.png", brand, brief, reference)
    assert _check(good, "colour_drift").passed
    assert not _check(bad, "colour_drift").passed
    assert _check(bad, "colour_drift").value > _check(good, "colour_drift").value


def test_single_reference_is_flagged_uncalibrated(
    tmp_path: Path,
    brand: BrandContext,
    brief: Brief,
) -> None:
    _render(ProceduralBackend(ON_BRAND), tmp_path / "r.png")
    reference = drift.build_reference_set(
        [drift.extract(load_rgb(tmp_path / "r.png"))],
        margin=1.25,
        floor=0.05,
    )
    result = evaluate(tmp_path / "r.png", brand, brief, reference)
    assert any("uncalibrated" in w for w in result.warnings)


def test_palette_fit_is_soft_for_photographs(
    tmp_path: Path,
    brand: BrandContext,
    brief: Brief,
) -> None:
    Image.new("RGB", (100, 100), "#3a7d2c").save(tmp_path / "green.png")
    photo_brief = brief.model_copy(update={"kind": "photo"})
    photo = evaluate(tmp_path / "green.png", brand, photo_brief, None)
    drawing = evaluate(tmp_path / "green.png", brand, brief, None)
    assert not _check(photo, "palette_fit").passed
    assert not _check(photo, "palette_fit").hard
    assert photo.hard_pass
    assert _check(drawing, "palette_fit").hard
    assert not drawing.hard_pass
