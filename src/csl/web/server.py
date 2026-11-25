"""Local HTTP server: JSON API under ``/api``, the engine's live preview, the built frontend.

Bound to 127.0.0.1 with no login: it is a single-user tool on the designer's machine. A web page
in another tab must not be able to drive it, so every request passes these guards before a
handler runs:

* ``Host`` must be a loopback name (against DNS rebinding);
* ``Origin``, if the browser sent one, must be a loopback origin, and ``Sec-Fetch-Site`` must say
  the request is same-origin (or typed in by the user) for the API, the preview and every write;
* every write (POST, PUT, DELETE) carries the per-process session token in ``X-CSL-Session``,
  which only a page of this server can read (``GET /api/session``; no CORS header is ever sent);
* a body is read only after its size and type are checked: 64 KiB of ``application/json``, or an
  image of at most 25 MiB. ``Content-Length`` is required, chunked bodies are refused.

Answers carry ``nosniff``, a content security policy, ``X-Frame-Options`` and a same-origin
resource policy; the API is never cached. The request log is off, so no body or header is kept.
"""

from __future__ import annotations

import hmac
import json
import logging
import mimetypes
import re
import secrets
import socketserver
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import TYPE_CHECKING, cast
from urllib.parse import parse_qsl

from csl import integrity, keys, review
from csl.backends.base import BackendError
from csl.budget import BudgetError
from csl.web import routes_runs, routes_studio
from csl.web.deliveries import DeliveryRunner, safe_filename
from csl.web.engine import Engine
from csl.web.fonts import MAX_FONT_BYTES, FontLibrary
from csl.web.jobs import JobBusyError, JobRunner
from csl.web.problems import ApiError
from csl.web.routing import Body, Raw, Request, Route, Upload
from csl.web.uploads import MAX_UPLOAD_BYTES, UPLOAD_TYPES
from csl.web.workspace import NotFoundError, Workspace

if TYPE_CHECKING:
    from pathlib import Path

    from csl.budget import Budget
    from csl.web.studio import Studio

logger = logging.getLogger(__name__)

SESSION_HEADER = "X-CSL-Session"
MAX_JSON_BYTES = 64 * 1024
_LOOPBACK = r"(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?"
_HOST = re.compile(rf"^{_LOOPBACK}$")
_ORIGIN = re.compile(rf"^http://{_LOOPBACK}$")
_LENGTH = re.compile(r"^\d{1,12}$")
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
_SAME_ORIGIN = {None, "same-origin", "none"}
_GUARDED_PREFIXES = ("/api/", "/engine/")
# The studio sends fonts as plain bytes; what they are is read from the bytes themselves.
_FONT_UPLOAD_TYPES = {"application/octet-stream", "font/woff2", "font/woff", "font/ttf", "font/otf"}
_APP_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; "
    "object-src 'none'"
)
_API_POLICY = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'"
_DOCUMENT_POLICY = "frame-ancestors 'self'"
_ROUTES: dict[str, list[Route]] = {
    "GET": [*routes_runs.GET, *routes_studio.GET],
    "POST": [*routes_runs.POST, *routes_studio.POST],
    "PUT": routes_studio.PUT,
    "DELETE": routes_studio.DELETE,
}
_CLIENT_ERRORS = (
    review.ReviewError,
    integrity.IntegrityError,
    BudgetError,
    KeyError,
    ValueError,
)


class _Server(ThreadingHTTPServer):
    """The HTTP server plus the application state its handlers need."""

    def __init__(
        self,
        port: int,
        workspace: Workspace,
        jobs: JobRunner,
        studio: Studio,
        engine: Engine,
        deliveries: DeliveryRunner,
        fonts: FontLibrary,
    ) -> None:
        super().__init__(("127.0.0.1", port), _RequestHandler)
        self.workspace = workspace
        self.jobs = jobs
        self.studio = studio
        self.engine = engine
        self.deliveries = deliveries
        self.fonts = fonts
        self.session_token = secrets.token_hex(32)

    def server_bind(self) -> None:
        """Bind without ``HTTPServer``'s reverse lookup, which can stall for many seconds."""
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = "127.0.0.1", self.server_address[1]

    def handle_error(self, request: object, client_address: object) -> None:
        """A connection that broke mid-answer is not worth a traceback in the terminal."""
        logger.debug("a connection broke while it was being answered")

    def server_close(self) -> None:
        """Close the socket and delete the engine's preview files."""
        super().server_close()
        self.engine.close()


