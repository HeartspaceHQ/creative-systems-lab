# Case study: one approved image, every medium, with a record

## The problem

A campaign is one idea delivered in many media: a scrolling page, social stills, a printed sheet, a
film. Each medium is usually redrawn by hand, and the versions drift apart. Generated images add
three quieter problems: a result cannot be regenerated or traced to a model and settings; "is it on
brand" lives in someone's memory; and the record of who approved what can be edited without anyone
noticing.

The work sample takes an invented tea brand, Aster Lane, and builds the smallest system that
addresses both: a generation pipeline that keeps a checkable record, and a composition engine that
draws every medium from one scene.

## What was built

**Generation** (`src/csl`). A hashed recipe with a model pin; a registry that selects models by
licence, kind and memory; local FLUX.2 klein through mflux and hosted backends behind a quote and an
approved budget; automatic colour and contrast checks with a hard gate; an append-only, hash-chained
review log; export with provenance; replay that classifies the result. A local React UI reviews
through the same functions as the CLI.

**Composition** (`poc/composition`). A scene is a module with `build(data)` returning `seek(t)`.
Tokens, campaign JSON and asset manifests are the only inputs. The renderer calls `seek` per frame
for MP4 and GIF, once for stills and PDF; the web export ships the same module and calls `seek`
from the scroll position. The page ends with a technical section whose facts (model, licence,
approval, output hashes, check counts) are read from the render report, and a scrubber that draws
the same scene at any moment.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the flow and the trust boundaries.

## Results

All measured in this repository on an Apple M4 Max (48 GB) on 2026-11-22, unless stated.

**Generation**

- Python: ruff, ruff format, mypy strict and 127 pytest tests (126 pass offline; one needs a real
  model and passed with it present).
- Replay of two FLUX.2 klein 4B candidates returned `bit_identical` on this machine.
- Tamper detection is tested for a changed decision, a removed or reordered row, a changed evaluation,
  sidecar or image. The UI end-to-end test edits a decision row and sees `verify` report it.
- 40 images at 320×320 with FLUX.2 klein 4B q8: 367,7 s, median 9,0 s per image including model load.

**Composition**

- The winter-morning campaign (three formats, two art-directed photographs) renders with 92 of 92
  technical checks passing, including legibility of every line against the real pixels behind it,
  sampled every 0,5 s through the film. Two fresh renders give the same bytes at the end and at
  2,5 s.
- **Film export, 3,2× faster.** Profiling showed the time was in Playwright's screenshot path, not in
  drawing or encoding. Capturing frames through the DevTools protocol with `optimizeForSpeed` took
  the film step from 374,5 s to 118,8 s and the full render from 436 s to 172,6 s, with every MP4
  and GIF byte identical. A stills-only render, for iteration, takes about 45 s.
- **The engine is reusable without code changes.** `design/variation.json` changes the headline, the
  photograph (a FLUX.2 klein image brought in through the import step), the colour layer and the
  composition. It renders with no edit to any `.ts` file, the unchanged variant is byte identical to
  the base campaign, and six distinct stills come out.
- **The gate works on new data too.** The same variation run fails 3 of 155 checks: the clay layer's
  wordmark reads 4,49:1 and its landscape deck 4,41:1 at their worst frames, and the FLUX image's
  landscape kicker 4,05:1, against a floor of 4,5:1. The render exits with an error. Those variants
  are left failing as evidence; fixing them is a design decision, not a code change.
- **Web parity.** 184 of 184 web checks pass: the renderer's own checks on six screens from
  360×640 to 1920×1080, accessibility, failure modes (no JavaScript, no fonts, no photograph, no
  scene module), resizing, and the technical section on a 360 px phone. The page's text boxes match the renderer's to 0,00 px on feed, story and landscape;
  the mean pixel difference at the end state is 0,95 to 1,30 of 255, split between the static grain
  tile used on the web and WebP compression.

- **Mobile cost.** On a Mac throttled to Lighthouse's phone profile, the scene page transfers 265 kB
  (the MP4 page 572 kB), keeps its main thread 9 % busy while scrolling, holds a 1,5 MB JavaScript
  heap and drops no frames. A throttled Mac is not a phone.
- **A defect the checks did not catch.** Building the scrubber put the scene in a 352×440 box, and
  a hard dark band appeared across the cup. On short screens the scrim's fall-off under the title and
  its rise behind the credits overlapped; the gradient's stops came out of order and SVG clamps
  those into an edge. Contrast still passed, which is why no check failed. The scrim now takes the
  darker of the two curves at every stop, a unit test covers the short case, and the rendered
  stills are unchanged.

## What the system does not do

- **Technical checks do not judge the design.** Every design criterion in the report says
  `pending human review`. The checks measure contrast, fit and colour; they cannot see a wrong
  subject or a weak idea.
- **No validation of the generation checks yet.** 40 images wait for a blind human rating. Until then
  there is no measure of how often the checks pass an image a person would reject.
- **Local trust only.** The hash chain detects casual edits; it does not stop someone who can rewrite
  the whole directory. Signing or an external anchor would.
- **One machine.** Bit-identical replay, render times and frame times are this Mac's. `web-perf`
  slows a Mac to approximate a phone; it is not a phone.
- **Small images.** The FLUX.2 klein example is 320 px and upscales softly in the variation stills.
  Higher resolutions were not measured.
- **Most hosted backends untested against real APIs.** OpenAI GPT Image 2.6 Sunburst made the two
  campaign photographs (six paid images in all, 0,34 USD); the other providers are tested against a
  fake transport only.
- **The PDF is not byte-reproducible.** Chromium writes the creation time into it; its fonts are
  checked instead.
- **Safari is tested by hand only.** Automated WebKit did not start (an old cached build against
  Playwright 1.65), and a new build was not downloaded for this. The technical section, the scrim fix
  and the iPhone safe-area insets were checked in Chromium; `poc/composition/README.md` lists the
  manual Safari test.
- **Print is untested with a printer.** The PDF embeds the variable fonts as Type 3; a print shop may
  want static instances.
