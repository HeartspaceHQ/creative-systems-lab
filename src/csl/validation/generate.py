"""Generate and score the images of a validation set.

Images are written under opaque names. The system's scores go to ``scores.json`` and the
generation record (recipes, timing, hardware) to ``generated.json``; neither is shown to the
person rating the images.

A paid model is refused without an approved budget, before any image is made, and every call
is reserved and settled through ``pipeline.generate_once``.
"""

from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING

from csl import drift as drift_mod
from csl import registry
from csl.canonical import sha256_file
from csl.evaluate import evaluate
from csl.pipeline import check_paid_calls, generate_once, recipe_hash
from csl.schema import BrandContext, Brief, Recipe
from csl.store import read_model, write_json
from csl.validation.spec import blind_id, load_spec

if TYPE_CHECKING:
    from pathlib import Path

    from csl.backends.base import Backend
    from csl.budget import Budget
    from csl.registry import ModelEntry

GENERATED = "generated.json"
SCORES = "scores.json"
IMAGES = "images"


def _reference_set(brand_path: Path, brand: BrandContext) -> drift_mod.ReferenceSet | None:
    if brand.reference_dir is None:
        return None
    directory = brand_path.parent / brand.reference_dir
    if not directory.is_dir():
        return None
    return drift_mod.load_reference_set(
        directory, brand.thresholds.drift_margin, brand.thresholds.drift_floor
    )


def _previous_seconds(out_dir: Path) -> dict[str, float | None]:
    path = out_dir / GENERATED
    if not path.is_file():
        return {}
    cases = json.loads(path.read_text(encoding="utf-8"))["cases"]
    return {key: value["generation_seconds"] for key, value in cases.items()}


def _recipe_marker(image: Path) -> Path:
    return image.with_suffix(".recipe")


def _resumable(image: Path, digest: str) -> bool:
    """True if the image exists and was made from exactly this recipe."""
    marker = _recipe_marker(image)
    return (
        image.is_file()
        and marker.is_file()
        and marker.read_text(encoding="utf-8").strip() == digest
    )


def _generate_atomically(
    entry: ModelEntry,
    backend: Backend,
    recipe: Recipe,
    image: Path,
    digest: str,
    budget: Budget | None,
) -> None:
    """Render to a temporary name and rename, then record which recipe made the image."""
    _recipe_marker(image).unlink(missing_ok=True)
    partial = image.with_name(f"{image.stem}.part{image.suffix}")
    generate_once(entry, backend, recipe, partial, budget, image.stem)
    partial.replace(image)
    _recipe_marker(image).write_text(digest + "\n", encoding="utf-8")


def generate_set(
    spec_path: Path, out_dir: Path, hardware: str, budget: Budget | None = None
) -> None:
    """Generate every case that has no image yet, then score all images.

    Resumable: an interrupted run continues where it stopped and keeps the timings already
    measured. An image is reused only if its ``.recipe`` marker holds the current recipe hash;
    otherwise it is regenerated. ``hardware`` is recorded verbatim next to the measured times.
    A paid model needs ``budget`` for every image still to make; it is checked before the first.
    """
    spec = load_spec(spec_path)
    brand_path = spec_path.parent / spec.brand
    brief = read_model(spec_path.parent / spec.brief, Brief)
    brand = read_model(brand_path, BrandContext)
    entry = registry.get(spec.model)
    backend = entry.make(brand)
    pin = backend.pin()
    reference = _reference_set(brand_path, brand)
    images = out_dir / IMAGES
    planned = []
    for case in spec.cases:
        key = blind_id(spec, case)
        recipe = Recipe(
            pin=pin,
            prompt=case.prompt,
            width=spec.width,
            height=spec.height,
            steps=entry.steps,
            seed=case.seed,
        )
        planned.append((case, key, images / f"{key}.png", recipe, recipe_hash(recipe)))
    to_make = sum(1 for _, _, path, _, digest in planned if not _resumable(path, digest))
    check_paid_calls(
        entry, budget, spec.width, spec.height, to_make, f"validation set {spec.set_id}"
    )
    images.mkdir(parents=True, exist_ok=True)
    seconds_before = _previous_seconds(out_dir)
    record: dict[str, object] = {}
    scores: dict[str, object] = {}
    for case, key, path, recipe, digest in planned:
        seconds = seconds_before.get(key)
        if not _resumable(path, digest):
            tick = time.perf_counter()
            _generate_atomically(entry, backend, recipe, path, digest, budget)
            seconds = round(time.perf_counter() - tick, 3)
        record[key] = {
            "case_id": case.id,
            "recipe_hash": digest,
            "sha256": sha256_file(path),
            "generation_seconds": seconds,
        }
        scores[key] = evaluate(path, brand, brief, reference).model_dump(mode="json")
    write_json(
        out_dir / GENERATED,
        {
            "set_id": spec.set_id,
            "model": spec.model,
            "pin": pin.model_dump(mode="json"),
            "hardware": hardware,
            "cases": record,
        },
    )
    write_json(out_dir / SCORES, scores)
