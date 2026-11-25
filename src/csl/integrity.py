"""Tamper evidence for a whole run: a manifest of artefact hashes and a decision hash chain.

Every line of ``decisions.jsonl`` carries the SHA-256 of the previous line (the first carries
zeros), so a changed, removed or reordered decision breaks the chain from that point on.
``integrity.json`` adds what a chain cannot show by itself: the hash of the last line (so the
newest decisions cannot be silently cut off) and the hash of every generated and exported file
(images, manifests, ``evaluation.json``, export sidecars).

What this is not: protection. Anyone who can write the run directory can recompute the chain
and the manifest together. It makes casual or accidental change visible and makes deliberate
change require rewriting everything consistently. Stopping that needs the head hash to live
outside the directory (a signature, a timestamping service or a copy in another system), which
this project does not do. See docs/integrity.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import ValidationError

from csl.canonical import sha256_file, sha256_text
from csl.schema import Decision, DecisionHead, IntegrityManifest
from csl.store import GENESIS_HASH, read_model, write_json

if TYPE_CHECKING:
    from pathlib import Path

    from csl.store import RunStore

MANIFEST_NAME = "integrity.json"
_TOP_LEVEL = ("run.json", "brief.json", "brand.json", "selection.json")
LEGACY_WARNING = (
    "no integrity manifest and an unchained decision log (the run predates hash chaining): "
    "decisions, evaluation.json and export sidecars are not verified; "
    "run `csl migrate RUN` to seal the current state"
)


class IntegrityError(RuntimeError):
    """Raised when a run cannot be written to because its record is unsealed or broken."""


def manifest_path(store: RunStore) -> Path:
    """Location of the integrity manifest."""
    return store.root / MANIFEST_NAME


def read_manifest(store: RunStore) -> IntegrityManifest | None:
    """The run's manifest, or None for a run created before manifests existed."""
    path = manifest_path(store)
    return read_model(path, IntegrityManifest) if path.is_file() else None


def is_migrated(store: RunStore) -> bool:
    """True if the run was sealed by ``migrate`` rather than at creation."""
    manifest = read_manifest(store)
    return manifest is not None and manifest.origin == "migrated"


def _hash_files(root: Path, files: list[Path]) -> dict[str, str]:
    return {path.relative_to(root).as_posix(): sha256_file(path) for path in sorted(files)}


def _generated_files(store: RunStore) -> list[Path]:
    top = [store.root / name for name in _TOP_LEVEL if (store.root / name).is_file()]
    return [*top, *(p for p in store.candidates_dir.rglob("*") if p.is_file())]


def _export_files(store: RunStore) -> list[Path]:
    return [p for p in store.export_dir.rglob("*") if p.is_file()]


def _head(store: RunStore) -> DecisionHead:
    return DecisionHead(count=len(store.decision_lines()), head=store.decision_head())


def _write(store: RunStore, manifest: IntegrityManifest) -> None:
    write_json(manifest_path(store), manifest)


def seal_generation(store: RunStore) -> None:
    """Record the hashes of everything generation produced. Called once, at the end of a run."""
    manifest = IntegrityManifest(
        generated=_hash_files(store.root, _generated_files(store)),
        decisions=_head(store),
    )
    _write(store, manifest)


def seal_decisions(store: RunStore) -> None:
    """Advance the recorded decision head after a decision was appended."""
    manifest = _require_manifest(store)
    _write(store, manifest.model_copy(update={"decisions": _head(store)}))


def seal_export(store: RunStore) -> None:
    """Record the hashes of everything in ``export/``. Called when an export is written."""
    manifest = _require_manifest(store)
    exported = _hash_files(store.root, _export_files(store))
    _write(store, manifest.model_copy(update={"exported": exported}))


def _require_manifest(store: RunStore) -> IntegrityManifest:
    manifest = read_manifest(store)
    if manifest is None:
        msg = f"{store.root} has no {MANIFEST_NAME}; run `csl migrate` to seal it first"
        raise IntegrityError(msg)
    return manifest


def require_intact(store: RunStore) -> None:
    """Refuse to use a run whose generated files, decision chain or images were altered.

    Stricter than ``require_writable``: every generated file must match the sealed manifest and
    every candidate image must match the hash in its own manifest, so a swapped image cannot
    be approved, exported, replayed or turned into a brand reference.
    """
    require_writable(store)
    if problems := [*generated_problems(store), *image_problems(store)]:
        msg = f"run is not intact, refusing to use it: {problems[0]}"
        raise IntegrityError(msg)


def require_writable(store: RunStore) -> None:
    """Refuse to extend a run whose record is unsealed or whose decision chain is broken."""
    _require_manifest(store)
    if problems := chain_problems(store):
        msg = f"decision log is not intact, refusing to extend it: {problems[0]}"
        raise IntegrityError(msg)


