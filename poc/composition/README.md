# Deterministic composition PoC

A small campaign for the invented tea brand Aster Lane. It demonstrates the working method this lab
is meant to show. The design is explicit code. A generative model supplies one photographic element.

| Step | Where | Decided by |
|---|---|---|
| Design direction: colour roles, type roles, rules, motion timing | `design/tokens.json` | designer |
| Copy, variants, formats | `design/campaign.json` | designer |
| Composition, vector graphics, typography, motion as `seek(t)` | `src/scene.ts`, `scene.html` | designer, written with AI assistance |
| One photographic asset (loose tea leaves) | CSL run, referenced by hash in `assets/leaves.json` | model generates, human picks |
| Assembly and export: PNG per format, MP4, GIF, PDF | `src/render.ts` | deterministic |
| Technical checks: source contrast, overflow, safe area, text off image, fonts, same bytes twice | `src/checks.ts` | automatic |
| Visual quality | review | human |

## Second campaign: editorial

`design/editorial.json` renders a typeset journal page around one photograph (`assets/tea.json`)
in feed, story and landscape, as PNG, MP4, GIF and PDF. It uses the same tokens and the same
renderer. The scene module is `src/editorial.ts`, and the helpers shared with the first scene are
in `src/kit.ts`. The photo is cropped to a rectangle around the designer's focus point and is
full-bleed where it touches the canvas edge. The text check uses that rectangle.
`evidence/03-editorial-render.log`: 94 of 94 technical checks pass.

The tea photo is FLUX.2 klein 4B, run locally. The same brief can be sent to any hosted provider
(`../../docs/image-providers.md`) without touching the design. Only the asset manifest changes.

## Third campaign: a winter morning (cinematic)

`design/winter-morning.json` uses the same photograph, copy and tokens for one rhetorical situation:
a December release that a tea drinker meets as muted autoplay on a phone, in the darkest weeks of
the year. The campaign file states the situation and nine criteria (kairos, pathos, logos, ethos)
before any layout. The method is in [`../../docs/design-rhetoric.md`](../../docs/design-rhetoric.md).

The scene (`src/cinema.ts`) treats the photograph as the stage. Over ten seconds the blue dark lifts,
a low sun comes through the window, the shadows warm from navy toward rust, the camera pushes in, the
words land, the steeping line fills under a fixed "4 min · 95 °C" and the release date comes last. Text sits on the image behind an
eased scrim, and two things are measured:

- legibility of each text against the real pixels behind it, with the text layer hidden. It is
  sampled every 0,5 s through the whole film and in the end state, for every text that is fully
  shown, and the worst frame counts. A text still fading in is in transition and is skipped. The
  first Sunburst render showed why: the steeping time read 4,36:1 at the end but 4,13:1 at 5,5 s;
- warmth (mean red minus blue) at 0,5 s and 9,5 s. It must rise and end above zero.

The report ties each criterion to its supporting checks and leaves the judgement to a person.

### Art direction per format

A format may name its own asset (`formats.<name>.asset`), so one photograph serves every format
where it works and another can be chosen where it does not. An asset manifest may say which formats
it was directed for (`use`), and a source check refuses to place it elsewhere.
`design/winter-morning-sunburst.json` uses a square GPT Image 2.6 Sunburst photo for feed and story
and a Sunburst photo composed for landscape (cup in the left third, a quiet right half for the
words). The model does not decide: the best asset per format does, whichever model made it.

### The same design on the web

`src/web-export.ts` writes a static page from the same campaign, tokens, photographs and scene
module, and `src/web.ts` runs that scene in the browser through the same `seek(t)` the renderer
uses. Nothing is redrawn for the web: the page differs from the renderer only in where it runs.

- **Art direction per screen.** Each viewport gets the format of its layout family (`src/shape.ts`,
  one rule for both runtimes): tall and medium screens the square photograph, wide screens the
  landscape one. A preload with the same rule as a media query fetches only that photograph, in
  the size the screen's density needs.
- **Motion.** The first 1,6 s play by themselves, so the headline is in place before any scroll.
  After that the film follows the scroll at 240 px per second of film on every screen, or plays in
  place with `?drive=time`. With reduced motion the page shows the end state and has no scroll length.
