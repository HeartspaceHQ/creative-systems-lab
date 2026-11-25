from __future__ import annotations

from typing import TYPE_CHECKING

from csl.backends.procedural import ProceduralBackend
from csl.canonical import sha256_file
from csl.schema import ModelPin, Recipe

if TYPE_CHECKING:
    from pathlib import Path


def _recipe(pin: ModelPin, seed: int) -> Recipe:
    return Recipe(pin=pin, prompt="x", width=128, height=96, steps=1, seed=seed)


def test_same_recipe_is_bit_identical(tmp_path: Path) -> None:
    backend = ProceduralBackend(["#f4efe6", "#c4623f", "#1f2a44"])
    recipe = _recipe(backend.pin(), 7)
    backend.generate(recipe, tmp_path / "a.png")
    backend.generate(recipe, tmp_path / "b.png")
    assert sha256_file(tmp_path / "a.png") == sha256_file(tmp_path / "b.png")


def test_seed_and_palette_change_output(tmp_path: Path) -> None:
    backend = ProceduralBackend(["#f4efe6", "#c4623f", "#1f2a44"])
    other = ProceduralBackend(["#f4efe6", "#c4623f", "#5f7a4f"])
    backend.generate(_recipe(backend.pin(), 1), tmp_path / "s1.png")
    backend.generate(_recipe(backend.pin(), 2), tmp_path / "s2.png")
    other.generate(_recipe(other.pin(), 1), tmp_path / "p1.png")
    hashes = {sha256_file(tmp_path / n) for n in ("s1.png", "s2.png", "p1.png")}
    assert len(hashes) == 3


def test_pin_identifies_palette() -> None:
    a = ProceduralBackend(["#000000", "#ffffff"]).pin()
    b = ProceduralBackend(["#000000", "#fffffe"]).pin()
    assert a.revision != b.revision
