# Evaluation

All checks return a `Check(name, value, threshold, comparison, passed, hard)` and are stored in
`evaluation.json` next to the image. A candidate is `auto_rejected` if any **hard** check fails;
a failed **soft** check does not reject anything, it is shown to the reviewer as a warning.
Thresholds come from the brand file (`thresholds`).

The checks measure colour and tone against numbers: the brand's palette, its forbidden colours,
the contrast of planned text, and the colour and tone distance to a set of approved reference
images. **They do not measure whether an image follows a brand.** A brand is also composition,
subject, mood and voice, and none of that is looked at. A pass means "the measured colours were
within the limits", nothing more.

| Check | Measures | Hard |
|---|---|---|
| `palette_fit` | Median-cut dominant colours (up to 8), area weighted; fraction of area within CIE76 dE <= 22 (default) of a palette colour. Clusters under 3% of the area are ignored. Near-grey colours (Lab chroma <= 12) count as covered when the brand allows neutrals. Pass at >= 0.8. | yes for illustrations; **soft for photographs** |
| `forbidden_colour_area` | Fraction of pixels within dE <= 12 of a forbidden colour. Pass at <= 0.01. | yes |
| `overlay_contrast` | WCAG contrast of the brief's planned text colour against the pixels in the reserved zone, taken at the 5th percentile so a small busy patch fails. Pass at >= 4.5, or >= 3.0 for large text. | yes |
| `colour_drift` | Colour deviation from the references: Jensen-Shannon distance between the candidate's 3x3x3 Lab joint histogram and the mean of the reference histograms. Limit = max(leave-one-out distance among references) x margin (1.25), floor 0.05. With one reference the limit is the floor. | **no, soft (warning only)** |
| `tone_drift` | Tone deviation from the references: worst absolute z-score of tone statistics (mean and spread of lightness, mean and spread of chroma, edge density), with a floor on each spread. Pass at <= 3.5. | **no, soft (warning only)** |

### Two gates: the asset and the finished design

An asset check asks whether an image is usable material: no forbidden colours, no drift far from
the references, and for illustrations the brand palette. It does not ask a photograph to consist of
brand colours. A photograph of tea is brown, amber and green by nature, and the GPT Image 2.6
Sunburst tea photo scored 0.63 on palette fit although the finished compositions built on it pass
their checks. The brand lives in the composition: type, colour fields, grading and layout. Those are
checked by the composition renderer (`poc/composition`) on the finished frames, against the real
pixels, through the whole film. So palette fit is hard for `kind: illustration` and soft for
`kind: photo` (changed 2026-11-22). Forbidden colours stay hard for both.

`colour_drift` and `tone_drift` are only produced when the brand has a reference directory with
at least one image; without one the run records the warning "no reference set: drift not
evaluated". With fewer than 3 references (`MIN_CALIBRATED_REFERENCES`) they are still computed
but a warning says the limits are uncalibrated.

Why the drift checks are soft: the methods are experimental (a small histogram and five
statistics, calibrated on a handful of images, see below). A failure means "this image's colours
or tones sit outside what the approved references cover". That can be a legitimate new direction
as well as an off-brand image, so it is a prompt for the human reviewer, not a gate. The code
sets `hard=False` for both in `src/csl/evaluate.py`; this document describes that, not an
intention to make them hard later.

## Similarity used by `csl replay`

Replay compares a regenerated image with the recorded one and returns one of four outcomes for a local model:

| Outcome | Rule |
|---|---|
| `bit_identical` | SHA-256 of the files is equal |
| `perceptually_close` | **both** dHash (8x8 grey-scale difference hash) Hamming distance <= 6 bits **and** mean CIE76 colour difference <= 6.0 dE on a 16x16 box-averaged Lab thumbnail |
| `diverged` | bytes differ and at least one of the two measures exceeds its limit |
| `pin_mismatch` | the installed model or tool versions differ from the recorded pin (not compared unless forced) |

A hosted model gets a fifth, `new_generation`. Its provider does not promise the same image for
the same request, so a new call is a new paid image, not a reproduction: replay refuses it without
an approved `--budget`, and states the comparison only as information.

dHash alone works on grey-scale and cannot see colour: a test in `tests/test_similarity.py`
builds a warm and a cold rendering of the same structure whose dHash distance is within 6 bits
but whose mean colour difference is far above the limit; that case is now `diverged`. The two
limits (6 bits, 6.0 dE) were **set by judgement, not validated** against human similarity
ratings. Structure is still measured only at 8x8, so a different but similarly laid-out image
can pass the structure half.

## What these cannot see

Object correctness, anatomy, text rendered inside the image, composition quality, and anything
semantic. CIE76 is the simplest Lab difference formula and is less perceptually uniform than
CIEDE2000, particularly in saturated blues. Images are box-downsampled to 128 px for
measurement, so fine texture is invisible to the checks. Dominant colours are taken from a
256 px thumbnail with median-cut quantisation.

## Calibration honesty

With 4 references the leave-one-out limit rests on 4 distances. The histogram resolution was
chosen by comparing candidate scores at five resolutions on the generated set and the off-brand
stub (the finer 5x7x7 grid put the limit at 0.99, essentially equal to the off-brand stub's distances of about 0.99, leaving no margin).
That is tuning on the test data; it is disclosed here rather than hidden.
