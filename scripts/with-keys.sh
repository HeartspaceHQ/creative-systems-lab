#!/usr/bin/env bash
# Run one command with the image-provider keys read from the macOS Keychain, for that process only.
# Nothing is written to disk, the shell profile or the command line.
#
# Store a key once (prompts for it, nothing echoed or kept in history):
#   security add-generic-password -U -a csl -s ELEVENLABS_API_KEY -w
#
# The prompt silently cuts input at 128 characters. OpenAI project keys are longer, so store those
# from the clipboard instead (copy the key first; the value is briefly visible to `ps`):
#   security add-generic-password -U -a csl -s OPENAI_API_KEY -w "$(pbpaste)"
#
# --status warns when a stored key is exactly 128 characters, the sign of a cut key.
#
#   scripts/with-keys.sh --status          # which keys are stored (names only)
#   scripts/with-keys.sh csl run ...       # run with the stored keys in the environment
set -euo pipefail
variables=(OPENAI_API_KEY GEMINI_API_KEY XAI_API_KEY BFL_API_KEY ELEVENLABS_API_KEY)

if [[ "${1:-}" == "--status" ]]; then
  for variable in "${variables[@]}"; do
    if value=$(security find-generic-password -a csl -s "$variable" -w 2>/dev/null); then
      if [[ ${#value} -eq 128 ]]; then
        echo "$variable: stored, but exactly 128 characters: probably cut by the prompt"
      else
        echo "$variable: stored"
      fi
    else
      echo "$variable: missing"
    fi
  done
  exit 0
fi

for variable in "${variables[@]}"; do
  if value=$(security find-generic-password -a csl -s "$variable" -w 2>/dev/null); then
    export "$variable=$value"
  fi
done
exec "$@"
