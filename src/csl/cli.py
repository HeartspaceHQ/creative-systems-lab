"""Command line interface: ``csl models | quote | run | recheck | review | export | verify``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from csl import integrity, pipeline, registry, report, review
from csl.backends.base import BackendError
from csl.backends.mflux import hardware_summary
from csl.budget import Budget
from csl.export import ExportError, add_reference, export_approved
from csl.keys import ask_keys
from csl.recheck import recheck
from csl.reproduce import replay, verify
from csl.schema import BrandContext, Brief
from csl.store import RunStore, read_model, write_json
from csl.validation.analysis import AnalysisError, analyse, format_analysis, to_json
from csl.validation.generate import generate_set
from csl.validation.spec import load_spec
from csl.web.engine import Engine
from csl.web.server import make_server
from csl.web.studio import Studio
from csl.web.workspace import Workspace

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence


def _say(text: str) -> None:
    sys.stdout.write(text + "\n")


def _add_brand_commands(sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    """Commands that work on the brand side: rechecking candidates, growing the references."""
    chk = sub.add_parser(
        "recheck", help="evaluate earlier candidates again under the current brand; no generation"
    )
    chk.add_argument("runs", type=Path, nargs="+", help="source runs, all for the same brief")
    chk.add_argument("--brand", type=Path, required=True)
    chk.add_argument("--runs-dir", type=Path, default=Path("runs"))

    ref = sub.add_parser("reference", help="add an approved candidate to the brand reference set")
    ref.add_argument("run", type=Path)
    ref.add_argument("candidate")
    ref.add_argument("--to", type=Path, required=True, help="reference directory")


def _add_quote(sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    quote = sub.add_parser("quote", help="price a brief on each model before any paid call")
    quote.add_argument("--brief", type=Path, required=True)
    quote.add_argument("--models", default="", help="comma-separated model keys (default: all)")
    quote.add_argument("--candidates", type=int, help="override candidates per model")
    quote.add_argument("--budget", type=Path, help="also show what is left of this budget")


def _add_serve(sub: argparse._SubParsersAction[argparse.ArgumentParser]) -> None:
    serve = sub.add_parser("serve", help="local designer web app (needs `npm run build` in web/)")
    serve.add_argument("--runs-dir", type=Path, action="append", help="first one receives new runs")
    serve.add_argument(
        "--studio", type=Path, default=Path("studio"), help="folder of brands and projects"
    )
    serve.add_argument(
        "--engine", type=Path, help="the rendering engine (default: poc/composition)"
    )
    serve.add_argument("--brand", type=Path, help="brand file for runs started from a brief file")
    serve.add_argument("--brief", type=Path, action="append", help="briefs that can be started")
    serve.add_argument("--references", type=Path, help="reference images of the brand file")
    serve.add_argument("--validation", type=Path, default=Path("runs/validation"))
    serve.add_argument("--static", type=Path, default=Path("web/dist"))
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument(
        "--budget", type=Path, help="approval file; without it the UI runs local models only"
    )
    _add_ask_key(serve)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="csl", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    models = sub.add_parser("models", help="list registered models and whether they can run here")
    models.add_argument("--brief", type=Path, help="also show how this brief would select")

    run = sub.add_parser("run", help="generate and evaluate candidates for a brief")
    run.add_argument("--brief", type=Path, required=True)
    run.add_argument("--brand", type=Path, required=True)
    run.add_argument("--runs-dir", type=Path, default=Path("runs"))
    run.add_argument("--models", default="", help="comma-separated model keys (default: auto)")
    run.add_argument("--candidates", type=int, help="override candidates per model")
    run.add_argument("--budget", type=Path, help="approved budget file; required for hosted models")
    _add_ask_key(run)

    _add_quote(sub)

    rev = sub.add_parser("review", help="approve or reject a candidate")
    rev.add_argument("run", type=Path)
    rev.add_argument("candidate")
    rev.add_argument("verdict", choices=["approve", "reject"])
    rev.add_argument("--reviewer", required=True)
    rev.add_argument("--note", default="")
    rev.add_argument("--override", action="store_true", help="approve despite hard failures")

    for name, text in (
        ("export", "export approved candidates"),
        ("migrate", "chain the decision log and seal a run made before integrity manifests"),
        ("compare", "per-model summary"),
        ("report", "rewrite report.html"),
    ):
        sub.add_parser(name, help=text).add_argument("run", type=Path)

    verify_parser = sub.add_parser("verify", help="check the whole history of a run")
    verify_parser.add_argument("run", type=Path)
    verify_parser.add_argument("--strict", action="store_true", help="treat warnings as failures")

    val = sub.add_parser("validate", help="blind validation of the quality verdict")
    val_sub = val.add_subparsers(dest="validate_command", required=True)
    gen = val_sub.add_parser("generate", help="generate and score the images of a case set")
    gen.add_argument("spec", type=Path)
    gen.add_argument("--out", type=Path, required=True)
    gen.add_argument("--budget", type=Path, help="approved budget file; required for hosted models")
    rep_val = val_sub.add_parser("report", help="confusion matrix and FP/FN after rating")
    rep_val.add_argument("spec", type=Path)
    rep_val.add_argument("--out", type=Path, required=True)
    rep_val.add_argument("--partial", action="store_true", help="allow unrated images")

    _add_serve(sub)

    _add_brand_commands(sub)

    rep = sub.add_parser("replay", help="regenerate a candidate and compare with the record")
    rep.add_argument("run", type=Path)
    rep.add_argument("candidate")
    rep.add_argument("--force", action="store_true", help="compare even if the model pin differs")
    rep.add_argument(
        "--budget",
        type=Path,
        help="approved budget file; required for a hosted model, whose replay is a new paid image",
    )
    return parser


def _add_ask_key(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--ask-key",
        action="append",
        default=[],
        metavar="VARIABLE",
        help="ask for this provider key at a hidden prompt (paste it; nothing is shown or saved)",
    )


def _ask_keys(variables: Sequence[str]) -> None:
    for variable in ask_keys(variables):
        _say(f"{variable} set for this process")


def _models(brief_path: Path | None) -> int:
    brief = read_model(brief_path, Brief) if brief_path else None
    for entry in registry.REGISTRY:
        reason = entry.unavailable()
        state = "available" if reason is None else f"unavailable: {reason}"
        _say(f"{entry.key:22} {entry.licence:28} {state}")
        if brief is not None:
            why = registry.exclusion_reason(entry, brief)
            _say(f"{'':22} for this brief: {'eligible' if why is None else 'excluded: ' + why}")
    return 0


def _run(args: argparse.Namespace) -> int:
    _ask_keys(args.ask_key)
    brief = read_model(args.brief, Brief)
    if args.candidates is not None:
        brief = brief.with_candidates(args.candidates)
    brand = read_model(args.brand, BrandContext)
    reference = (args.brand.parent / brand.reference_dir) if brand.reference_dir else None
    keys = tuple(k for k in args.models.split(",") if k)
    budget = Budget.load(args.budget) if args.budget else None
    store = pipeline.run(brief, brand, args.runs_dir, keys, reference, budget=budget)
    report.write_report(store)
    _say(f"run: {store.root}")
    for view in store.candidates():
        failed = [c.name for c in view.evaluation.checks if not c.passed]
        _say(
            f"  {view.id:34} {view.status:14} {view.manifest.generation_seconds:7.2f}s "
            f"{'failed: ' + ','.join(failed) if failed else 'all checks pass'}"
        )
    _say(f"report: {store.root / 'report.html'}")
    return 0


def _quote(args: argparse.Namespace) -> int:
    brief = read_model(args.brief, Brief)
    count = (
        brief.candidates
        if args.candidates is None
        else brief.with_candidates(args.candidates).candidates
    )
    keys = {k for k in args.models.split(",") if k}
    entries = [e for e in registry.REGISTRY if not keys or e.key in keys]
    _say(
        f"{brief.width}x{brief.height}, {count} per model. Prices are not calls; nothing is spent."
    )
    total = 0.0
    for entry in entries:
        each = entry.price.per_image(brief.width, brief.height)
        held = entry.price.reserve(brief.width, brief.height) * count
        total += held
        sure = "confirmed" if entry.price.confirmed else "UNCONFIRMED"
        _say(
            f"  {entry.key:34} ${each:7.4f}/image  ${held:7.3f} held  {sure}: {entry.price.source}"
        )
    _say(f"total held against a budget: ${total:.2f}")
    if args.budget:
        budget = Budget.load(args.budget)
        _say(f"budget {budget.approval.id!r}: ${budget.remaining():.2f} left")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point. Returns a process exit code."""
    args = _parser().parse_args(argv)
    try:
        return _dispatch(args)
    except (
        BackendError,
        ExportError,
        review.ReviewError,
        integrity.IntegrityError,
        AnalysisError,
        KeyError,
        RuntimeError,
        ValueError,
    ) as error:
        sys.stderr.write(f"error: {error}\n")
        return 1


