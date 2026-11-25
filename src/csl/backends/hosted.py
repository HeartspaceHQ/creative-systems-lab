"""Shared plumbing for hosted image APIs: keys, HTTPS, JSON access and saving what came back.

Every hosted backend is a thin client over the standard library. Network access goes through a
``Transport`` so tests can replace it, and so a dry run can never reach the network by accident.
API keys are read from the environment at call time and are never written to any record.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from PIL import Image, UnidentifiedImageError

from csl.backends.base import BackendError

if TYPE_CHECKING:
    from collections.abc import Callable, Iterator, Mapping, Sequence
    from pathlib import Path

_TIMEOUT_SECONDS = 180
_ERROR_EXCERPT = 600


class HostedError(BackendError):
    """A hosted API refused a request or answered with something unusable.

    ``status`` is the HTTP status when the provider answered with one, else None.
    """

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class Transport(Protocol):
    """Sends one HTTPS request and returns the response body."""

    def send(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> bytes:
        """Return the body of a 2xx response; raise ``HostedError`` otherwise."""
        ...


class UrllibTransport:
    """The real network, through ``urllib``. HTTPS only."""

    def send(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> bytes:
        """Send the request. Non-2xx responses become ``HostedError`` with the body excerpt."""
        if not url.startswith("https://"):
            msg = f"refusing non-HTTPS URL {url!r}"
            raise HostedError(msg)
        request = urllib.request.Request(url, data=body, headers=dict(headers), method=method)
        try:
            with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
                payload: bytes = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:_ERROR_EXCERPT]
            msg = f"{method} {url} -> HTTP {error.code}: {detail}"
            raise HostedError(msg, error.code) from error
        except (urllib.error.URLError, TimeoutError) as error:
            msg = f"{method} {url} failed: {error}"
            raise HostedError(msg) from error
        return payload


@contextmanager
def after_submission() -> Iterator[None]:
    """Mark the requests that follow an accepted job (polling, downloading the result).

    The provider may have charged for the job by then, so a refusal here says nothing about
    cost: the HTTP status is dropped and the budget keeps the reservation.
    """
    try:
        yield
    except HostedError as error:
        raise HostedError(str(error)) from error


def key_missing(variable: str) -> str | None:
    """Why a hosted model cannot run here (its key is not set), or None."""
    return None if os.environ.get(variable) else f"{variable} is not set"


def api_key(variable: str) -> str:
    """The API key from the environment. Raises if it is missing."""
    value = os.environ.get(variable)
    if not value:
        msg = f"{variable} is not set"
        raise HostedError(msg)
    return value


def send_json(
    transport: Transport,
    method: str,
    url: str,
    headers: Mapping[str, str],
    payload: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Send JSON (or nothing) and parse a JSON object back."""
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    all_headers = {"Accept": "application/json", **headers}
    if body is not None:
        all_headers["Content-Type"] = "application/json"
    raw = transport.send(method, url, all_headers, body)
    try:
        parsed: object = json.loads(raw)
    except json.JSONDecodeError as error:
        msg = f"{url} did not return JSON: {raw[:200]!r}"
        raise HostedError(msg) from error
    if not isinstance(parsed, dict):
        msg = f"{url} returned JSON that is not an object"
        raise HostedError(msg)
    return {str(k): v for k, v in parsed.items()}


def dig(value: object, path: Sequence[str | int]) -> object:
    """Follow keys and indexes into parsed JSON. Returns None where the path does not exist."""
    current = value
    for step in path:
        if isinstance(step, int) and isinstance(current, list):
            if not -len(current) <= step < len(current):
                return None
            current = current[step]
        elif isinstance(step, str) and isinstance(current, dict) and step in current:
            current = current[step]
        else:
            return None
    return current


def text_at(value: object, path: Sequence[str | int]) -> str | None:
    """A string at ``path``, or None."""
    found = dig(value, path)
    return found if isinstance(found, str) else None


def number_at(value: object, path: Sequence[str | int]) -> float | None:
    """A number at ``path``, or None. Booleans are not numbers here."""
    found = dig(value, path)
    if isinstance(found, bool) or not isinstance(found, int | float):
        return None
    return float(found)


def find_inline_image(value: object) -> str | None:
    """First base64 image payload anywhere in a JSON tree.

    Matches ``b64_json`` fields and objects that carry ``data`` next to an image MIME type
    (``mimeType``, ``mime_type``), which covers the response shapes of the APIs used here
    without depending on one exact nesting.
    """
    if isinstance(value, dict):
        b64 = value.get("b64_json")
        if isinstance(b64, str):
            return b64
        mime = value.get("mimeType", value.get("mime_type"))
        data = value.get("data")
        if isinstance(mime, str) and mime.startswith("image/") and isinstance(data, str):
            return data
        children: list[object] = list(value.values())
    elif isinstance(value, list):
        children = list(value)
    else:
        return None
    for child in children:
        found = find_inline_image(child)
        if found is not None:
            return found
    return None


def decode_base64(data: str) -> bytes:
    """Decode a base64 image payload, with a clear error if it is not base64."""
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as error:
        msg = "image payload is not valid base64"
        raise HostedError(msg) from error


def save_image(data: bytes, output: Path) -> str:
    """Keep the provider's original bytes and write a PNG for the rest of the pipeline.

    The original is stored next to ``output`` as ``source.<format>`` so nothing the provider
    returned is lost. Returns the original format name.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            fmt = (image.format or "bin").lower()
            output.with_name(f"source.{fmt}").write_bytes(data)
            image.convert("RGB").save(output, format="PNG")
    except (UnidentifiedImageError, OSError) as error:
        msg = "provider returned bytes that are not an image"
        raise HostedError(msg) from error
    return fmt


def nearest_aspect(width: int, height: int, options: Sequence[str]) -> str:
    """The ``w:h`` option closest to the requested aspect ratio (compared on a log scale)."""
    target = width / height

    def distance(option: str) -> float:
        w, h = (float(part) for part in option.split(":"))
        ratio = w / h
        return max(ratio, target) / min(ratio, target)

    return min(options, key=distance)


def size_tier(long_side: int, tiers: Sequence[tuple[int, str]]) -> str:
    """The smallest tier label whose limit covers ``long_side``, else the largest."""
    for limit, label in tiers:
        if long_side <= limit:
            return label
    return tiers[-1][1]


@dataclass(frozen=True)
class PollSpec:
    """How to read an asynchronous job: where its status is and which values end the wait."""

    status_path: tuple[str | int, ...]
    ready: frozenset[str]
    failed: frozenset[str]
    interval_seconds: float = 2.0
    attempts: int = 150


def poll_until(
    fetch: Callable[[], dict[str, object]],
    spec: PollSpec,
    sleep: Callable[[float], None],
) -> dict[str, object]:
    """Fetch a job until its status is ready. Raise when it fails or never finishes."""
    for _ in range(spec.attempts):
        state = fetch()
        status = text_at(state, spec.status_path)
        if status in spec.ready:
            return state
        if status in spec.failed:
            msg = f"generation {status}: {json.dumps(state)[:_ERROR_EXCERPT]}"
            raise HostedError(msg)
        sleep(spec.interval_seconds)
    msg = f"generation not ready after {spec.attempts} polls"
    raise HostedError(msg)


def require_host(url: str, suffix: str) -> str:
    """Accept ``url`` only over HTTPS on a host ending in ``suffix``, before sending a key there."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if not url.startswith("https://") or not (host == suffix or host.endswith("." + suffix)):
        msg = f"refusing to send credentials to {url!r}"
        raise HostedError(msg)
    return url
