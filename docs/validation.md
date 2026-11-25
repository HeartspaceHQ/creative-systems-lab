# Validating the quality judgement

Status: **prepared, not run.** The images are generated and scored. Nobody has rated them yet, so
this repository makes no claim about how well the quality checks agree with a human.

## The question

The checks in [evaluation.md](evaluation.md) measure colour and tone. Whether they also catch
images that are wrong in other ways (subject, composition, expression, light) is unknown. The
easy cases (clearly off-brand) are caught by construction. The informative cases are the subtle
ones, so the set is weighted towards them.

## The case set

`examples/aster-lane/validation/spec.json` lists 40 cases for the fictional Aster Lane brand. Each
has a prompt, a seed and an intended category:

| Intended category | Cases |
|---|---|
| good | 8 |
| subtle_composition | 6 |
| subtle_subject | 6 |
| near_tone | 6 |
| wrong_light | 6 |
| subtle_expression | 4 |
| clear_wrong | 4 |

The category is a hypothesis about what the prompt will produce, not a label. The model may not
follow the prompt, and the human rating, not the category, is the reference. The specification
holds no ratings and the ratings file holds no categories.

## Generation (measured)

`csl validate generate` used FLUX.2 Klein 4B q8 (Apache-2.0, already installed; nothing
downloaded) on an Apple M4 Max, 48 GB unified memory, 320x320. It generated and scored all 40
images in 367.7 s of generation time (median 9.0 s per image, range 7.9 to 14.4 s). Each image is
one process call including model load. No real people, customers or brands appear in any prompt.

## Blind rating

`csl serve`, then open `#/blind/aster-hard-cases-v1`. The page shows one image at a time under an
opaque id (`sha256(set:case)[:12]`) and the brief text. It shows no system score, no check result
and no category; the image file is re-encoded so no metadata travels with it. Keys: A approve, R
reject, arrows move. Ratings are appended to `ratings.jsonl` in the set directory.

When all 40 are rated:

```bash
csl validate report examples/aster-lane/validation/spec.json --out runs/validation/aster-hard-cases-v1
```

The report prints a confusion matrix overall and per category. Positive means "acceptable". A
false positive is an image the system accepts and the human rejects; a false negative is the
reverse. Two system verdicts are reported: `gate` (hard checks pass) and `strict` (hard checks pass
and no soft warning). `--partial` allows unrated images and says so.

## What this will and will not show

Forty images from one model, one brief and one rater give counts, not a calibrated error rate.
Per-category cells hold four to eight images. A single rater's taste is the reference. Treat the
outcome as a first look at where the checks are blind, not as validation.
