"""CSL Studio's API: storage, generation, images, deliveries and the security boundary.

Deliveries run against a fake ``node`` and a fake engine folder, so no browser, no ffmpeg and no
paid model is involved. The real engine was driven by hand; these tests pin the server's side.
"""

from __future__ import annotations

import http.client
import io
import json
import logging
import os
import shutil
import stat
import sys
import threading
import time
import urllib.parse
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, TypeVar

import pytest
from PIL import Image

from csl.web.deliveries import plain_check, safe_filename
from csl.web.engine import Engine
from csl.web.server import make_server
from csl.web.studio import Studio
from csl.web.workspace import Workspace

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator
    from http.server import ThreadingHTTPServer

T = TypeVar("T")

FAKE_KEY = "sk-studio-test-secret-value"
COLOURS = {"ground": "#f4efe6", "text": "#1d2a3a", "quiet": "#5b6675", "accent": "#b5542c"}
CATALOG = Path(__file__).parents[1] / "poc" / "composition" / "fonts" / "catalog.json"
BRAND: dict[str, object] = {
    "name": "Test Brand",
    "colours": COLOURS,
    "type": {"display": "Playfair Display", "body": "DM Sans"},
}
BRIEF = {"subject": "A leaf and a cup", "kind": "illustration", "shape": "square", "candidates": 2}
COPY = {"label": "", "headline": "Slow mornings", "body": "", "cta": "", "sender": ""}

# A stand-in for Node: answers --version, writes preview files, and "renders" by writing the
# files the report lists. The mode (ok, failed-check, nothing, hang) is read from the engine folder.
FAKE_NODE = """#!{python}
import hashlib, json, os, sys, time
from pathlib import Path

if sys.argv[1] == "--version":
    print("v26.0.0")
    raise SystemExit(0)
script = Path(sys.argv[1])
mode = (script.parent.parent / "mode.txt").read_text().strip()
if script.name == "studio-assets.py" or script.name == "studio-assets.ts":
    out = Path(sys.argv[2])
    (out / "studio.html").write_text("<html>preview</html>")
    (out / "evil.exe").write_text("not served")
    (out / "src").mkdir()
    (out / "src" / "design.ts").write_text("export const x = 1;")
    raise SystemExit(0)
if mode == "hang":
    time.sleep(60)
project = Path(os.environ["CSL_PROJECT"])
source = json.loads((project / "source.json").read_text())
if mode == "nothing":
    print("studio-render: the headline is missing", file=sys.stderr)
    raise SystemExit(2)
out = project / "out" / "studio"
out.mkdir(parents=True)
outputs = {{}}
for key in source["formats"]:
    data = b"\\x89PNG fake " + key.encode()
    (out / f"design-{{key}}.png").write_bytes(data)
    outputs[f"design-{{key}}.png"] = hashlib.sha256(data).hexdigest()
if source.get("extras"):
    # Like the real engine: one film run writes both the video and the animation.
    for ext in ("mp4", "gif"):
        data = f"fake {{ext}}".encode()
        (out / f"design-{{source['formats'][0]}}.{{ext}}").write_bytes(data)
        outputs[f"design-{{source['formats'][0]}}.{{ext}}"] = hashlib.sha256(data).hexdigest()
if mode == "tampered":
    next(out.glob("design-*.png")).write_bytes(b"changed")
failed = mode == "failed-check"
checks = {{
    "source": [{{"name": "The brand colours are valid colours", "passed": True, "detail": ""}}],
    "design-linkedin-square": [
        {{"name": "Headline fits on its line", "passed": not failed, "detail": "too long"}}
    ],
}}
report = {{"checks": checks, "outputs": outputs}}
(out / "report.json").write_text(json.dumps(report))
raise SystemExit(1 if failed else 0)
"""


class Client:
    """One session: raw HTTP with a chosen set of headers."""

    def __init__(self, server: ThreadingHTTPServer) -> None:
        self.port = server.server_address[1]
        self.token = str(getattr(server, "session_token", ""))

    def raw(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        *,
        token: bool = True,
    ) -> tuple[int, dict[str, str], bytes]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        sent = {"X-CSL-Session": self.token} if token and method != "GET" else {}
        sent.update(headers or {})
        conn.request(method, path, body=body, headers=sent)
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return response.status, {k.lower(): v for k, v in response.getheaders()}, data

    def call(
        self, method: str, path: str, body: object = None, **options: bool
    ) -> tuple[int, dict[str, object]]:
        payload = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        status, _, data = self.raw(method, path, payload, headers, **options)
        try:
            return status, json.loads(data)
        except ValueError:
            return status, {}

    def upload(
        self, path: str, data: bytes, name: str = "picture.png"
    ) -> tuple[int, dict[str, object]]:
        kind = "image/jpeg" if data.startswith(b"\xff\xd8") else "image/png"
        status, _, answer = self.raw(
            "POST", path, data, {"Content-Type": kind, "X-File-Name": name}
        )
        return status, json.loads(answer)


