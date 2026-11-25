"""No paid call without an approved budget, from any command. Nothing here reaches a network.

A fake paid model wraps the procedural renderer, counts its calls and reports a cost, so each
test can say exactly how many paid calls were made and what the ledger holds afterwards.
"""

from __future__ import annotations

import ast
import dataclasses
import json
import threading
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from csl import cli, pipeline, registry
from csl.backends.base import BackendError
from csl.backends.hosted import HostedError
from csl.budget import Approval, Budget, BudgetError
from csl.pricing import Price
from csl.reproduce import replay
from csl.schema import BrandContext, Brief, Cost, ModelPin, Recipe
from csl.validation.generate import generate_set

if TYPE_CHECKING:
    from csl.registry import ModelEntry
    from csl.store import RunStore

PRICE_USD = 0.04
SRC = Path(__file__).resolve().parents[1] / "src" / "csl"


class CountingPaidBackend:
    """Draws with the procedural renderer, counts calls and reports a paid cost."""

    def __init__(self, inner: object, *, fail: bool = False, status: int | None = None) -> None:
        self._inner = inner
        self.fail = fail
        self.status = status
        self.calls = 0

    def pin(self) -> ModelPin:
        return self._inner.pin()  # type: ignore[attr-defined,no-any-return]

    def generate(self, recipe: Recipe, output: Path) -> Cost:
        self.calls += 1
        if self.fail:
            msg = "provider refused"
            if self.status is not None:
                raise HostedError(msg, self.status)
            raise BackendError(msg)
        self._inner.generate(recipe, output)  # type: ignore[attr-defined]
        return Cost(usd=PRICE_USD, basis="fake provider", estimated=False)


@pytest.fixture
def paid(monkeypatch: pytest.MonkeyPatch, brand: BrandContext) -> CountingPaidBackend:
    """Make the procedural model a paid, hosted one for the duration of a test."""
    free = registry.get("procedural")
    backend = CountingPaidBackend(free.make(brand))
    entry: ModelEntry = dataclasses.replace(
        free,
        location="hosted",
        price=Price(((8192, PRICE_USD),), "test price", confirmed=True),
        make=lambda _: backend,
    )
    real_get = registry.get
    monkeypatch.setattr(
        registry, "get", lambda key: entry if key == "procedural" else real_get(key)
    )
    return backend


def _budget_file(tmp_path: Path, usd: float) -> Path:
    path = tmp_path / "budget.json"
    approval = Approval(
        id="t", approved_usd=usd, approved_by="test", approved_on=date(2026, 11, 22)
    )
    path.write_text(approval.model_dump_json(), encoding="utf-8")
    return path


def _spec(tmp_path: Path, brand: BrandContext, brief: Brief, cases: int = 3) -> Path:
    root = tmp_path / "set"
    root.mkdir()
    (root / "brand.json").write_text(brand.model_dump_json(), encoding="utf-8")
    (root / "brief.json").write_text(brief.model_dump_json(), encoding="utf-8")
    spec = {
        "set_id": "paid-set",
        "brief": "brief.json",
        "brand": "brand.json",
        "model": "procedural",
        "width": 64,
        "height": 64,
        "cases": [
            {"id": f"good-{n:02}", "category": "good", "seed": n, "prompt": "p", "intent": "i"}
            for n in range(1, cases + 1)
        ],
    }
    path = root / "spec.json"
    path.write_text(json.dumps(spec), encoding="utf-8")
    return path


# --- the single call site ---------------------------------------------------------------


def test_only_generate_once_calls_a_backend() -> None:
    """Every ``.generate(`` call outside the backends sits in ``pipeline.generate_once``."""
    sites: list[str] = []
    for path in SRC.rglob("*.py"):
        if "backends" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        functions = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
        sites.extend(
            f"{path.relative_to(SRC)}:{function.name}"
            for function in functions
            for node in ast.walk(function)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "generate"
        )
    assert sites, "the scan found no call at all; it is not looking in the right place"
    assert set(sites) == {"pipeline.py:generate_once"}


