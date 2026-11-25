"""Shared fixtures: an invented brand, a brief and helpers that need no model weights."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from csl.schema import BrandContext, Brief

if TYPE_CHECKING:
    from pathlib import Path

PALETTE = {
    "ink": "#1f2a44",
    "paper": "#f4efe6",
    "clay": "#c4623f",
    "moss": "#5f7a4f",
    "sand": "#e2c08d",
}


@pytest.fixture
def brand() -> BrandContext:
    return BrandContext(
        name="Test Brand",
        version="1.0.0",
        palette=PALETTE,
        forbidden_colours=["#ff00ff", "#39ff14"],
        style_prompt={"illustration": "Flat vector illustration.", "photo": "Natural light photo."},
    )


@pytest.fixture
def brief() -> Brief:
    return Brief(id="test-brief", subject="A leaf and a cup", kind="illustration", candidates=2)


@pytest.fixture
def runs_dir(tmp_path: Path) -> Path:
    return tmp_path / "runs"