@dataclass
class Studioed:
    client: Client
    studio: Studio
    server: ThreadingHTTPServer
    engine_dir: Path

    def set_mode(self, mode: str) -> None:
        (self.engine_dir / "mode.txt").write_text(mode, encoding="utf-8")


def _fake_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    engine_dir = tmp_path / "engine"
    (engine_dir / "src").mkdir(parents=True)
    (engine_dir / "src" / "studio-render.ts").write_text("// fake", encoding="utf-8")
    (engine_dir / "src" / "studio-assets.ts").write_text("// fake", encoding="utf-8")
    (engine_dir / "mode.txt").write_text("ok", encoding="utf-8")
    (engine_dir / "fonts").mkdir()
    (engine_dir / "node_modules").mkdir()
    shutil.copyfile(CATALOG, engine_dir / "fonts" / "catalog.json")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    node = bin_dir / "node"
    node.write_text(FAKE_NODE.format(python=sys.executable), encoding="utf-8")
    node.chmod(node.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    return engine_dir


@pytest.fixture
def app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Studioed]:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("csl.web.deliveries.RENDER_TIMEOUT_S", 2.0)
    engine_dir = _fake_engine(tmp_path, monkeypatch)
    runs = tmp_path / "runs"
    runs.mkdir()
    workspace = Workspace(run_roots=(runs,))
    studio = Studio(tmp_path / "studio")
    engine = Engine(engine_dir)
    engine.prepare_preview()
    server = make_server(workspace, runs, 0, studio=studio, engine=engine)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield Studioed(Client(server), studio, server, engine_dir)
    server.shutdown()
    server.server_close()