- **Text.** Every word is real HTML text: one `h1`, the photograph's description as its alternative,
  the steeping instruction a fixed line of text, read once.
- **Mobile cost.** The film grain is a static tile on the web (`medium: "web"`); the renderer keeps
  its per-frame grain. No canvas, no WebGL.
- **When something fails.** Without JavaScript, or if the scene module cannot load, the page shows
  the renderer's poster with the copy as text. Without fonts the scene starts in system faces and
  swaps them in when they arrive; a photograph that fails or is slow does not hold the words back.
- **Only verified posters.** The export refuses unless the last render passed every check, its stills
  match the report, and the render's source hash matches the current design source and scene code.
  Photographs need `approved_for: ["web"]` in their manifest.

```sh
node src/render.ts design/winter-morning-sunburst.json --stills   # posters and checks
node src/web-export.ts design/winter-morning-sunburst.json        # out/<id>/web
node src/web-check.ts design/winter-morning-sunburst.json         # equivalence, screens, motion, failures
node src/web-perf.ts design/winter-morning-sunburst.json          # load and frames, after a full render
```

`web-check` compares the page with the renderer. Measured 2026-11-22, 184 of 184 web checks pass:

| Format | Text boxes | End state: mean difference | Visibly different pixels | Mid-scroll at 5 s |
|---|---|---|---|---|
| Feed | identical (0,00 px) | 1,03/255 | 0,07 % | 0,80/255 |
| Story | identical | 1,30/255 | 0,09 % | 1,08/255 |
| Landscape | identical | 0,95/255 | 0,05 % | 0,68/255 |

The difference is split into its two causes: the static grain tile (about 0,44/255) and WebP
compression of the photograph (the rest). The same renderer checks (fit, safe area, type scale,
legibility over time against the real pixels) pass on six real screens from 360×640 to 1920×1080.

`web-perf` loads each page cold, three times, and reports the median. Phone: 390×844 at 3×,
Lighthouse's mobile throttling (562,5 ms round trip, 1,47 Mbit/s down, CPU slowed 4×). Desktop:
1440×900 at 2×, no throttling. For comparison, the same film as a web MP4 (H.264, crf 26) and as
the GIF. Measured 2026-11-22 on the Mac's GPU (Metal):

| Screen | Page | First paint | Message or first frame shown | Transferred | Frame time while scrolling or playing |
|---|---|---|---|---|---|
| Phone | Scene (this export) | 1,84 s | 2,60 s, as text | 265 kB | 16,7 ms, none late |
| Phone | MP4 | 0,60 s | 1,38 s | 572 kB | 16,7 ms |
| Phone | GIF | 1,18 s | 137 s | 25 725 kB | 16,7 ms |
| Desktop | Scene | 0,02 s | 0,03 s | 246 kB | 16,7 ms |
| Desktop | MP4 | 0,01 s | 0,03 s | 495 kB | 16,7 ms |
| Desktop | GIF | 0,03 s | 0,01 s | 8 160 kB | 16,7 ms |

CPU and memory on the throttled phone, measured after the scroll with garbage collected: the scene's
main thread is busy 9 % of the frame window (the films 1 %), its JavaScript heap is 1,5 MB (the
films 1,2 to 1,3 MB) and the document has 498 DOM nodes. Decoded images are not in the heap figure.

The scene sends less than half the MP4's bytes, and its words stay real, selectable text. On a
slow phone network the scene is drawn about 1,2 s after the MP4's first frame: the page is drawn by
JavaScript, so nothing paints until the modules, fonts (or the 2 s font wait) and photograph are in.
The GIF is not a usable web format for this film.

Limits of the measurement:

- A Mac slowing itself down is not a phone. GPU, memory and heat are the Mac's; the numbers compare
  the pages with each other and do not predict a given phone.
- Headless Chromium rasterises in software by default. There the scene's full-frame blend layers took
  33 ms a frame at 1440×900, the films 16,7 ms. `web-perf` therefore runs on the GPU and refuses to
  measure without one. A device without GPU rasterising would see the software figure.
