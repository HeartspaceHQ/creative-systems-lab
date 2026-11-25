"""FLUX.2 Klein on Apple Silicon through the ``mflux-generate-flux2`` command line tool.

The backend shells out instead of importing mflux, for two reasons: mflux pulls in MLX and is
heavy, and a subprocess boundary means a crash or a memory spike cannot take the pipeline
down. The tool is found through ``CSL_MFLUX_BIN_DIR`` (a venv ``bin`` directory) or ``PATH``.

Reproducibility handling:

* the model revision is read from the Hugging Face cache (``refs/main``) and written to the
  pin, so a manifest says which snapshot of the weights was used;
* mflux and mlx versions are read from the tool's own interpreter and pinned too;
* ``HF_HUB_OFFLINE=1`` is set for the child, so a run can never silently pull a newer
  snapshot of the weights.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from pathlib import Path

from csl.backends.base import BackendError
from csl.schema import Cost, ModelPin, Recipe

_TOOL = "mflux-generate-flux2"
_VERSION_SNIPPET = "import importlib.metadata as m; print(m.version('mflux'), m.version('mlx'))"


def find_tool() -> Path | None:
    """Locate the mflux command, or None."""
    bin_dir = os.environ.get("CSL_MFLUX_BIN_DIR")
    found = shutil.which(_TOOL, path=bin_dir) if bin_dir else shutil.which(_TOOL)
    return Path(found) if found else None


def hf_cache_dir() -> Path:
    """Hugging Face hub cache directory, honouring the usual environment variables."""
    if explicit := os.environ.get("HF_HUB_CACHE"):
        return Path(explicit)
    home = Path(os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface")))
    return home / "hub"


def cached_revision(model_id: str) -> str | None:
    """Revision hash of the cached snapshot of ``model_id``, or None if not cached."""
    ref = hf_cache_dir() / f"models--{model_id.replace('/', '--')}" / "refs" / "main"
    if not ref.is_file():
        return None
    return ref.read_text(encoding="utf-8").strip() or None


def unavailable_reason(model_id: str) -> str | None:
    """Why this backend cannot run here, or None if it can."""
    if find_tool() is None:
        return f"{_TOOL} not found (set CSL_MFLUX_BIN_DIR or put mflux on PATH)"
    if cached_revision(model_id) is None:
        return f"weights for {model_id} are not in the local Hugging Face cache"
    return None


class MfluxBackend:
    """One FLUX.2 Klein model at one quantisation level."""

    def __init__(self, model_id: str, quantize: int | None, name: str) -> None:
        self._model_id = model_id
        self._quantize = quantize
        self._name = name

    def _tool_versions(self, tool: Path) -> dict[str, str]:
        python = tool.parent / "python"
        try:
            result = subprocess.run(
                [str(python), "-c", _VERSION_SNIPPET],
                check=True,
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.SubprocessError) as error:
            msg = f"cannot read mflux version from {python}: {error}"
            raise BackendError(msg) from error
        mflux_version, mlx_version = result.stdout.split()
        return {"mflux": mflux_version, "mlx": mlx_version}

    def pin(self) -> ModelPin:
        """Resolve model revision and tool versions now."""
        reason = unavailable_reason(self._model_id)
        tool = find_tool()
        if reason is not None or tool is None:
            raise BackendError(reason or "mflux not found")
        return ModelPin(
            backend=self._name,
            model_id=self._model_id,
            revision=cached_revision(self._model_id),
            quantize=self._quantize,
            tool_versions=self._tool_versions(tool),
        )

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        """Run mflux for one image."""
        tool = find_tool()
        if tool is None:
            msg = f"{_TOOL} not found"
            raise BackendError(msg)
        command = [
            str(tool),
            "--model", recipe.pin.model_id,
            "--prompt", recipe.prompt,
            "--steps", str(recipe.steps),
            "--width", str(recipe.width),
            "--height", str(recipe.height),
            "--seed", str(recipe.seed),
            "--output", str(output),
            "--no-metadata",
        ]  # fmt: skip
        if recipe.pin.quantize is not None:
            command += ["--quantize", str(recipe.pin.quantize)]
        env = {**os.environ, "HF_HUB_OFFLINE": "1"}
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, env=env)
        except subprocess.CalledProcessError as error:
            msg = f"mflux failed (exit {error.returncode}): {error.stderr[-500:]}"
            raise BackendError(msg) from error
        if not output.is_file():
            msg = "mflux exited 0 but wrote no output file"
            raise BackendError(msg)
        return Cost(usd=0.0, basis="local model on this Mac, no API charge", estimated=False)


def hardware_summary() -> str:
    """Chip and memory of this Mac as reported by sysctl, for recording next to timings.

    Where sysctl or its keys are missing (Linux, for instance) it records the platform string
    instead, so a command that only notes the hardware does not fail there.
    """
    values = []
    try:
        for key in ("machdep.cpu.brand_string", "hw.memsize"):
            result = subprocess.run(
                ["/usr/sbin/sysctl", "-n", key],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            values.append(result.stdout.strip())
        gigabytes = round(int(values[1]) / 2**30)
    except (OSError, subprocess.SubprocessError, ValueError):
        return platform.platform()
    return f"{values[0]}, {gigabytes} GB unified memory"
