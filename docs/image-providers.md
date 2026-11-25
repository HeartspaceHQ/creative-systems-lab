# Image providers: local and hosted on equal terms

A generative model in this lab makes **one separate visual asset**, for example a photograph. It never
makes the finished design. Layout, typography, vector graphics, motion and export are code
(`poc/composition`). Each provider stands behind the same `Backend` protocol. Each returns the image
and a `Cost`, and goes through the same registry, evaluation, review and manifest as the local model.

| Key | Where | API shape | Seed | Cost in the response |
|---|---|---|---|---|
| `flux2-klein-4b-q8` (and q4, 9b-q6) | this Mac, mflux | subprocess | yes | n/a, $0 |
| `gpt-image-2.6-sunburst`, `gpt-image-2.6-flare` | OpenAI | sync, base64 | no | token `usage` → computed exactly |
| `nano-banana-2.1`, `nano-banana-pro` | Google Gemini API | sync, inline base64 | no | tokens only → priced from the table |
| `grok-imagine-image-2.0` | xAI | sync, base64 or URL | no | none → flat published price |
| `flux-2-pro`, `flux-3-image` | Black Forest Labs | async, poll, signed URL | flux-2-pro: yes | `cost` in credits → exact |
| `elevenlabs-gpt-image-2.5-sunburst`, `elevenlabs-nano-banana-pro` | ElevenLabs Image & Video | async, poll, URL | no | none, **unknown per call** |

The mflux backend stays optional and local. Hosted entries are never auto-selected. They run only
when named with `--models`, when their key is in the environment, and inside an approved budget.

## Prices

Read from the providers' own pages on 2026-11-22. `csl quote --brief <brief>` prints the same
table for any brief size without making a call.

| Model | USD per image | Confirmed | Notes |
|---|---|---|---|
| FLUX.2 [pro] | 0.03 first MP + 0.015 per extra MP (1280² ≈ 0.045) | yes, bfl.ai/pricing | fixed snapshot, seed, exact size |
| FLUX 3 Image | 1k 0.048, 1.5k 0.07, 2k 0.10 | yes | aspect ratio and resolution tier |
| Nano Banana 2.1 (`gemini-nano-banana-2.1`) | 1K 0.0336, 2K 0.0504, 4K 0.113 | yes | batch half price; SynthID watermark; paid tier |
| Nano Banana Pro (`gemini-3-pro-image`) | 1K/2K 0.134, 4K 0.24 | yes | SynthID watermark |
| Grok Imagine Image 2.0 | 0.04 flat | yes | resolution and watermark not documented |
| GPT Image 2.6 Sunburst, quality high | **measured**: 1280×1280 0.0636, 1536×1024 0.0421 | measured, not published | OpenAI publishes token rates, not a per-image price for 2.6. The cost is computed from the token counts in each response (`usage`) times the published rates, and settled in the budget ledger. Six images on 2026-11-22. The quote uses 0.07 as a ceiling up to 1536 and 0.20 at 2048 (not measured). |
| ElevenLabs (any model) | unknown | **no** | **The image API needs a Pro plan or above** (HTTP 402 `paid_plan_required` on a Creator account, 2026-11-22, nothing charged). The key also needs the `image_video_generation` permission, and `user_read` to read the credit balance. No per-image price is published and the response carries none. ElevenLabs' documentation says failed generations are not charged; the lab does not rely on that, and keeps a failed call's reservation as uncertain spend unless the request itself was refused. The API lists `gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2`, `gemini-3-pro-image`, `gemini-3.1-flash-image`, Seedream 5 and others, but not the 2.6 models. Sunburst takes `aspect_ratio`, `resolution` (1K, 2K, 4K) and `quality` (low to max; this lab sends high). Read on elevenlabs.io/docs/api-reference/flows, 2026-11-22. The real cost per image is read from the account's usage page after the first approved call. |