def _review(args: argparse.Namespace) -> int:
    store = RunStore(args.run)
    decision = review.decide(
        store,
        args.candidate,
        args.verdict,
        args.reviewer,
        args.note,
        override=args.override,
    )
    report.write_report(store)
    _say(
        f"{decision.verdict}: {decision.candidate_id} by {decision.reviewer}"
        f"{' (override)' if decision.override else ''}"
    )
    return 0


def _export(args: argparse.Namespace) -> int:
    store = RunStore(args.run)
    names = export_approved(store)
    _say(f"exported {len(names)} file(s) to {store.export_dir}")
    return 0


def _verify(args: argparse.Namespace) -> int:
    result = verify(RunStore(args.run))
    for warning in result.warnings:
        _say(f"warning: {warning}")
    if result.problems:
        _say("\n".join(result.problems))
        return 1
    _say("intact" if not result.warnings else "intact, with warnings (see above)")
    return 1 if args.strict and result.warnings else 0


def _validate(args: argparse.Namespace) -> int:
    spec_path: Path = args.spec
    if args.validate_command == "generate":
        budget = Budget.load(args.budget) if args.budget else None
        generate_set(spec_path, args.out, hardware_summary(), budget)
        _say(f"generated and scored {len(load_spec(spec_path).cases)} images in {args.out}")
        return 0
    analyses = analyse(load_spec(spec_path), args.out, partial=args.partial)
    _say(format_analysis(analyses))
    write_json(args.out / "analysis.json", to_json(analyses))
    return 0


