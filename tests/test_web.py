"""The local web API: it must go through the same logic as the CLI and keep blind sets blind."""

from __future__ import annotations

import http.client
import json
import shutil
import threading
import time
from datetime import UTC, date, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from csl import pipeline
from csl.budget import Budget
from csl.reproduce import verify
from csl.schema import BrandContext, Brief
from csl.store import RunStore, read_model
from csl.validation.generate import generate_set
from csl.web.server import make_server
from csl.web.studio import Studio
from csl.web.workspace import Workspace

if TYPE_CHECKING:
    from collections.abc import Iterator
    from http.server import ThreadingHTTPServer

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "aster-lane"


class Api:
    def __init__(self, server: ThreadingHTTPServer) -> None:
        self.port = server.server_address[1]
        self.token = getattr(server, "session_token", "")

    def call(
        self,
        method: str,
        path: str,
        body: object = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        payload = json.dumps(body) if body is not None else None
        session = {} if method == "GET" else {"X-CSL-Session": self.token}
        all_headers = {"Content-Type": "application/json", **session, **(headers or {})}
        conn.request(method, path, body=payload, headers=all_headers)
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response.status, data

    def json(self, method: str, path: str, body: object = None) -> tuple[int, dict[str, object]]:
        status, data = self.call(method, path, body)
        return status, json.loads(data)


@pytest.fixture
def served(tmp_path: Path, brand: BrandContext, brief: Brief) -> Iterator[tuple[Api, RunStore]]:
    runs = tmp_path / "runs"
    store = pipeline.run(
        brief,
        brand,
        runs,
        ("procedural", "procedural-offbrand"),
        clock=lambda: datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC),
    )
    brief_dir = tmp_path / "briefs"
    brief_dir.mkdir()
    shutil.copy(EXAMPLE / "brief.json", brief_dir / "brief.json")
    sets = tmp_path / "validation"
    spec = json.loads((EXAMPLE / "validation" / "spec.json").read_text(encoding="utf-8"))
    root = tmp_path / "aster"
    shutil.copytree(EXAMPLE, root, ignore=shutil.ignore_patterns("results", "validation"))
    spec.update(
        model="procedural",
        width=64,
        height=64,
        cases=spec["cases"][:3],
        brief="brief.json",
        brand="brand.json",
    )
    (root / "spec.json").write_text(json.dumps(spec), encoding="utf-8")
    generate_set(root / "spec.json", sets / spec["set_id"], "test")
    workspace = Workspace(
        run_roots=(runs,),
        brand=EXAMPLE / "brand.json",
        brief_files=(EXAMPLE / "brief.json",),
        references=EXAMPLE / "references",
        validation_root=sets,
    )
    server = make_server(workspace, runs, 0, studio=Studio(tmp_path / "studio"))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield Api(server), store
    server.shutdown()
    server.server_close()


def test_run_detail_explains_checks_and_decision_goes_through_review(
    served: tuple[Api, RunStore],
) -> None:
    api, store = served
    status, listing = api.call("GET", "/api/runs")
    assert status == 200
    assert store.root.name in listing.decode()
    _, detail = api.json("GET", f"/api/runs/{store.root.name}")
    candidates = detail["candidates"]
    assert isinstance(candidates, list)
    bad = next(c for c in candidates if c["status"] == "auto_rejected")
    failed = [c for c in bad["checks"] if not c["passed"]]
    assert failed
    assert all(c["explanation"]["measured"] for c in failed)
    assert any("Hard check failed" in c["explanation"]["consequence"] for c in failed)

    good = next(c["id"] for c in candidates if c["status"] == "pending")
    path = f"/api/runs/{store.root.name}/decisions"
    status, error = api.json(
        "POST", path, {"candidate": good, "verdict": "approve", "reviewer": ""}
    )
    assert status == 400
    assert "reviewer" in str(error["error"])
    status, _ = api.json(
        "POST", path, {"candidate": bad["id"], "verdict": "approve", "reviewer": "ana"}
    )
    assert status == 400
    status, decision = api.json(
        "POST", path, {"candidate": good, "verdict": "approve", "reviewer": "ana", "note": "ok"}
    )
    assert status == 201
    assert decision["prev_hash"] == "0" * 64
    assert verify(store).intact
    _, detail = api.json("GET", f"/api/runs/{store.root.name}")
    verification = detail["verification"]
    assert isinstance(verification, dict)
    assert verification["intact"] is True


