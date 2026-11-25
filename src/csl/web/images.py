"""The images of a project: approved candidates from a run, imported files, and decisions.

A generated image enters a project only through its run's sealed decision log: the latest
decision of the candidate must be an approval, the run must be intact and the model licence
must allow the brief's use (the same checks as ``csl export``). An imported image starts
pending and is approved by a person who confirms the right to use it.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from http import HTTPStatus
from typing import TYPE_CHECKING

from PIL import Image

from csl import export, integrity, registry
from csl.web.problems import not_found, refuse
from csl.web.studio_models import Asset, AssetDecision, AssetSource, DecisionInput
from csl.web.workspace import NotFoundError

if TYPE_CHECKING:
    from csl.web.studio import Studio
    from csl.web.studio_models import Project
    from csl.web.uploads import CleanImage
    from csl.web.workspace import Workspace


def asset_from_run(
    studio: Studio, workspace: Workspace, project_id: str, run_id: str, candidate_id: str
) -> tuple[Asset, bool]:
    """Copy an approved candidate into the project; returns the asset and whether it is new."""
    try:
        store = workspace.run_store(run_id)
    except NotFoundError:
        not_found("run")
    try:
        view = store.candidate(candidate_id)
    except KeyError:
        refuse("That image is not part of this run.", HTTPStatus.NOT_FOUND)
    decision = store.latest_decisions().get(candidate_id)
    if decision is None or decision.verdict != "approve":
        refuse("Approve this image in its run before using it in a design.")
    try:
        integrity.require_intact(store)
        export.require_exportable(view, store.brief())
    except (integrity.IntegrityError, export.ExportError) as error:
        refuse(f"This image cannot be used: {error}")
    with studio.locked():
        project = studio.get_project(project_id)
        for existing in project.assets:
            if (existing.source.run_id, existing.source.candidate_id) == (run_id, candidate_id):
                return existing, False
        recipe = view.manifest.recipe
        entry = registry.get(recipe.pin.backend)
        with Image.open(view.image) as picture:
            width, height = picture.size
        asset_id = studio.new_asset_id(project)
        target = studio.assets_dir(project_id) / f"{asset_id}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = export.write_with_provenance(
            view.image, target, export.candidate_provenance(view, decision)
        )
        asset = Asset(
            id=asset_id,
            width=width,
            height=height,
            sha256=digest,
            origin="generated",
            source=AssetSource(
                run_id=run_id,
                candidate_id=candidate_id,
                model=recipe.pin.backend,
                model_id=recipe.pin.model_id,
                recipe_hash=view.manifest.recipe_hash,
                licence=entry.licence,
            ),
            status="approved",
            decision=AssetDecision(
                verdict="approve",
                reviewer=decision.reviewer,
                note=decision.note,
                decided_at=decision.decided_at,
                rights_confirmed=True,
            ),
            created_at=datetime.now(UTC),
        )
        studio.set_asset(project_id, asset)
        return asset, True


def import_asset(studio: Studio, project_id: str, image: CleanImage, file_name: str) -> Asset:
    """Add an uploaded image (already decoded and re-encoded) as a pending asset."""
    with studio.locked():
        project = studio.get_project(project_id)
        asset_id = studio.new_asset_id(project)
        target = studio.assets_dir(project_id) / f"{asset_id}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(image.png)
        asset = Asset(
            id=asset_id,
            width=image.width,
            height=image.height,
            sha256=hashlib.sha256(image.png).hexdigest(),
            origin="imported",
            source=AssetSource(file_name=file_name),
            status="pending",
            created_at=datetime.now(UTC),
        )
        studio.set_asset(project_id, asset)
        return asset


def decide_asset(studio: Studio, project_id: str, asset_id: str, decision: DecisionInput) -> Asset:
    """Approve or reject an image.

    Approving an imported image needs the reviewer's confirmation of the rights. A generated
    image's rights come from its model's licence, so they stay confirmed.
    """
    with studio.locked():
        current = _find(studio.get_project(project_id), asset_id)
        imported = current.origin == "imported"
        if decision.verdict == "approve" and imported and not decision.rights_confirmed:
            refuse(
                "Confirm that you have the right to use this image.",
                fields={"rights_confirmed": "Confirm that you have the right to use this image"},
            )
        decided = current.model_copy(
            update={
                "status": "approved" if decision.verdict == "approve" else "rejected",
                "decision": AssetDecision(
                    verdict=decision.verdict,
                    reviewer=decision.reviewer,
                    note=decision.note,
                    decided_at=datetime.now(UTC),
                    rights_confirmed=decision.rights_confirmed or not imported,
                ),
            }
        )
        studio.set_asset(project_id, decided)
        return decided


def _find(project: Project, asset_id: str) -> Asset:
    return next((a for a in project.assets if a.id == asset_id), None) or not_found("image")