- Frame times are `requestAnimationFrame` intervals; compositor work after a frame is handed over is
  not in them. Throttling is applied through DevTools, per request, not by a real radio.
- The page has no server-rendered text (only the `noscript` and fallback poster), and its modules are
  shipped unbundled with types stripped.
- The end-state hashes changed on this branch: the scrim now follows the measured text and the
  headline grows on narrow screens, so `same bytes twice` holds for the new bytes, not the old ones.

### Share

`share/deploy.sh` puts the checked export on a Cloudflare Worker (`share/wrangler.jsonc`,
`src/share-worker.ts`) on a `workers.dev` address. The files are the export unchanged. The script
refuses unless web-check passed and is newer than the export. Deploying needs a Cloudflare account
and `wrangler`; the Worker's name in `share/wrangler.jsonc` is the only account-specific setting.

The `ACCESS` var decides who gets in. `"public"` (the current setting) serves the page to anyone
with the link. Any other value puts it behind HTTP Basic authentication: the Worker answers every
request first, so nothing is served without the password, and responses carry `private, no-store`.
The user name and password are then created on the first run and kept only in the macOS Keychain
(`CSL_SHARE_USER`, `CSL_SHARE_PASSWORD`, account `csl`). Both modes send `noindex`, so search
engines leave the page alone until that header is removed.

**What it can cost.** The Worker serves static files only; it calls no model and holds no key, so
no visitor can cause a paid generation. Its own cost follows Cloudflare's Workers pricing (read
2026-11-22 on developers.cloudflare.com, pages updated 12 to 19 November 2026):

- `run_worker_first` is on, so every request runs the Worker and counts as a Worker request.
  Static assets served without the Worker would be free and unlimited.
- **Free plan:** 100,000 requests a day, reset at midnight UTC. Beyond that, requests get an error
  (1027, or 429 for assets) instead of a bill.
- **Paid plan:** USD 5 a month minimum, 10 million requests and 30 million CPU ms included, then
  USD 0.30 per million requests and USD 0.02 per million CPU ms. No charge for bandwidth or egress.
  The Worker only adds headers, so its CPU time per request is small.
- **Caps.** Cloudflare offers a Workers spending limit that blocks new invocations at a threshold,
  and email alerts without blocking (see its spend-management page). Neither is set by this
  repository; set one in the account if it is on the Paid plan.
- Observability is off in `wrangler.jsonc`, so no log storage is used.

### Render time

`--stills` renders the stills and every check and skips film and print: about 45 s for three
formats, for design iteration. The report records time per phase (`timings_s`).

The film was the cost: 301 frames per format, each a PNG screenshot piped to ffmpeg.
`src/profile-film.ts` split a frame's time into seeking, screenshot and encoding; the screenshot
dominated. Frames are now captured through the DevTools protocol (`Page.captureScreenshot` with
`optimizeForSpeed`). Measured on 2026-11-22 on an otherwise idle M4 Max: film frames and MP4 for
three formats went from 374,5 s to 118,8 s, the full render from 436 s to 172,6 s, and every MP4
and GIF hash stayed the same. Later full renders took 179 to 187 s.

The PDF is not byte-reproducible: Chromium writes the creation time into it. Its fonts are checked
instead.

### The technical section

