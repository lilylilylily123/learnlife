#!/usr/bin/env bash
# Regenerate the bottom_tray and top_lid STLs from enclosure.scad.
#
# Requires OpenSCAD on PATH. On macOS:
#   brew install --cask openscad
#
# IMPORTANT — macOS Gatekeeper workaround:
# The Homebrew-installed OpenSCAD (2021.01) is an unsigned Intel build that
# macOS Gatekeeper will silently kill on first run (exit 137 with no output).
# To fix once:
#   1. Open Finder → /Applications/OpenSCAD-2021.01.app
#   2. Right-click → "Open" → click "Open" in the warning dialog
#   3. macOS now permanently allows it.
# Alternative: System Settings → Privacy & Security → look for the blocked
# OpenSCAD message and click "Allow Anyway", then re-run this script.
#
# Usage:
#   ./render.sh          # render both STLs into ./stl/
#   ./render.sh bottom   # render only bottom_tray.stl
#   ./render.sh top      # render only top_lid.stl

set -euo pipefail
cd "$(dirname "$0")"

if command -v openscad >/dev/null 2>&1; then
  OPENSCAD=openscad
elif [[ -x /Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD ]]; then
  OPENSCAD=/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD
elif [[ -x /Applications/OpenSCAD-2021.01.app/Contents/MacOS/OpenSCAD ]]; then
  OPENSCAD=/Applications/OpenSCAD-2021.01.app/Contents/MacOS/OpenSCAD
else
  echo "ERROR: openscad not found. Install with: brew install --cask openscad" >&2
  exit 1
fi

mkdir -p stl

render_part() {
  local part="$1"
  local out="stl/${part}_$( [[ "$part" == "bottom" ]] && echo tray || echo lid ).stl"
  echo "Rendering $part -> $out"
  if ! "$OPENSCAD" -q -D "part=\"$part\"" -o "$out" enclosure.scad; then
    echo
    echo "OpenSCAD exited non-zero. If you see no error output, it was likely"
    echo "killed by macOS Gatekeeper. Open the .app via Finder once to allow"
    echo "it (see comment block at top of this script)."
    exit 1
  fi
}

case "${1:-all}" in
  bottom) render_part bottom ;;
  top)    render_part top ;;
  all)    render_part bottom; render_part top ;;
  *)      echo "Usage: $0 [bottom|top|all]" >&2; exit 1 ;;
esac

echo "Done. STLs in ./stl/"
