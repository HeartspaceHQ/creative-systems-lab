"""The vertical slice: brief + brand -> model selection -> generation -> evaluation -> review.

Generation and evaluation are separate from review on purpose. The pipeline never approves
anything: it produces candidates with a manifest and an evaluation, and a human decision
(``review.decide``) is the only way an image becomes approved.
"""

from __future__ import annotations

import platform
import shutil
import sys
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from PIL import Image

from csl import drift as drift_mod
from csl import integrity, registry
from csl.backends.base import BackendError
from csl.backends.hosted import HostedError
from csl.budget import Budget, BudgetError
from csl.canonical import sha256_file, sha256_json
from csl.evaluate import evaluate
from csl.schema import Artefact, BrandContext, Brief, Cost, Environment, Manifest, Recipe
from csl.store import RunStore, write_json

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from csl.backends.base import Backend
    from csl.registry import ModelEntry, Selection

_SEED_SPACE = 1_000_000
_HTTP_CLIENT_ERRORS = range(400, 500)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def compose_prompt(brief: Brief, brand: BrandContext) -> str:
    """Build the model prompt from the brief subject and the brand's style language."""
    colours = ", ".join(f"{name} {hex_}" for name, hex_ in brand.palette.items())
    return f"{brief.subject}. {brand.style_prompt[brief.kind]} Colour palette: {colours}."


def base_seed(brief: Brief, brief_hash: str) -> int:
    """Seed for the first candidate: explicit, or derived from the brief's content hash."""
    if brief.base_seed is not None:
        return brief.base_seed
    return int(brief_hash[:8], 16) % _SEED_SPACE


def environment() -> Environment:
    """Describe the machine and interpreter. Recorded, but not part of the recipe hash."""
    return Environment(
        python=sys.version.split()[0],
        platform=platform.platform(),
        machine=platform.machine(),
    )


def recipe_hash(recipe: Recipe) -> str:
    """Identity of a generation: pin, prompt, size, steps and seed."""
    return sha256_json(recipe.model_dump(mode="json"))


def image_artefact(path: Path, root: Path) -> Artefact:
    """Describe an image file by content hash, size and dimensions."""
    with Image.open(path) as image:
        width, height = image.size
    return Artefact(
        path=str(path.relative_to(root)),
        sha256=sha256_file(path),
        bytes=path.stat().st_size,
        width=width,
        height=height,
    )


def reference_hashes(directory: Path | None) -> dict[str, str]:
    """Sorted ``{file name: sha256}`` of the reference images, so a run records what it saw."""
    if directory is None or not directory.is_dir():
        return {}
    paths = sorted(p for p in directory.glob("*") if p.suffix.lower() in drift_mod.IMAGE_SUFFIXES)
    return {path.name: sha256_file(path) for path in paths}


def check_budget(selection: Selection, brief: Brief, budget: Budget | None) -> None:
    """Refuse before anything is written if hosted models are chosen without enough budget."""
    paid = [entry for entry in selection.chosen if not entry.price.free]
    if not paid:
        return
    names = ", ".join(entry.key for entry in paid)
    if budget is None:
        msg = f"{names} would be paid calls; run `csl quote` and pass an approved --budget"
        raise BudgetError(msg)
    total = sum(entry.price.reserve(brief.width, brief.height) for entry in paid)
    budget.require(round(total * brief.candidates, 6), f"this run ({names})")


def check_paid_calls(
    entry: ModelEntry,
    budget: Budget | None,
    width: int,
    height: int,
    calls: int,
    what: str,
) -> None:
    """Refuse up front ``calls`` paid calls to ``entry`` without enough approved budget."""
    if entry.price.free or calls == 0:
        return
    if budget is None:
        msg = (
            f"{what} would make {calls} paid call(s) to {entry.key}; "
            "run `csl quote` and pass an approved --budget"
        )
        raise BudgetError(msg)
    held = entry.price.reserve(width, height) * calls
    budget.require(round(held, 6), f"{what} ({entry.key})")


def _refused_before_generation(error: BackendError) -> bool:
    """True when the provider answered the request itself with an HTTP 4xx: nothing was made."""
    status = error.status if isinstance(error, HostedError) else None
    return status in _HTTP_CLIENT_ERRORS


