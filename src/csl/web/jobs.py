"""Background generation jobs, so the UI can start a run and poll instead of blocking."""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING

from csl import keys, pipeline, registry, report
from csl.schema import BrandContext, Brief
from csl.store import read_model

if TYPE_CHECKING:
    from collections.abc import Callable
    from pathlib import Path

    from csl.budget import Budget
    from csl.web.workspace import Workspace


logger = logging.getLogger(__name__)


class JobBusyError(RuntimeError):
    """Another generation job is still running."""


@dataclass
class Job:
    """State of one generation job."""

    id: str
    state: str = "running"
    run_id: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class RunRequest:
    """Everything one generation needs: the inputs are in memory, no brief or brand file.

    ``on_done`` is called with the run id after a successful run, before the job reports done.
    """

    brief: Brief
    brand: BrandContext
    models: tuple[str, ...]
    reference_dir: Path | None
    on_done: Callable[[str], None] | None = None


class JobRunner:
    """Runs ``pipeline.run`` in a thread. One job at a time: local models are memory bound."""

    def __init__(self, workspace: Workspace, runs_dir: Path, budget: Budget | None = None) -> None:
        self._workspace = workspace
        self._runs_dir = runs_dir
        self.budget = budget
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def start(self, brief_file: str, models: tuple[str, ...], candidates: int | None) -> Job:
        """Start a job from a brief file of the workspace and its brand."""
        brief = read_model(self._workspace.brief_path(brief_file), Brief)
        if candidates is not None:
            brief = brief.with_candidates(candidates)
        brand = self._workspace.brand_context()
        return self.submit(RunRequest(brief, brand, models, self._reference_dir(brand)))

    def submit(self, request: RunRequest) -> Job:
        """Start a job, or raise ``JobBusyError`` if one is already running.

        A requested model that cannot serve the brief is refused with its reason, and the
        budget is checked here, before a job exists, so the UI gets the reason as an answer and
        not a failed job; ``pipeline.run`` checks again with the same rules before any call.
        """
        selection = registry.select(request.brief, request.models)
        if request.models and selection.excluded:
            msg = "; ".join(f"{key}: {why}" for key, why in selection.excluded)
            raise ValueError(msg)
        if not selection.chosen:
            msg = "no model can serve this brief"
            raise ValueError(msg)
        pipeline.check_budget(selection, request.brief, self.budget)
        with self._lock:
            if any(job.state == "running" for job in self._jobs.values()):
                msg = "a generation job is already running"
                raise JobBusyError(msg)
            job = Job(id=uuid.uuid4().hex[:12])
            self._jobs[job.id] = job
        threading.Thread(target=self._work, args=(job, request), daemon=True).start()
        return job

    def get(self, job_id: str) -> Job:
        """Look up a job by id."""
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return self._jobs[job_id]

    def _work(self, job: Job, request: RunRequest) -> None:
        state = "failed"
        try:
            store = pipeline.run(
                request.brief,
                request.brand,
                self._runs_dir,
                request.models,
                request.reference_dir,
                budget=self.budget,
            )
            report.write_report(store)
            if request.on_done is not None:
                request.on_done(store.root.name)
            job.run_id = store.root.name
            state = "done"
        except Exception as error:
            # Any failure must end the job, or "running" would block every later job.
            job.error = keys.redact(str(error).strip("'\"")) or type(error).__name__
            # The text is redacted; a traceback is not, so it is only kept at debug level.
            logger.warning("generation job %s failed: %s", job.id, job.error)
            logger.debug("traceback of job %s", job.id, exc_info=True)
        finally:
            job.state = state

    def _reference_dir(self, brand: BrandContext) -> Path | None:
        """The brand's own reference directory when it names one, else the workspace's."""
        if brand.reference_dir is not None and self._workspace.brand is not None:
            return self._workspace.brand.parent / brand.reference_dir
        return self._workspace.references
