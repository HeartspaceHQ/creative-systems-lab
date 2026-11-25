#!/usr/bin/env bash
# The same commands CI runs. Exit code is non-zero if any step fails.
set -euo pipefail
cd "$(dirname "$0")/.."
ruff check .
ruff format --check .
mypy
pytest -q
(
  # The studio's end-to-end test renders through the composition engine, so it needs its packages.
  cd poc/composition
  npm ci --no-audit --no-fund
  npx playwright install chromium
)
(
  cd web
  npm ci --no-audit --no-fund
  npm run typecheck
  npm run lint
  npm run build
  npx playwright install chromium
  npm run e2e
)
