"""The Node rendering engine (``poc/composition``) as the studio uses it.

Two jobs: at server start, ``studio-assets.ts`` writes the files of the live preview into a
temporary folder, which ``/engine/*`` serves read-only; and ``Engine.require`` says whether
deliveries can be rendered, with a reason a designer can act on when they cannot. Missing Node
or a missing engine never stops the studio: only the preview and deliveries answer with the reason.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from csl import keys

MIN_NODE = 24
ASSETS_TIMEOUT_S = 60
SERVED_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".ts": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
}
RENDER_SCRIPT = "src/studio-render.ts"
ASSETS_SCRIPT = "src/studio-assets.ts"
_NODE_VERSION = re.compile(r"^v(\d+)\.")


class EngineError(Exception):
    """Rendering cannot start; the message says why in plain words."""


def default_engine_dir() -> Path:
    """``poc/composition`` of the working directory, else of the repository this package is in."""
    here = Path.cwd() / "poc" / "composition"
    return here if here.is_dir() else Path(__file__).resolve().parents[3] / "poc" / "composition"


def clean_environment() -> dict[str, str]:
    """This process's environment without provider keys: the renderer never needs them."""
    secret = set(keys.provider_variables())
    return {name: value for name, value in os.environ.items() if name not in secret}


class Engine:
    """Where the engine is, whether Node can run it, and the preview files it wrote."""

    def __init__(self, directory: Path | None = None) -> None:
        self.directory = (directory or default_engine_dir()).resolve()
        self.node = shutil.which("node")
        self.problem = self._problem()
        self._temp: tempfile.TemporaryDirectory[str] | None = None
        self._files: dict[str, Path] = {}
        self.preview_problem: str | None = self.problem or "The live preview has not been prepared."

    def _problem(self) -> str | None:
        if not (self.directory / RENDER_SCRIPT).is_file():
            return (
                f"The rendering engine was not found in {self.directory}. "
                "Start the server with --engine <folder of poc/composition>."
            )
        if not (self.directory / "node_modules").is_dir():
            return (
                "The rendering engine's packages are not installed. "
                f"Run `npm ci` in {self.directory} and start the server again."
            )
        if self.node is None:
            return f"Node.js {MIN_NODE} or newer is needed for this, but `node` was not found."
        found = self._node_version()
        if found is None or found < MIN_NODE:
            seen = f"v{found}" if found else "an unknown version"
            return f"Node.js {MIN_NODE} or newer is needed for this, found {seen}."
        return None

    def _node_version(self) -> int | None:
        try:
            result = subprocess.run(
                [str(self.node), "--version"],
                capture_output=True,
                text=True,
                timeout=ASSETS_TIMEOUT_S,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        match = _NODE_VERSION.match(result.stdout.strip())
        return int(match[1]) if match else None

    def require(self) -> str:
        """The path of ``node``, or ``EngineError`` saying why rendering cannot run."""
        if self.problem is not None or self.node is None:
            raise EngineError(self.problem)
        return self.node

    def prepare_preview(self) -> None:
        """Write the preview files once; on any failure the preview answers 503 with the reason."""
        if self.problem is not None or self.node is None:
            return
        self._temp = tempfile.TemporaryDirectory(prefix="csl-engine-")
        out = Path(self._temp.name)
        try:
            result = subprocess.run(
                [self.node, str(self.directory / ASSETS_SCRIPT), str(out)],
                cwd=self.directory,
                env=clean_environment(),
                capture_output=True,
                text=True,
                timeout=ASSETS_TIMEOUT_S,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as error:
            self.preview_problem = f"The live preview could not be prepared: {error}"
            return
        if result.returncode != 0:
            tail = " ".join(result.stderr.strip().splitlines()[-2:])
            self.preview_problem = f"The live preview could not be prepared: {tail}".strip()
            return
        self._files = {
            path.relative_to(out).as_posix(): path
            for path in sorted(out.rglob("*"))
            if path.is_file() and not path.is_symlink() and path.suffix in SERVED_TYPES
        }
        self.preview_problem = None if self._files else "The live preview has no files to show."

    def asset(self, relative: str) -> tuple[bytes, str] | None:
        """One preview file and its type, or None. Only files written at start are served."""
        path = self._files.get(relative)
        if path is None:
            return None
        return path.read_bytes(), SERVED_TYPES[path.suffix]

    def close(self) -> None:
        """Delete the preview files."""
        if self._temp is not None:
            self._temp.cleanup()
            self._temp = None
