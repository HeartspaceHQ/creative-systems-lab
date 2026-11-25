"""Verification and replay: the two halves of the reproducibility claim.

``verify`` answers "is this record still intact?": every file of the run matches the hash
sealed in ``integrity.json``, the decision log's hash chain is unbroken, and every recipe hash
matches its recipe. It needs no model. It detects change; it does not prevent it (see
``csl.integrity``).

``replay`` answers "does the recipe still produce the same image?": it re-resolves the model
pin on this machine, refuses to compare if the pin differs (different weights or tool version
make a difference meaningless), re-generates, and reports bit-identical, perceptually close
(close in structure by difference hash *and* in colour by mean Lab difference) or diverged.

A hosted model is different. Its providers do not promise the same image for the same request
(OpenAI's image API takes no seed at all), so a new call cannot reproduce a recorded one. It is
a new paid image: replay refuses it without an approved budget, and with one reports
``new_generation`` with the comparison as information, never as a reproduction.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from csl import integrity, registry
from csl.canonical import sha256_file, sha256_json
from csl.imaging import dhash, hamming, mean_delta_e
from csl.pipeline import check_paid_calls, generate_once, recipe_hash
from csl.schema import SourceRecord
from csl.store import SOURCE_NAME, read_model

if TYPE_CHECKING:
    from collections.abc import Callable

    from csl.budget import Budget
    from csl.store import RunStore

# Both limits were set by judgement, not validated against human similarity ratings
# (docs/evaluation.md). Structure alone is not enough: dHash is blind to colour.
PERCEPTUAL_BITS = 6
PERCEPTUAL_DELTA_E = 6.0
ReplayStatus = Literal[
    "bit_identical", "perceptually_close", "diverged", "pin_mismatch", "new_generation"
]


@dataclass(frozen=True)
class Verification:
    """Result of ``verify``.

    ``problems`` mean the record was altered. ``warnings`` mean less was checked than usual,
    for example on a run that predates hash chaining.
    """

    problems: list[str]
    warnings: list[str]

    @property
    def intact(self) -> bool:
        """True when nothing that could be checked was found altered."""
        return not self.problems


def verify(store: RunStore) -> Verification:
    """Check the whole history of a run: files, recipes, decisions, evaluations and exports."""
    problems = _guarded("candidates", lambda: _verify_candidates(store))
    warnings: list[str] = []
    if not integrity.manifest_path(store).is_file():
        warnings.append(integrity.LEGACY_WARNING)
    else:
        problems.extend(_guarded("integrity manifest", lambda: integrity.manifest_problems(store)))
        problems.extend(_guarded("decision log", lambda: integrity.chain_problems(store)))
        problems.extend(
            _guarded("decisions", lambda: integrity.unknown_candidate_problems(store)),
        )
        if _is_migrated(store):
            warnings.append(
                "run was sealed by `csl migrate`: it is attested as it was at migration time",
            )
    index = store.export_dir / "index.json"
    if index.is_file():
        problems.extend(_guarded("export index", lambda: _verify_export(store, index)))
    return Verification(problems, warnings)


def _is_migrated(store: RunStore) -> bool:
    try:
        return integrity.is_migrated(store)
    except (OSError, ValueError):
        return False  # an unreadable manifest is already reported as a problem


def _guarded(what: str, check: Callable[[], list[str]]) -> list[str]:
    """Run one check; a damaged or unreadable record becomes a problem, not a crash."""
    try:
        return check()
    except (OSError, ValueError, KeyError, TypeError) as error:
        return [f"{what}: unreadable or invalid ({type(error).__name__}: {error})"]


def _verify_candidates(store: RunStore) -> list[str]:
    problems: list[str] = []
    brief_hash = sha256_json(store.brief().model_dump(mode="json"))
    brand_hash = sha256_json(store.brand().model_dump(mode="json"))
    for view in store.candidates():
        manifest = view.manifest
        expected_brief, expected_brand = brief_hash, brand_hash
        source_path = view.directory / SOURCE_NAME
        if source_path.is_file():  # rechecked: the manifest belongs to the original run
            source = read_model(source_path, SourceRecord)
            expected_brief = sha256_json(source.brief.model_dump(mode="json"))
            expected_brand = sha256_json(source.brand.model_dump(mode="json"))
        if manifest.brief_hash != expected_brief:
            problems.append(f"{view.id}: brief snapshot does not match manifest brief_hash")
        if manifest.brand_hash != expected_brand:
            problems.append(f"{view.id}: brand snapshot does not match manifest brand_hash")
        if recipe_hash(manifest.recipe) != manifest.recipe_hash:
            problems.append(f"{view.id}: recipe_hash does not match the recipe")
        image = store.root / manifest.output.path
        if not image.is_file():
            problems.append(f"{view.id}: image file missing")
        elif sha256_file(image) != manifest.output.sha256:
            problems.append(f"{view.id}: image bytes differ from manifest sha256")
    return problems


def _verify_export(store: RunStore, index: Path) -> list[str]:
    problems: list[str] = []
    entries = json.loads(index.read_text(encoding="utf-8"))["items"]
    for item in entries:
        path = store.export_dir / item["file"]
        if not path.is_file():
            problems.append(f"export: {item['file']} missing")
        elif sha256_file(path) != item["sha256"]:
            problems.append(f"export: {item['file']} differs from index sha256")
    return problems


@dataclass(frozen=True)
class ReplayResult:
    """Outcome of replaying one candidate."""

    candidate_id: str
    status: ReplayStatus
    detail: str


def replay(
    store: RunStore, candidate_id: str, *, force: bool = False, budget: Budget | None = None
) -> ReplayResult:
    """Re-generate a candidate from its recipe and compare with the recorded output.

    A paid model is refused without ``budget`` before anything is called.
    """
    integrity.require_intact(store)
    manifest = store.candidate(candidate_id).manifest
    recipe = manifest.recipe
    entry = registry.get(recipe.pin.backend)
    check_paid_calls(entry, budget, recipe.width, recipe.height, 1, f"replay of {candidate_id}")
    backend = entry.make(store.brand())
    current = backend.pin()
    if current != recipe.pin and not force:
        return ReplayResult(
            candidate_id,
            "pin_mismatch",
            f"recorded pin {recipe.pin.model_dump(mode='json')} != current "
            f"{current.model_dump(mode='json')}; pass force to compare anyway",
        )
    with tempfile.TemporaryDirectory(prefix="csl-replay-") as tmp:
        out = Path(tmp) / "image.png"
        generate_once(entry, backend, recipe, out, budget, f"replay {candidate_id}")
        status, detail = compare_images(store.root / manifest.output.path, out)
        if entry.location == "hosted":
            return ReplayResult(
                candidate_id,
                "new_generation",
                f"hosted model: a new paid image, not a reproduction ({status}: {detail})",
            )
        return ReplayResult(candidate_id, status, detail)


def compare_images(original: Path, replayed: Path) -> tuple[ReplayStatus, str]:
    """Classify a regenerated image against the recorded one.

    ``perceptually_close`` needs both the same structure (dHash distance within
    ``PERCEPTUAL_BITS``) and the same colours (mean Lab difference within
    ``PERCEPTUAL_DELTA_E``).
    """
    if sha256_file(replayed) == sha256_file(original):
        return "bit_identical", "output sha256 matches"
    bits = hamming(dhash(replayed), dhash(original))
    delta = mean_delta_e(replayed, original)
    detail = f"bytes differ; dHash distance {bits} bits, mean colour difference dE {delta:.1f}"
    if bits <= PERCEPTUAL_BITS and delta <= PERCEPTUAL_DELTA_E:
        return "perceptually_close", detail
    return "diverged", detail