def _serve(args: argparse.Namespace) -> int:
    _ask_keys(args.ask_key)
    run_dirs: list[Path] = args.runs_dir or [Path("runs"), Path("examples/aster-lane/results")]
    workspace = Workspace(
        run_roots=tuple(run_dirs),
        brand=args.brand,
        brief_files=tuple(args.brief or ()),
        references=args.references,
        validation_root=args.validation,
        static_dir=args.static,
    )
    engine = Engine(args.engine)
    engine.prepare_preview()
    studio = Studio(args.studio)
    budget = Budget.load(args.budget) if args.budget else studio.saved_budget()
    server = make_server(workspace, run_dirs[0], args.port, budget, studio=studio, engine=engine)
    _say(f"serving on http://127.0.0.1:{server.server_address[1]} (ctrl-c to stop)")
    _say(f"studio folder: {studio.root}")
    if engine.preview_problem is not None:
        _say(f"live preview and deliveries are off: {engine.preview_problem}")
    if budget is None:
        _say("no spending limit yet: set one in the studio to use hosted models")
    else:
        _say(f"budget {budget.approval.id!r}: ${budget.remaining():.2f} left for hosted models")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _say("stopped")
    return 0


def _migrate(args: argparse.Namespace) -> int:
    manifest = integrity.migrate(RunStore(args.run))
    _say(f"sealed {args.run} (origin: {manifest.origin}, decisions: {manifest.decisions.count})")
    return 0


def _replay(args: argparse.Namespace) -> int:
    budget = Budget.load(args.budget) if args.budget else None
    result = replay(RunStore(args.run), args.candidate, force=args.force, budget=budget)
    _say(f"{result.candidate_id}: {result.status} ({result.detail})")
    return 0 if result.status in {"bit_identical", "perceptually_close"} else 1


def _compare(args: argparse.Namespace) -> int:
    for row in report.compare(RunStore(args.run)):
        drift = "-" if row.mean_colour_drift is None else f"{row.mean_colour_drift:.3f}"
        _say(
            f"{row.model:22} n={row.candidates} hard_pass={row.hard_pass} "
            f"approved={row.approved} colour_drift={drift} mean_s={row.mean_seconds:.1f}"
        )
    return 0


def _reference(args: argparse.Namespace) -> int:
    added = add_reference(RunStore(args.run), args.candidate, args.to)
    _say(f"added {added.name} to {args.to}")
    return 0


def _recheck(args: argparse.Namespace) -> int:
    brand = read_model(args.brand, BrandContext)
    reference = (args.brand.parent / brand.reference_dir) if brand.reference_dir else None
    store = recheck([RunStore(path) for path in args.runs], brand, args.runs_dir, reference)
    report.write_report(store)
    _say(f"run: {store.root}")
    for view in store.candidates():
        _say(f"  {view.id:40} {view.status}")
    return 0


def _report(args: argparse.Namespace) -> int:
    store = RunStore(args.run)
    report.write_report(store)
    _say(f"wrote {store.root / 'report.html'}")
    return 0


_HANDLERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "models": lambda args: _models(args.brief),
    "quote": _quote,
    "run": _run,
    "review": _review,
    "export": _export,
    "verify": _verify,
    "migrate": _migrate,
    "validate": _validate,
    "serve": _serve,
    "replay": _replay,
    "compare": _compare,
    "reference": _reference,
    "recheck": _recheck,
    "report": _report,
}


def _dispatch(args: argparse.Namespace) -> int:
    return _HANDLERS[args.command](args)