When the campaign names an explainer (`"explainer": "design/explainer.json"`), the page ends with a
section for a technical reader: the problem, what a model made, what is code, one scene in every
medium, and how the result is checked. The prose is data; every fact under it (model, licence,
approval, recipe and image hashes, output hashes, check counts) is read at export time from the
asset manifests and the render report, so the page cannot state more than the render did.
A scrubber builds a second, small instance of the same scene module and seeks it to the chosen
moment. It is built only when the section comes near the screen, is hidden from assistive
technology (the film's words are already on the page once), and `web-check` verifies that it draws
the scene at the chosen time and that the section fits a 360 px phone.


```sh
# once: the asset (needs local FLUX.2 klein 4B and mflux; see the repo README)
csl run --brief poc/composition/briefs/asset-leaves.json --brand examples/aster-lane/brand.json --runs-dir runs/poc
# every change of copy, layer or format: seconds, no generation
node poc/composition/src/render.ts                         # first campaign
node poc/composition/src/render.ts design/editorial.json   # editorial
node poc/composition/src/render.ts design/winter-morning.json   # cinematic, about 6 min with film
node poc/composition/src/render.ts design/winter-morning-sunburst.json --stills   # art direction, about 40 s
```

The renderer serves this folder to Chromium under a placeholder origin and strips TypeScript types
on the way. Every other request is aborted. Outputs go to `out/<campaign id>/`.

Dependencies (Playwright, TypeScript, ESLint) are declared in `package.json` and locked in
`package-lock.json`. Type check and lint use the same strict settings as `web/`:

```sh
cd poc/composition && npm ci && npm run typecheck && npm run lint && npm test && npm run test:demo
```

## Your own project

The examples above live inside the engine. A campaign of your own can live anywhere: point
`CSL_PROJECT` at a folder with `design/tokens.json`, `design/<campaign>.json` and `assets/`, and run
the same commands from it.

```sh
export CSL_PROJECT=~/work/spring-campaign
node src/import-asset.ts <sidecar.json> hero --use feed,story --for render,web
node src/render.ts design/spring.json
```

Imports, renders and the web export are written into the project. Scene code always comes from the
engine; a page, stylesheet or font in the project replaces the engine's. `npm run test:project`
renders a copy of the demo this way. The full contract is in
[`../../docs/interfaces.md`](../../docs/interfaces.md).

## Safari: a manual test

Safari is not tested automatically. Playwright 1.65 expects its own WebKit build; the one cached on
the development machine is older and fails at the first page (`Unknown setting: PushAPIEnabled`).
Downloading the matching build was left out on purpose. Chromium cannot emulate an iPhone's safe
area, so the notch and home-indicator insets were checked only by building the scene with those
insets (59 px at the sides, 21 px below) and measuring the text boxes.

On an iPhone with Safari, and on a Mac in Safari, open the exported page and check:

1. Portrait, at the top: the headline is there within a second, no line is cut at its descenders
   ("y", "p"), and the photograph fills the screen.
2. Scroll slowly through the film: the light rises, the steeping line fills, and the release date
   lands last. Scrolling back reverses it.
3. Turn the phone sideways: the photograph runs under the notch to the screen edges, and no text sits
   under the notch or the home indicator.
4. Settings, Accessibility, Motion, Reduce Motion on: the page shows the end state, still, with no
   long scroll.
5. The technical section: nothing is wider than the screen, the scrubber draws the scene at the chosen
   moment, and VoiceOver reads the section without reading the scrubber's scene.


- `evidence/01-source-check-stopped-render.log`: the first run. The source check refused to render
  because moss on paper is 4.18:1 and paper on clay is 3.55:1. The fix was a design decision. Two darker
  working tones were added and the brand colours were left unchanged.
- `evidence/02-render.log`: 355 of 355 technical checks pass. After the move to a shared renderer the same campaign gives 354 of 354, because the PDF font check now counts DM Sans once, not once per type role. The PNG bytes are unchanged. Two fresh renders give identical
  bytes for the end state and for the frame at t = 2.5 s.
- The checks say nothing about whether the composition is good. That is the human review.
- The CSL asset run auto-rejected the chosen candidate on palette fit. It was picked anyway because it
  fills a round crop evenly. Colour statistics are a hint for assets, not a design verdict.
- The PDF keeps text as selectable vector glyphs. Chromium embeds the variable fonts as Type 3. A print
  shop may want static TrueType or OpenType instances. This has not been tested with a printer.
- `scripts/generate_whole_image.sh` is the comparison baseline. It asks the same model, at the same pin,
  for the finished poster. The output is in `runs/poc-whole/` and is not committed.

## Licences

The fonts DM Sans and Playfair Display are under the SIL Open Font License. The licence texts are in
`fonts/`. The asset is from FLUX.2 klein 4B, which is under Apache-2.0. Generated images and renders
stay local; only the manifests are committed.