def test_generate_once_refuses_paid_call_without_budget(
    paid: CountingPaidBackend, tmp_path: Path
) -> None:
    entry = registry.get("procedural")
    recipe = Recipe(pin=paid.pin(), prompt="p", width=64, height=64, steps=1, seed=1)
    with pytest.raises(BudgetError):
        pipeline.generate_once(entry, paid, recipe, tmp_path / "x.png", None, "x")
    assert paid.calls == 0


# --- csl validate generate --------------------------------------------------------------


def test_validate_generate_refuses_without_budget(
    paid: CountingPaidBackend, brand: BrandContext, brief: Brief, tmp_path: Path
) -> None:
    spec = _spec(tmp_path, brand, brief)
    with pytest.raises(BudgetError, match="3 paid call"):
        generate_set(spec, tmp_path / "out", "h")
    assert paid.calls == 0
    assert not (tmp_path / "out").exists()


def test_validate_generate_refuses_when_budget_too_small(
    paid: CountingPaidBackend, brand: BrandContext, brief: Brief, tmp_path: Path
) -> None:
    spec = _spec(tmp_path, brand, brief)
    budget = Budget.load(_budget_file(tmp_path, PRICE_USD * 2))
    with pytest.raises(BudgetError):
        generate_set(spec, tmp_path / "out", "h", budget)
    assert paid.calls == 0
    assert budget.remaining() == pytest.approx(PRICE_USD * 2)


def test_validate_generate_spends_and_settles_within_budget(
    paid: CountingPaidBackend, brand: BrandContext, brief: Brief, tmp_path: Path
) -> None:
    spec = _spec(tmp_path, brand, brief)
    budget = Budget.load(_budget_file(tmp_path, 1.0))
    generate_set(spec, tmp_path / "out", "h", budget)
    assert paid.calls == 3
    assert budget.remaining() == pytest.approx(1.0 - 3 * PRICE_USD)
    # A resumed run with every image in place makes no call, so it needs no budget.
    generate_set(spec, tmp_path / "out", "h")
    assert paid.calls == 3


