"""On-disk run layout. Plain files, no database: a run is a directory you can zip and inspect.

::

    <run>/
      run.json                 summary written when generation finishes
      brief.json, brand.json   snapshots of the inputs, hashed into every manifest
      selection.json           chosen models and the reason every other model was excluded
      candidates/<id>/image.png, manifest.json, evaluation.json
      decisions.jsonl          append-only human decisions, each line hashing the one before
      integrity.json           hashes of every artefact and of the decision log head
      export/                  approved images, sidecars, index.json
      report.html              static review page
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, TypeVar

from pydantic import BaseModel

from csl.canonical import sha256_text
from csl.locking import exclusive
from csl.schema import BrandContext, Brief, Decision, Evaluation, Manifest

if TYPE_CHECKING:
    from contextlib import AbstractContextManager
    from pathlib import Path

_M = TypeVar("_M", bound=BaseModel)
GENESIS_HASH = "0" * 64
Status = str  # "auto_rejected" | "pending" | "approved" | "rejected"


SOURCE_NAME = "source.json"  # next to a rechecked candidate: where it was generated


def write_json(path: Path, value: BaseModel | dict[str, object] | list[object]) -> None:
    """Write JSON atomically (temp file then rename) so a crash never leaves half a file."""
    payload = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def read_model(path: Path, model: type[_M]) -> _M:
    """Read and validate a JSON file into a model."""
    return model.model_validate_json(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class CandidateView:
    """A candidate with its records and its derived review status."""

    id: str
    directory: Path
    manifest: Manifest
    evaluation: Evaluation
    status: Status

    @property
    def image(self) -> Path:
        """Path of the generated image."""
        return self.directory / "image.png"


class RunStore:
    """Reads and writes one run directory."""

    def __init__(self, root: Path) -> None:
        self.root = root

    @property
    def candidates_dir(self) -> Path:
        """Directory holding one subdirectory per candidate."""
        return self.root / "candidates"

    @property
    def decisions_path(self) -> Path:
        """Append-only decision log."""
        return self.root / "decisions.jsonl"

    @property
    def export_dir(self) -> Path:
        """Where approved images are exported."""
        return self.root / "export"

    def lock(self) -> AbstractContextManager[None]:
        """Exclusive lock on this run, held while the decision chain or export is changed."""
        return exclusive(self.root / ".lock")

    def brief(self) -> Brief:
        """The brief snapshot."""
        return read_model(self.root / "brief.json", Brief)

    def brand(self) -> BrandContext:
        """The brand snapshot."""
        return read_model(self.root / "brand.json", BrandContext)

    def decision_lines(self) -> list[str]:
        """The raw lines of the decision log, exactly as stored."""
        if not self.decisions_path.is_file():
            return []
        lines = self.decisions_path.read_text(encoding="utf-8").splitlines()
        return [line for line in lines if line.strip()]

    def decisions(self) -> list[Decision]:
        """All decisions in the order they were made."""
        return [Decision.model_validate_json(line) for line in self.decision_lines()]

    def decision_head(self) -> str:
        """Hash that the next decision must carry as ``prev_hash``."""
        lines = self.decision_lines()
        return sha256_text(lines[-1]) if lines else GENESIS_HASH

    def append_decision(self, decision: Decision) -> Decision:
        """Append one decision, chained to the previous line. The log is never rewritten."""
        chained = decision.model_copy(update={"prev_hash": self.decision_head()})
        with self.decisions_path.open("a", encoding="utf-8") as handle:
            handle.write(chained.model_dump_json() + "\n")
        return chained

    def latest_decisions(self) -> dict[str, Decision]:
        """Latest decision per candidate."""
        return {d.candidate_id: d for d in self.decisions()}

    def candidates(self) -> list[CandidateView]:
        """All candidates in a stable order, with derived status."""
        latest = self.latest_decisions()
        views: list[CandidateView] = []
        for directory in sorted(p for p in self.candidates_dir.iterdir() if p.is_dir()):
            manifest = read_model(directory / "manifest.json", Manifest)
            evaluation = read_model(directory / "evaluation.json", Evaluation)
            decision = latest.get(directory.name)
            if decision is not None:
                status = "approved" if decision.verdict == "approve" else "rejected"
            elif not evaluation.hard_pass:
                status = "auto_rejected"
            else:
                status = "pending"
            views.append(CandidateView(directory.name, directory, manifest, evaluation, status))
        return views

    def candidate(self, candidate_id: str) -> CandidateView:
        """One candidate by id."""
        for view in self.candidates():
            if view.id == candidate_id:
                return view
        msg = f"no candidate {candidate_id!r} in {self.root}"
        raise KeyError(msg)
