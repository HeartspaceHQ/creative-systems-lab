from __future__ import annotations

import os
from typing import TYPE_CHECKING

import pytest

from csl.cli import main
from csl.keys import ask_keys, provider_variables

if TYPE_CHECKING:
    from collections.abc import Callable


def _answer(value: str, asked: list[str]) -> Callable[[str], str]:
    def prompt(text: str) -> str:
        asked.append(text)
        return value

    return prompt


def test_key_goes_to_environment_not_into_the_prompt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    asked: list[str] = []
    assert ask_keys(["OPENAI_API_KEY"], _answer("  sk-test-value \n", asked)) == ["OPENAI_API_KEY"]
    assert os.environ["OPENAI_API_KEY"] == "sk-test-value"
    assert len(asked) == 1
    assert "sk-test" not in asked[0]


def test_repeated_variable_is_asked_once(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    asked: list[str] = []
    ask_keys(["OPENAI_API_KEY", "OPENAI_API_KEY"], _answer("k", asked))
    assert len(asked) == 1


def test_empty_answer_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="no value"):
        ask_keys(["OPENAI_API_KEY"], _answer("   ", []))
    assert "OPENAI_API_KEY" not in os.environ


def test_unknown_variable_is_refused_before_asking() -> None:
    asked: list[str] = []
    with pytest.raises(ValueError, match="not a provider key"):
        ask_keys(["HOME"], _answer("x", asked))
    assert asked == []


def test_known_variables_are_the_registry_keys() -> None:
    assert "OPENAI_API_KEY" in provider_variables()


def test_cli_refuses_unknown_variable_without_prompting(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["serve", "--ask-key", "HOME", "--port", "0"]) == 1
    assert "not a provider key" in capsys.readouterr().err
