"""Deliveries: the studio's design rendered into files by the Node engine, in the background.

A delivery is an engine project of its own: ``deliveries/<d>/assets/<image>.png`` (a verified copy
of the approved image) and ``source.json`` (brand, design, image, sizes, extras). The engine's
``studio-render.ts`` renders it; this module reads the engine's report, keeps the files as
``files/<size>.<ext>`` and turns the engine's checks into sentences a designer can act on. A
delivery whose checks fail is still done: the files exist and the failures are listed.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import threading
import zipfile
from http import HTTPStatus
from typing import TYPE_CHECKING, cast

from PIL import Image

from csl import keys
from csl.canonical import sha256_file
from csl.store import write_json
from csl.web.engine import RENDER_SCRIPT, Engine, EngineError, clean_environment
from csl.web.problems import ApiError, refuse
from csl.web.studio_models import (
    FORMATS,
    Delivery,
    DeliveryCheck,
    DeliveryInput,
    Output,
    OutputKind,
    headline_lines,
)

if TYPE_CHECKING:
    from pathlib import Path

    from csl.web.fonts import FontLibrary
    from csl.web.studio import Studio
    from csl.web.studio_models import Asset, Brand, Project

logger = logging.getLogger(__name__)

RENDER_TIMEOUT_S = 600
_ENGINE_PREFIX = "design-"
_OUTPUT = re.compile(r"^design-(?P<format>[a-z0-9-]+)\.(?P<ext>png|mp4|gif|pdf)$")
_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]")
_FORMAT_SIZES: dict[str, tuple[int, int]] = {
    spec.key: (spec.width, spec.height) for spec in FORMATS
}
_FORMAT_LABELS: dict[str, str] = {spec.key: spec.label for spec in FORMATS}
_TEXTS = {
    "kicker": "Label",
    "headline": "Headline",
    "deck": "Body text",
    "cta": "Call to action",
    "steep": "Steeping time",
    "wordmark": "Sender name",
}
_COLOUR_ROLES = {
    "text": "Text",
    "quiet": "Secondary text",
    "line": "Lines",
    "accent": "The accent colour",
}
_CHECK_SENTENCES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^colours are #rrggbb$"), "The brand colours are valid colours"),
    (
        re.compile(r"^contrast \w+\.(?P<role>\w+)/ground$"),
        "{role} is readable against the background",
    ),
    (
        re.compile(r"^type roles distinct$"),
        "The headline and the body text use two different fonts",
    ),
    (re.compile(r"^(?P<text>\w+) fits its line$"), "{text} fits on its line"),
    (re.compile(r"^(?P<text>\w+) inside safe area$"), "{text} stays inside the safe margins"),
    (re.compile(r"^(?P<text>\w+) clear of image$"), "{text} stays clear of the photograph"),
    (re.compile(r"^(?P<text>\w+) legible on stage$"), "{text} stays readable over the image"),
    (re.compile(r"^type scale display/body$"), "The headline is clearly larger than the body text"),
    (re.compile(r"^font loaded: (?P<family>.+)$"), "The font {family} is available"),
    (re.compile(r"^asset approved for render$"), "The image is approved for use"),
    (re.compile(r"^asset hash matches manifest$"), "The image is exactly the approved file"),
    (re.compile(r"^asset directed for (?P<size>\w+)$"), "The image suits the {size} size"),
    (re.compile(r"^campaign references resolve$"), "Every file the design needs is present"),
    (re.compile(r"^same bytes twice at .+$"), "Rendering again gives exactly the same result"),
    (re.compile(r"^warmth rises \w+$"), "The light warms up as the film plays"),
    (re.compile(r"^.+\.pdf embeds (?P<family>.+)$"), "The PDF keeps {family} as real text"),
)
_FAILURE_HINTS: tuple[tuple[str, str], ...] = (
    (
        "Executable doesn't exist",
        (
            "The browser used for rendering is not installed. "
            "Run `npx playwright install chromium` in the engine folder."
        ),
    ),
    ("ffmpeg", "ffmpeg is needed for film and GIF but could not be started. Install it first."),
    ("pdffonts", "pdffonts (from poppler) is needed to check the PDF but could not be started."),
    ("hash differs", "The image no longer matches the one that was approved. Approve it again."),
)


def plain_check(name: str) -> str:
    """The engine's name of a check as a sentence for a designer."""
    for pattern, sentence in _CHECK_SENTENCES:
        match = pattern.match(name)
        if match is None:
            continue
        found = match.groupdict()
        text = found.get("text", "")
        values = {
            "role": _COLOUR_ROLES.get(found.get("role", ""), "This colour"),
            "text": _TEXTS.get(text, text.capitalize()),
            "family": found.get("family", ""),
            "size": found.get("size", ""),
        }
        return sentence.format(**values)
    return name[:1].upper() + name[1:]


def safe_filename(name: str) -> str:
    """A file name safe for a ``Content-Disposition`` header: plain characters only."""
    return _UNSAFE_NAME.sub("-", name).strip(".-")[:80] or "file"


def _format_label(format_key: str) -> str:
    return _FORMAT_LABELS.get(format_key, format_key)


