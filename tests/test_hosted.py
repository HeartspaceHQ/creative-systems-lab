"""Hosted backends against a recorded fake transport. No test here reaches the network."""

from __future__ import annotations

import base64
import io
import json
from datetime import date
from typing import TYPE_CHECKING

import pytest
from PIL import Image

from csl import pipeline, registry
from csl.backends import bfl, elevenlabs_images, gemini_images, openai_images, xai_images
from csl.backends.hosted import HostedError, UrllibTransport, require_host
from csl.budget import Approval, Budget, BudgetError
from csl.pricing import Price
from csl.schema import ModelPin, Recipe

if TYPE_CHECKING:
    from collections.abc import Mapping
    from pathlib import Path

    from csl.schema import BrandContext, Brief


def _png(width: int = 8, height: int = 8) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 80, 40)).save(buffer, "PNG")
    return buffer.getvalue()


class FakeTransport:
    """Replies from a queue and records every request (headers included) for inspection."""

    def __init__(self, replies: list[bytes]) -> None:
        self.replies = replies
        self.sent: list[tuple[str, str, dict[str, str], bytes | None]] = []

    def send(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> bytes:
        self.sent.append((method, url, dict(headers), body))
        return self.replies.pop(0)


def _json(value: object) -> bytes:
    return json.dumps(value).encode()


def _recipe(width: int = 1280, height: int = 1280) -> Recipe:
    pin = ModelPin(backend="x", model_id="x", revision=None, tool_versions={})
    return Recipe(pin=pin, prompt="tea", width=width, height=height, steps=1, seed=7)


@pytest.fixture(autouse=True)
def _keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for variable in ("OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY", "BFL_API_KEY"):
        monkeypatch.setenv(variable, "test-key-not-real")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key-not-real")


def test_openai_cost_comes_from_usage_tokens(tmp_path: Path) -> None:
    reply = {
        "data": [{"b64_json": base64.b64encode(_png()).decode()}],
        "usage": {"output_tokens": 6000, "input_tokens_details": {"text_tokens": 100}},
    }
    transport = FakeTransport([_json(reply)])
    backend = openai_images.OpenAIImages("gpt-image-2.6-sunburst", "high", "s", transport)
    cost = backend.generate(_recipe(), tmp_path / "image.png")
    assert cost.usd == pytest.approx(6000 * 30e-6 + 100 * 5e-6)
    assert not cost.estimated
    sent = json.loads(transport.sent[0][3] or b"{}")
    assert sent["size"] == "1280x1280"
    assert (tmp_path / "image.png").is_file()
    assert (tmp_path / "source.png").is_file()


def test_gemini_price_follows_size_tier(tmp_path: Path) -> None:
    reply = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": base64.b64encode(_png()).decode(),
                            }
                        }
                    ]
                }
            }
        ]
    }
    transport = FakeTransport([_json(reply)])
    backend = gemini_images.GeminiImages("m", "n", {"1K": 0.03, "2K": 0.05}, transport)
    cost = backend.generate(_recipe(1080, 1350), tmp_path / "image.png")
    assert cost.usd == 0.05
    body = json.loads(transport.sent[0][3] or b"{}")
    assert body["generationConfig"]["imageConfig"] == {"aspectRatio": "4:5", "imageSize": "2K"}
    assert "key" not in transport.sent[0][1]


def test_xai_downloads_url_without_key(tmp_path: Path) -> None:
    transport = FakeTransport([_json({"data": [{"url": "https://imgen.x.ai/a.png"}]}), _png()])
    cost = xai_images.XaiImages("grok", "g", 0.04, transport).generate(
        _recipe(), tmp_path / "i.png"
    )
    assert cost.usd == 0.04
    assert transport.sent[1][2] == {}


def test_bfl_polls_and_reports_credits(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            _json(
                {"id": "j", "polling_url": "https://api.eu.bfl.ai/v1/get_result?id=j", "cost": 4.5}
            ),
            _json({"status": "Pending"}),
            _json({"status": "Ready", "result": {"sample": "https://delivery.bfl.ai/x.png"}}),
            _png(),
        ]
    )
    backend = bfl.BflFlux("flux-2-pro", "f", transport, sleep=lambda _: None)
    cost = backend.generate(_recipe(), tmp_path / "image.png")
    assert cost.usd == pytest.approx(0.045)
    assert not cost.estimated
    assert transport.sent[-1][2] == {}


def test_bfl_refuses_foreign_polling_host(tmp_path: Path) -> None:
    transport = FakeTransport([_json({"polling_url": "https://evil.example/poll", "cost": 1})])
    backend = bfl.BflFlux("flux-2-pro", "f", transport, sleep=lambda _: None)
    with pytest.raises(HostedError, match="refusing to send credentials"):
        backend.generate(_recipe(), tmp_path / "image.png")
    assert len(transport.sent) == 1


