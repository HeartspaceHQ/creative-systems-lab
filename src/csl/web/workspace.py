"""What the web API serves: runs, briefs, models, references and validation sets.

Pure functions over files and the existing modules; the HTTP layer only routes to these. Ids
that arrive from a URL are checked against a strict pattern and resolved only inside the
configured directories.
"""

from __future__ import annotations

import io
import json
import re
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

from PIL import Image

from csl import integrity, registry, review
from csl.canonical import sha256_file
from csl.evaluate import palette_matches
from csl.reproduce import verify
from csl.schema import BrandContext, Brief, SourceRecord
from csl.store import SOURCE_NAME, RunStore, read_model
from csl.validation.ratings import BlindSet
from csl.web.explain import explain

if TYPE_CHECKING:
    from pathlib import Path

    from csl.schema import Check, Decision
    from csl.store import CandidateView

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}


class NotFoundError(KeyError):
    """The requested run, candidate, image or set does not exist."""


@dataclass(frozen=True)
class Workspace:
    """Directories the server is allowed to read and write."""

    run_roots: tuple[Path, ...]
    brand: Path | None = None
    brief_files: tuple[Path, ...] = ()
    references: Path | None = None
    validation_root: Path | None = None
    static_dir: Path | None = None

    def run_store(self, run_id: str) -> RunStore:
        """Open a run by directory name."""
        if not _SAFE_ID.match(run_id):
            raise NotFoundError(run_id)
        for root in self.run_roots:
            candidate = root / run_id
            if (candidate / "run.json").is_file():
                return RunStore(candidate)
        raise NotFoundError(run_id)

    def list_runs(self) -> list[dict[str, object]]:
        """Summaries of every run, newest name first.

        A run id found in several roots is listed once, from the first root, because that is the
        copy ``run_store`` opens.
        """
        rows: list[dict[str, object]] = []
        seen: set[str] = set()
        for root in self.run_roots:
            if not root.is_dir():
                continue
            for run_json in sorted(root.glob("*/run.json")):
                if run_json.parent.name in seen:
                    continue
                seen.add(run_json.parent.name)
                try:
                    rows.append(_run_summary(RunStore(run_json.parent)))
                except (OSError, ValueError, KeyError):
                    continue  # one damaged run must not hide the others
        return sorted(rows, key=lambda row: str(row["id"]), reverse=True)

    def _reference_files(self) -> dict[str, Path]:
        """Reference images by file name, from every kind folder of the reference directory."""
        if self.references is None or not self.references.is_dir():
            return {}
        return {
            path.name: path
            for path in sorted(self.references.rglob("*"))
            if path.suffix.lower() in _IMAGE_SUFFIXES and path.is_file()
        }

    def reference_names(self) -> list[str]:
        """File names of the reference images, if a reference directory is configured."""
        return sorted(self._reference_files())

    def reference_path(self, name: str) -> Path:
        """Path of one reference image."""
        files = self._reference_files()
        if name not in files:
            raise NotFoundError(name)
        return files[name]

    def run_references(self, store: RunStore) -> list[dict[str, object]]:
        """The references a run measured drift against, as recorded, and whether each is here.

        A reference counts as available only when a file of that name still has the recorded
        hash, so the page never shows a different image under a recorded name.
        """
        recorded = _run_json(store).get("reference_hashes", {})
        files = self._reference_files()
        rows: list[dict[str, object]] = []
        for name, digest in sorted(recorded.items()) if isinstance(recorded, dict) else []:
            path = files.get(name)
            rows.append(
                {"name": name, "available": path is not None and sha256_file(path) == digest}
            )
        return rows

    def candidate_image(self, run_id: str, candidate_id: str) -> Path:
        """Path of a candidate's image."""
        store = self.run_store(run_id)
        if not _SAFE_ID.match(candidate_id) or not (store.candidates_dir / candidate_id).is_dir():
            raise NotFoundError(candidate_id)
        return store.candidates_dir / candidate_id / "image.png"

    def run_detail(self, run_id: str) -> dict[str, object]:
        """Everything the run view needs: brief, brand, candidates with explained checks."""
        store = self.run_store(run_id)
        brief = store.brief()
        brand = store.brand()
        decisions = store.decisions()
        result = verify(store)
        record = _run_json(store)
        return {
            "id": run_id,
            "brief": brief.model_dump(mode="json"),
            "brand": {
                "name": brand.name,
                "version": brand.version,
                "palette": brand.palette,
                "forbidden_colours": brand.forbidden_colours,
                "palette_max_delta_e": brand.thresholds.palette_max_delta_e,
            },
            "started_at": record.get("started_at"),
            "rechecked_from": record.get("rechecked_from", []),
            "references": self.run_references(store),
            "candidates": [_candidate_json(view, store, brand) for view in store.candidates()],
            "decisions": [d.model_dump(mode="json") for d in decisions],
            "verification": {
                "intact": result.intact,
                "sealed": integrity.read_manifest(store) is not None,
                "problems": result.problems,
                "warnings": result.warnings,
            },
        }

    def decide(
        self,
        run_id: str,
        candidate_id: str,
        verdict: str,
        reviewer: str,
        note: str,
        *,
        override: bool,
    ) -> Decision:
        """Record a decision through the same logic as ``csl review``."""
        store = self.run_store(run_id)
        if verdict not in {"approve", "reject"}:
            msg = "verdict must be 'approve' or 'reject'"
            raise review.ReviewError(msg)
        return review.decide(
            store,
            candidate_id,
            "approve" if verdict == "approve" else "reject",
            reviewer,
            note,
            override=override,
        )

    def validation_sets(self) -> list[str]:
        """Ids of the validation sets that have images."""
        if self.validation_root is None or not self.validation_root.is_dir():
            return []
        return sorted(p.name for p in self.validation_root.iterdir() if (p / "images").is_dir())

    def blind_set(self, set_id: str) -> BlindSet:
        """Open a validation set for blind rating."""
        if self.validation_root is None or not _SAFE_ID.match(set_id):
            raise NotFoundError(set_id)
        if set_id not in self.validation_sets():
            raise NotFoundError(set_id)
        return BlindSet(self.validation_root / set_id)

    def blind_items(self, set_id: str) -> dict[str, object]:
        """Image ids in presentation order with the verdicts so far; no scores or categories."""
        blind = self.blind_set(set_id)
        ratings = blind.ratings()
        return {
            "set": set_id,
            "items": [
                {
                    "id": key,
                    "verdict": ratings[key].verdict if key in ratings else None,
                    "note": ratings[key].note if key in ratings else "",
                }
                for key in blind.ids()
            ],
        }

    def blind_image(self, set_id: str, blind_id: str) -> bytes:
        """The image re-encoded as PNG so no embedded metadata can reach the rater."""
        path = self.blind_set(set_id).image_path(blind_id)
        if path is None:
            raise NotFoundError(blind_id)
        buffer = io.BytesIO()
        with Image.open(path) as image:
            image.convert("RGB").save(buffer, format="PNG")
        return buffer.getvalue()

    def briefs(self) -> list[dict[str, object]]:
        """Briefs that can be started from the UI."""
        rows: list[dict[str, object]] = []
        for path in self.brief_files:
            brief = read_model(path, Brief)
            rows.append(
                {
                    "file": path.name,
                    "id": brief.id,
                    "subject": brief.subject,
                    "kind": brief.kind,
                    "candidates": brief.candidates,
                }
            )
        return rows

    def brief_path(self, file_name: str) -> Path:
        """Resolve a brief file name from the configured list."""
        for path in self.brief_files:
            if path.name == file_name:
                return path
        raise NotFoundError(file_name)

    def brand_context(self) -> BrandContext:
        """The brand file's profile, for runs started from a brief file."""
        if self.brand is None:
            msg = "this server was started without a brand file"
            raise NotFoundError(msg)
        return read_model(self.brand, BrandContext)


