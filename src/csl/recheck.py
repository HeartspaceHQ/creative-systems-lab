"""Check earlier candidates again under the current brand, without generating anything.

When the brand changes (new references, new thresholds), the images already made are still worth
reviewing. ``recheck`` gathers the candidates of one or more runs for the same brief into a new
run: each image and its manifest are copied unchanged, the original brief and brand are kept next
to them in ``source.json``, and only the evaluation is new. The source runs are not touched, and
no model is called, so a recheck costs nothing.
"""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from csl import drift as drift_mod
from csl import integrity
from csl.canonical import sha256_json
from csl.evaluate import evaluate
from csl.pipeline import reference_hashes
from csl.schema import SourceRecord
from csl.store import SOURCE_NAME, RunStore, write_json

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from pathlib import Path

    from csl.schema import BrandContext, Brief

_PER_RUN_FIELDS = {"candidates", "base_seed"}


class RecheckError(ValueError):
    """The source runs cannot be rechecked together."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _shared_brief(sources: Sequence[RunStore]) -> Brief:
    """The brief every source run answered, with the candidate count of all of them."""
    briefs = [store.brief() for store in sources]
    first = briefs[0]

    def shape(brief: Brief) -> dict[str, object]:
        return brief.model_dump(mode="json", exclude=_PER_RUN_FIELDS)

    for store, brief in zip(sources, briefs, strict=True):
        if shape(brief) != shape(first):
            msg = f"{store.root.name} answers another brief than {sources[0].root.name}"
            raise RecheckError(msg)
    total = sum(len(store.candidates()) for store in sources)
    return first.with_candidates(total)


def recheck(
    sources: Sequence[RunStore],
    brand: BrandContext,
    runs_dir: Path,
    reference_dir: Path | None = None,
    clock: Callable[[], datetime] = _utc_now,
) -> RunStore:
    """Evaluate the candidates of ``sources`` again under ``brand`` in a new, sealed run."""
    if not sources:
        msg = "recheck needs at least one source run"
        raise RecheckError(msg)
    for store in sources:
        integrity.require_intact(store)
    brief = _shared_brief(sources)
    seen: set[str] = set()
    for store in sources:
        for view in store.candidates():
            if view.id in seen:
                msg = f"candidate {view.id} appears in more than one source run"
                raise RecheckError(msg)
            seen.add(view.id)

    reference_dir = drift_mod.reference_dir_for(reference_dir, brief.kind)
    reference = (
        drift_mod.load_reference_set(
            reference_dir, brand.thresholds.drift_margin, brand.thresholds.drift_floor
        )
        if reference_dir is not None
        else None
    )

    started = clock()
    store = RunStore(runs_dir / f"{brief.id}-recheck-{started:%Y%m%dT%H%M%S}")
    store.candidates_dir.mkdir(parents=True)
    write_json(store.root / "brief.json", brief)
    write_json(store.root / "brand.json", brand)
    models = sorted({view.manifest.recipe.pin.backend for s in sources for view in s.candidates()})
    write_json(store.root / "selection.json", {"chosen": models, "excluded": []})

    for source in sources:
        source_brief, source_brand = source.brief(), source.brand()
        for view in source.candidates():
            directory = store.candidates_dir / view.id
            directory.mkdir()
            shutil.copyfile(view.image, directory / "image.png")
            shutil.copyfile(view.directory / "manifest.json", directory / "manifest.json")
            write_json(
                directory / SOURCE_NAME,
                SourceRecord(
                    run_id=source.root.name,
                    candidate_id=view.id,
                    brief=source_brief,
                    brand=source_brand,
                ),
            )
            write_json(
                directory / "evaluation.json",
                evaluate(directory / "image.png", brand, brief, reference),
            )

    write_json(
        store.root / "run.json",
        {
            "run_id": store.root.name,
            "brief_hash": sha256_json(brief.model_dump(mode="json")),
            "brand_hash": sha256_json(brand.model_dump(mode="json")),
            "started_at": started.isoformat(),
            "finished_at": clock().isoformat(),
            "candidates": [view.id for view in store.candidates()],
            "rechecked_from": [source.root.name for source in sources],
            "reference_images": reference.size if reference is not None else 0,
            "reference_hashes": reference_hashes(reference_dir),
        },
    )
    integrity.seal_generation(store)
    return store