def test_bfl_moderation_is_a_failure(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            _json({"polling_url": "https://api.bfl.ai/v1/get_result?id=j", "cost": 3}),
            _json({"status": "Content Moderated"}),
        ]
    )
    backend = bfl.BflFlux("flux-2-pro", "f", transport, sleep=lambda _: None)
    with pytest.raises(HostedError):
        backend.generate(_recipe(), tmp_path / "image.png")


def test_elevenlabs_cost_is_unknown(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            _json({"id": "g1", "status": "pending"}),
            _json({"status": "completed", "content_url": "https://cdn.elevenlabs.io/g1.png"}),
            _png(),
        ]
    )
    backend = elevenlabs_images.ElevenLabsImages("m", "e", transport, sleep=lambda _: None)
    cost = backend.generate(_recipe(), tmp_path / "image.png")
    assert cost.usd is None


def test_elevenlabs_sends_quality_and_portrait_aspect(tmp_path: Path) -> None:
    transport = FakeTransport(
        [
            _json({"id": "g2", "status": "pending"}),
            _json({"status": "generating", "id": "g2"}),
            _json({"status": "completed", "content_url": "https://cdn.elevenlabs.io/g2.png"}),
            _png(),
        ]
    )
    backend = elevenlabs_images.ElevenLabsImages(
        "gpt-image-2.5-sunburst", "e", transport, quality="high", sleep=lambda _: None
    )
    cost = backend.generate(_recipe(1080, 1350), tmp_path / "image.png")
    body = json.loads(transport.sent[0][3] or b"{}")
    assert body == {
        "model_id": "gpt-image-2.5-sunburst",
        "prompt": "tea",
        "aspect_ratio": "4:5",
        "resolution": "2K",
        "quality": "high",
    }
    assert cost.usage["quality"] == "high"
    assert "xi-api-key" not in transport.sent[-1][2]


def test_missing_key_marks_hosted_model_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("BFL_API_KEY")
    assert registry.get("flux-2-pro").unavailable() is not None


def test_hosted_models_are_never_auto_selected() -> None:
    hosted = [e for e in registry.REGISTRY if e.location == "hosted"]
    assert hosted
    assert not any(e.auto_select for e in hosted)
    assert all(not e.price.free for e in hosted)


def test_transport_refuses_plain_http() -> None:
    with pytest.raises(HostedError):
        UrllibTransport().send("GET", "http://api.bfl.ai/x", {}, None)


def test_require_host_rejects_lookalike() -> None:
    with pytest.raises(HostedError):
        require_host("https://notbfl.ai/x", "bfl.ai")
    assert require_host("https://api.bfl.ai/x", "bfl.ai") == "https://api.bfl.ai/x"


def test_unconfirmed_price_reserves_margin() -> None:
    price = Price(((8192, 0.2),), "estimate", confirmed=False)
    assert price.reserve(1024, 1024) == pytest.approx(0.3)


def test_megapixel_surcharge() -> None:
    price = Price(((8192, 0.03),), "bfl", confirmed=True, per_extra_megapixel=0.015)
    assert price.per_image(1280, 1280) == pytest.approx(0.045)


def _budget(tmp_path: Path, usd: float) -> Budget:
    path = tmp_path / "budget.json"
    approval = Approval(
        id="poc", approved_usd=usd, approved_by="test", approved_on=date(2026, 11, 22)
    )
    path.write_text(approval.model_dump_json(), encoding="utf-8")
    return Budget.load(path)


def test_budget_reserve_settle_and_refuse(tmp_path: Path) -> None:
    budget = _budget(tmp_path, 0.10)
    held = budget.reserve("a", 0.06)
    assert budget.remaining() == pytest.approx(0.04)
    budget.settle(held, 0.045, "reported")
    assert budget.remaining() == pytest.approx(0.055)
    with pytest.raises(BudgetError):
        budget.reserve("b", 0.06)
    assert Budget.load(tmp_path / "budget.json").remaining() == pytest.approx(0.055)


def test_unknown_cost_keeps_reservation(tmp_path: Path) -> None:
    budget = _budget(tmp_path, 1.0)
    held = budget.reserve("a", 0.3)
    budget.settle(held, None, "elevenlabs")
    assert budget.remaining() == pytest.approx(0.7)


def test_run_refuses_hosted_model_without_budget(
    brief: Brief, brand: BrandContext, runs_dir: Path
) -> None:
    with pytest.raises(BudgetError):
        pipeline.run(brief.model_copy(update={"kind": "photo"}), brand, runs_dir, ("flux-2-pro",))
    assert not any(runs_dir.iterdir()) if runs_dir.exists() else True


def test_run_refuses_when_budget_too_small(
    tmp_path: Path, brief: Brief, brand: BrandContext, runs_dir: Path
) -> None:
    budget = _budget(tmp_path, 0.01)
    with pytest.raises(BudgetError):
        pipeline.run(
            brief.model_copy(update={"kind": "photo"}),
            brand,
            runs_dir,
            ("flux-2-pro",),
            budget=budget,
        )
