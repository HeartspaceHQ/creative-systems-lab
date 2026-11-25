"""The routes of CSL Studio: brands, projects, images, the design, deliveries, keys, preview."""

from __future__ import annotations

import re
from http import HTTPStatus
from pathlib import PurePosixPath
from typing import TYPE_CHECKING, TypeVar

from pydantic import BaseModel, ValidationError

from csl import keys, registry
from csl.backends.hosted import key_missing
from csl.web import deliveries, generation, images, studio_runs
from csl.web.jobs import RunRequest
from csl.web.problems import ApiError, from_validation, not_found, refuse
from csl.web.routing import ID, Raw, Route, route
from csl.web.studio_models import (
    FORMATS,
    MAX_CANDIDATES,
    BrandInput,
    BriefInput,
    BudgetInput,
    DecisionInput,
    DeliveryInput,
    Design,
    FromRunInput,
    KeyInput,
    ProjectChange,
    ProjectInput,
    RunInput,
)
from csl.web.uploads import clean_image, display_name

if TYPE_CHECKING:
    from csl.web.routing import Request

_M = TypeVar("_M", bound=BaseModel)
_SLUG = r"[a-z0-9][a-z0-9-]*"
_FILE_TYPES = {"png": "image/png", "mp4": "video/mp4", "gif": "image/gif", "pdf": "application/pdf"}
_ENGINE_PATH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$")


def _parse(model: type[_M], body: dict[str, object]) -> _M:
    """Validate a request body, answering a failure with a sentence per field."""
    try:
        return model.model_validate(body)
    except ValidationError as error:
        raise from_validation(error) from error


def _upload(req: Request) -> tuple[bytes, str, str]:
    if req.upload is None:
        refuse("Send the image as the body of the request.")
    return req.upload.data, req.upload.content_type, display_name(req.upload.file_name)


# --- small lists -----------------------------------------------------------------------------


