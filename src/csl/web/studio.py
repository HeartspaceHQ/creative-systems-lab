"""Storage for CSL Studio: brands, projects, images and deliveries, as plain files.

::

    <studio>/
      brands/<brand>.json
      brands/<brand>/refs/<ref>.png
      projects/<project>/project.json
      projects/<project>/assets/<asset>.png
      projects/<project>/deliveries/<delivery>/...
      budgets/<budget>.json            spending limits approved in the studio, newest last
      budgets/<budget>.ledger.jsonl

Every id that reaches this module from a URL or a body is checked against a strict pattern, and
every path is built one checked part at a time under the studio directory: a part that is not a
plain name, or that is a symbolic link, is refused. Writes are atomic (temp file, then rename).
All changes to a project run under one lock, so two requests never overwrite each other.
"""

from __future__ import annotations

import re
import secrets
import threading
import unicodedata
from contextlib import contextmanager
from datetime import UTC, datetime
from http import HTTPStatus
from typing import TYPE_CHECKING, TypeVar

from pydantic import BaseModel, ValidationError

from csl.budget import Approval, Budget
from csl.store import read_model, write_json
from csl.web.problems import ApiError, not_found, refuse
from csl.web.studio_models import (
    SLUG_RE,
    Asset,
    Brand,
    BrandInput,
    BriefInput,
    BudgetInput,
    Delivery,
    DeliveryInput,
    Design,
    Project,
    ProjectBrief,
    ProjectChange,
    ProjectInput,
    Reference,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from pathlib import Path

_M = TypeVar("_M", bound=BaseModel)
_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_FILE = re.compile(r"^[a-z0-9][a-z0-9-]*\.(png|mp4|gif|pdf)$")
_SLUG_LIMIT = 30
MAX_REFERENCES = 24
MAX_ID = 64


def _now() -> datetime:
    return datetime.now(UTC)


def slugify(name: str) -> str:
    """A lowercase ASCII slug of a name: accents dropped, other characters become dashes."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")[:_SLUG_LIMIT].strip("-")
    return slug or "untitled"


class Studio:
    """The studio directory and the rules for what may be written in it."""

    def __init__(self, root: Path) -> None:
        root.mkdir(parents=True, exist_ok=True)
        self.root = root.resolve()
        self._lock = threading.RLock()

    @contextmanager
    def locked(self) -> Iterator[None]:
        """Hold the studio lock: for changes that read a project and write it back."""
        with self._lock:
            yield

    # --- paths -----------------------------------------------------------------------------

    def _inside(self, *parts: str) -> Path:
        """``root/parts``, refusing a part that is not a plain name or is a symbolic link."""
        path = self.root
        for part in parts:
            if not _PART.match(part):
                not_found("address")
            path = path / part
            if path.is_symlink():
                not_found("address")
        return path

    def _load(self, path: Path, model: type[_M], what: str) -> _M:
        if not path.is_file():
            not_found(what)
        try:
            return read_model(path, model)
        except (OSError, ValueError, ValidationError) as error:
            msg = f"The saved {what} is damaged and cannot be opened."
            raise ApiError(msg, HTTPStatus.INTERNAL_SERVER_ERROR) from error

    def _new_id(self, name: str, exists: Callable[[str], bool]) -> str:
        slug = slugify(name)
        while exists(candidate := f"{slug}-{secrets.token_hex(2)}"):
            continue
        return candidate

    @staticmethod
    def check_id(value: str, what: str) -> str:
        """``value`` if it is a well-formed id, else a 404 for ``what``."""
        if not SLUG_RE.match(value) or len(value) > MAX_ID:
            not_found(what)
        return value

    # --- spending limit --------------------------------------------------------------------

    def saved_budget(self) -> Budget | None:
        """The newest spending limit approved in the studio, so it outlives a restart."""
        folder = self._inside("budgets")
        approvals = sorted(folder.glob("*.json")) if folder.is_dir() else []
        return Budget.load(approvals[-1]) if approvals else None

    def approve_budget(self, data: BudgetInput) -> Budget:
        """Write a new approval and return it as the budget. A new limit starts its own ledger."""
        now = _now()
        approval = Approval(
            id=f"studio-{now:%Y%m%d-%H%M%S}-{secrets.token_hex(2)}",
            approved_usd=data.approved_usd,
            approved_by=data.approved_by,
            approved_on=now.date(),
            note="Approved in CSL Studio",
        )
        path = self._inside("budgets", f"{approval.id}.json")
        write_json(path, approval)
        return Budget.load(path)

    # --- brands ----------------------------------------------------------------------------

    def _brand_path(self, brand_id: str) -> Path:
        return self._inside("brands", f"{self.check_id(brand_id, 'brand')}.json")

    def brand_refs_dir(self, brand_id: str) -> Path:
        """Where the brand's reference images live (may not exist yet)."""
        return self._inside("brands", self.check_id(brand_id, "brand"), "refs")

    def list_brands(self) -> list[Brand]:
        """Every brand, by name. A damaged file is skipped so it cannot hide the others."""
        brands: list[Brand] = []
        for path in sorted((self.root / "brands").glob("*.json")):
            try:
                brands.append(read_model(path, Brand))
            except (OSError, ValueError):
                continue
        return sorted(brands, key=lambda brand: brand.name.lower())

    def get_brand(self, brand_id: str) -> Brand:
        """One brand."""
        return self._load(self._brand_path(brand_id), Brand, "brand")

    def create_brand(self, data: BrandInput) -> Brand:
        """Save a new brand and return it."""
        with self._lock:
            brand_id = self._new_id(data.name, lambda c: self._brand_path(c).exists())
            brand = Brand(id=brand_id, updated_at=_now(), **dict(data))
            write_json(self._brand_path(brand_id), brand)
            return brand

    def update_brand(self, brand_id: str, data: BrandInput) -> Brand:
        """Replace a brand's name, colours, type and note; its references stay."""
        with self._lock:
            current = self.get_brand(brand_id)
            brand = Brand(
                id=brand_id, references=current.references, updated_at=_now(), **dict(data)
            )
            write_json(self._brand_path(brand_id), brand)
            return brand

    def add_reference(self, brand_id: str, name: str, png: bytes) -> Brand:
        """Keep an image (already clean PNG) as a visual reference of the brand."""
        with self._lock:
            brand = self.get_brand(brand_id)
            if len(brand.references) >= MAX_REFERENCES:
                refuse(f"A brand can keep up to {MAX_REFERENCES} reference images.")
            taken = {ref.id for ref in brand.references}
            ref_id = f"r{secrets.token_hex(3)}"
            while ref_id in taken:
                ref_id = f"r{secrets.token_hex(3)}"
            folder = self.brand_refs_dir(brand_id)
            folder.mkdir(parents=True, exist_ok=True)
            file = f"{ref_id}.png"
            (folder / file).write_bytes(png)
            updated = brand.model_copy(
                update={
                    "references": [*brand.references, Reference(id=ref_id, name=name, file=file)],
                    "updated_at": _now(),
                }
            )
            write_json(self._brand_path(brand_id), updated)
            return updated

    def delete_reference(self, brand_id: str, ref_id: str) -> Brand:
        """Forget a reference image and delete its file."""
        with self._lock:
            brand = self.get_brand(brand_id)
            kept = [ref for ref in brand.references if ref.id != ref_id]
            if len(kept) == len(brand.references):
                not_found("reference image")
            updated = brand.model_copy(update={"references": kept, "updated_at": _now()})
            write_json(self._brand_path(brand_id), updated)
            (self.brand_refs_dir(brand_id) / f"{ref_id}.png").unlink(missing_ok=True)
            return updated

    def reference_file(self, brand_id: str, ref_id: str) -> Path:
        """The file of one reference image of the brand."""
        brand = self.get_brand(brand_id)
        ref = next((r for r in brand.references if r.id == ref_id), None)
        if ref is None:
            not_found("reference image")
        path = self._inside("brands", brand_id, "refs", ref.file)
        if not path.is_file():
            not_found("reference image")
        return path

    # --- projects --------------------------------------------------------------------------

    def _project_dir(self, project_id: str) -> Path:
        return self._inside("projects", self.check_id(project_id, "project"))

    def _project_path(self, project_id: str) -> Path:
        return self._inside("projects", self.check_id(project_id, "project"), "project.json")

    def list_projects(self) -> list[Project]:
        """Every project, most recently changed first."""
        projects: list[Project] = []
        for path in (self.root / "projects").glob("*/project.json"):
            try:
                projects.append(read_model(path, Project))
            except (OSError, ValueError):
                continue
        return sorted(projects, key=lambda project: project.updated_at, reverse=True)

    def get_project(self, project_id: str) -> Project:
        """One project."""
        return self._load(self._project_path(project_id), Project, "project")

    def _save(self, project: Project) -> Project:
        stamped = project.model_copy(update={"updated_at": _now()})
        write_json(self._project_path(project.id), stamped)
        return stamped

    def edit(self, project_id: str, change: Callable[[Project], Project]) -> Project:
        """Apply ``change`` to a project under the studio lock and save the result."""
        with self._lock:
            return self._save(change(self.get_project(project_id)))

    def _require_brand(self, brand_id: str) -> None:
        try:
            self.get_brand(brand_id)
        except ApiError as error:
            if error.status != HTTPStatus.NOT_FOUND:
                raise
            refuse("Choose a brand that exists.", fields={"brand": "That brand does not exist"})

    def create_project(self, data: ProjectInput) -> Project:
        """Start a project for a brand."""
        with self._lock:
            self._require_brand(data.brand)
            project_id = self._new_id(data.name, lambda c: self._project_path(c).exists())
            now = _now()
            project = Project(
                id=project_id, name=data.name, brand=data.brand, created_at=now, updated_at=now
            )
            write_json(self._project_path(project_id), project)
            return project

    def update_project(self, project_id: str, data: ProjectChange) -> Project:
        """Rename a project or move it to another brand."""
        with self._lock:
            if data.brand is not None:
                self._require_brand(data.brand)
            return self.edit(
                project_id,
                lambda p: p.model_copy(
                    update={
                        "name": data.name if data.name is not None else p.name,
                        "brand": data.brand if data.brand is not None else p.brand,
                    }
                ),
            )

    def set_brief(self, project_id: str, data: BriefInput) -> Project:
        """Replace the project's brief."""
        brief = ProjectBrief(**dict(data))
        return self.edit(project_id, lambda p: p.model_copy(update={"brief": brief}))

    def add_run(self, project_id: str, run_id: str) -> Project:
        """Record a finished generation run on the project."""

        def append(project: Project) -> Project:
            if run_id in project.runs:
                return project
            return project.model_copy(update={"runs": [*project.runs, run_id]})

        return self.edit(project_id, append)

    # --- images ----------------------------------------------------------------------------

    def assets_dir(self, project_id: str) -> Path:
        """The folder of the project's images (may not exist yet)."""
        return self._inside("projects", self.check_id(project_id, "project"), "assets")

    def new_asset_id(self, project: Project) -> str:
        """An unused image id."""
        taken = {asset.id for asset in project.assets}
        while (asset_id := f"a{secrets.token_hex(3)}") in taken:
            continue
        return asset_id

    def asset_file(self, project_id: str, asset_id: str) -> Path:
        """The PNG of one image of the project."""
        project = self.get_project(project_id)
        if not any(asset.id == asset_id for asset in project.assets):
            not_found("image")
        path = self._inside("projects", project_id, "assets", f"{asset_id}.png")
        if not path.is_file():
            not_found("image")
        return path

    def set_asset(self, project_id: str, asset: Asset) -> Project:
        """Add an image to the project, or replace the one with the same id."""

        def put(project: Project) -> Project:
            others = [a for a in project.assets if a.id != asset.id]
            return project.model_copy(update={"assets": [*others, asset]})

        return self.edit(project_id, put)

    # --- design ----------------------------------------------------------------------------

    def set_design(self, project_id: str, design: Design) -> Project:
        """Save the design, if it uses an approved image of this project."""
        with self._lock:
            project = self.get_project(project_id)
            asset = next((a for a in project.assets if a.id == design.asset), None)
            if asset is None or asset.status != "approved":
                refuse(
                    "Only an approved image can go into the design.",
                    fields={"asset": "Choose an approved image"},
                )
            return self._save(project.model_copy(update={"design": design}))

    # --- deliveries ------------------------------------------------------------------------

    def delivery_dir(self, project_id: str, delivery_id: str) -> Path:
        """The engine project folder of one delivery."""
        self.get_project(project_id)
        return self._inside(
            "projects", project_id, "deliveries", self.check_id(delivery_id, "delivery")
        )

    def get_delivery(self, project_id: str, delivery_id: str) -> Delivery:
        """One delivery of a project."""
        project = self.get_project(project_id)
        found = next((d for d in project.deliveries if d.id == delivery_id), None)
        if found is None:
            not_found("delivery")
        return found

    def new_delivery(self, project_id: str, data: DeliveryInput) -> tuple[Project, Delivery]:
        """Record a delivery as running. Needs a design whose image is still approved."""
        with self._lock:
            project = self.get_project(project_id)
            design = project.design
            asset = next((a for a in project.assets if design and a.id == design.asset), None)
            if design is None or asset is None or asset.status != "approved":
                refuse("Choose an approved image and save the design before delivering.")
            number = 1 + max((int(d.id[1:]) for d in project.deliveries), default=0)
            delivery = Delivery(
                id=f"d{number}",
                created_at=_now(),
                state="running",
                formats=list(dict.fromkeys(data.formats)),
                extras=list(dict.fromkeys(data.extras)),
            )
            saved = self._save(
                project.model_copy(update={"deliveries": [*project.deliveries, delivery]})
            )
            return saved, delivery

    def update_delivery(self, project_id: str, delivery: Delivery) -> None:
        """Replace a delivery's record (state, outputs, checks)."""

        def put(project: Project) -> Project:
            return project.model_copy(
                update={
                    "deliveries": [
                        delivery if d.id == delivery.id else d for d in project.deliveries
                    ]
                }
            )

        self.edit(project_id, put)

    def fail_unfinished_deliveries(self) -> None:
        """After a restart no delivery can still be running: mark the leftovers failed."""
        for project in self.list_projects():
            if not any(d.state == "running" for d in project.deliveries):
                continue
            for delivery in project.deliveries:
                if delivery.state == "running":
                    msg = "The server was stopped before this delivery finished. Deliver again."
                    self.update_delivery(
                        project.id, delivery.model_copy(update={"state": "failed", "error": msg})
                    )

    def delivery_file(self, project_id: str, delivery_id: str, name: str) -> Path:
        """One finished file of a delivery; only names the delivery lists are served."""
        delivery = self.get_delivery(project_id, delivery_id)
        if not _FILE.match(name) or name not in {o.name for o in delivery.outputs}:
            not_found("file")
        path = self._inside("projects", project_id, "deliveries", delivery_id, "files", name)
        if not path.is_file():
            not_found("file")
        return path

    # --- what the browser sees -------------------------------------------------------------

    def brand_json(self, brand: Brand) -> dict[str, object]:
        """A brand as the API shows it: references with a URL instead of a file name."""
        data = brand.model_dump(mode="json")
        data["references"] = [
            {
                "id": ref.id,
                "name": ref.name,
                "url": f"/api/brands/{brand.id}/references/{ref.id}/image",
            }
            for ref in brand.references
        ]
        return data

    def project_json(self, project: Project) -> dict[str, object]:
        """A project as the API shows it: images and files with their URLs."""
        data = project.model_dump(mode="json")
        base = f"/api/projects/{project.id}"
        for asset in data["assets"]:
            asset["url"] = f"{base}/assets/{asset['id']}/image"
        for delivery in data["deliveries"]:
            for output in delivery["outputs"]:
                output["url"] = f"{base}/deliveries/{delivery['id']}/files/{output['name']}"
        return data

    def asset_json(self, project_id: str, asset: Asset) -> dict[str, object]:
        """An image as the API shows it, with its URL."""
        data = asset.model_dump(mode="json")
        data["url"] = f"/api/projects/{project_id}/assets/{asset.id}/image"
        return data

    def delivery_json(self, project_id: str, delivery: Delivery) -> dict[str, object]:
        """A delivery as the API shows it."""
        return next(
            d
            for d in self.project_json(self.get_project(project_id))["deliveries"]  # type: ignore[attr-defined]
            if d["id"] == delivery.id
        )

    def summary(self, project: Project) -> dict[str, object]:
        """One row of the project list."""
        approved = [a for a in project.assets if a.status == "approved"]
        used = project.design.asset if project.design else None
        cover = next((a for a in approved if a.id == used), approved[0] if approved else None)
        return {
            "id": project.id,
            "name": project.name,
            "brand": project.brand,
            "updated_at": project.updated_at.isoformat(),
            "cover_url": f"/api/projects/{project.id}/assets/{cover.id}/image" if cover else None,
        }