def test_cli_validate_generate_without_budget_exits_with_error(
    paid: CountingPaidBackend,
    brand: BrandContext,
    brief: Brief,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    spec = _spec(tmp_path, brand, brief)
    monkeypatch.setattr(cli, "hardware_summary", lambda: "test")  # sysctl exists on macOS only
    code = cli.main(["validate", "generate", str(spec), "--out", str(tmp_path / "out")])
    assert code == 1
    assert "--budget" in capsys.readouterr().err
    assert paid.calls == 0


# --- csl replay --------------------------------------------------------------------------


@pytest.fixture
def paid_run(brand: BrandContext, brief: Brief, runs_dir: Path) -> tuple[RunStore, str]:
    """A run made by the free model; the ``paid`` fixture then makes the same key paid."""
    store = pipeline.run(brief, brand, runs_dir, ("procedural",))
    return store, store.candidates()[0].id


def test_replay_refuses_paid_model_without_budget(
    paid_run: tuple[RunStore, str], paid: CountingPaidBackend
) -> None:
    store, candidate = paid_run
    with pytest.raises(BudgetError, match="replay"):
        replay(store, candidate)
    assert paid.calls == 0


def test_cli_replay_without_budget_exits_with_error(
    paid_run: tuple[RunStore, str],
    paid: CountingPaidBackend,
    capsys: pytest.CaptureFixture[str],
) -> None:
    store, candidate = paid_run
    assert cli.main(["replay", str(store.root), candidate]) == 1
    assert "--budget" in capsys.readouterr().err
    assert paid.calls == 0


def test_replay_of_hosted_model_is_a_new_generation_not_a_reproduction(
    paid_run: tuple[RunStore, str], paid: CountingPaidBackend, tmp_path: Path
) -> None:
    store, candidate = paid_run
    budget = Budget.load(_budget_file(tmp_path, 1.0))
    result = replay(store, candidate, budget=budget)
    assert result.status == "new_generation"
    assert "not a reproduction" in result.detail
    assert paid.calls == 1
    assert budget.remaining() == pytest.approx(1.0 - PRICE_USD)


def test_replay_of_hosted_model_refuses_when_budget_used_up(
    paid_run: tuple[RunStore, str], paid: CountingPaidBackend, tmp_path: Path
) -> None:
    store, candidate = paid_run
    budget = Budget.load(_budget_file(tmp_path, PRICE_USD / 2))
    with pytest.raises(BudgetError):
        replay(store, candidate, budget=budget)
    assert paid.calls == 0


# --- the ledger ---------------------------------------------------------------------------


def test_overlapping_runs_with_the_same_label_keep_both_holds(tmp_path: Path) -> None:
    """Two runs reserve under one candidate name; one settling must not release the other."""
    path = _budget_file(tmp_path, 1.0)
    first, second = Budget.load(path), Budget.load(path)
    held_first = first.reserve("gpt-image-s1", 0.3)
    second.reserve("gpt-image-s1", 0.3)
    first.settle(held_first, 0.1, "reported")
    assert Budget.load(path).committed() == pytest.approx(0.1 + 0.3)


def test_failed_call_keeps_its_reservation(paid: CountingPaidBackend, tmp_path: Path) -> None:
    budget = Budget.load(_budget_file(tmp_path, 1.0))
    paid.fail = True
    entry = registry.get("procedural")
    recipe = Recipe(pin=paid.pin(), prompt="p", width=64, height=64, steps=1, seed=1)
    with pytest.raises(BackendError):
        pipeline.generate_once(entry, paid, recipe, tmp_path / "x.png", budget, "x")
    assert paid.calls == 1
    assert budget.committed() == pytest.approx(PRICE_USD)


def test_concurrent_runs_never_overspend(tmp_path: Path) -> None:
    """Eight writers, separate ``Budget`` objects, one label: only what fits is reserved."""
    path = _budget_file(tmp_path, 1.0)
    barrier = threading.Barrier(8)
    held: list[object] = []
    refused: list[str] = []
    lock = threading.Lock()

    def work() -> None:
        budget = Budget.load(path)
        barrier.wait()
        try:
            reservation = budget.reserve("same-candidate", 0.3)
        except BudgetError:
            with lock:
                refused.append("refused")
            return
        with lock:
            held.append(reservation)

    threads = [threading.Thread(target=work) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert (len(held), len(refused)) == (3, 5)
    assert Budget.load(path).committed() == pytest.approx(0.9)
    settle = Budget.load(path)
    for reservation in held:
        settle.settle(reservation, 0.2, "reported")  # type: ignore[arg-type]
    assert Budget.load(path).committed() == pytest.approx(0.6)


def test_ledger_written_before_reservation_ids_still_pairs_by_candidate(tmp_path: Path) -> None:
    path = _budget_file(tmp_path, 1.0)
    lines = [
        {
            "budget_id": "t",
            "kind": "reserve",
            "candidate_id": "a",
            "usd": 0.3,
            "at": "2026-11-22T12:00:00Z",
        },
        {
            "budget_id": "t",
            "kind": "settle",
            "candidate_id": "a",
            "usd": 0.1,
            "at": "2026-11-22T12:01:00Z",
        },
        {
            "budget_id": "t",
            "kind": "reserve",
            "candidate_id": "b",
            "usd": 0.2,
            "at": "2026-11-22T12:02:00Z",
        },
    ]
    path.with_suffix(".ledger.jsonl").write_text(
        "".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8"
    )
    assert Budget.load(path).committed() == pytest.approx(0.1 + 0.2)


@pytest.mark.parametrize(
    ("status", "charged", "uncertain"),
    [(400, 0.0, 0.0), (422, 0.0, 0.0), (500, 0.0, PRICE_USD), (None, 0.0, PRICE_USD)],
)
def test_only_a_provider_4xx_settles_at_zero(
    paid: CountingPaidBackend, tmp_path: Path, status: int | None, charged: float, uncertain: float
) -> None:
    paid.fail = True
    paid.status = status
    budget = Budget.load(_budget_file(tmp_path, 1.0))
    entry = registry.get("procedural")
    recipe = Recipe(pin=paid.pin(), prompt="p", width=64, height=64, steps=1, seed=1)
    with pytest.raises(BackendError):
        pipeline.generate_once(entry, paid, recipe, tmp_path / "x.png", budget, "x")
    spend = budget.spend()
    assert spend.charged == charged
    assert spend.uncertain == pytest.approx(uncertain)
    assert spend.held == 0.0
    assert spend.remaining == pytest.approx(1.0 - uncertain)
