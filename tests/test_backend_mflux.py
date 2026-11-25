"""mflux backend tests. A fake tool stands in for mflux so command building, pinning and
failure handling are tested everywhere; the real-model test runs only where mflux and the
weights exist (``pytest -m mflux``)."""

from __future__ import annotations

import json
import os
import platform
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from csl import registry
from csl.backends import mflux
from csl.backends.base import BackendError
from csl.canonical import sha256_file
from csl.schema import Recipe

MODEL = "black-forest-labs/FLUX.2-klein-4B"

_FAKE_TOOL = """#!{python}
import json, sys
from pathlib import Path
from PIL import Image
args = sys.argv[1:]
Path(args[args.index("--output") + 1]).parent.mkdir(exist_ok=True)
Path({log!r}).write_text(json.dumps(args))
Image.new("RGB", (16, 16), "#c4623f").save(args[args.index("--output") + 1])
"""


def _executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


@pytest.fixture
def fake_mflux(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "args.json"
    _executable(
        bin_dir / "mflux-generate-flux2", _FAKE_TOOL.format(python=sys.executable, log=str(log))
    )
    _executable(bin_dir / "python", "#!/bin/sh\necho '9.9.9 8.8.8'\n")
    snapshot_ref = tmp_path / "hf" / "hub" / "models--black-forest-labs--FLUX.2-klein-4B" / "refs"
    snapshot_ref.mkdir(parents=True)
    (snapshot_ref / "main").write_text("abc123revision\n", encoding="utf-8")
    monkeypatch.setenv("CSL_MFLUX_BIN_DIR", str(bin_dir))
    monkeypatch.setenv("HF_HOME", str(tmp_path / "hf"))
    monkeypatch.delenv("HF_HUB_CACHE", raising=False)
    return log


@pytest.mark.usefixtures("fake_mflux")
def test_pin_reads_revision_and_tool_versions() -> None:
    pin = mflux.MfluxBackend(MODEL, 8, "flux2-klein-4b-q8").pin()
    assert pin.revision == "abc123revision"
    assert pin.tool_versions == {"mflux": "9.9.9", "mlx": "8.8.8"}
    assert pin.quantize == 8


def test_generate_builds_expected_command_offline(fake_mflux: Path, tmp_path: Path) -> None:
    backend = mflux.MfluxBackend(MODEL, 4, "flux2-klein-4b-q4")
    recipe = Recipe(pin=backend.pin(), prompt="a leaf", width=256, height=192, steps=6, seed=11)
    backend.generate(recipe, tmp_path / "out.png")
    args = json.loads(fake_mflux.read_text(encoding="utf-8"))
    assert args[args.index("--seed") + 1] == "11"
    assert args[args.index("--steps") + 1] == "6"
    assert args[args.index("--quantize") + 1] == "4"
    assert args[args.index("--model") + 1] == MODEL
    assert "--no-metadata" in args
    assert (tmp_path / "out.png").is_file()


@pytest.mark.usefixtures("fake_mflux")
def test_missing_weights_make_backend_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("HF_HOME", str(tmp_path / "empty"))
    reason = mflux.unavailable_reason(MODEL)
    assert reason is not None
    assert "not in the local Hugging Face cache" in reason
    with pytest.raises(BackendError):
        mflux.MfluxBackend(MODEL, 8, "k").pin()


def test_missing_tool_is_reported(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("CSL_MFLUX_BIN_DIR", str(tmp_path / "nothing"))
    assert "not found" in (mflux.unavailable_reason(MODEL) or "")


@pytest.mark.usefixtures("fake_mflux")
def test_tool_failure_surfaces_stderr(tmp_path: Path) -> None:
    bin_dir = Path(os.environ["CSL_MFLUX_BIN_DIR"])
    _executable(bin_dir / "mflux-generate-flux2", "#!/bin/sh\necho boom >&2\nexit 3\n")
    backend = mflux.MfluxBackend(MODEL, 8, "k")
    recipe = Recipe(pin=backend.pin(), prompt="p", width=64, height=64, steps=1, seed=1)
    with pytest.raises(BackendError, match="boom"):
        backend.generate(recipe, tmp_path / "x.png")


def test_hardware_summary_falls_back_off_macos(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without sysctl's keys (as on Linux) the platform string is recorded, not an error."""

    def no_sysctl(*_: object, **__: object) -> None:
        raise subprocess.CalledProcessError(1, "sysctl")

    monkeypatch.setattr(subprocess, "run", no_sysctl)
    assert mflux.hardware_summary() == platform.platform()


@pytest.mark.mflux
def test_real_klein_is_deterministic_for_a_fixed_seed(tmp_path: Path) -> None:
    key = "flux2-klein-4b-q8"
    entry = registry.get(key)
    reason = entry.unavailable()
    if reason is not None:
        pytest.skip(reason)
    backend = mflux.MfluxBackend(MODEL, 8, key)
    recipe = Recipe(
        pin=backend.pin(), prompt="a teal leaf, flat vector", width=256, height=256, steps=4, seed=5
    )
    backend.generate(recipe, tmp_path / "a.png")
    backend.generate(recipe, tmp_path / "b.png")
    assert sha256_file(tmp_path / "a.png") == sha256_file(tmp_path / "b.png")
