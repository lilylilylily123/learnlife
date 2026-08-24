#!/usr/bin/env bash
#
# Open a part in the OpenSCAD GUI, from the right directory.
#
#   ./view.sh              assembly preview (base + lid + mock modules)
#   ./view.sh base         just the base
#   ./view.sh lid          just the lid
#   ./view.sh coupon       the tolerance test plate
#
# Why this script exists: every .scad here does `include <params.scad>`, which
# resolves relative to the WORKING DIRECTORY, not to the file. So running
# `openscad apps/.../assembly.scad` from the repo root silently opens a blank
# new document instead of the model — with nothing on screen to say why.
# This cds first so that can't happen.

set -euo pipefail
cd "$(dirname "$0")"

PART="${1:-assembly}"
FILE="${PART%.scad}.scad"

if [[ ! -f "$FILE" ]]; then
  echo "error: no such part '$FILE' in $(pwd)" >&2
  echo "available:" >&2
  ls -1 *.scad | sed 's/^/  /' >&2
  exit 1
fi

if ! command -v openscad >/dev/null 2>&1; then
  echo "error: openscad not found on PATH." >&2
  echo "       brew install --cask openscad@snapshot" >&2
  exit 1
fi

echo "Opening $FILE"
echo
echo "  >>> The window opens EMPTY. Press F5 to preview. <<<"
echo
echo "  F5  fast preview — this is the one you want"
echo "  F6  slow exact render, only needed before exporting"
echo
echo "(Qt font warnings and 'FALLBACK' lines below are harmless macOS noise.)"
echo

exec openscad "$FILE"
