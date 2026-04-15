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
echo "📁 Windows installer: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/NFC Attender_0.1.0_x64-setup.exe"