def _session(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, {"token": req.session_token}


def _fonts(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, req.fonts.entries()


def _add_font(req: Request, _: re.Match[str]) -> tuple[int, object]:
    if req.upload is None:
        refuse("Send the font file as the body of the request.")
    family = req.query.get("family", "")
    confirmed = req.query.get("rights") == "confirmed"
    return 201, req.fonts.add(family, req.upload.data, rights_confirmed=confirmed)


def _font_file(req: Request, m: re.Match[str]) -> tuple[int, object]:
    data, content_type = req.fonts.file(m["font"])
    return 200, Raw(data, content_type)


def _formats(_: Request, __: re.Match[str]) -> tuple[int, object]:
    return 200, [spec.model_dump(mode="json") for spec in FORMATS]


# --- brands ----------------------------------------------------------------------------------


def _brands(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, [req.studio.brand_json(brand) for brand in req.studio.list_brands()]


def _brand_input(req: Request) -> BrandInput:
    """A brand from the body, whose two fonts must be on offer."""
    data = _parse(BrandInput, req.body)
    req.fonts.require(data.type.display, data.type.body)
    return data


def _create_brand(req: Request, _: re.Match[str]) -> tuple[int, object]:
    brand = req.studio.create_brand(_brand_input(req))
    return 201, req.studio.brand_json(brand)


def _update_brand(req: Request, m: re.Match[str]) -> tuple[int, object]:
    brand = req.studio.update_brand(m["brand"], _brand_input(req))
    return 200, req.studio.brand_json(brand)


def _add_reference(req: Request, m: re.Match[str]) -> tuple[int, object]:
    data, content_type, name = _upload(req)
    req.studio.get_brand(m["brand"])
    brand = req.studio.add_reference(m["brand"], name, clean_image(data, content_type).png)
    return 201, req.studio.brand_json(brand)


def _delete_reference(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, req.studio.brand_json(req.studio.delete_reference(m["brand"], m["ref"]))


def _reference_image(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, Raw(req.studio.reference_file(m["brand"], m["ref"]).read_bytes(), "image/png")


# --- projects --------------------------------------------------------------------------------


def _projects(req: Request, _: re.Match[str]) -> tuple[int, object]:
    return 200, [req.studio.summary(project) for project in req.studio.list_projects()]


def _create_project(req: Request, _: re.Match[str]) -> tuple[int, object]:
    project = req.studio.create_project(_parse(ProjectInput, req.body))
    return 201, req.studio.project_json(project)


def _project(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, req.studio.project_json(req.studio.get_project(m["project"]))


def _update_project(req: Request, m: re.Match[str]) -> tuple[int, object]:
    project = req.studio.update_project(m["project"], _parse(ProjectChange, req.body))
    return 200, req.studio.project_json(project)


def _set_brief(req: Request, m: re.Match[str]) -> tuple[int, object]:
    project = req.studio.set_brief(m["project"], _parse(BriefInput, req.body))
    return 200, req.studio.project_json(project)


# --- generation ------------------------------------------------------------------------------


def _models(req: Request, m: re.Match[str]) -> tuple[int, object]:
    brief = studio_runs.project_brief(req.studio.get_project(m["project"]))
    return 200, generation.models(brief, req.jobs.budget)


def _quote_candidates(text: str | None) -> int | None:
    if text is None:
        return None
    if not text.isdecimal() or not 1 <= int(text) <= MAX_CANDIDATES:
        refuse(
            f"Use between 1 and {MAX_CANDIDATES} candidates.",
            fields={"candidates": f"Use a number from 1 to {MAX_CANDIDATES}"},
        )
    return int(text)


def _quote(req: Request, m: re.Match[str]) -> tuple[int, object]:
    project = req.studio.get_project(m["project"])
    brief = studio_runs.project_brief(project, _quote_candidates(req.query.get("candidates")))
    chosen = tuple(key for key in req.query.get("models", "").split(",") if key)
    for key in chosen:
        entry = next((e for e in registry.REGISTRY if e.key == key), None)
        if entry is None:
            refuse(
                f"There is no model called {key}.", fields={"models": "Pick a model from the list"}
            )
        reason = registry.exclusion_reason(entry, brief)
        if reason is not None:
            refuse(f"{key} cannot be used here: {reason}", fields={"models": reason})
    return 200, generation.quote(brief, chosen, req.jobs.budget)


def _start_run(req: Request, m: re.Match[str]) -> tuple[int, object]:
    data = _parse(RunInput, req.body)
    project = req.studio.get_project(m["project"])
    brand = req.studio.get_brand(project.brand)
    brief = studio_runs.runnable_brief(project, data.candidates)
    refs_dir = req.studio.brand_refs_dir(brand.id)
    has_refs = studio_runs.has_references(refs_dir)
    project_id = project.id

    def record(run_id: str) -> None:
        req.studio.add_run(project_id, run_id)

    job = req.jobs.submit(
        RunRequest(
            brief,
            studio_runs.brand_context(brand, references=has_refs),
            tuple(data.models),
            refs_dir if has_refs else None,
            on_done=record,
        )
    )
    return 202, {"job": job.id, "state": job.state}


# --- images and design -----------------------------------------------------------------------


def _from_run(req: Request, m: re.Match[str]) -> tuple[int, object]:
    data = _parse(FromRunInput, req.body)
    asset, is_new = images.asset_from_run(
        req.studio, req.workspace, m["project"], data.run, data.candidate
    )
    return (201 if is_new else 200), req.studio.asset_json(m["project"], asset)


def _import_image(req: Request, m: re.Match[str]) -> tuple[int, object]:
    data, content_type, name = _upload(req)
    req.studio.get_project(m["project"])
    asset = images.import_asset(req.studio, m["project"], clean_image(data, content_type), name)
    return 201, req.studio.asset_json(m["project"], asset)


def _decide(req: Request, m: re.Match[str]) -> tuple[int, object]:
    asset = images.decide_asset(
        req.studio, m["project"], m["asset"], _parse(DecisionInput, req.body)
    )
    return 200, req.studio.asset_json(m["project"], asset)


def _asset_image(req: Request, m: re.Match[str]) -> tuple[int, object]:
    return 200, Raw(req.studio.asset_file(m["project"], m["asset"]).read_bytes(), "image/png")


def _set_design(req: Request, m: re.Match[str]) -> tuple[int, object]:
    project = req.studio.set_design(m["project"], _parse(Design, req.body))
    return 200, req.studio.project_json(project)


# --- deliveries ------------------------------------------------------------------------------


def _start_delivery(req: Request, m: re.Match[str]) -> tuple[int, object]:
    delivery = req.deliveries.start(m["project"], _parse(DeliveryInput, req.body))
    return 202, req.studio.delivery_json(m["project"], delivery)


def _delivery(req: Request, m: re.Match[str]) -> tuple[int, object]:
    delivery = req.studio.get_delivery(m["project"], m["delivery"])
    return 200, req.studio.delivery_json(m["project"], delivery)


def _delivery_file(req: Request, m: re.Match[str]) -> tuple[int, object]:
    path = req.studio.delivery_file(m["project"], m["delivery"], m["name"])
    download = req.query.get("download") == "1"
    return 200, Raw(
        path.read_bytes(),
        _FILE_TYPES[path.suffix.removeprefix(".")],
        filename=deliveries.safe_filename(m["name"]) if download else None,
        ranged=True,
    )


def _delivery_zip(req: Request, m: re.Match[str]) -> tuple[int, object]:
    data = deliveries.zip_delivery(req.studio, m["project"], m["delivery"])
    name = deliveries.safe_filename(f"{m['project']}-{m['delivery']}.zip")
    return 200, Raw(data, "application/zip", filename=name)


# --- keys and preview ------------------------------------------------------------------------


def _set_key(req: Request, _: re.Match[str]) -> tuple[int, object]:
    data = _parse(KeyInput, req.body)
    try:
        keys.set_key(data.variable, data.value)
    except ValueError as error:
        raise ApiError(
            str(error), HTTPStatus.BAD_REQUEST, {"variable": "Choose one of the listed keys"}
        ) from error
    return 200, {"variable": data.variable, "set": True}


def _forget_key(_: Request, m: re.Match[str]) -> tuple[int, object]:
    try:
        keys.forget_key(m["variable"])
    except ValueError as error:
        raise ApiError(str(error), HTTPStatus.NOT_FOUND) from error
    return 200, {"variable": m["variable"], "set": key_missing(m["variable"]) is None}


def _approve_budget(req: Request, _: re.Match[str]) -> tuple[int, object]:
    data = _parse(BudgetInput, req.body)
    req.jobs.budget = req.studio.approve_budget(data)
    return 200, generation.budget_status(req.jobs.budget)


def _engine_file(req: Request, m: re.Match[str]) -> tuple[int, object]:
    relative = m["path"]
    if not _ENGINE_PATH.match(relative) or ".." in PurePosixPath(relative).parts:
        not_found("file")
    if req.engine.preview_problem is not None:
        raise ApiError(req.engine.preview_problem, HTTPStatus.SERVICE_UNAVAILABLE)
    found = req.engine.asset(relative)
    if found is None:
        not_found("file")
    return 200, Raw(found[0], found[1])


GET: list[Route] = [
    route(r"/api/session", _session),
    route(r"/api/fonts", _fonts),
    route(r"/api/fonts/(?P<font>f[0-9a-f]{6})/file", _font_file),
    route(r"/api/formats", _formats),
    route(r"/api/brands", _brands),
    route(rf"/api/brands/(?P<brand>{_SLUG})/references/(?P<ref>{ID})/image", _reference_image),
    route(r"/api/projects", _projects),
    route(rf"/api/projects/(?P<project>{_SLUG})", _project),
    route(rf"/api/projects/(?P<project>{_SLUG})/models", _models),
    route(rf"/api/projects/(?P<project>{_SLUG})/quote", _quote),
    route(rf"/api/projects/(?P<project>{_SLUG})/assets/(?P<asset>{ID})/image", _asset_image),
    route(rf"/api/projects/(?P<project>{_SLUG})/deliveries/(?P<delivery>{_SLUG})", _delivery),
    route(
        rf"/api/projects/(?P<project>{_SLUG})/deliveries/(?P<delivery>{_SLUG})/files/(?P<name>{ID})",
        _delivery_file,
    ),
    route(
        rf"/api/projects/(?P<project>{_SLUG})/deliveries/(?P<delivery>{_SLUG})/zip", _delivery_zip
    ),
    route(r"/engine/(?P<path>.+)", _engine_file),
]
POST: list[Route] = [
    route(r"/api/fonts", _add_font, "font"),
    route(r"/api/brands", _create_brand, "json"),
    route(rf"/api/brands/(?P<brand>{_SLUG})/references", _add_reference, "upload"),
    route(r"/api/projects", _create_project, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})/runs", _start_run, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})/assets/from-run", _from_run, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})/assets/import", _import_image, "upload"),
    route(rf"/api/projects/(?P<project>{_SLUG})/assets/(?P<asset>{ID})/decision", _decide, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})/deliveries", _start_delivery, "json"),
    route(r"/api/keys", _set_key, "json"),
    route(r"/api/budget", _approve_budget, "json"),
]
PUT: list[Route] = [
    route(rf"/api/brands/(?P<brand>{_SLUG})", _update_brand, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})", _update_project, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})/brief", _set_brief, "json"),
    route(rf"/api/projects/(?P<project>{_SLUG})/design", _set_design, "json"),
]
DELETE: list[Route] = [
    route(rf"/api/brands/(?P<brand>{_SLUG})/references/(?P<ref>{ID})", _delete_reference),
    route(r"/api/keys/(?P<variable>[A-Z][A-Z0-9_]{0,63})", _forget_key),
]
