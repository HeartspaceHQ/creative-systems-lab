#!/usr/bin/env bash
# Comparison baseline: ask the image model for the finished campaign image,
# headline and layout included. Same model and pin as the asset run.
# Usage: CSL_MFLUX_BIN_DIR=/path/to/venv/bin scripts/generate_whole_image.sh OUT_DIR
set -euo pipefail
out="${1:?output directory}"
mkdir -p "$out"
prompt='Advertising campaign poster for Aster Lane, a premium tea brand. Large elegant serif headline reading "Steep it slow." Smaller line reading "Winter Blend No. 3. Black tea, orange peel and clove." Overhead photograph of loose black tea leaves with orange peel and cloves inside a large circle. Calm editorial layout, generous margins, deep navy #1f2a44, warm paper #f4efe6, clay #c4623f accents.'
for seed in 7301 7302 7303; do
  /usr/bin/time -p "$CSL_MFLUX_BIN_DIR/mflux-generate-flux2" \
    --model flux2-klein-4b --quantize 8 --steps 20 \
    --width 1024 --height 1280 --seed "$seed" \
    --prompt "$prompt" --output "$out/whole-s$seed.png" 2>&1 | grep -E '^real' | sed "s/^/seed $seed /"
done
printf '%s\n' "$prompt" > "$out/prompt.txt"