The budget holds back 1.5 times the estimate for unconfirmed prices. A call whose cost is not
reported keeps its whole reservation in the ledger, counted as uncertain. The ledger leans towards
overstating spend, with two exceptions: a call the provider refused with an HTTP 4xx is counted as
zero, and a cost computed from a published price is only as right as that price.

## Budget approval

No hosted call runs without an approval file written by a person:

```json
{"id": "poc-providers-1", "approved_usd": 5.0, "approved_by": "<name>", "approved_on": "2026-11-22"}
```

```bash
csl quote --brief <brief> --models flux-2-pro,nano-banana-2.1 --budget budgets/poc.json
csl run   --brief <brief> --brand <brand> --models flux-2-pro,nano-banana-2.1 --budget budgets/poc.json
```

Every command that can call a model goes through one function, `pipeline.generate_once`, which
refuses a paid model without a budget: `csl run`, `csl validate generate` and `csl replay` all
take `--budget` and refuse before the first call when it is missing or too small. A test checks
that no other code outside the backends calls a model.

The local review UI (`csl serve`, bound to 127.0.0.1) follows the same rule. Started without
`--budget` it offers only the free local models and greys out every hosted one with the reason.
Started with `csl serve --budget budgets/<id>.json` it shows what each run would hold before you
press start, and the server checks the run against what is left before it creates the job. The
page shows whether each provider's key variable is set, never its value; keys are read from the
server's environment and never pass through the browser. Nothing in this repository exposes
generation to the internet; the public demo page is static files.

The run is checked against what is left before anything is written. Each call reserves its
quote under its own reservation id, then settles with the reported cost, in
`budgets/<id>.ledger.jsonl`; overlapping runs, even with the same candidate names, keep each
other's holds. `budgets/` is git-ignored because the approval names a person.

`csl serve --ask-key OPENAI_API_KEY` (also on `csl run`) asks for a key at a hidden prompt before it
starts: paste it, nothing is echoed or saved, and it lives in that process only. Repeat the flag for
more than one provider. `scripts/with-keys.sh` keeps the keys in the macOS Keychain and puts them in the environment of
one command only (`scripts/with-keys.sh csl run ...`). Keys are read from the environment at call time (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`,
`BFL_API_KEY`, `ELEVENLABS_API_KEY`). They are never written to a manifest, log or URL. A polling
URL must be on the provider's own domain before the key is sent to it. Signed result URLs are
fetched without a key.

## What is kept

For every candidate the provider's original bytes are saved as `source.<format>` next to the
normalised `image.png`. The manifest records the model id, the request parameters (size, aspect,
tier) and the cost with its basis and whether it is estimated. `runs/` stays out of Git.

## Not yet known (needs an approved call or an account)

- Cost of GPT Image 2.6 at qualities other than high and at 2048.
- ElevenLabs credits per image: needs a Pro plan for API access.
- Whether xAI honours a size request and whether it watermarks.
- Quality of the other hosted models on the tea brief. Only GPT Image 2.6 Sunburst has been called
  (six images, 0.34 USD in all). All hosted tests use a recorded fake transport.

## Measured so far

| Model | Brief | Size | Images | USD each | Seconds each | Asset check |
|---|---|---|---|---|---|---|
| FLUX.2 klein 4B q8 (local, M-series Mac) | tea | 1280×1280 | 4 | 0 (electricity only) | see `docs/validation.md` | palette fit passes, tone drift soft fail |
| GPT Image 2.6 Sunburst, high | tea | 1280×1280 | 4 | 0.0636 | 36–38 | palette fit 0.63 (soft for photos since 2026-11-22) |
| GPT Image 2.6 Sunburst, high | tea, landscape composition | 1536×1024 | 2 | 0.0421 | 29–30 | palette fit soft fail, otherwise pass |

A call the provider answers with an HTTP 4xx before generating (missing permission, plan, invalid
key) is settled at zero, as such a refusal is not billed by the providers here; the lab cannot see the
invoice to confirm it. Any other failed call (a timeout, a 5xx, a lost connection) keeps its whole
reservation, counted as uncertain, because an image may have been made and billed.
