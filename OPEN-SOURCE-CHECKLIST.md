# Before this repository was opened

The code is MIT; images and fonts are not (see `NOTICE.md`). The demo page is public at the link in
the README, not indexed by search engines. This list records what was checked on 2026-11-22 before
the repository was made public, and what remains.

## Checked

| Item | How | Result |
|---|---|---|
| Composition dependencies | `poc/composition/package.json` declares them; own `package-lock.json` | no symlink to `web/` |
| Fresh-clone chain | CI job `composition`: `npm ci`, typecheck, lint, unit tests, `test:demo` | renders from committed FLUX.2 klein example, every check passes |
| Secrets in tracked files | `git grep` for API key, token and private key patterns, `password=` | none found |
| Secrets in history | `git log -p --all` for the same patterns and for the share password variable | none found |
| Secret scanner | gitleaks 8.30.1, default rules, every ref (`--all`) and the working tree, 2026-11-22 | 4 matches of `generic-api-key`, all model names (`key="flux2-klein-4b-q8"`); allowed by one narrow rule in `.gitleaks.toml`; then none |
| CI logs | all 14 GitHub Actions runs downloaded and scanned with gitleaks and for personal strings | no leaks; only the repository name and GitHub's masked checkout token; workflows use no secrets; no stored artifacts |
| Paid calls | every model call goes through `pipeline.generate_once`; `run`, `validate generate` and `replay` refuse a paid model without `--budget`; `tests/test_budget_gates.py` | no command can make a paid call without an approval file; nothing exposes generation to the internet |
| Demo page cost | Cloudflare Workers pricing, read 2026-11-22; `poc/composition/README.md` | static files only; Free plan errors past 100,000 requests a day instead of billing |
| Private paths and names | `git grep -i` for home paths, personal and company names | none in files besides the publisher and the creator in the licence notes; commits use the GitHub no-reply address |
| Preview credentials | share user and password live only in the macOS Keychain (`CSL_SHARE_USER`, `CSL_SHARE_PASSWORD`) | not in files, docs or history |
| API keys | `src/csl/backends/hosted.py` reads them from the environment at call time | never written to a record |
| Model weights | `.gitignore` excludes `*.safetensors`, `*.gguf`, `*.ckpt`; no weights tracked | none in Git |
| Large generated files | runs, renders (`out/`), builds and composition PNG assets are ignored | 15 example images (320 px FLUX.2 klein outputs and procedural stubs), screenshots and recordings in `docs/img/`, the largest the 12.9 MB launch film, two subset web fonts |
| GPT Image 2.6 photographs | OpenAI Services Agreement (effective 2026-01-01), sections 4.1, 4.3, 4.4, 3.3; key and organisation of the calls | output owned by the API customer, Heartspace PR Sverige AB, which also publishes this repository; kept as the main example; `docs/image-rights.md` |
| Code licence | `LICENSE` (MIT, Heartspace PR Sverige AB), `NOTICE.md` scope, `license` in `pyproject.toml` and both `package.json` | images, recordings, the film, its music and fonts excluded |
| Node dependency licences | `license` of every package in both lockfiles | MIT, Apache-2.0, ISC, BSD, BlueOak, 0BSD; MPL-2.0 (lightningcss) and CC-BY-4.0 (caniuse-lite data) in build tools only; none bundled in Git |
| Python dependency licences | package metadata in `.venv` | MIT, BSD, Apache-2.0, PSF-2.0, MIT-CMU; MPL-2.0 (pathspec, via mypy) in development only |
| Demo page | `share/wrangler.jsonc` `ACCESS` = `public`; headless load on phone and desktop | reachable without a password, `noindex` |
| Example brand | "Aster Lane" | invented |
| Screenshots, recording and launch film | `docs/img/`, captured headless with Playwright from the public demo and from `csl serve` on local runs; each one viewed | real renders and a real decision; the only name shown is the creator's, as reviewer; no paths or credentials; the start panel was captured with a placeholder key and a test budget; demo images show the GPT Image photographs, terms in `docs/image-rights.md` |
| Customer material | inventory in `docs/inventory.md` | none; code written new, no history copied |

## To decide

0. **Who licenses the code. Decided 2026-11-25.** Heartspace PR Sverige AB holds the copyright in
   the code and publishes it under MIT, as `LICENSE` and `NOTICE.md` state. Sohrab Fadai created
   the project and leads it.

1. **A fresh history.** The development history is kept private, because its commits carry a
   personal email address and session links. This repository starts from one commit of the same
   tracked files, authored with the GitHub no-reply address. Whether to make it public is the
   owner's decision.
2. **Search engines.** The demo page sends `noindex`. Remove the header in `src/share-worker.ts`
   when the page should be findable.
3. **Cloudflare plan and spending limit.** Confirm which Workers plan the account is on. On the
   Paid plan, set a Workers spending limit or an email alert.

## To do

- **Manual Safari test** on an iPhone, as listed in `poc/composition/README.md`.
- **Pending approvals.** `assets/leaves.json` and `assets/tea.json` record approval as pending, so
  the renderer refuses the first and editorial campaigns. This is the gate working.
- **Fonts.** Confirm the subset files keep the OFL reserved-name rules.
- **Separate provider terms from distribution licence in the asset manifest.** The `licence` field
  now holds the provider's terms (for the photographs, the OpenAI agreement), which is not a licence
  to others. Split it into `provider_terms` and `distribution_licence`; it changes the source hash,
  so it needs a full render.
- **Legacy scenes.** `src/scene.ts`, `src/editorial.ts` and `design/winter-morning.json` predate the
  shared scene contract and the approval gate. Keep them as history or remove them.
- **Deploy settings.** `share/deploy.sh` assumes a Cloudflare account, `wrangler` and, in private
  mode, the macOS Keychain. Documented in `poc/composition/README.md`; generalise if others deploy.
- **The web page from a fresh clone.** `test:demo` renders a still from committed material only. The
  full winter-morning page still needs the photographs, which are not in Git.
- **Film and print in CI.** MP4, GIF and PDF need ffmpeg and poppler on the runner and are tested
  locally only.
- **External tools.** ffmpeg (libx264, GPL), poppler's `pdffonts` (GPL), mflux (MIT) and Chromium
  run as separate programs and are not distributed; `NOTICE.md` says so.

## What is generic and what is example material

| Kind | Where |
|---|---|
| Generic code | `src/csl` (pipeline, registry, evaluation, review, integrity, export, replay); `web/` (review UI); `poc/composition/src` (scene contract, renderer, checks, web export, import) |
| Example material | `examples/aster-lane` (invented brand, FLUX.2 klein images and a committed run); `poc/composition/design` (tokens, campaigns, criteria, explainer prose); `poc/composition/assets/*.json` (manifests) |
| Needs a paid external API | the hosted backends in `src/csl/backends/hosted.py`, each behind a quote and an approved budget |
| Needs specific hardware or accounts | the mflux backend (Apple silicon, local FLUX.2 klein weights); `web-perf` (a GPU); `share/` (a Cloudflare account) |