def test_tampering_after_a_decision_is_reported_by_the_api(served: tuple[Api, RunStore]) -> None:
    api, store = served
    good = next(v.id for v in store.candidates() if v.status == "pending")
    api.json(
        "POST",
        f"/api/runs/{store.root.name}/decisions",
        {"candidate": good, "verdict": "approve", "reviewer": "ana"},
    )
    store.decisions_path.write_text(
        store.decisions_path.read_text(encoding="utf-8").replace("approve", "reject"),
        encoding="utf-8",
    )
    _, detail = api.json("GET", f"/api/runs/{store.root.name}")
    verification = detail["verification"]
    assert isinstance(verification, dict)
    assert verification["intact"] is False
    assert verification["problems"]


def test_request_guards(served: tuple[Api, RunStore]) -> None:
    api, store = served
    path = f"/api/runs/{store.root.name}/decisions"
    status, _ = api.call("POST", path, {}, {"Content-Type": "text/plain"})
    assert status == 415
    status, _ = api.call("GET", "/api/runs", headers={"Host": "evil.example"})
    assert status == 403
    status, _ = api.call("GET", "/api/runs/..%2f..%2fetc")
    assert status == 404
    status, _ = api.call("GET", f"/api/runs/{store.root.name}/candidates/..%2f..%2frun.json/image")
    assert status == 404
    status, _ = api.call("GET", "/api/nothing")
    assert status == 404


def test_blind_endpoints_expose_no_category_or_score(served: tuple[Api, RunStore]) -> None:
    api, _ = served
    status, raw = api.call("GET", "/api/validation")
    assert status == 200
    set_id = json.loads(raw)[0]
    status, raw = api.call("GET", f"/api/validation/{set_id}")
    text = raw.decode()
    for leak in ("good", "category", "wrong", "hard_pass", "score", "intent"):
        assert leak not in text
    items = json.loads(text)["items"]
    first = items[0]["id"]
    status, image = api.call("GET", f"/api/validation/{set_id}/images/{first}")
    assert status == 200
    assert image.startswith(b"\x89PNG")
    status, rated = api.json(
        "POST", f"/api/validation/{set_id}/ratings", {"id": first, "verdict": "reject", "note": "x"}
    )
    assert status == 201
    assert rated["verdict"] == "reject"
    status, _ = api.json(
        "POST", f"/api/validation/{set_id}/ratings", {"id": "nope", "verdict": "reject"}
    )
    assert status == 400


def test_start_job_generates_a_run(served: tuple[Api, RunStore], tmp_path: Path) -> None:
    api, _ = served
    status, job = api.json("POST", "/api/jobs", {"brief": "brief.json", "models": ["procedural"]})
    assert status == 202
    for _ in range(100):
        _, state = api.json("GET", f"/api/jobs/{job['id']}")
        if state["state"] != "running":
            break
        time.sleep(0.1)
    assert state["state"] == "done", state
    assert RunStore(tmp_path / "runs" / str(state["run_id"])).candidates()
    assert read_model(EXAMPLE / "brief.json", Brief).id in str(state["run_id"])


def _workspace(*roots: Path) -> Workspace:
    return Workspace(
        run_roots=roots,
        brand=EXAMPLE / "brand.json",
        brief_files=(EXAMPLE / "brief.json",),
    )


def test_a_run_in_two_roots_is_listed_once_from_the_root_that_opens_it(
    served: tuple[Api, RunStore], tmp_path: Path
) -> None:
    _, store = served
    copy_root = tmp_path / "copies"
    shutil.copytree(store.root, copy_root / store.root.name)
    rows = _workspace(store.root.parent, copy_root).list_runs()
    assert [row["id"] for row in rows] == [store.root.name]


