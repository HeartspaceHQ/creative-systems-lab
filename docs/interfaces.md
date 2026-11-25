# Interfaces

What another application may rely on when it uses Creative Systems Lab as a component. Everything
else in the repository is implementation and may change in any release.

The lab is versioned as a whole. A release is a Git tag, `v<major>.<minor>.<patch>`, and the Python
package (`creative-systems-lab`) and the composition engine (`@creative-systems-lab/composition`)
carry the same version. Before 1.0 a breaking change to anything on this page raises the minor
version and is listed in [`CHANGELOG.md`](../CHANGELOG.md). Pin both the tag and its commit.

There are four interfaces, in the order an image passes through them.

## 1. The `csl` command line

Install from a tag:

```sh
pip install "creative-systems-lab @ git+https://github.com/<owner>/<repo>@v0.3.0"
```

Stable commands: `csl models`, `csl quote`, `csl run`, `csl review`, `csl export`, `csl verify`,
`csl recheck`, `csl reference` and `csl serve`. `csl <command> --help` lists their arguments. A
command that fails exits non-zero with the reason on standard error.

Paid calls need an approved budget file (`--budget`), as described in the README. Without one, only
local models run.

## 2. The local HTTP API of `csl serve`

```sh
csl serve --brand <brand.yaml> --brief <brief.yaml> [--brief …] --runs-dir <dir> [--budget <file>] [--ask-key <VARIABLE>] --port <port>
```

The server binds to 127.0.0.1, answers only loopback `Host` headers and has no login: it is a tool
for one designer on one machine. An application that runs it on the designer's behalf keeps it on
that machine. All bodies are JSON.

| Method and path | What it does |
|---|---|
| `GET /api/setup` | Local models, which provider keys are set and where from (`source`: `studio` when pasted, `terminal` when the process started with it; never their values) and the budget |
| `GET /api/briefs` | The briefs the server was started with |
| `GET /api/models?brief=<file>` | Every model: can it run here, may it serve this brief, its price |
| `GET /api/quote?brief=<file>&models=<a,b>&candidates=<n>` | What a run would hold from the budget, and whether it fits |
| `POST /api/jobs` | Start a run: `{ "brief": <file>, "models": [...], "candidates": n }` |
| `GET /api/jobs/<job>` | `running`, `done` with its `run_id`, or `failed` with the reason |
| `GET /api/runs`, `GET /api/runs/<run>` | Runs, and one run with candidates, checks, provenance, decisions and its verification |
| `GET /api/runs/<run>/candidates/<id>/image` | The candidate image |
| `POST /api/runs/<run>/decisions` | A human decision: `{ "candidate": id, "verdict": "approve" \| "reject", "reviewer": name, "note": text }`, plus `"override": true` to approve a candidate that failed a hard check |

**Studio.** The same server keeps brands and projects in `--studio <dir>` (default `studio/`). These
endpoints are what the studio pages use; their shapes are JSON with snake_case names. Every write
(`POST`, `PUT`, `DELETE`) must carry `X-CSL-Session` with the token from `GET /api/session`, and a
browser `Origin`, when sent, must be a loopback origin. The server sends no CORS headers, so another
site cannot read the token. Errors are `{ "error": sentence, "fields": { "<path>": sentence } }`.

| Method and path | What it does |
|---|---|
| `GET /api/session` | The token for writes, new for each server process |
| `GET /api/fonts`, `GET /api/formats` | The fonts on offer, each `{ family, url, weights, kind, display, body, label }`, and the delivery sizes |
| `POST /api/fonts?family=<name>&rights=confirmed` (font bytes) | Keep a WOFF2, WOFF, TTF or OTF file (at most 10 MB) in `<studio>/fonts/` under that name; `GET /api/fonts/<f>/file` serves it |
| `GET`, `POST /api/brands`; `PUT /api/brands/<b>` | Brands: name, four colours, two typefaces, style note |
| `POST /api/brands/<b>/references` (image bytes), `DELETE …/references/<r>` | Reference images of a brand |
| `GET`, `POST /api/projects`; `GET`, `PUT /api/projects/<p>` | Projects, each with one brand |
| `PUT /api/projects/<p>/brief` | `subject`, `kind`, `shape`, `candidates` |
| `GET /api/projects/<p>/models`, `GET …/quote`, `POST …/runs` | Models for the brief, the price, and a run |
| `POST /api/projects/<p>/assets/from-run`, `POST …/assets/import` (image bytes) | Images the project may use |
| `POST /api/projects/<p>/assets/<a>/decision` | `verdict`, `reviewer`, `note`, `rights_confirmed` |
| `PUT /api/projects/<p>/design` | The one design: image, layout, copy, focus, zoom, headline size, darkness |
| `POST /api/projects/<p>/deliveries` | `{ "formats": [...], "extras": ["mp4", "gif", "pdf"] }`, rendered in the background |
| `GET /api/projects/<p>/deliveries/<d>[/files/<name>[?download=1]][/zip]` | State, checks and files |
| `POST /api/keys`, `DELETE /api/keys/<VARIABLE>` | A provider key for this process only; never returned |
| `POST /api/budget` | `{ "approved_usd": n, "approved_by": name }`: a spending limit (at most 1000) that applies at once and is kept in `<studio>/budgets/` |

