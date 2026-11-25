"""The routes of the run browser: runs, decisions, briefs, models, jobs and blind review."""

from __future__ import annotations

import mimetypes
from typing import TYPE_CHECKING

from csl import review
from csl.schema import Brief
from csl.store import read_model
from csl.web import generation
from csl.web.routing import ID, Raw, Route, route

if TYPE_CHECKING:
    import re

    from csl.validation.ratings import Verdict
    from csl.web.routing import Request


def _text(body: dict[str, object], key: str, default: str = "") -> str:
    value = body.get(key, default)
    return value if isinstance(value, str) else default


def _list_runs(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, req.workspace.list_runs()


def _run_detail(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, req.workspace.run_detail(m["run"])


def _candidate_image(req: Request, m: re.Match[str]) -> tuple[int, object]:
    path = req.workspace.candidate_image(m["run"], m["cid"])
    return 200, Raw(path.read_bytes(), "image/png")


def _reference_image(req: Request, m: re.Match[str]) -> tuple[int, object]:
    path = req.workspace.reference_path(m["name"])
    return 200, Raw(path.read_bytes(), mimetypes.guess_type(path.name)[0] or "image/png")


def _briefs(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, req.workspace.briefs()


def _brief(req: Request, candidates: str | None = None) -> Brief | None:
    file_name = req.query.get("brief")
    if not file_name:
        return None
    brief = read_model(req.workspace.brief_path(file_name), Brief)
    return brief if candidates is None else brief.with_candidates(int(candidates))


def _models(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, generation.models(_brief(req), req.jobs.budget)


def _setup(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, generation.setup(req.jobs.budget)


def _quote(req: Request, _: re.Match[str]) -> tuple[int, object]:
    brief = _brief(req, req.query.get("candidates"))
    if brief is None:
        msg = "brief is required"
        raise ValueError(msg)
    keys = tuple(k for k in req.query.get("models", "").split(",") if k)
    return 200, generation.quote(brief, keys, req.jobs.budget)


def _start_job(req: Request, _: re.Match[str]) -> tuple[int, object]:
    raw_models = req.body.get("models", [])
    models = (
        tuple(m for m in raw_models if isinstance(m, str)) if isinstance(raw_models, list) else ()
    )
    candidates = req.body.get("candidates")
    if candidates is not None and (isinstance(candidates, bool) or not isinstance(candidates, int)):
        msg = "candidates must be an integer"
        raise ValueError(msg)
    job = req.jobs.start(_text(req.body, "brief"), models, candidates)
    return 202, {"id": job.id, "state": job.state}


def _job(req: Request, m: re.Match[str]) -> tuple[int, object]:
    job = req.jobs.get(m["job"])
    return 200, {"id": job.id, "state": job.state, "run_id": job.run_id, "error": job.error}


def _decide(req: Request, m: re.Match[str]) -> tuple[int, object]:
    decision = req.workspace.decide(
        m["run"],
        _text(req.body, "candidate"),
        _text(req.body, "verdict"),
        _text(req.body, "reviewer"),
        _text(req.body, "note"),
        override=req.body.get("override") is True,
    )
    return 201, decision.model_dump(mode="json")


def _validation_sets(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, req.workspace.validation_sets()


def _validation_items(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, req.workspace.blind_items(m["set"])


def _validation_image(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, Raw(req.workspace.blind_image(m["set"], m["id"]), "image/png")


def _rate(req: Request, m: re.Match[str]) -> tuple[int, object]:
    verdict = _text(req.body, "verdict")
    if verdict not in {"approve", "reject"}:
        msg = "verdict must be 'approve' or 'reject'"
        raise review.ReviewError(msg)
    typed: Verdict = "approve" if verdict == "approve" else "reject"
    blind = req.workspace.blind_set(m["set"])
    rating = blind.rate(_text(req.body, "id"), typed, _text(req.body, "note"))
    return 201, {"id": rating.blind_id, "verdict": rating.verdict}


GET: list[Route] = [
    route(r"/api/runs", _list_runs),
    route(rf"/api/runs/(?P<run>{ID})", _run_detail),
    route(rf"/api/runs/(?P<run>{ID})/candidates/(?P<cid>{ID})/image", _candidate_image),
    route(rf"/api/references/(?P<name>{ID})", _reference_image),
    route(r"/api/briefs", _briefs),
    route(r"/api/models", _models),
    route(r"/api/setup", _setup),
    route(r"/api/quote", _quote),
    route(rf"/api/jobs/(?P<job>{ID})", _job),
    route(r"/api/validation", _validation_sets),
    route(rf"/api/validation/(?P<set>{ID})", _validation_items),
    route(rf"/api/validation/(?P<set>{ID})/images/(?P<id>{ID})", _validation_image),
]
POST: list[Route] = [
    route(r"/api/jobs", _start_job, "json"),
    route(rf"/api/runs/(?P<run>{ID})/decisions", _decide, "json"),
    route(rf"/api/validation/(?P<set>{ID})/ratings", _rate, "json"),
]
