# Image rights

The code and the images in this repository are under different terms. Heartspace PR Sverige AB
holds the copyright in the code and licenses it under MIT ([LICENSE](../LICENSE)); the MIT licence
does not cover any image, recording, film or music listed here (see [NOTICE.md](../NOTICE.md)).

## The winter-morning photographs (GPT Image 2.6 Sunburst)

The two photographs in the finished campaign demonstration, `design/winter-morning-sunburst.json`,
are the visual main example of this repository.

| Image | Run, candidate | Generated (UTC) |
|---|---|---|
| `assets/tea-sunburst.png` (feed, story) | `aster-editorial-tea-20261122T120454`, `gpt-image-2.6-sunburst-s337839` | 2026-11-22 12:05 |
| `assets/tea-sunburst-landscape.png` (landscape) | `aster-editorial-tea-landscape-20261122T131804`, `gpt-image-2.6-sunburst-s611713` | 2026-11-22 13:18 |

**How they were made.** OpenAI's Images API (`v1/images/generations`, model `gpt-image-2.6-sunburst`,
quality high), from a text prompt written for this project and recorded in each candidate's
manifest. No image was sent as input; the reference images a run records are used only by the local
drift check.

**Which account.** The API key that made both calls belongs to the OpenAI API organisation of
Heartspace PR Sverige AB (organisation number 556882-2042), an organisation account, not a personal
one. Checked on 2026-11-22: the key in use was last changed at 12:04 UTC, before both calls, and
OpenAI identifies its organisation in the response headers. The organisation and project ids are kept out of the repository.

**The terms.** The calls were made under the OpenAI Services Agreement (updated 1 December 2025,
effective 1 January 2026, <https://openai.com/policies/services-agreement/>):

- **4.1.** As between the customer and OpenAI, and to the extent permitted by applicable law, the
  customer owns the Output, and OpenAI assigns to the customer any right, title and interest it has
  in it. The customer here is Heartspace PR Sverige AB.
- **4.4.** Output may not be unique; other customers may receive similar content.
- **4.3 and 3.3.** The customer is responsible for how Output is used, and may not use it in breach
  of law, third-party rights or OpenAI's usage policies.

**Use here.** Heartspace PR Sverige AB, the API customer, is also the publisher of this repository,
and shows the photographs on its demo page, in this README, in the screenshots and in the launch
film.

**What this repository claims, and what it does not.** It claims that, as between
Heartspace PR Sverige AB and OpenAI, the company holds whatever rights exist in these two photographs. It does not claim that
they are protected by copyright, or that anyone holds exclusive rights in them: protection for a
generated image depends on the law where it is used and on human creative contribution, and the
agreement does not settle it. Similar images may exist elsewhere.

**Terms for anyone else.** None are granted. The MIT licence does not cover these images; they are
shown on the demonstration page, and any licence to reuse them would be a separate, explicit
decision. The source images are not in Git (`.gitignore` excludes composition PNGs); the manifests
that identify them by hash are. The screenshots and the screen recording of the demo in `docs/img/`
(`hero-winter-morning.jpg`, `scroll-moments.jpg`, `phone-moments.jpg`, `technical-section.jpg`,
`scrubber.jpg`, `review-approved.jpg`, `scroll-recording.gif`, `scroll-recording.mp4`) show the
photographs as the page renders them, and the same terms apply to them.

## The launch film

`docs/img/csl-launch-film.mp4` (and its poster `csl-launch-film.jpg`) was recorded headless from the
public demo page and from CSL Studio. Besides the two photographs above it shows four candidates
generated with GPT Image 2.6 on the same OpenAI API organisation on 2026-11-25 (run
`winter-morning-ac5a-20261125T112753`), under the same terms. Its soundtrack, "Convergent Signal",
was made with Suno under terms that allow commercial use. Neither the film, its images nor its
music are covered by the MIT licence, and no reuse rights are granted.

The CSL Studio screenshots in `docs/img/` (`studio-brief.jpg`, `studio-fonts.jpg`,
`studio-images.jpg`, `studio-keys.jpg`, `studio-design.jpg`, `studio-deliver.jpg`) and the delivered
example `studio-output-portrait.jpg` show photographs generated locally with FLUX.2 Klein 4B for a
made-up brand, Aster Lane. They fall under the terms of the FLUX.2 klein example images below.

## The FLUX.2 klein example images

The 320 px images under `examples/aster-lane` (in Git), the copy `import-asset` writes to
`poc/composition/assets/flux-leaf.png` and the photographs in the CSL Studio screenshots were generated locally with FLUX.2 Klein 4B, whose weights are Apache-2.0. They make the fresh-clone
demo (`npm run test:demo`) run without keys, and may be used for running and testing this
repository. Like the photographs above, they are not covered by the MIT licence, and no other reuse
rights are granted.

## The other hosted providers

Gemini, xAI, Black Forest Labs and ElevenLabs are implemented but were never called for an image in
this repository. Each provider's terms would govern its output; nothing here relies on them.