def _picture(size: tuple[int, int] = (64, 48), fmt: str = "PNG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 120, 90)).save(buffer, fmt)
    return buffer.getvalue()


def _project(client: Client) -> tuple[str, str]:
    _, brand = client.call("POST", "/api/brands", BRAND)
    status, project = client.call(
        "POST", "/api/projects", {"name": "Winter tea", "brand": brand["id"]}
    )
    assert status == 201, project
    assert client.call("PUT", f"/api/projects/{project['id']}/brief", BRIEF)[0] == 200
    return str(brand["id"]), str(project["id"])


def _approved_import(client: Client, project: str) -> str:
    status, asset = client.upload(f"/api/projects/{project}/assets/import", _picture())
    assert status == 201, asset
    status, decided = client.call(
        "POST",
        f"/api/projects/{project}/assets/{asset['id']}/decision",
        {"verdict": "approve", "reviewer": "Ana", "rights_confirmed": True},
    )
    assert status == 200, decided
    return str(asset["id"])


def _design(asset: str, headline: str = "Slow mornings") -> dict[str, object]:
    return {
        "asset": asset,
        "layout": "editorial",
        "copy": {**COPY, "headline": headline},
        "focus": {"x": 0.5, "y": 0.5},
        "zoom": 1,
        "headline_scale": 1,
        "night": 0,
    }


def _wait_delivery(client: Client, project: str, delivery: str) -> dict[str, object]:
    path = f"/api/projects/{project}/deliveries/{delivery}"
    for _ in range(200):
        _, state = client.call("GET", path)
        if state["state"] != "running":
            return state
        time.sleep(0.05)
    pytest.fail("the delivery did not finish")


# --- storage and forms ---------------------------------------------------------------------


def test_a_brand_is_validated_in_plain_language_per_field(app: Studioed) -> None:
    bad = {**BRAND, "name": "", "colours": {**COLOURS, "ground": "red"}}
    bad["type"] = {"display": "DM Sans", "body": "DM Sans"}
    status, error = app.client.call("POST", "/api/brands", bad)
    assert status == 400
    fields = error["fields"]
    assert isinstance(fields, dict)
    assert set(fields) == {"name", "colours.ground", "type.body"}
    assert "Use a colour" in fields["colours.ground"]
    assert str(error["error"]).endswith(".")


def test_the_design_is_checked_against_its_ranges_and_its_image(app: Studioed) -> None:
    _, project = _project(app.client)
    status, error = app.client.call(
        "PUT", f"/api/projects/{project}/design", {**_design("nope"), "zoom": 9}
    )
    assert status == 400
    assert error["fields"] == {"zoom": "Use a number between 0.5 and 2"}
    status, error = app.client.call("PUT", f"/api/projects/{project}/design", _design("nope"))
    assert status == 400
    assert "asset" in str(error["fields"])


def test_unknown_ids_are_404_and_malformed_ones_never_reach_the_disk(app: Studioed) -> None:
    for path in (
        "/api/projects/missing",
        "/api/projects/..%2f..%2fetc",
        "/api/projects/%2e%2e",
        "/api/projects/UPPER",
        "/api/brands/x/references/..%2f..%2fbrand/image",
    ):
        status, _ = app.client.call("GET", path)
        assert status == 404, path


# --- images --------------------------------------------------------------------------------


def test_an_import_is_stripped_re_encoded_and_pending_until_rights_are_confirmed(
    app: Studioed,
) -> None:
    _, project = _project(app.client)
    buffer = io.BytesIO()
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    Image.new("RGB", (40, 30), (1, 2, 3)).save(
        buffer, "JPEG", exif=exif, icc_profile=b"profile-bytes"
    )
    status, asset = app.client.upload(
        f"/api/projects/{project}/assets/import",
        buffer.getvalue(),
        "..%2F..%2Fx%0D%0ASet-Cookie%3A%20a%3Db.jpg",
    )
    assert status == 201
    assert asset["status"] == "pending"
    assert "\n" not in json.dumps(asset["source"])
    stored = app.studio.asset_file(project, str(asset["id"]))
    assert stored.read_bytes().startswith(b"\x89PNG")
    assert b"SecretCameraMaker" not in stored.read_bytes()
    assert b"profile-bytes" not in stored.read_bytes()
    path = f"/api/projects/{project}/assets/{asset['id']}/decision"
    status, error = app.client.call("POST", path, {"verdict": "approve", "reviewer": "Ana"})
    assert status == 400
    assert "rights_confirmed" in str(error["fields"])
    status, decided = app.client.call(
        "POST", path, {"verdict": "approve", "reviewer": "Ana", "rights_confirmed": True}
    )
    assert status == 200
    assert decided["status"] == "approved"


@pytest.mark.parametrize(
    "data", [b"not an image", b"", b"\x89PNG\r\n\x1a\n" + b"x" * 40], ids=["text", "empty", "stub"]
)
def test_an_upload_that_is_not_an_image_is_refused(app: Studioed, data: bytes) -> None:
    _, project = _project(app.client)
    status, error = app.client.upload(f"/api/projects/{project}/assets/import", data)
    assert status == 400
    assert error["error"]


def test_an_image_above_forty_megapixels_is_refused(app: Studioed) -> None:
    _, project = _project(app.client)
    status, error = app.client.upload(
        f"/api/projects/{project}/assets/import", _picture((8000, 5200), "PNG")
    )
    assert status == 413
    assert "large" in str(error["error"]).lower()


def test_an_upload_over_the_cap_is_refused_before_it_is_read(app: Studioed) -> None:
    _, project = _project(app.client)
    status, _, data = app.client.raw(
        "POST",
        f"/api/projects/{project}/assets/import",
        None,
        {"Content-Type": "image/png", "Content-Length": str(26 * 1024 * 1024)},
    )
    assert status == 413
    assert json.loads(data)["error"]


def test_only_an_approved_candidate_of_a_run_becomes_an_asset(app: Studioed) -> None:
    _, project = _project(app.client)
    status, job = app.client.call(
        "POST",
        f"/api/projects/{project}/runs",
        {"models": ["procedural", "procedural-offbrand"], "candidates": 4},
    )
    assert status == 202
    for _ in range(600):
        _, state = app.client.call("GET", f"/api/jobs/{job['job']}")
        if state["state"] != "running":
            break
        time.sleep(0.05)
    assert state["state"] == "done", state
    run = str(state["run_id"])
    _, detail = app.client.call("GET", f"/api/runs/{run}")
    candidates = detail["candidates"]
    assert isinstance(candidates, list)
    good = next(c["id"] for c in candidates if c["status"] == "pending")
    path = f"/api/projects/{project}/assets/from-run"
    status, error = app.client.call("POST", path, {"run": run, "candidate": good})
    assert status == 400
    assert "Approve" in str(error["error"])
    app.client.call(
        "POST",
        f"/api/runs/{run}/decisions",
        {"candidate": good, "verdict": "approve", "reviewer": "Ana"},
    )
    status, asset = app.client.call("POST", path, {"run": run, "candidate": good})
    assert status == 201
    assert asset["status"] == "approved"
    status, again = app.client.call("POST", path, {"run": run, "candidate": good})
    assert (status, again["id"]) == (200, asset["id"])
    decision = f"/api/projects/{project}/assets/{asset['id']}/decision"
    status, redecided = app.client.call(
        "POST", decision, {"verdict": "approve", "reviewer": "Bo", "note": "Second look"}
    )
    assert status == 200, redecided
    record = redecided["decision"]
    assert isinstance(record, dict)
    assert (record["reviewer"], record["rights_confirmed"]) == ("Bo", True)
    _, listed = app.client.call("GET", f"/api/projects/{project}")
    assert listed["runs"] == [run]
    bad = next(c["id"] for c in candidates if c["status"] == "auto_rejected")
    assert app.client.call("POST", path, {"run": run, "candidate": bad})[0] == 400
    assert app.client.call("POST", path, {"run": "../x", "candidate": good})[0] in {400, 404}


def test_a_hosted_model_below_one_megapixel_is_refused_before_any_call(
    app: Studioed, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    _, project = _project(app.client)
    status, error = app.client.call(
        "POST", f"/api/projects/{project}/runs", {"models": ["gpt-image-2.6-sunburst"]}
    )
    assert status == 400
    assert error["error"]


# --- deliveries ----------------------------------------------------------------------------


def _delivery(
    app: Studioed, formats: list[str] | None = None, extras: list[str] | None = None
) -> tuple[str, dict[str, object]]:
    _, project = _project(app.client)
    asset = _approved_import(app.client, project)
    assert app.client.call("PUT", f"/api/projects/{project}/design", _design(asset))[0] == 200
    status, started = app.client.call(
        "POST",
        f"/api/projects/{project}/deliveries",
        {"formats": formats or ["linkedin-square"], "extras": extras or []},
    )
    assert status == 202, started
    return project, _wait_delivery(app.client, project, str(started["id"]))


def test_a_delivery_renders_files_and_serves_them(app: Studioed) -> None:
    project, done = _delivery(app, ["linkedin-square", "story"])
    assert done["state"] == "done"
    outputs = done["outputs"]
    assert isinstance(outputs, list)
    assert [o["name"] for o in outputs] == ["linkedin-square.png", "story.png"]
    assert all(c["passed"] for c in done["checks"])  # type: ignore[attr-defined]
    base = f"/api/projects/{project}/deliveries/{done['id']}"
    status, headers, data = app.client.raw("GET", f"{base}/files/story.png")
    assert status == 200
    assert data.startswith(b"\x89PNG fake story")
    assert headers["content-type"] == "image/png"
    assert "attachment" not in headers.get("content-disposition", "")
    status, headers, _ = app.client.raw("GET", f"{base}/files/story.png?download=1")
    assert 'attachment; filename="story.png"' in headers["content-disposition"]
    status, headers, data = app.client.raw(
        "GET", f"{base}/files/story.png", None, {"Range": "bytes=0-3"}
    )
    assert (status, data) == (206, b"\x89PNG")
    assert headers["content-range"].startswith("bytes 0-3/")
    status, _, data = app.client.raw("GET", f"{base}/zip")
    assert status == 200
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert archive.namelist() == ["linkedin-square.png", "story.png"]


def test_only_the_chosen_extras_are_delivered(app: Studioed) -> None:
    _, done = _delivery(app, ["linkedin-portrait"], ["mp4"])
    assert done["state"] == "done"
    outputs = done["outputs"]
    assert isinstance(outputs, list)
    assert [o["name"] for o in outputs] == ["linkedin-portrait.mp4", "linkedin-portrait.png"]


def test_a_failed_check_still_delivers_and_says_what_failed_in_words(app: Studioed) -> None:
    app.set_mode("failed-check")
    _, done = _delivery(app)
    assert done["state"] == "done"
    checks = done["checks"]
    assert isinstance(checks, list)
    failed = [c for c in checks if not c["passed"]]
    assert [c["name"] for c in failed] == ["Headline fits on its line (LinkedIn square)"]
    assert done["outputs"]


def test_a_render_that_produced_nothing_fails_with_the_engine_message(app: Studioed) -> None:
    app.set_mode("nothing")
    _, done = _delivery(app)
    assert done["state"] == "failed"
    assert "headline is missing" in str(done["error"])
    assert done["outputs"] == []


def test_an_output_that_differs_from_the_report_is_not_delivered(app: Studioed) -> None:
    app.set_mode("tampered")
    _, done = _delivery(app)
    assert done["state"] == "failed"
    assert done["outputs"] == []


def test_a_render_that_hangs_is_stopped_at_the_limit(app: Studioed) -> None:
    app.set_mode("hang")
    _, done = _delivery(app)
    assert done["state"] == "failed"
    assert "longer than" in str(done["error"])


def test_a_delivery_needs_a_headline_and_runs_one_at_a_time(app: Studioed) -> None:
    _, project = _project(app.client)
    asset = _approved_import(app.client, project)
    app.client.call("PUT", f"/api/projects/{project}/design", _design(asset, headline=""))
    status, error = app.client.call(
        "POST", f"/api/projects/{project}/deliveries", {"formats": ["story"], "extras": []}
    )
    assert status == 400
    assert error["fields"] == {"design.copy.headline": "Write a headline"}
    app.client.call("PUT", f"/api/projects/{project}/design", _design(asset))
    app.set_mode("hang")
    path = f"/api/projects/{project}/deliveries"
    body = {"formats": ["story"], "extras": []}
    assert app.client.call("POST", path, body)[0] == 202
    assert app.client.call("POST", path, body)[0] == 409
    assert app.server.deliveries.wait_idle(10)  # type: ignore[attr-defined]


def test_a_started_delivery_renders_the_design_and_brand_saved_when_it_started(
    app: Studioed, monkeypatch: pytest.MonkeyPatch
) -> None:
    brand, project = _project(app.client)
    asset = _approved_import(app.client, project)
    app.client.call("PUT", f"/api/projects/{project}/design", _design(asset, "First words"))
    # Hold the render thread at any read until the design and brand have changed underneath it.
    release = threading.Event()
    studio = app.studio

    def held(read: Callable[[str], T]) -> Callable[[str], T]:
        def wait_then_read(key: str) -> T:
            if threading.current_thread().name.startswith("delivery-"):
                release.wait(10)
            return read(key)

        return wait_then_read

    monkeypatch.setattr(studio, "get_project", held(studio.get_project))
    monkeypatch.setattr(studio, "get_brand", held(studio.get_brand))
    status, started = app.client.call(
        "POST", f"/api/projects/{project}/deliveries", {"formats": ["story"], "extras": []}
    )
    assert status == 202, started
    app.client.call("PUT", f"/api/projects/{project}/design", _design(asset, "Later words"))
    changed = {**BRAND, "colours": {**COLOURS, "accent": "#123456"}}
    assert app.client.call("PUT", f"/api/brands/{brand}", changed)[0] == 200
    release.set()
    done = _wait_delivery(app.client, project, str(started["id"]))
    assert done["state"] == "done", done
    folder = app.studio.delivery_dir(project, str(started["id"]))
    source = json.loads((folder / "source.json").read_text(encoding="utf-8"))
    assert source["design"]["copy"]["headline"] == "First words"
    assert source["brand"]["colours"]["accent"] == COLOURS["accent"]


def test_an_engine_without_its_packages_says_how_to_install_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine_dir = _fake_engine(tmp_path, monkeypatch)
    (engine_dir / "node_modules").rmdir()
    engine = Engine(engine_dir)
    assert engine.problem is not None
    assert "npm ci" in engine.problem
    assert str(engine_dir) in engine.problem


def test_without_node_deliveries_and_preview_answer_503_with_a_reason(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PATH", str(tmp_path))
    (tmp_path / "missing" / "fonts").mkdir(parents=True)  # the fonts are there, the engine is not
    shutil.copyfile(CATALOG, tmp_path / "missing" / "fonts" / "catalog.json")
    engine = Engine(tmp_path / "missing")
    engine.prepare_preview()
    runs = tmp_path / "runs"
    runs.mkdir()
    server = make_server(
        Workspace(run_roots=(runs,)), runs, 0, studio=Studio(tmp_path / "s"), engine=engine
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    client = Client(server)
    try:
        status, error = client.call("GET", "/engine/studio.html")
        assert status == 503
        assert "engine" in str(error["error"])
        _, project = _project(client)
        status, error = client.call(
            "POST", f"/api/projects/{project}/deliveries", {"formats": ["story"], "extras": []}
        )
        assert status == 503
    finally:
        server.shutdown()
        server.server_close()


def test_the_engine_is_served_read_only_with_a_fixed_type_map(app: Studioed) -> None:
    status, headers, data = app.client.raw("GET", "/engine/studio.html")
    assert (status, headers["content-type"]) == (200, "text/html; charset=utf-8")
    assert data == b"<html>preview</html>"
    status, headers, _ = app.client.raw("GET", "/engine/src/design.ts")
    assert headers["content-type"] == "text/javascript; charset=utf-8"
    for path in (
        "/engine/evil.exe",
        "/engine/../mode.txt",
        "/engine/%2e%2e/mode.txt",
        "/engine/src",
    ):
        assert app.client.raw("GET", path)[0] == 404, path
    assert app.client.raw(
        "POST", "/engine/studio.html", b"{}", {"Content-Type": "application/json"}
    )[0] in {404, 405}


# --- the boundary --------------------------------------------------------------------------

WRITES = [
    ("POST", "/api/brands"),
    ("PUT", "/api/projects/x/design"),
    ("DELETE", "/api/keys/OPENAI_API_KEY"),
    ("POST", "/api/keys"),
    ("POST", "/api/budget"),
]


@pytest.mark.parametrize(("method", "path"), WRITES)
def test_every_write_needs_the_session_token(app: Studioed, method: str, path: str) -> None:
    headers = {"Content-Type": "application/json"}
    for token in (None, "wrong", "0" * 64):
        extra = {"X-CSL-Session": token} if token else {}
        status, _, _ = app.client.raw(method, path, b"{}", {**headers, **extra}, token=False)
        assert status == 403, (method, path, token)


def test_the_token_is_not_given_to_a_foreign_host_or_origin_or_site(app: Studioed) -> None:
    for headers in (
        {"Host": "evil.example"},
        {"Host": "evil.example:80"},
        {"Host": "127.0.0.1.evil.example"},
        {"Origin": "https://evil.example"},
        {"Sec-Fetch-Site": "cross-site"},
        {"Sec-Fetch-Site": "same-site"},
    ):
        status, _, data = app.client.raw("GET", "/api/session", None, headers)
        assert status == 403, headers
        assert app.client.token.encode() not in data


def test_a_write_from_another_origin_is_refused_even_with_the_token(app: Studioed) -> None:
    body = json.dumps(BRAND).encode()
    base = {"Content-Type": "application/json"}
    for origin in ("https://evil.example", "http://localhost.evil.example", "null"):
        status, _, _ = app.client.raw("POST", "/api/brands", body, {**base, "Origin": origin})
        assert status == 403, origin
    status, _, _ = app.client.raw(
        "POST", "/api/brands", body, {**base, "Origin": f"http://localhost:{app.client.port}"}
    )
    assert status == 201


@pytest.mark.parametrize(
    "content_type",
    ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""],
)
def test_a_form_or_text_post_cannot_write(app: Studioed, content_type: str) -> None:
    headers = {"Content-Type": content_type} if content_type else {}
    status, _, _ = app.client.raw("POST", "/api/brands", json.dumps(BRAND).encode(), headers)
    assert status in {403, 415}
    assert app.studio.list_brands() == []


def test_bodies_are_capped_before_they_are_read_and_a_length_is_required(app: Studioed) -> None:
    status, _, _ = app.client.raw(
        "POST",
        "/api/brands",
        None,
        {"Content-Type": "application/json", "Content-Length": "99999999"},
    )
    assert status == 413
    conn = http.client.HTTPConnection("127.0.0.1", app.client.port, timeout=10)
    conn.putrequest("POST", "/api/brands")
    conn.putheader("X-CSL-Session", app.client.token)
    conn.putheader("Content-Type", "application/json")
    conn.putheader("Transfer-Encoding", "chunked")
    conn.endheaders()
    assert conn.getresponse().status == 411
    conn.close()
    assert app.client.raw(
        "POST", "/api/brands", b"{}", {"Content-Type": "application/json", "Content-Length": "x"}
    )[0] in {400, 411}


def test_responses_carry_the_security_headers(app: Studioed) -> None:
    status, headers, _ = app.client.raw("GET", "/api/formats")
    assert status == 200
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["cross-origin-resource-policy"] == "same-origin"
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["x-frame-options"] == "SAMEORIGIN"
    assert "no-store" in headers["cache-control"]
    assert "default-src 'none'" in headers["content-security-policy"]
    assert "python" not in headers.get("server", "").lower()
    status, headers, _ = app.client.raw("GET", "/engine/studio.html")
    assert "frame-ancestors 'self'" in headers["content-security-policy"]


def test_an_error_never_shows_a_path_or_a_traceback(app: Studioed) -> None:
    for path in ("/api/nope", "/api/projects/missing", "/nowhere"):
        status, _, data = app.client.raw("GET", path)
        assert status == 404
        text = data.decode()
        assert "Traceback" not in text
        assert str(app.studio.root) not in text


def test_a_symlink_in_the_studio_folder_is_never_followed(app: Studioed, tmp_path: Path) -> None:
    _, project = _project(app.client)
    asset = _approved_import(app.client, project)
    secret = tmp_path / "secret.png"
    secret.write_bytes(_picture())
    stored = app.studio.asset_file(project, asset)
    stored.unlink()
    stored.symlink_to(secret)
    status, _, data = app.client.raw("GET", f"/api/projects/{project}/assets/{asset}/image")
    assert status in {404, 500}
    assert data != secret.read_bytes()
    outside = tmp_path / "outside"
    outside.mkdir()
    (app.studio.root / "brands" / "evil").symlink_to(outside)
    assert app.client.call("GET", "/api/brands/evil")[0] == 404


def test_a_delivery_that_lists_a_traversing_name_cannot_be_downloaded(app: Studioed) -> None:
    project, done = _delivery(app)
    path = app.studio.root / "projects" / project / "project.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["deliveries"][0]["outputs"][0]["name"] = "../../project.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    base = f"/api/projects/{project}/deliveries/{done['id']}"
    assert app.client.raw("GET", f"{base}/files/..%2f..%2fproject.json")[0] == 404
    assert app.client.raw("GET", f"{base}/zip")[0] in {404, 500}


@pytest.mark.parametrize(
    ("raw", "safe"),
    [
        ('a"b\r\nSet-Cookie: x=1.png', "a-b--Set-Cookie--x-1.png"),
        ("../../etc/passwd", "etc-passwd"),
        ("", "file"),
    ],
)
def test_file_names_in_headers_are_reduced_to_safe_characters(raw: str, safe: str) -> None:
    result = safe_filename(raw)
    assert result == safe
    assert all(c.isalnum() or c in "._-" for c in result)
    assert len(result) <= 80


# --- keys ----------------------------------------------------------------------------------


def test_a_typed_key_is_kept_in_memory_and_never_returned_or_logged(
    app: Studioed, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    caplog.set_level(logging.DEBUG)
    status, answer = app.client.call(
        "POST", "/api/keys", {"variable": "OPENAI_API_KEY", "value": FAKE_KEY}
    )
    assert status in {200, 201, 204}
    assert FAKE_KEY not in json.dumps(answer)
    status, _, data = app.client.raw("GET", "/api/setup")
    assert FAKE_KEY.encode() not in data
    openai = next(p for p in json.loads(data)["providers"] if p["variable"] == "OPENAI_API_KEY")
    assert openai["set"] is True
    assert openai["source"] == "studio"
    status, _ = app.client.call("POST", "/api/keys", {"variable": "PATH", "value": "x"})
    assert status == 400
    assert app.client.call("DELETE", "/api/keys/OPENAI_API_KEY")[0] in {200, 204}
    _, _, data = app.client.raw("GET", "/api/setup")
    openai = next(p for p in json.loads(data)["providers"] if p["variable"] == "OPENAI_API_KEY")
    assert openai["set"] is False
    assert openai["source"] is None
    assert FAKE_KEY not in caplog.text
    assert os.environ.get("OPENAI_API_KEY") is None


def test_the_setup_reports_the_budget_fields(app: Studioed) -> None:
    _, _, data = app.client.raw("GET", "/api/setup")
    assert json.loads(data)["budget"] is None


def test_a_spending_limit_set_in_the_studio_opens_paid_models_at_once_and_is_kept(
    app: Studioed, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", FAKE_KEY)
    _, project = _project(app.client)
    app.client.call(
        "PUT",
        f"/api/projects/{project}/brief",
        {"subject": "a cup of tea", "kind": "photo", "shape": "portrait", "candidates": 1},
    )

    def gpt() -> dict[str, object]:
        _, rows = app.client.call("GET", f"/api/projects/{project}/models")
        assert isinstance(rows, list)
        return next(r for r in rows if str(r["key"]).startswith("gpt-image"))

    assert "spending limit" in str(gpt()["reason"])
    for bad in (
        {"approved_usd": 0, "approved_by": "Ann"},
        {"approved_usd": 5000, "approved_by": "Ann"},
        {"approved_usd": 5, "approved_by": "  "},
    ):
        assert app.client.call("POST", "/api/budget", bad)[0] == 400, bad
    status, budget = app.client.call(
        "POST", "/api/budget", {"approved_usd": 5, "approved_by": "Ann"}
    )
    assert status == 200
    assert budget["approved_usd"] == 5
    assert budget["approved_by"] == "Ann"
    assert gpt()["available"] is True
    kept = app.studio.saved_budget()
    assert kept is not None
    assert kept.approval.approved_usd == 5


@pytest.mark.parametrize(
    ("engine_name", "words"),
    [
        ("Headline fits on its line", "Headline fits"),
        ("Text is readable against the background", "readable"),
    ],
)
def test_check_names_are_sentences(engine_name: str, words: str) -> None:
    assert words in plain_check(engine_name)


def test_the_frontend_folder_cannot_be_escaped(tmp_path: Path) -> None:
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<p>app</p>", encoding="utf-8")
    (tmp_path / "private.txt").write_text("private", encoding="utf-8")
    runs = tmp_path / "runs"
    runs.mkdir()
    workspace = Workspace(run_roots=(runs,), static_dir=static)
    server = make_server(workspace, runs, 0, studio=Studio(tmp_path / "s"), engine=Engine(tmp_path))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    client = Client(server)
    try:
        for path in (
            "/../private.txt",
            "/%2e%2e/private.txt",
            "/..%2fprivate.txt",
            "/a/../../private.txt",
        ):
            status, _, data = client.raw("GET", path)
            assert b"private" not in data, path
            assert status in {200, 404}
        assert client.raw("GET", "/anything")[2] == b"<p>app</p>"
    finally:
        server.shutdown()
        server.server_close()


FONT_FILE = CATALOG.parent / "Inter-latin-var.woff2"


def _upload_font(
    client: Client, data: bytes, family: str = "House Sans", rights: str = "confirmed"
) -> tuple[int, dict[str, object]]:
    query = urllib.parse.urlencode({"family": family, "rights": rights})
    status, _, answer = client.raw(
        "POST", f"/api/fonts?{query}", data, {"Content-Type": "application/octet-stream"}
    )
    return status, json.loads(answer)


def _fonts(client: Client) -> list[dict[str, object]]:
    status, _, data = client.raw("GET", "/api/fonts")
    assert status == 200
    fonts: list[dict[str, object]] = json.loads(data)
    return fonts


def test_the_bundled_fonts_are_offered_with_how_each_is_set(app: Studioed) -> None:
    fonts = _fonts(app.client)
    families = [font["family"] for font in fonts]
    assert {"Newsreader", "Figtree", "Playfair Display", "DM Sans"} <= set(families)
    newsreader = fonts[families.index("Newsreader")]
    assert newsreader["url"] == "fonts/Newsreader-latin-var.woff2"
    assert newsreader["kind"] == "serif"
    assert set(newsreader) >= {"weights", "display", "body", "label"}


def test_an_uploaded_font_is_kept_served_and_usable_in_a_brand(app: Studioed) -> None:
    data = FONT_FILE.read_bytes()
    status, font = _upload_font(app.client, data)
    assert status == 201, font
    assert font["family"] == "House Sans"
    assert font["kind"] == "uploaded"
    status, headers, served = app.client.raw("GET", str(font["url"]))
    assert (status, headers["content-type"], served) == (200, "font/woff2", data)
    assert "House Sans" in [entry["family"] for entry in _fonts(app.client)]
    brand = {**BRAND, "type": {"display": "Newsreader", "body": "House Sans"}}
    status, created = app.client.call("POST", "/api/brands", brand)
    assert status == 201, created


def test_a_brand_with_a_font_that_is_not_on_offer_is_refused_at_the_field(app: Studioed) -> None:
    brand = {**BRAND, "type": {"display": "Comic Sans", "body": "DM Sans"}}
    status, error = app.client.call("POST", "/api/brands", brand)
    assert status == 400
    fields = error["fields"]
    assert isinstance(fields, dict)
    assert list(fields) == ["type.display"]


@pytest.mark.parametrize(
    ("data", "family", "rights", "field"),
    [
        (b"PK\x03\x04" + b"\x00" * 600, "House Sans", "confirmed", None),
        (b"wOF2" + b"\x00" * 10, "House Sans", "confirmed", None),
        (None, "House Sans", "", "rights"),
        (None, "<script>", "confirmed", "family"),
        (None, "dm sans", "confirmed", "family"),
    ],
)
def test_a_font_upload_is_refused_with_a_reason(
    app: Studioed, data: bytes | None, family: str, rights: str, field: str | None
) -> None:
    status, error = _upload_font(app.client, data or FONT_FILE.read_bytes(), family, rights)
    assert status == 400, error
    assert error["error"]
    if field is not None:
        assert field in error["fields"]  # type: ignore[operator]
    assert not (app.studio.root / "fonts").exists() or not any(
        (app.studio.root / "fonts").glob("*.woff2")
    )


def test_a_font_upload_needs_the_session_and_a_font_type(app: Studioed) -> None:
    data = FONT_FILE.read_bytes()
    status, _, _ = app.client.raw(
        "POST",
        "/api/fonts?family=X&rights=confirmed",
        data,
        {"Content-Type": "font/woff2"},
        token=False,
    )
    assert status == 403
    status, _, _ = app.client.raw(
        "POST", "/api/fonts?family=X&rights=confirmed", data, {"Content-Type": "image/png"}
    )
    assert status == 415
    for path in ("/api/fonts/f000000/file", "/api/fonts/..%2fx/file", "/api/fonts/F123ABC/file"):
        assert app.client.raw("GET", path)[0] == 404


def test_a_delivery_carries_its_fonts_and_copies_an_uploaded_one(app: Studioed) -> None:
    _, font = _upload_font(app.client, FONT_FILE.read_bytes())
    _, brand = app.client.call(
        "POST", "/api/brands", {**BRAND, "type": {"display": "Newsreader", "body": "House Sans"}}
    )
    status, project = app.client.call(
        "POST", "/api/projects", {"name": "House", "brand": brand["id"]}
    )
    assert status == 201
    assert app.client.call("PUT", f"/api/projects/{project['id']}/brief", BRIEF)[0] == 200
    asset = _approved_import(app.client, str(project["id"]))
    path = f"/api/projects/{project['id']}"
    assert app.client.call("PUT", f"{path}/design", _design(asset))[0] == 200
    _, started = app.client.call("POST", f"{path}/deliveries", {"formats": ["story"], "extras": []})
    done = _wait_delivery(app.client, str(project["id"]), str(started["id"]))
    assert done["state"] == "done", done
    folder = app.studio.delivery_dir(str(project["id"]), str(done["id"]))
    source = json.loads((folder / "source.json").read_text(encoding="utf-8"))
    by_family = {face["family"]: face for face in source["fonts"]}
    assert by_family["Newsreader"]["url"] == "fonts/Newsreader-latin-var.woff2"
    uploaded = str(by_family["House Sans"]["url"])
    assert uploaded.startswith("fonts/f")
    assert uploaded != font["url"]
    assert (folder / uploaded).read_bytes() == FONT_FILE.read_bytes()