class _RequestHandler(BaseHTTPRequestHandler):
    server_version = "csl"
    sys_version = ""
    timeout = 60

    @property
    def _app(self) -> _Server:
        return cast("_Server", self.server)

    def version_string(self) -> str:
        """Name the server, not the Python version behind it."""
        return self.server_version

    def log_message(self, format: str, *args: object) -> None:
        """Keep the terminal quiet: no request line, header or body is ever logged."""

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        """Answer a request the parser refused in the API's own shape."""
        self._error(code, "This request could not be understood.")

    # --- answers ---------------------------------------------------------------------------

    def _send(self, status: int, payload: object) -> None:
        if isinstance(payload, Raw):
            self._send_raw(status, payload)
            return
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._finish(status, data, "application/json; charset=utf-8")

    def _send_raw(self, status: int, raw: Raw) -> None:
        data, extra = raw.data, {}
        if raw.filename is not None:
            extra["Content-Disposition"] = f'attachment; filename="{safe_filename(raw.filename)}"'
        if raw.ranged:
            extra["Accept-Ranges"] = "bytes"
            window = _byte_range(self.headers.get("Range"), len(data))
            if isinstance(window, str):
                extra["Content-Range"] = f"bytes */{len(data)}"
                self._finish(
                    HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE, b"", raw.content_type, extra
                )
                return
            if window is not None:
                first, last = window
                extra["Content-Range"] = f"bytes {first}-{last}/{len(data)}"
                data, status = data[first : last + 1], HTTPStatus.PARTIAL_CONTENT
        self._finish(status, data, raw.content_type, extra)

    def _finish(
        self, status: int, data: bytes, content_type: str, extra: dict[str, str] | None = None
    ) -> None:
        path = getattr(self, "path", "")
        api = path.startswith("/api/")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if api else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", _policy(content_type, api=api))
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status: int, message: str, fields: dict[str, str] | None = None) -> None:
        self._send(status, {"error": message, "fields": fields or {}})

    # --- guards ----------------------------------------------------------------------------

    def _refusal(self, method: str, path: str) -> str | None:
        """Why this request must not run (a sentence), or None if it may."""
        if _HOST.match(self.headers.get("Host") or "") is None:
            return "Open the studio at http://127.0.0.1 or http://localhost."
        origin = self.headers.get("Origin")
        if origin is not None and _ORIGIN.match(origin) is None:
            return "This request came from another website and was refused."
        guarded = path.startswith(_GUARDED_PREFIXES)
        if (guarded or method != "GET") and self.headers.get("Sec-Fetch-Site") not in _SAME_ORIGIN:
            return "This request came from another website and was refused."
        if method != "GET" and not self._has_session():
            return "This page is not connected to the studio. Reload it and try again."
        return None

    def _has_session(self) -> bool:
        supplied = (self.headers.get(SESSION_HEADER) or "").encode("utf-8", "surrogateescape")
        return hmac.compare_digest(supplied, self._app.session_token.encode("ascii"))

    # --- bodies ----------------------------------------------------------------------------

    def _length(self, limit: int, too_large: str) -> int | None:
        """The declared body size, or None after answering that it is missing, bad or too big."""
        if self.headers.get("Transfer-Encoding") is not None:
            self._error(HTTPStatus.LENGTH_REQUIRED, "Send the size of the body (no chunking).")
            return None
        declared = self.headers.get("Content-Length")
        if declared is None:
            self._error(HTTPStatus.LENGTH_REQUIRED, "Send the size of the body.")
            return None
        if _LENGTH.match(declared) is None:
            self._error(HTTPStatus.BAD_REQUEST, "The size of the body is not valid.")
            return None
        if int(declared) > limit:
            self._error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, too_large)
            return None
        return int(declared)

    def _read(self, length: int) -> bytes | None:
        data = self.rfile.read(length)
        if len(data) != length:
            self._error(HTTPStatus.BAD_REQUEST, "The body ended before it was complete.")
            return None
        return data

    def _read_json(self) -> dict[str, object] | None:
        """Parse a JSON object body, or answer with an error and return None."""
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Send application/json.")
            return None
        length = self._length(MAX_JSON_BYTES, "That request is too large.")
        data = None if length is None else self._read(length)
        if data is None:
            return None
        try:
            body = json.loads(data or b"{}")
        except ValueError:
            self._error(HTTPStatus.BAD_REQUEST, "The request is not valid JSON.")
            return None
        if not isinstance(body, dict):
            self._error(HTTPStatus.BAD_REQUEST, "Send a JSON object.")
            return None
        return body

    def _read_upload(self, kind: Body) -> Upload | None:
        """Read a raw image or font body, or answer with an error and return None."""
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        font = kind == "font"
        accepted = _FONT_UPLOAD_TYPES if font else UPLOAD_TYPES
        if content_type not in accepted:
            wanted = "a WOFF2, WOFF, TTF or OTF font" if font else "a PNG, JPEG or WebP image"
            self._error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, f"Upload {wanted}.")
            return None
        limit = MAX_FONT_BYTES if font else MAX_UPLOAD_BYTES
        what = "font" if font else "image"
        too_large = f"That {what} is larger than {limit // (1024 * 1024)} MB."
        length = self._length(limit, too_large)
        data = None if length is None else self._read(length)
        if data is None:
            return None
        return Upload(data, content_type, self.headers.get("X-File-Name") or "")

    # --- dispatch --------------------------------------------------------------------------

    def _handle(self, method: str) -> None:
        path, _, query = self.path.partition("?")
        if (problem := self._refusal(method, path)) is not None:
            self._error(HTTPStatus.FORBIDDEN, problem)
            return
        for candidate in _ROUTES[method]:
            if (match := candidate.pattern.match(path)) is not None:
                self._run(candidate, match, query)
                return
        if method == "GET" and not path.startswith(_GUARDED_PREFIXES):
            self._static(path)
        else:
            self._error(HTTPStatus.NOT_FOUND, "There is no such page.")

    def _run(self, route: Route, match: re.Match[str], query: str) -> None:
        app = self._app
        request = Request(
            app.workspace,
            app.jobs,
            app.studio,
            app.engine,
            app.deliveries,
            app.fonts,
            app.session_token,
            query=dict(parse_qsl(query)),
        )
        if route.body == "json":
            body = self._read_json()
            if body is None:
                return
            request.body = body
        elif route.body in {"upload", "font"}:
            request.upload = self._read_upload(route.body)
            if request.upload is None:
                return
        self._call(route, request, match)

    def _call(self, route: Route, request: Request, match: re.Match[str]) -> None:
        """Run the handler and answer; every failure becomes a sentence, never a traceback."""
        try:
            status, payload = route.handler(request, match)
        except ApiError as error:
            self._error(error.status, error.message, error.fields)
        except NotFoundError as error:
            self._error(HTTPStatus.NOT_FOUND, f"not found: {error}")
        except JobBusyError:
            self._error(HTTPStatus.CONFLICT, "A generation is already running. Wait for it.")
        except (*_CLIENT_ERRORS, BackendError) as error:
            text = str(error.args[0]) if error.args else str(error)
            self._error(HTTPStatus.BAD_REQUEST, keys.redact(text))
        except Exception as error:
            logger.warning("unhandled error in %s: %s", self.command, keys.redact(str(error)))
            logger.debug("traceback of %s", self.command, exc_info=True)
            self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "Something went wrong on the server.")
        else:
            self._send(status, payload)

    def _static(self, path: str) -> None:
        root = self._app.workspace.static_dir
        if root is None or not root.is_dir():
            self._error(HTTPStatus.NOT_FOUND, "The frontend is not built (see web/).")
            return
        target = (root / path.lstrip("/")).resolve()
        if not target.is_file() or root.resolve() not in target.parents:
            target = root / "index.html"
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(HTTPStatus.OK, Raw(target.read_bytes(), content_type))

    def do_GET(self) -> None:
        """Serve the API, the preview files, or the frontend for any other path."""
        self._handle("GET")

    def do_POST(self) -> None:
        """Serve the create and action endpoints."""
        self._handle("POST")

    def do_PUT(self) -> None:
        """Serve the replace endpoints."""
        self._handle("PUT")

    def do_DELETE(self) -> None:
        """Serve the delete endpoints."""
        self._handle("DELETE")


