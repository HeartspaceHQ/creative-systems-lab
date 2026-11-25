# Changelog

The interfaces another application may rely on are described in [`docs/interfaces.md`](docs/interfaces.md).
Before 1.0, a breaking change to them raises the minor version.

## 0.3.0, 2026-11-25

- Heartspace PR Sverige AB is the copyright holder and publishes the code under MIT (`LICENSE`,
  `NOTICE.md`). Images, recordings, the launch film and its music are outside the MIT licence.
- A 41-second launch film, `docs/img/csl-launch-film.mp4`, recorded headless from the demo page and
  CSL Studio, is presented at the top of the README.
- The studio's Keychain command reads the key from the clipboard. The `security` prompt keeps only 128
  characters and silently cut longer OpenAI project keys, which then failed with HTTP 401.
- CSL Studio: `csl serve` opens on projects. Brief & brand, Images, Design and Deliver are four areas of
  one project, reachable in any order and saved as you go. Brands are reused across projects.
  Images are generated or imported, approved under a name (imports with a rights confirmation) and
  put in the design; the design is previewed live by the composition engine and delivered as checked
  PNG, MP4, GIF and PDF files. The API endpoints are listed in `docs/interfaces.md`.
- Writes to the local API need the session token from `GET /api/session` and a loopback `Origin`.
- Provider keys can be pasted in the studio; they are kept in the server process only. The studio says
  so where the key is pasted, shows whether each key was pasted or came from the terminal, and shows
  how to keep a key in the terminal instead (`--ask-key` or the macOS Keychain), with commands to copy.
- Rejecting the last image to review returns to generating, with the reason shown.
- Changing the decision on a generated image no longer asks for a rights confirmation the form does not
  show; only imported images need it, and a generated image's rights stay confirmed by its model licence.
  The terminal commands wrap between words, so a long command is shown whole and no flag is split.
- Eight bundled fonts instead of two: Newsreader, Fraunces, Lora and Playfair Display (serif), Figtree,
  Inter, Space Grotesk and DM Sans (sans), listed with their role settings in
  `poc/composition/fonts/catalog.json`. A designer can upload a font file of their own under a name,
  with a licence confirmation; it is kept in the studio folder and copied into the deliveries that
  use it. The engine takes the fonts as data (`fonts` in the preview message and in `source.json`).
- Studio designs keep a readable body: a headline needs to be 2.5 times the body (not 4), and the body
  never grows past a body-copy size. A call to action longer than its column wraps instead of overflowing.
- Films start clean: headline lines stay hidden until they rise, in the studio layouts and in the
  demo campaign's scene, whose first frame and scrubber at t = 0 showed slivers of the waiting
  lines. GIFs are 720 px wide and smoothed before the palette, so the film grain no longer turns
  into noise.
- A spending limit can be approved in the studio under a name. It applies at once, without a
  restart, and is kept in the studio folder so the next start uses it; `--budget` still overrides.
- The budget reports what is charged, uncertain and held apart, and a call the provider refused
  before generating is settled at zero.
- Creating files first saves the open brand and design edits, and does not start if one of them
  is not valid yet or the server refused it; before, a refused save could deliver the older version.
- A started delivery renders the design and brand as they were when it started; edits made while
  it renders no longer reach it.
- The studio's budget shows reported, uncertain and reserved spend on their own lines, and no longer
  says that a failed run cost nothing: only a call the provider refused is counted as not charged.
- Composition engine: `composition.framing` (`close` or `whole`); headlines wider than their column
  shrink and then break between words; the cinematic layout of a brand with a light ground is set
  dark with light words, with the accent lifted until it reads; on a wide canvas a narrow
  photograph stands in a panel instead of being cut to a band.
- `csl serve` and `csl run` take `--ask-key <VARIABLE>`: the provider key is pasted at a hidden prompt,
  kept in that process only and never shown, so it cannot leak on a shared or recorded screen. The
  README and the start panel use it instead of `export`.

## 0.2.0, 2026-11-23

- The composition engine keeps a project apart from its own code. `CSL_PROJECT` points at a folder
  with `design/`, `assets/` and `out/`; scene code comes from the engine, and a project may replace
  a page, stylesheet or font. Unset, the engine's own examples are the project, as before.
- The composition engine is named `@creative-systems-lab/composition` and carries the lab's version.
- `docs/interfaces.md` describes the stable interfaces: the `csl` command line, the local HTTP API of
  `csl serve`, the export sidecar and the composition engine.
- A test renders a project kept outside the engine and checks that the engine's own output is untouched.

## 0.1.0, 2026-11-22

The first published version.
