#!/usr/bin/env bash
# Upload the verified web export to the share Worker (share/wrangler.jsonc).
#
# Refuses unless out/<id>/web exists and the last web-check passed every check. Whether the page needs
# a password is the ACCESS var in share/wrangler.jsonc. In private mode the user name and password live
# only in the macOS Keychain (account csl, service CSL_SHARE_USER / CSL_SHARE_PASSWORD); they are
# created on first run and handed to Cloudflare as Worker secrets on stdin, never printed.
#
#   share/deploy.sh                       # wrangler from PATH (npx wrangler)
#   WRANGLER=/path/to/wrangler share/deploy.sh
#
# Read the credentials yourself with:
#   security find-generic-password -a csl -s CSL_SHARE_USER -w
#   security find-generic-password -a csl -s CSL_SHARE_PASSWORD -w
set -euo pipefail
cd "$(dirname "$0")/.."
wrangler=(${WRANGLER:-npx wrangler})
config=share/wrangler.jsonc
out=out/aster-winter-morning-sunburst

[[ -f "$out/web/index.html" ]] || { echo "no web export: run src/web-export.ts first" >&2; exit 1; }
[[ -f "$out/web-check.json" ]] || { echo "no web-check report: run src/web-check.ts first" >&2; exit 1; }
[[ "$out/web-check.json" -nt "$out/web/index.html" ]] || { echo "web-check is older than the export: run it again" >&2; exit 1; }
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const failed = Object.values(r.checks).flat().filter((c) => !c.passed);
  if (failed.length > 0) { console.error(`web-check has ${failed.length} failed checks`); process.exit(1); }
' "$out/web-check.json"

if grep -q '"ACCESS": "public"' "$config"; then
  "${wrangler[@]}" deploy --config "$config"
  exit 0
fi

secret() { security find-generic-password -a csl -s "$1" -w 2>/dev/null; }
if ! secret CSL_SHARE_USER >/dev/null; then security add-generic-password -a csl -s CSL_SHARE_USER -w preview; fi
if ! secret CSL_SHARE_PASSWORD >/dev/null; then
  security add-generic-password -a csl -s CSL_SHARE_PASSWORD -w "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
fi

"${wrangler[@]}" deploy --config "$config"
secret CSL_SHARE_USER | "${wrangler[@]}" secret put SHARE_USER --config "$config"
secret CSL_SHARE_PASSWORD | "${wrangler[@]}" secret put SHARE_PASSWORD --config "$config"
