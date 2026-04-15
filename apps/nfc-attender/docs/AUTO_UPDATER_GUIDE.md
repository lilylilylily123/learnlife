# Auto-Updater Setup Guide

This guide explains how to set up and use Tauri's built-in auto-updater for NFC Attender.

## Overview

The auto-updater has been configured to:
- Check for updates on app startup
- Download and install updates automatically
- Display progress in the terminal (expandable to UI dialogs)
- Restart the app after successful update

## Prerequisites

1. **Tauri CLI**: Make sure you have `@tauri-apps/cli` installed
2. **GitHub Repository**: Updates will be hosted on GitHub Releases

## Setup Steps

### 1. Generate Update Signature Keys

First, generate a public/private key pair for signing your updates:

```bash
pnpm tauri signer generate -w ~/.tauri/nfc-attender.key
```

This will:
- Generate a private key and save it to `~/.tauri/nfc-attender.key`
- Output the corresponding public key to your terminal

**Important**: 
- Keep the private key secure and never commit it to version control
- You'll need the public key for the next step

### 2. Update tauri.conf.json

Replace `YOUR_PUBLIC_KEY_HERE` in `src-tauri/tauri.conf.json` with the public key generated above:

```json
"updater": {
  "active": true,
  "endpoints": [
    "https://github.com/lilylilylily123/nfc-attender/releases/latest/download/latest.json"
  ],
  "dialog": true,
  "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0RFRkdISUoKUldTaUNxc1BoV29WZjRyVGM4U3Y4RzVUODB2eUpJVVVwSFNiR2JJcUMzRU8K"
}
```

### 3. Build and Sign Your Release

When building for production, use the private key to sign your bundles:

```bash
# Set the private key path as an environment variable
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/nfc-attender.key)

# Build the app
pnpm tauri build
```

Or on Windows PowerShell:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/nfc-attender.key -Raw
pnpm tauri build
```

### 4. Set Up GitHub Release

After building, you'll find these files in `src-tauri/target/release/bundle/`:

**For macOS:**
- `nfc-attender_0.1.0_aarch64.dmg` (Apple Silicon)
- `nfc-attender_0.1.0_aarch64.dmg.sig` (signature)
- `nfc-attender_0.1.0_x64.dmg` (Intel)
- `nfc-attender_0.1.0_x64.dmg.sig` (signature)

**For Windows:**
- `nfc-attender_0.1.0_x64-setup.exe`
- `nfc-attender_0.1.0_x64-setup.exe.sig`

**For Linux:**
- `nfc-attender_0.1.0_amd64.AppImage`
- `nfc-attender_0.1.0_amd64.AppImage.sig`

### 5. Create the Update Manifest

The Tauri build process will generate a `latest.json` file for you. This file contains metadata about the update. You need to upload this file along with your installers to GitHub Releases.

Example `latest.json`:

```json
{
  "version": "0.1.0",
  "notes": "Fixed bugs and improved performance",
  "pub_date": "2026-02-26T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ...",
      "url": "https://github.com/lilylilylily123/nfc-attender/releases/download/v0.1.0/nfc-attender_0.1.0_aarch64.dmg"
    },
    "darwin-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ...",
      "url": "https://github.com/lilylilylily123/nfc-attender/releases/download/v0.1.0/nfc-attender_0.1.0_x64.dmg"
    },
    "windows-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ...",
      "url": "https://github.com/lilylilylily123/nfc-attender/releases/download/v0.1.0/nfc-attender_0.1.0_x64-setup.exe"
    },
    "linux-x86_64": {
      "signature": "dW50cnVzdGVkIGNvbW1lbnQ...",
      "url": "https://github.com/lilylilylily123/nfc-attender/releases/download/v0.1.0/nfc-attender_0.1.0_amd64.AppImage"
    }
  }
}
```

### 6. Upload to GitHub Releases

1. Go to your GitHub repository
2. Create a new release (e.g., `v0.1.0`)
3. Upload ALL the installer files AND their `.sig` signature files
4. Upload the `latest.json` file
5. Publish the release

## How It Works

1. **On App Startup**: The app checks the GitHub endpoint for `latest.json`
2. **Version Comparison**: Compares the current version with the latest version
3. **Signature Verification**: Validates the update signature using the public key
4. **Download**: If an update is available and valid, downloads the installer
5. **Install**: Installs the update
6. **Restart**: Prompts user to restart (or auto-restarts)

## Customization Options

### Change Update Check Frequency

Currently, updates are checked only on startup. To check periodically:

```rust
// In main.rs, add a background task
let handle = app.handle().clone();
tauri::async_runtime::spawn(async move {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await; // Check every hour
        
        if let Ok(updater) = handle.updater() {
            if let Ok(Some(update)) = updater.check().await {
                // Handle update...
            }
        }
    }
});
```

### Add UI Notifications

Instead of terminal logs, emit events to the frontend:

```rust
// Emit to frontend
let _ = window.emit("update-available", json!({
    "current": update.current_version,
    "latest": update.version,
    "notes": update.notes
}));
```

Then handle in your React component using Tauri's event system.

### Disable Auto-Install

To prompt user before installing:

```rust
// Just check, don't auto-install
if let Ok(Some(update)) = updater.check().await {
    let _ = window.emit("update-available", update);
    // Wait for user confirmation via a command
}
```

## Testing

### Local Testing

For local testing, you can use a local server:

1. Build your app with a new version
2. Host the `latest.json` and installers on a local server
3. Update the endpoint in `tauri.conf.json` to point to your local server
4. Test the update flow

### GitHub Testing

1. Create a test release (e.g., `v0.1.1-test`)
2. Upload the files
3. Update the endpoint to point to this specific release
4. Verify the update process works

## Troubleshooting

### "Invalid signature" error
- Ensure your public key in `tauri.conf.json` matches the private key used to sign
- Verify all `.sig` files are uploaded correctly

### "Update not found" error
- Check that `latest.json` is accessible at the endpoint URL
- Verify the version in `latest.json` is higher than your current version

### Update downloads but doesn't install
- Check file permissions
- Verify the installer format is correct for your platform
- Look at console logs for detailed error messages

## Security Notes

1. **Never commit the private key** to version control
2. Store the private key securely (use environment variables in CI/CD)
3. The public key can be safely included in your app
4. Signatures ensure updates haven't been tampered with
5. Always use HTTPS for update endpoints

## CI/CD Integration

For automated releases with GitHub Actions, see the example workflow in `.github/workflows/release.yml` (to be created).

## Additional Resources

- [Tauri Updater Documentation](https://v2.tauri.app/plugin/updater/)
- [Tauri Signer CLI](https://v2.tauri.app/reference/cli#signer)
- [GitHub Releases Documentation](https://docs.github.com/en/repositories/releasing-projects-on-github)