def translate_checks(report: dict[str, object]) -> list[DeliveryCheck]:
    """Every check of the engine's report, in plain words; per-size checks name their size."""
    groups = report.get("checks")
    if not isinstance(groups, dict):
        return []
    checks: list[DeliveryCheck] = []
    for group, items in groups.items():
        size = (
            str(group).removeprefix(_ENGINE_PREFIX) if str(group).startswith(_ENGINE_PREFIX) else ""
        )
        suffix = f" ({_format_label(size)})" if size in _FORMAT_LABELS else ""
        checks.extend(
            DeliveryCheck(
                name=plain_check(str(item["name"])) + suffix,
                passed=bool(item["passed"]),
                detail=str(item.get("detail", "")),
            )
            for item in (items if isinstance(items, list) else [])
        )
    return checks


def explain_failure(stderr: str, failed_checks: list[DeliveryCheck]) -> str:
    """What went wrong with a render that produced nothing, in a few plain sentences."""
    lines = [line.strip() for line in stderr.strip().splitlines() if line.strip()]
    first = next(
        (line.removeprefix("studio-render:").strip() for line in lines if "studio-render:" in line),
        lines[-1] if lines else "",
    )
    for needle, sentence in _FAILURE_HINTS:
        if needle in stderr:
            return sentence
    if failed_checks:
        listed = "; ".join(check.name for check in failed_checks[:5])
        hint = (
            " Make the text colours darker or the background lighter in the brand colours."
            if any("readable" in check.name for check in failed_checks)
            else " Adjust the design and try again."
        )
        return f"No files were made because the design did not pass these checks: {listed}.{hint}"
    summary = (
        f"The design could not be rendered: {first[:240]}"
        if first
        else "The renderer stopped before it finished."
    )
    return keys.redact(summary)


def _source_json(
    project: Project, brand: dict[str, object], asset: Asset, d: Delivery
) -> dict[str, object]:
    """The input of ``studio-render.ts``: brand, design, image and the delivery's sizes."""
    design = project.design
    if design is None or asset.decision is None:
        refuse("Save the design before delivering.")
    image: dict[str, object] = {
        "path": f"assets/{asset.id}.png",
        "sha256": asset.sha256,
        "approved_by": asset.decision.reviewer,
    }
    provenance = {
        "run_id": asset.source.run_id,
        "candidate_id": asset.source.candidate_id,
        "recipe_hash": asset.source.recipe_hash,
        "model": asset.source.model,
        "licence": asset.source.licence,
    }
    image.update({key: value for key, value in provenance.items() if value})
    return {
        "brand": {key: brand[key] for key in ("name", "colours", "type")},
        "design": design.model_dump(mode="json"),
        "asset": image,
        "formats": d.formats,
        "extras": d.extras,
    }


def _kind(extension: str) -> OutputKind:
    return cast("OutputKind", extension)


