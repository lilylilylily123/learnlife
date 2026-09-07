#!/bin/bash
# Build Windows executable from macOS/Linux using cargo-xwin

set -e

echo "🚀 Building Windows (x86_64) executable..."

# Check if cargo-xwin is installed
if ! command -v cargo-xwin &> /dev/null; then
    echo "📦 Installing cargo-xwin..."
    cargo install cargo-xwin
fi

# Check if Windows target is installed
if ! rustup target list | grep -q "x86_64-pc-windows-msvc (installed)"; then
    echo "📦 Installing Windows target..."
    rustup target add x86_64-pc-windows-msvc
fi

# Build
echo "🔨 Building..."
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc

echo "✅ Build complete!"

# Don't hardcode the filename — it embeds the version from tauri.conf.json, and a
# stale literal here sent people looking for an installer that was never built.
# List what actually landed instead.
BUNDLE_DIR="src-tauri/target/x86_64-pc-windows-msvc/release/bundle"
echo "📁 Bundles in ${BUNDLE_DIR}:"
find "${BUNDLE_DIR}" -maxdepth 2 -type f \( -name '*.exe' -o -name '*.msi' \) 2>/dev/null \
    || echo "  (none found — check the build output above)"