def _policy(content_type: str, *, api: bool) -> str:
    """The content security policy of an answer: strict for the API, the app's for pages."""
    if not api:
        return _APP_POLICY
    return _DOCUMENT_POLICY if content_type == "application/pdf" else _API_POLICY


def _byte_range(header: str | None, size: int) -> tuple[int, int] | str | None:
    """The one byte range asked for, ``"unsatisfiable"``, or None to send the whole file."""
    match = _RANGE.match(header or "")
    if match is None or not (match[1] or match[2]):
        return None
    if match[1] == "":
        suffix = int(match[2])
        return (max(size - suffix, 0), size - 1) if suffix and size else "unsatisfiable"
    first = int(match[1])
    last = min(int(match[2]), size - 1) if match[2] else size - 1
    return (first, last) if first <= last and first < size else "unsatisfiable"


def make_server(
    workspace: Workspace,
    runs_dir: Path,
    port: int,
    budget: Budget | None = None,
    *,
    studio: Studio,
    engine: Engine | None = None,
) -> ThreadingHTTPServer:
    """Create the server (not yet serving). ``port`` 0 picks a free port.

    Without ``budget`` the UI can start local models only; with it, hosted models whose key is
    set, each run checked against what is left before the first call. A delivery that was still
    rendering when the last server stopped is marked failed.
    """
    used = engine or Engine()
    studio.fail_unfinished_deliveries()
    fonts = FontLibrary(used.directory / "fonts", studio.root / "fonts")
    return _Server(
        port,
        workspace,
        JobRunner(workspace, runs_dir, budget),
        studio,
        used,
        DeliveryRunner(studio, used, fonts),
        fonts,
    )