def _run_summary(store: RunStore) -> dict[str, object]:
    views = store.candidates()
    brief = store.brief()
    record = _run_json(store)
    cover = next((v for v in views if v.status != "auto_rejected"), views[0] if views else None)
    return {
        "id": store.root.name,
        "brief": brief.id,
        "subject": brief.subject,
        "kind": brief.kind,
        "started_at": record.get("started_at"),
        "rechecked": bool(record.get("rechecked_from")),
        "models": sorted({v.manifest.recipe.pin.backend for v in views}),
        "cover": cover.id if cover else None,
        "candidates": len(views),
        "pending": sum(v.status == "pending" for v in views),
        "approved": sum(v.status == "approved" for v in views),
        "rejected": sum(v.status == "rejected" for v in views),
        "held_back": sum(v.status == "auto_rejected" for v in views),
    }


def _run_json(store: RunStore) -> dict[str, object]:
    path = store.root / "run.json"
    value = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    return value if isinstance(value, dict) else {}


def _source_run(view: CandidateView) -> str | None:
    path = view.directory / SOURCE_NAME
    return read_model(path, SourceRecord).run_id if path.is_file() else None


def _model_label(key: str) -> str:
    """A short readable model name: the registry description up to its first qualifier."""
    entry = next((e for e in registry.REGISTRY if e.key == key), None)
    if entry is None:
        return key
    return entry.description.split(",")[0].split(" (")[0].split(":")[0].strip() or key


def _candidate_json(view: CandidateView, store: RunStore, brand: BrandContext) -> dict[str, object]:
    manifest = view.manifest
    recipe = manifest.recipe
    latest = store.latest_decisions().get(view.id)
    return {
        "id": view.id,
        "status": view.status,
        "model": recipe.pin.backend,
        "model_id": recipe.pin.model_id,
        "model_label": _model_label(recipe.pin.backend),
        "seed": recipe.seed,
        "steps": recipe.steps,
        "width": recipe.width,
        "height": recipe.height,
        "prompt": recipe.prompt,
        "seconds": manifest.generation_seconds,
        "created_at": manifest.created_at.isoformat(),
        "cost_usd": manifest.cost.usd if manifest.cost else None,
        "cost_estimated": manifest.cost.estimated if manifest.cost else None,
        "sha256": manifest.output.sha256,
        "source_run": _source_run(view),
        "hard_pass": view.evaluation.hard_pass,
        "checks": [
            {**check.model_dump(mode="json"), "explanation": _explanation_json(check)}
            for check in view.evaluation.checks
        ],
        "warnings": view.evaluation.warnings,
        "colours": [asdict(match) for match in palette_matches(view.image, brand)],
        "decision": latest.model_dump(mode="json") if latest else None,
    }


def _explanation_json(check: Check) -> dict[str, str]:
    return asdict(explain(check))
