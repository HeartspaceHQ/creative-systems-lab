"""Static review page and per-model comparison.

The page is a single self-contained HTML file with relative image links. It shows what a
reviewer needs next to each image: model, seed, timing, every check with its value and
threshold, and the current status. Decisions are made with ``csl review``, which keeps the
audit trail in one place instead of in browser state.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from csl.store import CandidateView, RunStore

_CSS = """
:root{--ink:#1d1d1f;--paper:#fbfaf7;--line:#d9d6cf;--ok:#1a6b3a;--bad:#9b1c1c;--warn:#8a5a00}
body{font:15px/1.5 system-ui,sans-serif;background:var(--paper);color:var(--ink);
margin:0;padding:24px}
h1{font-size:20px;margin:0 0 4px}.sub{color:#555;margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.card{border:1px solid var(--line);background:#fff;padding:12px}
.card img{width:100%;height:auto;display:block;margin-bottom:8px}
.status{font-weight:600}.approved{color:var(--ok)}.rejected,.auto_rejected{color:var(--bad)}
.pending{color:var(--warn)}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-top:1px solid var(--line);padding:3px 4px;text-align:left}.fail{color:var(--bad)}
code{font-size:12px}
"""


@dataclass(frozen=True)
class ModelSummary:
    """Aggregates for one model across a run's candidates."""

    model: str
    candidates: int
    hard_pass: int
    approved: int
    mean_colour_drift: float | None
    mean_seconds: float


def compare(store: RunStore) -> list[ModelSummary]:
    """Per-model aggregates: pass rate, approvals, drift and generation time."""
    groups: dict[str, list[CandidateView]] = {}
    for view in store.candidates():
        groups.setdefault(view.manifest.recipe.pin.backend, []).append(view)
    rows: list[ModelSummary] = []
    for model, views in sorted(groups.items()):
        drifts = [c.value for v in views for c in v.evaluation.checks if c.name == "colour_drift"]
        rows.append(
            ModelSummary(
                model=model,
                candidates=len(views),
                hard_pass=sum(v.evaluation.hard_pass for v in views),
                approved=sum(v.status == "approved" for v in views),
                mean_colour_drift=sum(drifts) / len(drifts) if drifts else None,
                mean_seconds=sum(v.manifest.generation_seconds for v in views) / len(views),
            ),
        )
    return rows


def _card(view: CandidateView) -> str:
    recipe = view.manifest.recipe
    rows = "".join(
        f"<tr class='{'' if c.passed else 'fail'}'><td>{escape(c.name)}"
        f"{'' if c.hard else ' (soft)'}</td><td>{c.value}</td>"
        f"<td>{c.comparison} {c.threshold}</td><td>{'pass' if c.passed else 'FAIL'}</td></tr>"
        for c in view.evaluation.checks
    )
    warnings = "".join(f"<div class='sub'>{escape(w)}</div>" for w in view.evaluation.warnings)
    return (
        f"<div class='card'><img src='candidates/{escape(view.id)}/image.png' "
        f"alt='{escape(view.id)}'>"
        f"<div><b>{escape(view.id)}</b> "
        f"<span class='status {view.status}'>{view.status.replace('_', ' ')}</span></div>"
        f"<div class='sub'>{escape(recipe.pin.model_id)} "
        f"rev <code>{escape((recipe.pin.revision or '-')[:10])}</code> "
        f"seed {recipe.seed}, {recipe.steps} steps, {view.manifest.generation_seconds:g} s<br>"
        f"recipe <code>{view.manifest.recipe_hash[:12]}</code></div>"
        f"<table>{rows}</table>{warnings}</div>"
    )


def write_report(store: RunStore) -> None:
    """Write ``report.html`` into the run directory."""
    brief = store.brief()
    cards = "".join(_card(v) for v in store.candidates())
    summary = "".join(
        f"<tr><td>{escape(r.model)}</td><td>{r.candidates}</td><td>{r.hard_pass}</td>"
        f"<td>{r.approved}</td>"
        f"<td>{'-' if r.mean_colour_drift is None else f'{r.mean_colour_drift:.3f}'}</td>"
        f"<td>{r.mean_seconds:.1f}</td></tr>"
        for r in compare(store)
    )
    html = (
        "<!doctype html><meta charset='utf-8'><meta name='viewport' "
        "content='width=device-width,initial-scale=1'>"
        f"<title>{escape(brief.id)} review</title><style>{_CSS}</style>"
        f"<h1>{escape(brief.id)}</h1><p class='sub'>{escape(brief.subject)}</p>"
        "<table><tr><th>model</th><th>candidates</th><th>hard pass</th><th>approved</th>"
        f"<th>mean colour drift</th><th>mean s</th></tr>{summary}</table><br>"
        f"<div class='grid'>{cards}</div>"
    )
    (store.root / "report.html").write_text(html, encoding="utf-8")
