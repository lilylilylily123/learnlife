#!/usr/bin/env bash
#
# LearnLife NFC Attender — render every enclosure part to stl/
# ============================================================
#
# Usage:
#   ./export.sh            render every part that exists
#   ./export.sh coupon     render just one part (name without .scad)
#   ./export.sh --check    parse/render everything but write nothing (CI-safe)
#
# Requires OpenSCAD on PATH:
#   brew uninstall --cask openscad          # the old cask is deprecated and
#                                           # is disabled from 2026-09-01
#   brew install --cask openscad@snapshot   # installs /Applications/OpenSCAD.app
#                                           # and links an `openscad` CLI
#
# Why STLs are committed alongside the .scad sources: a makerspace wants an
# STL, not a source file they'd have to install OpenSCAD to render. Committing
# both means the printable artefact is always one download away, and a
# reviewer can see the geometry without a toolchain.

set -euo pipefail

cd "$(dirname "$0")"

# Parts are listed in the order you should print them. Files that don't exist
# yet are skipped with a note rather than treated as an error — base/lid/stand
# are gated on the caliper measurements in docs/measurements.md, so a fresh
# checkout legitimately has only the two test prints.
PARTS=(
  antenna_tiles   # print FIRST — fixes lid_t, needs no measurements
  coupon          # print SECOND — fixes the five tolerance parameters
  base
  lid
  stand
  retainer
  clamp
)

CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=1
  shift
fi

if ! command -v openscad >/dev/null 2>&1; then
  echo "error: openscad not found on PATH." >&2
  echo "       brew install --cask openscad@snapshot" >&2
  exit 1
fi

echo "openscad: $(openscad --version 2>&1 | head -1)"
mkdir -p stl

# A single part was named on the command line.
if [[ $# -gt 0 ]]; then
  PARTS=("$@")
fi

rendered=0
skipped=0
failed=0

for part in "${PARTS[@]}"; do
  src="${part}.scad"

  if [[ ! -f "$src" ]]; then
    echo "  skip    ${src} (not written yet)"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ $CHECK_ONLY -eq 1 ]]; then
    out="$(mktemp -t "${part}").stl"
  else
    out="stl/${part}.stl"
  fi

  # OpenSCAD reports geometry problems (non-manifold results, degenerate
  # faces) on stderr while still exiting 0, so grep the log rather than
  # trusting the exit status alone.
  # binstl, not the default ASCII stl: binary is roughly 5x smaller for the
  # same mesh (these files live in git) and every slicer reads it.
  log="$(mktemp)"
  if ! openscad --export-format=binstl -o "$out" "$src" >"$log" 2>&1; then
    echo "  FAIL    ${src}"
    sed 's/^/            /' "$log" >&2
    failed=$((failed + 1))
    rm -f "$log"
    continue
  fi

  # Match "WARNING:" / "ERROR:" with the colon. Matching a bare "ERROR"
  # case-insensitively would also hit OpenSCAD's own success line,
  # "Status: NoError", and report every clean render as a failure.
  problems="$(grep -E '(WARNING|ERROR):' "$log" || true)"

  # The manifold check is the one that actually matters for printability:
  # a non-manifold mesh slices into garbage. OpenSCAD prints this on the
  # "Status:" line and still exits 0, so it has to be inspected explicitly.
  status_line="$(grep -E '^\s*Status:' "$log" | head -1 | tr -s ' ' | sed 's/^ //' || true)"
  if [[ -n "$status_line" && "$status_line" != *"NoError"* ]]; then
    problems="${problems}"$'\n'"${status_line}"
  fi

  if [[ -n "${problems// /}" ]]; then
    echo "  FAIL    ${src}"
    echo "$problems" | sed 's/^/            /'
    failed=$((failed + 1))
  else
    echo "  ok      ${src} -> ${out}${status_line:+  (${status_line})}"
    rendered=$((rendered + 1))
  fi

  rm -f "$log"
  [[ $CHECK_ONLY -eq 1 ]] && rm -f "$out"
done

echo
echo "rendered ${rendered}, skipped ${skipped}, failed ${failed}"
[[ $failed -eq 0 ]] || exit 1