def _line_problem(index: int, line: str, expected: str) -> str | None:
    number = index + 1
    try:
        decision = Decision.model_validate_json(line)
    except ValidationError:
        return f"decision {number}: line is not a valid decision record"
    if decision.prev_hash is None:
        return f"decision {number}: carries no prev_hash (unchained line in a sealed run)"
    if decision.prev_hash != expected:
        where = "the start of the log" if index == 0 else f"decision {index}"
        return (
            f"decision {number}: prev_hash does not match {where}; a decision before this "
            "point was changed, removed or reordered"
        )
    return None


def chain_problems(store: RunStore) -> list[str]:
    """Check the hash chain of ``decisions.jsonl`` and its length and head against the seal."""
    problems: list[str] = []
    expected = GENESIS_HASH
    lines = store.decision_lines()
    for index, line in enumerate(lines):
        if problem := _line_problem(index, line, expected):
            problems.append(problem)
        expected = sha256_text(line)
    manifest = read_manifest(store)
    if manifest is not None:
        sealed = manifest.decisions
        if len(lines) != sealed.count:
            problems.append(
                f"decision log has {len(lines)} line(s) but {sealed.count} were sealed "
                "(decisions removed, or added outside csl)",
            )
        elif store.decision_head() != sealed.head:
            problems.append(
                "last decision does not match the sealed head (it was changed after sealing)",
            )
    return problems


def _diff_files(label: str, recorded: dict[str, str], current: dict[str, str]) -> list[str]:
    problems = [f"{name}: missing ({label})" for name in sorted(recorded) if name not in current]
    problems += [
        f"{name}: changed since it was sealed ({label})"
        for name, digest in sorted(recorded.items())
        if name in current and current[name] != digest
    ]
    problems += [
        f"{name}: not in the sealed manifest, added after sealing ({label})"
        for name in sorted(current)
        if name not in recorded
    ]
    return problems


def generated_problems(store: RunStore) -> list[str]:
    """Compare the generated files with the hashes recorded in the manifest."""
    manifest = read_manifest(store)
    if manifest is None:
        return []
    return _diff_files(
        "generated",
        manifest.generated,
        _hash_files(store.root, _generated_files(store)),
    )


def image_problems(store: RunStore) -> list[str]:
    """Candidate images whose bytes differ from the hash in the candidate's own manifest."""
    problems: list[str] = []
    for view in store.candidates():
        image = store.root / view.manifest.output.path
        if not image.is_file():
            problems.append(f"{view.id}: image file missing")
        elif sha256_file(image) != view.manifest.output.sha256:
            problems.append(f"{view.id}: image bytes differ from manifest sha256")
    return problems


def manifest_problems(store: RunStore) -> list[str]:
    """Compare every generated and exported file with the hashes recorded in the manifest."""
    manifest = read_manifest(store)
    if manifest is None:
        return []
    problems = generated_problems(store)
    current_export = _hash_files(store.root, _export_files(store))
    if manifest.exported is None:
        if current_export:
            problems.append("export/: files exist but the export was never sealed")
    else:
        problems += _diff_files("exported", manifest.exported, current_export)
    return problems


def unknown_candidate_problems(store: RunStore) -> list[str]:
    """Decisions that refer to a candidate the run does not have."""
    known = {view.id for view in store.candidates()}
    return [
        f"decision {number}: refers to unknown candidate {decision.candidate_id!r}"
        for number, decision in enumerate(store.decisions(), start=1)
        if decision.candidate_id not in known
    ]


def migrate(store: RunStore) -> IntegrityManifest:
    """Chain the decision log of a pre-integrity run and seal its current state.

    This attests the files as they are now, not as they were when generated: nothing can be
    said about changes made before migration. The manifest records ``origin: migrated``.
    """
    with store.lock():
        return _migrate_locked(store)


def _migrate_locked(store: RunStore) -> IntegrityManifest:
    if manifest_path(store).is_file():
        msg = f"{store.root} is already sealed"
        raise IntegrityError(msg)
    previous = GENESIS_HASH
    chained: list[str] = []
    for line in store.decision_lines():
        decision = Decision.model_validate_json(line).model_copy(update={"prev_hash": previous})
        stored = decision.model_dump_json()
        chained.append(stored)
        previous = sha256_text(stored)
    if chained:
        store.decisions_path.write_text("\n".join(chained) + "\n", encoding="utf-8")
    manifest = IntegrityManifest(
        origin="migrated",
        generated=_hash_files(store.root, _generated_files(store)),
        exported=_hash_files(store.root, _export_files(store))
        if store.export_dir.is_dir()
        else None,
        decisions=_head(store),
    )
    _write(store, manifest)
    return manifest
