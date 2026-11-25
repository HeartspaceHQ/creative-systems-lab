#!/usr/bin/env bash
# Re-creates the committed example run (needs mflux and the cached FLUX.2 Klein 4B weights).
# Usage: CSL_MFLUX_BIN_DIR=/path/to/venv/bin scripts/run_example.sh
set -euo pipefail
cd "$(dirname "$0")/.."
csl models --brief examples/aster-lane/brief.json
csl run --brief examples/aster-lane/brief.json --brand examples/aster-lane/brand.json \
  --runs-dir runs --models flux2-klein-4b-q8,flux2-klein-4b-q4,procedural-offbrand
