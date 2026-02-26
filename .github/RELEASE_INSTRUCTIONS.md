# GitHub Actions Release Instructions

This project uses GitHub Actions to automatically build, sign, and release the NFC Attender app.

## Prerequisites

You need to set up the following GitHub repository secrets:

### 1. Generate Signing Keys (One-time setup)

If you haven't already generated signing keys, run:

```bash
pnpm tauri signer generate -w ~/.tauri/nfc-attender.key
```

This will output:
- A private key saved to `~/.tauri/nfc-attender.key`
- A public key printed to the console

**Important:** 
- Keep the private key secure and NEVER commit it to the repository
- Save the public key to update your `tauri.conf.json`

### 2. Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add these secrets:

#### `TAURI_PRIVATE_KEY`
The contents of your private key file:
```bash
cat ~/.tauri/nfc-attender.key
```
Copy the entire output and paste it as the secret value.

#### `TAURI_KEY_PASSWORD` (Optional)
If you set a password when generating the key, add it here. Otherwise, leave it empty or add an empty secret.

### 3. Update Public Key in tauri.conf.json

Make sure the `pubkey` in `src-tauri/tauri.conf.json` matches your generated public key:

```json
"updater": {
  "active": true,
  "endpoints": [
    "https://github.com/lilylilylily123/nfc-attender/releases/latest/download/latest.json"
  ],
  "pubkey": "YOUR_PUBLIC_KEY_HERE"
}
```

## How to Release

### Option 1: Create a Git Tag (Recommended)

```bash
# Commit your changes
git add .
git commit -m "Release v0.1.0"

# Create and push a tag
git tag v0.1.0
git push origin v0.1.0
```

The GitHub Action will automatically:
1. Build for macOS (Intel + Apple Silicon), Windows, and Linux
2. Sign all bundles
3. Generate `latest.json` with signatures
4. Create a draft GitHub Release with all assets
5. You can then review and publish the release

### Option 2: Manual Trigger

1. Go to GitHub → Actions → "Release Build"
2. Click "Run workflow"
3. Select the branch
4. Click "Run workflow"

## After the Build Completes

1. Go to GitHub → Releases → Drafts
2. Review the draft release
3. Edit the release notes if needed
4. Click "Publish release"

The app will now automatically check for this update when users launch it!

## Test Builds

Every push to `main` or pull request will trigger a test build (without signing) to verify the app compiles correctly on all platforms.

## Troubleshooting

### Build fails with "TAURI_PRIVATE_KEY not found"
- Make sure you've added the `TAURI_PRIVATE_KEY` secret in GitHub repository settings
- Verify the secret contains the entire key file contents

### Signature verification fails
- Verify the public key in `tauri.conf.json` matches the one generated with your private key
- Make sure you're using the same key pair (don't regenerate keys between releases)

### macOS build fails
- Apple Silicon and Intel builds are separate - both will run
- If one fails, check the specific platform logs in the GitHub Actions run

### Windows/Linux dependencies
- The workflow includes all necessary system dependencies
- If builds fail, check the error logs for missing packages
