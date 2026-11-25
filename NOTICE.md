# Licence

**Rights holder.** Creative Systems Lab is published by Heartspace PR Sverige AB (organisation
number 556882-2042), which holds the copyright in the code and licenses it under MIT. Sohrab Fadai
created the project and leads it.

**Code and documentation: MIT.** See [LICENSE](LICENSE). It covers the source code, configuration,
tests, campaign and design data, and the documentation in this repository.

**Not covered by the MIT licence:**

- **Images and recordings.** Every image or video file (`*.png`, `*.jpg`, `*.gif`, `*.mp4` and the
  like), generated or captured: the FLUX.2 klein examples under `examples/`, the screenshots, the
  screen recording and the launch film under `docs/img/`, and the GPT Image 2.6 photographs of the
  winter-morning campaign. The photographs themselves are not in Git, but the demo screenshots,
  the recording and the launch film show them. No reuse rights are granted for them; their terms
  are recorded separately in [docs/image-rights.md](docs/image-rights.md).
- **Music.** The soundtrack of the launch film `docs/img/csl-launch-film.mp4`, "Convergent Signal",
  was made with Suno under terms that allow commercial use. It is not covered by the MIT licence,
  and no reuse rights are granted for it.
- **Fonts.** The subset fonts in `poc/composition/fonts/` keep their own licence, SIL OFL 1.1.
- **Third-party components**, listed below, keep their own licences.

## Third-party components

| Component | Licence | Use |
|---|---|---|
| numpy, Pillow, pydantic | BSD-3-Clause, MIT-CMU (HPND), MIT | runtime dependencies |
| ruff, mypy, pytest, pytest-cov | MIT, MIT, MIT, MIT | development only |
| mflux (optional, external tool) | MIT | invoked as a subprocess, not bundled |
| React, React DOM | MIT | review UI runtime (`web/`) |
| Vite, TypeScript, ESLint, typescript-eslint, Playwright | MIT, Apache-2.0, MIT, MIT, Apache-2.0 | development and rendering; the transitive tree is not yet audited |
| DM Sans, Figtree, Fraunces, Inter, Lora, Newsreader, Playfair Display, Space Grotesk | SIL Open Font License 1.1 | unmodified Latin subsets with a variable weight axis, from Fontsource, in `poc/composition/fonts/`, licence texts beside them; Lora and Playfair Display carry Reserved Font Names, so a modified version must be renamed |
| Chromium (via Playwright) | BSD-3-Clause and others | renders scenes; downloaded by Playwright, not bundled |
| ffmpeg with libx264 | GPL-2.0-or-later | external program for MP4 and GIF; not bundled |
| poppler `pdffonts` | GPL-2.0 | external program for the PDF font check; not bundled |
| FLUX.2 Klein 4B weights | Apache-2.0 | optional, downloaded by the user, not in this repository |
| FLUX.2 Klein 9B weights | FLUX Non-Commercial License | registered so the licence rule can be demonstrated; refused for commercial briefs |

No model weights are included. The example images under `examples/` were generated with FLUX.2
Klein 4B (Apache-2.0) by this system and are labelled as such in their manifests. The brand
"Aster Lane" is invented.

The winter-morning campaign in `poc/composition`, the repository's main visual example, uses two
photographs generated with OpenAI's GPT Image 2.6 on the OpenAI API organisation of Heartspace PR
Sverige AB. Under the OpenAI Services Agreement (section 4.1) the API customer owns that output as
between it and OpenAI; no claim of copyright or exclusivity is made. The source files are not in
Git, only their manifests; the screenshots, the recording and the launch film in `docs/img/` show
them. See [docs/image-rights.md](docs/image-rights.md).