class DeliveryRunner:
    """Starts deliveries and runs each in its own thread; one at a time, as Chromium is heavy."""

    def __init__(
        self, studio: Studio, engine: Engine, fonts: FontLibrary, timeout_s: float | None = None
    ) -> None:
        self._studio = studio
        self._engine = engine
        self._fonts = fonts
        self._timeout_s = RENDER_TIMEOUT_S if timeout_s is None else timeout_s
        self._active: set[tuple[str, str]] = set()
        self._lock = threading.Lock()

    def start(self, project_id: str, data: DeliveryInput) -> Delivery:
        """Record a delivery as running and render it in the background."""
        try:
            self._engine.require()
        except EngineError as error:
            raise ApiError(str(error), HTTPStatus.SERVICE_UNAVAILABLE) from error
        project = self._studio.get_project(project_id)
        if project.design is None or not headline_lines(project.design.words.headline):
            refuse(
                "Write a headline in the design before delivering.",
                fields={"design.copy.headline": "Write a headline"},
            )
        # The design and brand are read once, here: later edits do not reach a started delivery.
        brand = self._studio.get_brand(project.brand)
        with self._lock:
            if self._active:
                refuse("Another delivery is still rendering. Wait for it to finish.", 409)
            _, delivery = self._studio.new_delivery(project_id, data)
            self._active.add((project_id, delivery.id))
        threading.Thread(
            target=self._work,
            args=(project, brand, delivery),
            name=f"delivery-{delivery.id}",
            daemon=True,
        ).start()
        return delivery

    def wait_idle(self, timeout_s: float = 30) -> bool:
        """Block until no delivery is rendering (for tests and shutdown)."""
        done = threading.Event()

        def poll() -> None:
            while self._active:
                done.wait(0.05)
            done.set()

        thread = threading.Thread(target=poll, daemon=True)
        thread.start()
        thread.join(timeout_s)
        return not self._active

    def _work(self, project: Project, brand: Brand, delivery: Delivery) -> None:
        project_id = project.id
        result = delivery.model_copy(
            update={"state": "failed", "error": "Something went wrong while rendering."}
        )
        try:
            result = self._render(project, brand, delivery)
        except ApiError as error:
            result = delivery.model_copy(update={"state": "failed", "error": error.message})
        except Exception as error:
            # Any failure must end the delivery, or it would stay "running" for ever.
            logger.warning("delivery %s failed: %s", delivery.id, keys.redact(str(error)))
            logger.debug("traceback of delivery %s", delivery.id, exc_info=True)
        finally:
            try:
                self._studio.update_delivery(project_id, result)
            finally:
                with self._lock:
                    self._active.discard((project_id, delivery.id))

    def _render(self, project: Project, brand: Brand, delivery: Delivery) -> Delivery:
        """Render the design and brand as they were when the delivery started."""
        studio = self._studio
        design = project.design
        asset = next((a for a in project.assets if design and a.id == design.asset), None)
        if design is None or asset is None or asset.status != "approved":
            refuse("The image of the design is no longer approved.")
        folder = studio.delivery_dir(project.id, delivery.id)
        self._prepare(project, brand, asset, folder, delivery)
        stderr = self._run_engine(folder)
        report_path = folder / "out" / "studio" / "report.json"
        report = _read_report(report_path)
        checks = translate_checks(report) if report else []
        if report is None:
            refuse(explain_failure(stderr, []))
        outputs = self._collect(report, folder, delivery)
        if outputs is None:
            refuse(explain_failure(stderr, [c for c in checks if not c.passed]))
        return delivery.model_copy(update={"state": "done", "outputs": outputs, "checks": checks})

    def _prepare(
        self, project: Project, saved: Brand, asset: Asset, folder: Path, delivery: Delivery
    ) -> None:
        """Write the engine project: the verified image copy, uploaded fonts and ``source.json``."""
        source_png = self._studio.asset_file(project.id, asset.id)
        if sha256_file(source_png) != asset.sha256:
            refuse("The image file has changed since it was approved. Import and approve it again.")
        brand = self._studio.brand_json(saved)
        target = folder / "assets" / f"{asset.id}.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_png, target)
        source = _source_json(project, brand, asset, delivery)
        source["fonts"] = self._fonts.for_delivery((saved.type.display, saved.type.body), folder)
        write_json(folder / "source.json", source)

    def _run_engine(self, folder: Path) -> str:
        """Run ``studio-render.ts`` for the folder; returns what it wrote to stderr."""
        node = self._engine.require()
        environment = {**clean_environment(), "CSL_PROJECT": str(folder)}
        process = subprocess.Popen(
            [node, str(self._engine.directory / RENDER_SCRIPT)],
            cwd=self._engine.directory,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        try:
            _, stderr = process.communicate(timeout=self._timeout_s)
        except subprocess.TimeoutExpired:
            _kill_group(process)
            process.communicate()
            minutes = round(self._timeout_s / 60)
            refuse(f"The render took longer than {minutes} minutes and was stopped.")
        return stderr or ""

    def _collect(
        self, report: dict[str, object], folder: Path, delivery: Delivery
    ) -> list[Output] | None:
        """Move the engine's files to ``files/<size>.<ext>``; None if one is missing or altered."""
        listed = report.get("outputs")
        if not isinstance(listed, dict):
            return None
        files = folder / "files"
        files.mkdir(parents=True, exist_ok=True)
        outputs: list[Output] = []
        for engine_name, digest in sorted(listed.items()):
            match = _OUTPUT.match(engine_name)
            if match is None or match["format"] not in delivery.formats:
                continue
            if match["ext"] != "png" and match["ext"] not in delivery.extras:
                # One film run makes the video and the animation; deliver only what was chosen.
                continue
            produced = folder / "out" / "studio" / engine_name
            if not produced.is_file() or produced.is_symlink() or sha256_file(produced) != digest:
                return None
            name = f"{match['format']}.{match['ext']}"
            produced.replace(files / name)
            outputs.append(_output(files / name, name, match["format"], _kind(match["ext"])))
        wanted = {f"{key}.png" for key in delivery.formats}
        return outputs if wanted <= {o.name for o in outputs} else None


def _output(path: Path, name: str, format_key: str, kind: OutputKind) -> Output:
    width, height = _FORMAT_SIZES[format_key]
    if kind == "gif":
        with Image.open(path) as picture:
            width, height = picture.size
    return Output(
        name=name,
        kind=kind,
        format=format_key,
        width=width,
        height=height,
        bytes=path.stat().st_size,
    )


def _read_report(path: Path) -> dict[str, object] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _kill_group(process: subprocess.Popen[str]) -> None:
    """Stop the renderer and the browser and encoder it started."""
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()


def zip_delivery(studio: Studio, project_id: str, delivery_id: str) -> bytes:
    """All files of a finished delivery as one zip. Names come only from the delivery's own list."""
    delivery = studio.get_delivery(project_id, delivery_id)
    if delivery.state != "done" or not delivery.outputs:
        refuse("This delivery has no files to download.", HTTPStatus.NOT_FOUND)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for output in delivery.outputs:
            path = studio.delivery_file(project_id, delivery_id, output.name)
            info = zipfile.ZipInfo(output.name, date_time=(2020, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            archive.writestr(info, path.read_bytes())
    return buffer.getvalue()
