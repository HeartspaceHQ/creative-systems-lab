"""Export approved candidates with provenance.

Each exported PNG carries a ``csl:provenance`` text chunk (recipe hash, model, seed, reviewer)
and has a JSON sidecar with the full record. The exported bytes differ from the generated
image because of that chunk, so the sidecar records both hashes. ``index.json`` lists every
exported file with its hash; ``reproduce.verify`` re-checks it.
"""

from __future__ import annotations

import shutil
from typing import TYPE_CHECKING

from PIL import Image
from PIL.PngImagePlugin import PngInfo

from csl import integrity, registry
from csl.canonical import canonical_json, sha256_file
from csl.store import write_json

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Brief, Decision
    from csl.store import CandidateView, RunStore


class ExportError(RuntimeError):
    """Raised when an approved candidate may not be exported."""


def export_approved(store: RunStore) -> list[str]:
    """Export every approved candidate. Returns the exported file names.

    Licences are checked first, the files are built in ``export.tmp`` and swapped in only when
    complete, so a failure never destroys the previous export. Runs under the run's lock.
    """
    with store.lock():
        return _export_locked(store)


def _export_locked(store: RunStore) -> list[str]:
    integrity.require_intact(store)
    brief = store.brief()
    decisions = store.latest_decisions()
    approved = [view for view in store.candidates() if view.status == "approved"]
    for view in approved:
        require_exportable(view, brief)
    staging = store.root / "export.tmp"
    previous = store.root / "export.old"
    if previous.exists() and not store.export_dir.exists():
        previous.replace(store.export_dir)  # a crash between the two renames of a swap
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    try:
        items = [_export_one(view, decisions[view.id], brief, staging) for view in approved]
        write_json(staging / "index.json", {"items": items})
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    if previous.exists():
        shutil.rmtree(previous)
    if store.export_dir.exists():
        store.export_dir.replace(previous)
    staging.replace(store.export_dir)
    shutil.rmtree(previous, ignore_errors=True)
    integrity.seal_export(store)
    return [str(item["file"]) for item in items]


def require_exportable(view: CandidateView, brief: Brief) -> None:
    """Refuse a candidate whose model licence forbids the brief's use or whose image changed."""
    entry = registry.get(view.manifest.recipe.pin.backend)
    if brief.commercial_use and not entry.commercial_use:
        msg = f"{view.id}: model licence '{entry.licence}' forbids commercial export"
        raise ExportError(msg)
    if sha256_file(view.image) != view.manifest.output.sha256:
        msg = f"{view.id}: image bytes differ from the manifest hash, refusing to export"
        raise ExportError(msg)


def candidate_provenance(view: CandidateView, decision: Decision) -> dict[str, object]:
    """What an exported image says about itself: recipe, model, seed and who approved it."""
    recipe = view.manifest.recipe
    return {
        "recipe_hash": view.manifest.recipe_hash,
        "model": recipe.pin.model_id,
        "revision": recipe.pin.revision,
        "seed": recipe.seed,
        "approved_by": decision.reviewer,
        "approved_at": decision.decided_at.isoformat(),
    }


def write_with_provenance(source: Path, target: Path, provenance: dict[str, object]) -> str:
    """Save ``source`` as a PNG carrying a ``csl:provenance`` chunk; return the file's sha256."""
    info = PngInfo()
    info.add_text("csl:provenance", canonical_json(provenance))
    with Image.open(source) as image:
        image.save(target, format="PNG", pnginfo=info)
    return sha256_file(target)


def _export_one(
    view: CandidateView, decision: Decision, brief: Brief, staging: Path
) -> dict[str, object]:
    """Write one approved image and its sidecar into ``staging``; return its index entry."""
    require_exportable(view, brief)
    entry = registry.get(view.manifest.recipe.pin.backend)
    name = f"{brief.id}-{view.id}"
    exported = staging / f"{name}.png"
    digest = write_with_provenance(view.image, exported, candidate_provenance(view, decision))
    sidecar: dict[str, object] = {
        "file": exported.name,
        "sha256": digest,
        "source_image_sha256": sha256_file(view.image),
        "manifest": view.manifest.model_dump(mode="json"),
        "evaluation": view.evaluation.model_dump(mode="json"),
        "decision": decision.model_dump(mode="json"),
        "model_licence": {"name": entry.licence, "commercial_use": entry.commercial_use},
    }
    write_json(staging / f"{name}.json", sidecar)
    return {"file": exported.name, "sha256": digest, "candidate": view.id}


def add_reference(store: RunStore, candidate_id: str, directory: Path) -> Path:
    """Copy an approved candidate into a brand reference directory (the drift baseline)."""
    integrity.require_intact(store)
    view = store.candidate(candidate_id)
    if view.status != "approved":
        msg = f"{candidate_id} is {view.status}; only approved candidates become references"
        raise ExportError(msg)
    directory.mkdir(parents=True, exist_ok=True)
    stem = f"{store.root.name}-{candidate_id}"
    target = directory / f"{stem}.png"
    try:
        with target.open("xb") as handle:
            handle.write(view.image.read_bytes())
    except FileExistsError as error:
        msg = f"{target} already exists; a reference is never overwritten"
        raise ExportError(msg) from error
    write_json(
        directory / f"{stem}.json",
        {"recipe_hash": view.manifest.recipe_hash, "source_run": store.root.name},
    )
    return target
