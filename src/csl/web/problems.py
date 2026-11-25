"""Errors the API answers with, in words for the person who caused them.

``ApiError`` carries an HTTP status, one plain sentence and, for a form, a message per field.
``from_validation`` turns a pydantic error into that shape: each failing field becomes a dotted
path of the request body with a sentence the designer can act on.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from pydantic import ValidationError

_FIELD_WORDS = {
    "name": "Give it a name",
    "subject": "Write what the image should show",
    "brand": "Choose a brand",
    "reviewer": "Write your name",
    "formats": "Pick at least one format",
    "models": "Pick at least one model",
    "colours": "Choose the four colours",
    "type": "Choose the two typefaces",
    "variable": "Choose which key this is",
    "value": "Paste the key",
    "run": "Choose a run",
    "candidate": "Choose an image of the run",
}
_RANGES = {
    "zoom": "0.5 and 2",
    "headline_scale": "0.5 and 2",
    "night": "0 and 1",
    "x": "0 and 1",
    "y": "0 and 1",
    "candidates": "1 and 16",
}
_TYPE_WORDS = {
    "missing": "This is required",
    "extra_forbidden": "This setting does not exist",
    "string_too_short": "This cannot be empty",
    "bool_type": "Use yes or no",
    "bool_parsing": "Use yes or no",
    "int_type": "Use a whole number",
    "int_parsing": "Use a whole number",
    "float_type": "Use a number",
    "float_parsing": "Use a number",
    "string_type": "Use text",
    "list_type": "Use a list",
    "model_type": "Fill in the fields of this section",
    "dict_type": "Fill in the fields of this section",
    "too_short": "Pick at least one",
    "string_pattern_mismatch": "Use only lowercase letters, digits and dashes",
}


_BOUND_ERRORS = {
    "greater_than",
    "greater_than_equal",
    "less_than",
    "less_than_equal",
}


class ApiError(Exception):
    """A request that cannot be done, with the sentence to show and the fields it concerns."""

    def __init__(
        self,
        message: str,
        status: int = HTTPStatus.BAD_REQUEST,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.fields = fields or {}


def refuse(
    message: str, status: int = HTTPStatus.BAD_REQUEST, fields: dict[str, str] | None = None
) -> NoReturn:
    """Answer with ``message``; ``fields`` maps dotted body paths to what is wrong there."""
    raise ApiError(message, status, fields)


def not_found(what: str) -> NoReturn:
    """Answer 404 and name what is missing: ``not_found("project")``."""
    msg = f"That {what} does not exist."
    raise ApiError(msg, HTTPStatus.NOT_FOUND)


def _sentence(error: dict[str, object]) -> str:
    kind = str(error["type"])
    context = error.get("ctx")
    limits = context if isinstance(context, dict) else {}
    if kind == "value_error" and "error" in limits:
        return str(limits["error"])
    location = error.get("loc")
    last = str(location[-1]) if isinstance(location, tuple) and location else ""
    if kind in _BOUND_ERRORS and last in _RANGES:
        return f"Use a number between {_RANGES[last]}"
    if kind == "string_too_long" and "max_length" in limits:
        return f"Use at most {limits['max_length']} characters"
    if kind in {"literal_error", "enum"}:
        expected = str(limits.get("expected", "")).replace("'", "")
        return f"Pick one of: {expected}" if expected else "Pick one of the choices"
    word = _FIELD_WORDS.get(last)
    if word is not None and kind in {"string_too_short", "missing", "too_short"}:
        return word
    return _TYPE_WORDS.get(kind, "This value is not valid")


def from_validation(error: ValidationError, prefix: str = "") -> ApiError:
    """The API error for a failed validation: one sentence plus a message per field."""
    fields: dict[str, str] = {}
    for item in error.errors():
        path = ".".join(str(part) for part in item["loc"])
        fields.setdefault(f"{prefix}{path}" if path else prefix.rstrip("."), _sentence(dict(item)))
    first = next(iter(fields.values()), "Check the form")
    return ApiError(f"{first}.", HTTPStatus.BAD_REQUEST, fields)
