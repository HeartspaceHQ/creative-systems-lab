"""Compare the system's verdict with the human's, per intended category.

Positive means "acceptable". A false positive is an image the system accepts and the human
rejects (a bad image let through); a false negative is an image the system rejects and the
human approves (a good image blocked). Two system verdicts are reported: ``gate`` (hard checks
pass, which is what decides ``auto_rejected``) and ``strict`` (hard checks pass and no soft
drift warning). Nothing here is a result until a human has rated the images.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Literal

from csl.schema import Evaluation
from csl.validation.generate import GENERATED, SCORES
from csl.validation.ratings import BlindSet
from csl.validation.spec import CATEGORIES, blind_id

if TYPE_CHECKING:
    from pathlib import Path

    from csl.validation.spec import ValidationSpec

SystemVerdict = Literal["gate", "strict"]


class AnalysisError(RuntimeError):
    """Raised when the analysis cannot be done honestly (for example unrated images)."""


@dataclass(frozen=True)
class Counts:
    """Confusion counts for a group of images."""

    n: int = 0
    true_positive: int = 0
    false_positive: int = 0
    false_negative: int = 0
    true_negative: int = 0

    def add(self, *, system_accepts: bool, human_approves: bool) -> Counts:
        """Return the counts with one more image included."""
        return Counts(
            n=self.n + 1,
            true_positive=self.true_positive + (system_accepts and human_approves),
            false_positive=self.false_positive + (system_accepts and not human_approves),
            false_negative=self.false_negative + (not system_accepts and human_approves),
            true_negative=self.true_negative + (not system_accepts and not human_approves),
        )


@dataclass(frozen=True)
class Analysis:
    """Confusion matrix overall and per intended category, for one system verdict."""

    verdict: SystemVerdict
    overall: Counts
    by_category: dict[str, Counts]


def _system_accepts(evaluation: Evaluation, verdict: SystemVerdict) -> bool:
    if verdict == "gate":
        return evaluation.hard_pass
    return evaluation.hard_pass and all(check.passed for check in evaluation.checks)


def analyse(
    spec: ValidationSpec,
    directory: Path,
    *,
    partial: bool = False,
) -> list[Analysis]:
    """Build the confusion tables. Refuses unrated images unless ``partial`` is set."""
    scores = json.loads((directory / SCORES).read_text(encoding="utf-8"))
    generated = json.loads((directory / GENERATED).read_text(encoding="utf-8"))
    ratings = BlindSet(directory).ratings()
    missing = [c.id for c in spec.cases if blind_id(spec, c) not in ratings]
    if missing and not partial:
        msg = f"{len(missing)} of {len(spec.cases)} images are not rated yet"
        raise AnalysisError(msg)
    results = []
    verdicts: tuple[SystemVerdict, ...] = ("gate", "strict")
    for verdict in verdicts:
        overall = Counts()
        by_category: dict[str, Counts] = {category: Counts() for category in CATEGORIES}
        for case in spec.cases:
            key = blind_id(spec, case)
            if key not in ratings or key not in generated["cases"]:
                continue
            accepts = _system_accepts(Evaluation.model_validate(scores[key]), verdict)
            approves = ratings[key].verdict == "approve"
            overall = overall.add(system_accepts=accepts, human_approves=approves)
            by_category[case.category] = by_category[case.category].add(
                system_accepts=accepts, human_approves=approves
            )
        results.append(Analysis(verdict, overall, by_category))
    return results


def format_analysis(analyses: list[Analysis]) -> str:
    """Plain-text tables: one per system verdict."""
    lines: list[str] = []
    for analysis in analyses:
        lines.append(f"system verdict: {analysis.verdict}")
        lines.append(f"{'category':22}{'n':>4}{'TP':>5}{'FP':>5}{'FN':>5}{'TN':>5}")
        rows = [*analysis.by_category.items(), ("ALL", analysis.overall)]
        lines.extend(
            f"{name:22}{c.n:>4}{c.true_positive:>5}{c.false_positive:>5}"
            f"{c.false_negative:>5}{c.true_negative:>5}"
            for name, c in rows
        )
        lines.append("")
    return "\n".join(lines)


def to_json(analyses: list[Analysis]) -> dict[str, object]:
    """Machine-readable form of the analysis."""
    return {
        a.verdict: {
            "overall": asdict(a.overall),
            "by_category": {k: asdict(v) for k, v in a.by_category.items()},
        }
        for a in analyses
    }
