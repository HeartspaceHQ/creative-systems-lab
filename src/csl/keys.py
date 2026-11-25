"""Provider keys typed or pasted at a hidden prompt, for one process only.

``csl serve --ask-key OPENAI_API_KEY`` asks for the key before the server starts. Nothing is echoed,
so the key never appears in the terminal, the shell history, a screen recording or a shared screen,
and it is never written anywhere: it lives in this process's environment until the process ends.
CSL Studio can also take a key in the browser (``POST /api/keys``); it is kept the same way and the
API never returns it.
"""

from __future__ import annotations

import getpass
import os
import re
from typing import TYPE_CHECKING, Literal

from csl import registry

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable


_MIN_SECRET = 8

KeySource = Literal["studio", "terminal"]
# Keys pasted in the studio; any other key that is set came with the process, from the terminal.
_PASTED: set[str] = set()


def provider_variables() -> list[str]:
    """Every environment variable a registered hosted model reads its key from."""
    return sorted({e.key_variable for e in registry.REGISTRY if e.key_variable is not None})


def ask_keys(variables: Iterable[str], prompt: Callable[[str], str] = getpass.getpass) -> list[str]:
    """Ask for each key without echo and put it in this process's environment.

    Returns the names that were set. An empty answer is an error, so a mistaken Enter does not start
    a server that silently has no key.
    """
    known = set(provider_variables())
    set_now: list[str] = []
    for variable in dict.fromkeys(variables):
        if variable not in known:
            msg = f"{variable} is not a provider key ({', '.join(sorted(known))})"
            raise ValueError(msg)
        value = prompt(f"{variable} (paste it, nothing is shown): ").strip()
        if not value:
            msg = f"no value given for {variable}"
            raise ValueError(msg)
        os.environ[variable] = value
        set_now.append(variable)
    return set_now


_KEY_SHAPE = re.compile(r"^[\x21-\x7e]{8,512}$")
_HIDDEN = "[key hidden]"


def set_key(variable: str, value: str) -> None:
    """Keep a key in this process's environment, after checking the variable and the value.

    Only a registered provider variable is accepted, and only a value that looks like a key
    (printable ASCII without spaces), so nothing can be smuggled into a request header.
    """
    if variable not in provider_variables():
        msg = f"{variable} is not a provider key"
        raise ValueError(msg)
    if not _KEY_SHAPE.match(value):
        msg = "that does not look like a key: paste it as given, without spaces or line breaks"
        raise ValueError(msg)
    os.environ[variable] = value
    _PASTED.add(variable)


def key_source(variable: str) -> KeySource | None:
    """Where a set key came from: pasted in the studio, or given to the process in the terminal."""
    if not os.environ.get(variable):
        return None
    return "studio" if variable in _PASTED else "terminal"


def forget_key(variable: str) -> None:
    """Remove a key from this process's environment."""
    if variable not in provider_variables():
        msg = f"{variable} is not a provider key"
        raise ValueError(msg)
    os.environ.pop(variable, None)
    _PASTED.discard(variable)


def redact(text: str) -> str:
    """``text`` with every key currently set replaced, for errors that are shown or logged."""
    for variable in provider_variables():
        value = os.environ.get(variable, "")
        if len(value) >= _MIN_SECRET:
            text = text.replace(value, _HIDDEN)
    return text