def test_an_unsealed_run_is_not_reported_as_sealed(served: tuple[Api, RunStore]) -> None:
    _, store = served
    workspace = _workspace(store.root.parent)
    sealed = workspace.run_detail(store.root.name)["verification"]
    assert isinstance(sealed, dict)
    assert sealed["sealed"] is True
    (store.root / "integrity.json").unlink()
    unsealed = workspace.run_detail(store.root.name)["verification"]
    assert isinstance(unsealed, dict)
    assert unsealed["sealed"] is False
    assert unsealed["problems"] == []


def _wait_for_jobs(api: Api, ids: list[str]) -> None:
    deadline = time.monotonic() + 30
    for job_id in ids:
        while time.monotonic() < deadline:
            _, job = api.json("GET", f"/api/jobs/{job_id}")
            if job["state"] != "running":
                break
            time.sleep(0.05)


@pytest.mark.parametrize("candidates", [100, -3, 0, True, "2"])
def test_job_with_invalid_candidates_is_rejected_before_any_run(
    served: tuple[Api, RunStore], candidates: object
) -> None:
    api, store = served
    runs_before = sorted(p.name for p in store.root.parent.iterdir())
    status, error = api.json(
        "POST",
        "/api/jobs",
        {"brief": "brief.json", "models": ["procedural"], "candidates": candidates},
    )
    assert status == 400
    assert "candidates" in str(error["error"])
    assert sorted(p.name for p in store.root.parent.iterdir()) == runs_before


def test_job_with_unknown_model_is_refused_and_does_not_block_the_next_job(
    served: tuple[Api, RunStore],
) -> None:
    api, _ = served
    status, refused = api.json("POST", "/api/jobs", {"brief": "brief.json", "models": ["nope"]})
    assert status == 400
    assert "nope" in str(refused["error"])
    status, second = api.json(
        "POST", "/api/jobs", {"brief": "brief.json", "models": ["procedural"], "candidates": 1}
    )
    assert status == 202
    _wait_for_jobs(api, [str(second["id"])])


def test_listing_survives_one_broken_run(served: tuple[Api, RunStore]) -> None:
    api, store = served
    broken = store.root.parent / "broken-run"
    shutil.copytree(store.root, broken)
    (next((broken / "candidates").iterdir()) / "manifest.json").unlink()
    status, data = api.call("GET", "/api/runs")
    assert status == 200
    assert store.root.name in data.decode()
    assert "broken-run" not in data.decode()


@pytest.mark.parametrize("length", ["-5", "abc", "99999999"])
def test_bad_content_length_is_a_client_error(served: tuple[Api, RunStore], length: str) -> None:
    api, _ = served
    status, _ = api.call("POST", "/api/jobs", {}, headers={"Content-Length": length})
    assert status in {400, 413}


def test_unexpected_failure_answers_500_without_details(served: tuple[Api, RunStore]) -> None:
    api, store = served
    candidate = store.candidates()[0]
    candidate.image.unlink()
    status, data = api.call("GET", f"/api/runs/{store.root.name}/candidates/{candidate.id}/image")
    assert status == 500
    assert json.loads(data) == {"error": "Something went wrong on the server.", "fields": {}}


# Starting a run from the UI: key status without key values, prices, and the budget gate.

FAKE_KEY = "sk-test-value-that-must-never-be-served"


def _serve(tmp_path: Path, budget: Budget | None) -> Iterator[Api]:
    runs = tmp_path / "runs"
    runs.mkdir()
    large = tmp_path / "large.json"
    large.write_text(
        read_model(EXAMPLE / "brief.json", Brief)
        .model_copy(update={"width": 1024, "height": 1024})
        .model_dump_json(),
        encoding="utf-8",
    )
    workspace = Workspace(
        run_roots=(runs,),
        brand=EXAMPLE / "brand.json",
        brief_files=(EXAMPLE / "brief.json", large),
    )
    server = make_server(workspace, runs, 0, budget, studio=Studio(tmp_path / "studio"))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield Api(server)
    server.shutdown()
    server.server_close()


def _budget(tmp_path: Path, usd: float) -> Budget:
    path = tmp_path / "ui-test.json"
    approval = {
        "id": "ui-test",
        "approved_usd": usd,
        "approved_by": "Test",
        "approved_on": date(2026, 11, 22).isoformat(),
    }
    path.write_text(json.dumps(approval), encoding="utf-8")
    return Budget.load(path)


