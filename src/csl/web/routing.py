"""What the route handlers share: the request they receive, the answers they give, the table.

A handler is ``(Request, match) -> (status, payload)``. The payload is a JSON-able value, or
``Raw`` for a file. A route also says what body it reads, so the server can refuse a request
before reading it: nothing is read for ``none``, a small JSON object for ``json``, a raw image
for ``upload`` and a raw font file for ``font``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from csl.web.deliveries import DeliveryRunner
    from csl.web.engine import Engine
    from csl.web.fonts import FontLibrary
    from csl.web.jobs import JobRunner
    from csl.web.studio import Studio
    from csl.web.workspace import Workspace

ID = r"[A-Za-z0-9][A-Za-z0-9._-]*"
Body = Literal["none", "json", "upload", "font"]


@dataclass(frozen=True)
class Upload:
    """A raw file sent by the browser (an image or a font), before it is checked."""

    data: bytes
    content_type: str
    file_name: str


@dataclass(frozen=True)
class Raw:
    """A non-JSON answer: a file. ``filename`` makes it a download; ``ranged`` allows ``Range``."""

    data: bytes
    content_type: str
    filename: str | None = None
    ranged: bool = False


@dataclass
class Request:
    """One request as a handler sees it: the application's parts and the parsed input."""

    workspace: Workspace
    jobs: JobRunner
    studio: Studio
    engine: Engine
    deliveries: DeliveryRunner
    fonts: FontLibrary
    session_token: str
    body: dict[str, object] = field(default_factory=dict)
    query: dict[str, str] = field(default_factory=dict)
    upload: Upload | None = None


Handler = Callable[[Request, re.Match[str]], tuple[int, object]]


@dataclass(frozen=True)
class Route:
    """A path pattern, what it does and which body it reads."""

    pattern: re.Pattern[str]
    handler: Handler
    body: Body = "none"


def route(pattern: str, handler: Handler, body: Body = "none") -> Route:
    """A route for a path pattern written as a regular expression without anchors."""
    return Route(re.compile(f"^{pattern}$"), handler, body)