A delivery holds exactly the sizes and extras that were asked for, named `<size>.<ext>`.

A decision is appended to the run's sealed log. An application may send one only for a decision a
person made in its interface, under that person's name.

## 3. The export sidecar

`csl export <run>` writes, for each approved candidate, a PNG with its provenance embedded and a JSON
sidecar next to it. The sidecar is the handover contract:

| Field | Meaning |
|---|---|
| `file` | The exported PNG, in the same folder |
| `sha256` | Hash of that PNG. Check it before using the image |
| `source_image_sha256` | Hash of the image as generated, before export |
| `manifest` | The candidate's manifest: `candidate_id`, `recipe_hash`, `recipe` (model pin, prompt, seed) |
| `evaluation` | The measured checks |
| `decision` | `verdict`, `reviewer`, `note`, `decided_at` |
| `model_licence` | `name` and `commercial_use` |

Only approved candidates are exported. `csl verify <run>` checks the whole history behind them.

## 4. The composition engine

The engine (`poc/composition`) is TypeScript run directly by Node 24 or later. It keeps a project, the
design that one campaign is made of, apart from its own code. Point `CSL_PROJECT` at the project
folder:

```
<project>/
  design/tokens.json        colours, colour roles per layer, type roles, motion
  design/<campaign>.json    copy, variants, formats, which asset each uses, film and print lists
  assets/<name>.json        asset manifests written by the import below
  assets/<name>.png
  fonts/, *.html, *.css     optional: a page, stylesheet or font that replaces the engine's
  out/<campaign id>/        everything the engine writes
```

Scene code (`src/`) always comes from the engine. Design and assets always come from the project.
Pages, stylesheets and fonts come from the project if it has them, otherwise from the engine. Paths
in the campaign and in the manifests are relative to the project. Without `CSL_PROJECT`, the
engine's own Aster Lane examples are the project.

Commands, run with the engine checked out at the same tag and `npm ci` done in it:

```sh
export CSL_PROJECT=/path/to/project
node <engine>/src/import-asset.ts <sidecar.json> <name> --use feed,story --for render[,web] [--focus x,y]
node <engine>/src/render.ts design/<campaign>.json [--stills]
node <engine>/src/web-export.ts design/<campaign>.json [--variant <id>]
node <engine>/src/web-check.ts design/<campaign>.json [--variant <id>]
```

- **Import** refuses an image that does not match its sidecar hash, a candidate that was not
  approved and a model licence that forbids commercial use. The manifest it writes keeps the
  provenance and records which uses the approval covers (`render`, `web`).
- **Render** writes PNG stills and, unless `--stills` is given, MP4, GIF and PDF. Every output is
  checked against its own pixels. `out/<campaign id>/report.json` lists `outputs` and `checks` by
  group, each check with `name`, `passed` and `detail`. The command exits 1 if any check failed.
- **Composition** in a campaign or variant may set `zoom`, `headline` (both 0.5 to 2), `night`
  (0 to 1) and `framing`: `close` (the default) frames the photograph as the scene was directed,
  `whole` starts from just covering the canvas so any photograph keeps as much in view as the format
  allows. The studio uses `whole`.
- **Web export** writes a static page to `out/<campaign id>/web/`, only from a render that is current.

Rendering needs Chromium (Playwright). MP4 and GIF need `ffmpeg`, and the PDF check needs `pdffonts`.
Set `FFMPEG` and `PDFFONTS` if they are not on the `PATH`.
