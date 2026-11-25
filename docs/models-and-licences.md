# Models, licences and hardware

| Registry id | Model | Licence | Commercial use | Run in this work |
|---|---|---|---|---|
| `flux2-klein-4b-q8` | FLUX.2 Klein 4B, mflux 8-bit | Apache-2.0 | yes | yes |
| `flux2-klein-4b-q4` | FLUX.2 Klein 4B, mflux 4-bit | Apache-2.0 | yes | yes |
| `flux2-klein-9b-q6` | FLUX.2 Klein 9B, 6-bit community quantisation | FLUX Non-Commercial License | no | no, registered to demonstrate the licence rule |
| `procedural`, `procedural-offbrand` | in-repo shape generator | n/a (not a model) | yes | yes |

The registry refuses to select a non-commercial model for a brief with `commercial_use: true`,
and `export` refuses to export such a candidate under a commercial brief. Related families to
keep apart: FLUX.1-dev is non-commercial, FLUX.1-schnell is Apache-2.0. Check the model card for
the exact weights you use; this table records what was verified for the weights actually run.

No weights are in this repository and none are downloaded by it. `mflux` (MIT) is called as an
external tool.

## Hardware

Real runs: Apple M4 Max, 48 GB unified memory, macOS, mflux 0.19.2, mlx 0.32.2. 320x320, 8
steps: about 8.2 s per image for 4B q8 and 8.9 s for 4B q4, including model load per image.

Not run here: anything needing CUDA, the 9B model, high-resolution generation, video models. The
mflux backend targets Apple silicon; other backends would implement the same two-method
`Backend` protocol (`pin()` and `generate()`).
