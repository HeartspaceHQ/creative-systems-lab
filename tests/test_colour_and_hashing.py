from __future__ import annotations

import numpy as np
import pytest

from csl.canonical import canonical_json, sha256_json
from csl.colour import contrast_ratio, hex_to_lab, hex_to_rgb, is_hex, relative_luminance


def test_white_and_black_lab() -> None:
    assert hex_to_lab("#ffffff") == pytest.approx([100, 0, 0], abs=0.05)
    assert hex_to_lab("#000000") == pytest.approx([0, 0, 0], abs=0.05)


def test_known_lab_value_for_srgb_red() -> None:
    # Reference value for sRGB (255, 0, 0) under D65: L=53.24, a=80.09, b=67.20.
    assert hex_to_lab("#ff0000") == pytest.approx([53.24, 80.09, 67.20], abs=0.1)


def test_wcag_black_on_white_is_21() -> None:
    white = relative_luminance(np.array([255.0, 255.0, 255.0]))
    black = relative_luminance(np.array([0.0, 0.0, 0.0]))
    assert float(contrast_ratio(white, black)) == pytest.approx(21.0)


def test_hex_validation() -> None:
    assert is_hex("#a1B2c3")
    assert not is_hex("a1b2c3")
    with pytest.raises(ValueError, match="not a #rrggbb"):
        hex_to_rgb("#fff")


def test_canonical_json_ignores_key_order() -> None:
    assert canonical_json({"b": 1, "a": [1, 2]}) == canonical_json({"a": [1, 2], "b": 1})
    assert sha256_json({"b": 1, "a": 2}) == sha256_json({"a": 2, "b": 1})
    assert sha256_json({"a": 1}) != sha256_json({"a": 2})
