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

# One scratch directory for --check runs, removed on exit however we leave.
TMPWORK="$(mktemp -d)"
trap 'rm -rf "$TMPWORK"' EXIT

# Binary STL is ~5x smaller than ASCII for the same mesh, which matters
# because these files live in git. `--export-format` is not in every OpenSCAD
# build though — Ubuntu's apt package (used by CI) is several years behind the
# macOS snapshot — so probe for it once rather than assuming.
FORMAT_ARGS=()
if openscad --export-format=binstl -o "${TMPWORK}/probe.stl" \
     <(echo 'cube(1);') >/dev/null 2>&1; then
  FORMAT_ARGS=(--export-format=binstl)
else
  echo "note: this OpenSCAD lacks --export-format; writing ASCII STL"
fi
rm -f "${TMPWORK}/probe.stl"

# Force the CGAL backend when this build has one.
#
# Not a preference — a correctness check. Newer OpenSCAD defaults to the
# Manifold backend, which SILENTLY REPAIRS geometry that CGAL rejects. Two real
# bugs in stand.scad rendered as perfectly valid solids locally and failed CI,
# which runs OpenSCAD 2021.01 (CGAL only). Using CGAL here means local and CI
# agree, and a grazing cut is caught on the machine that made it.
BACKEND_ARGS=()
if openscad --backend=CGAL -o "${TMPWORK}/probe2.stl" \
     <(echo 'cube(1);') >/dev/null 2>&1; then
  BACKEND_ARGS=(--backend=CGAL)
fi
rm -f "${TMPWORK}/probe2.stl"

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
    out="${TMPWORK}/${part}.stl"
  else
    out="stl/${part}.stl"
  fi

  # OpenSCAD reports geometry problems (non-manifold results, degenerate
  # faces) on stderr while still exiting 0, so grep the log rather than
  # trusting the exit status alone.
  log="$(mktemp)"
  if ! openscad "${BACKEND_ARGS[@]}" "${FORMAT_ARGS[@]}" -o "$out" "$src" >"$log" 2>&1; then
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

  # The manifold warning is phrased without a colon, so the pattern above
  # misses it. It is the single most important thing this script can catch: a
  # non-manifold mesh slices into garbage.
  manifold="$(grep -i '2-manifold' "$log" || true)"
  if [[ -n "$manifold" ]]; then
    problems="${problems}"$'\n'"${manifold}"
  fi

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
  # (--check output lands in TMPWORK, cleaned up by the EXIT trap)
done

echo
echo "rendered ${rendered}, skipped ${skipped}, failed ${failed}"
[[ $failed -eq 0 ]] || exit 1