def generate_once(
    entry: ModelEntry,
    backend: Backend,
    recipe: Recipe,
    output: Path,
    budget: Budget | None,
    label: str,
) -> Cost:
    """Make one image; the only place outside the backends that calls ``generate``.

    A paid call needs a budget: it is reserved first and settled with the reported cost after.
    Without a budget it is refused, never made.
    """
    if entry.price.free:
        return backend.generate(recipe, output)
    if budget is None:
        msg = f"{entry.key} is a paid model; refusing to call it without an approved --budget"
        raise BudgetError(msg)
    held = budget.reserve(label, entry.price.reserve(recipe.width, recipe.height))
    try:
        cost = backend.generate(recipe, output)
    except BackendError as error:
        if _refused_before_generation(error):
            budget.refuse(held)
        else:
            budget.settle(held, None, f"call failed: {error}")
        raise
    budget.settle(held, cost.usd, cost.basis)
    return cost


def run(
    brief: Brief,
    brand: BrandContext,
    runs_dir: Path,
    models: tuple[str, ...] = (),
    reference_dir: Path | None = None,
    clock: Callable[[], datetime] = _utc_now,
    budget: Budget | None = None,
) -> RunStore:
    """Generate and evaluate candidates for a brief. Returns the run's store.

    Hosted models need ``budget``; the whole run is checked against it before any call.
    """
    selection = registry.select(brief, models)
    if not selection.chosen:
        reasons = "; ".join(f"{key}: {why}" for key, why in selection.excluded)
        msg = f"no model can serve this brief ({reasons})"
        raise RuntimeError(msg)
    check_budget(selection, brief, budget)

    started = clock()
    brief_hash = sha256_json(brief.model_dump(mode="json"))
    brand_hash = sha256_json(brand.model_dump(mode="json"))
    store = RunStore(runs_dir / f"{brief.id}-{started:%Y%m%dT%H%M%S}")
    store.candidates_dir.mkdir(parents=True)
    write_json(store.root / "brief.json", brief)
    write_json(store.root / "brand.json", brand)
    write_json(
        store.root / "selection.json",
        {
            "chosen": [entry.key for entry in selection.chosen],
            "excluded": [{"model": key, "reason": why} for key, why in selection.excluded],
        },
    )

    reference_dir = drift_mod.reference_dir_for(reference_dir, brief.kind)
    reference = None
    if reference_dir is not None:
        reference = drift_mod.load_reference_set(
            reference_dir,
            brand.thresholds.drift_margin,
            brand.thresholds.drift_floor,
        )

    prompt = compose_prompt(brief, brand)
    first_seed = base_seed(brief, brief_hash)
    for entry in selection.chosen:
        backend = entry.make(brand)
        pin = backend.pin()
        for offset in range(brief.candidates):
            seed = first_seed + offset
            recipe = Recipe(
                pin=pin,
                prompt=prompt,
                width=brief.width,
                height=brief.height,
                steps=entry.steps,
                seed=seed,
            )
            candidate_id = f"{entry.key}-s{seed}"
            directory = store.candidates_dir / candidate_id
            directory.mkdir()
            image_path = directory / "image.png"
            tick = time.perf_counter()
            try:
                cost = generate_once(
                    entry, backend, recipe, image_path, budget, image_path.parent.name
                )
            except BaseException:
                shutil.rmtree(directory, ignore_errors=True)  # no half-made candidate stays
                raise
            elapsed = time.perf_counter() - tick
            manifest = Manifest(
                candidate_id=candidate_id,
                brief_hash=brief_hash,
                brand_hash=brand_hash,
                recipe=recipe,
                recipe_hash=recipe_hash(recipe),
                output=image_artefact(image_path, store.root),
                environment=environment(),
                generation_seconds=round(elapsed, 3),
                created_at=clock(),
                cost=cost,
            )
            write_json(directory / "manifest.json", manifest)
            write_json(
                directory / "evaluation.json",
                evaluate(image_path, brand, brief, reference),
            )

    write_json(
        store.root / "run.json",
        {
            "run_id": store.root.name,
            "brief_hash": brief_hash,
            "brand_hash": brand_hash,
            "started_at": started.isoformat(),
            "finished_at": clock().isoformat(),
            "candidates": [view.id for view in store.candidates()],
            "reference_images": reference.size if reference is not None else 0,
            "reference_hashes": reference_hashes(reference_dir),
        },
    )
    integrity.seal_generation(store)
    return store