@pytest.fixture
def no_budget(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Api]:
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    yield from _serve(tmp_path, None)


@pytest.fixture
def with_budget(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Api]:
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    yield from _serve(tmp_path, _budget(tmp_path, 0.5))


def _rows(api: Api, path: str) -> list[dict[str, object]]:
    status, data = api.call("GET", path)
    assert status == 200, data
    rows = json.loads(data)
    assert isinstance(rows, list)
    return rows


def test_setup_says_a_key_is_set_but_never_serves_it(no_budget: Api) -> None:
    status, data = no_budget.call("GET", "/api/setup")
    assert status == 200
    assert FAKE_KEY not in data.decode()
    setup = json.loads(data)
    openai = next(p for p in setup["providers"] if p["variable"] == "OPENAI_API_KEY")
    assert openai["set"] is True
    assert openai["source"] == "terminal"
    assert "gpt-image-2.6-sunburst" in openai["models"]
    assert setup["budget"] is None


def test_without_a_budget_hosted_models_are_listed_as_blocked(no_budget: Api) -> None:
    rows = _rows(no_budget, "/api/models?brief=brief.json")
    sunburst = next(r for r in rows if r["key"] == "gpt-image-2.6-sunburst")
    assert sunburst["available"] is False
    assert "spending limit" in str(sunburst["unavailable_reason"])
    assert sunburst["location"] == "hosted"
    assert isinstance(sunburst["per_image_usd"], float)
    assert sunburst["per_image_usd"] > 0


def test_without_a_budget_a_hosted_job_is_refused_before_any_run(
    no_budget: Api, tmp_path: Path
) -> None:
    status, error = no_budget.json(
        "POST", "/api/jobs", {"brief": "large.json", "models": ["gpt-image-2.6-sunburst"]}
    )
    assert status == 400
    assert "budget" in str(error["error"])
    assert list((tmp_path / "runs").iterdir()) == []


def test_quote_prices_the_run_against_the_budget(with_budget: Api) -> None:
    status, quote = with_budget.json(
        "GET", "/api/quote?brief=brief.json&models=procedural,gpt-image-2.6-sunburst&candidates=2"
    )
    assert status == 200
    assert quote["images"] == 4
    lines = quote["lines"]
    assert isinstance(lines, list)
    assert lines[0]["free"] is True
    assert lines[1]["held_usd"] > 0
    assert quote["total_held_usd"] == lines[1]["held_usd"]
    assert quote["fits"] is True
    budget = quote["budget"]
    assert isinstance(budget, dict)
    assert budget["remaining_usd"] == 0.5


def test_a_run_larger_than_the_budget_is_refused(with_budget: Api, tmp_path: Path) -> None:
    status, quote = with_budget.json(
        "GET", "/api/quote?brief=brief.json&models=gpt-image-2.6-sunburst&candidates=16"
    )
    assert status == 200
    assert quote["fits"] is False
    status, error = with_budget.json(
        "POST",
        "/api/jobs",
        {"brief": "large.json", "models": ["gpt-image-2.6-sunburst"], "candidates": 16},
    )
    assert status == 400
    assert "ui-test" in str(error["error"])
    assert list((tmp_path / "runs").iterdir()) == []


def test_free_runs_need_no_budget(no_budget: Api) -> None:
    status, quote = no_budget.json("GET", "/api/quote?brief=brief.json&models=procedural")
    assert status == 200
    assert quote["total_held_usd"] == 0
    assert quote["fits"] is True


def test_setup_reports_charged_uncertain_held_and_remaining(with_budget: Api) -> None:
    _, setup = with_budget.json("GET", "/api/setup")
    budget = setup["budget"]
    assert isinstance(budget, dict)
    assert {k: budget[k] for k in ("charged_usd", "uncertain_usd", "held_usd")} == {
        "charged_usd": 0,
        "uncertain_usd": 0,
        "held_usd": 0,
    }
    assert budget["remaining_usd"] == 0.5
