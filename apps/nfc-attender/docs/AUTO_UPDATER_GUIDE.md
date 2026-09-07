# Auto-updater

How NFC Attender updates itself, and what to do when it does not. The updater is
already set up and working — the signing key exists, the public key is in
`tauri.conf.json`, and CI signs release artifacts. This document explains the
running system first, then key generation and troubleshooting, because the common
need is understanding a failure rather than doing initial setup.

The previous version of this file was written before any of it was configured. It
still contained a `YOUR_PUBLIC_KEY_HERE` placeholder, pointed at a repository that
is not the one in use, described Tauri v1 config keys, referred to a release workflow
"to be created" that now exists twice, and documented Linux and Intel-macOS
artifacts that this repo's CI has never produced. All of that has been corrected.

## Why the update prompt blocks the app

`UpdateNotification` renders a full-screen modal that cannot be dismissed while an
update is pending — the only way past it is Install, or "Continue without updating"
after a failure. That is deliberate rather than aggressive: every copy of this app
writes to the same PocketBase instance, and an older copy carrying a stale copy of
the attendance rule will write records the current copy disagrees with. The
attendance rule is duplicated across three implementations already (see
[`ARCHITECTURE.md`](ARCHITECTURE.md#the-attendance-rule-exists-three-times)); a
stale desktop build adds a fourth. A minute of waiting beats a day of reconciling.

## The running configuration

From `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/lilylilylily123/learnlife/releases/latest/download/latest.json"
    ],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEYzQkQxNUYyMjFGREQ4NEYK…",
    "windows": { "installMode": "passive" }
  }
},
"bundle": { "createUpdaterArtifacts": true }
```

| Setting | Value | Note |
| --- | --- | --- |
| Endpoint | `latest/download/latest.json` on the **`learnlife` monorepo** releases | Not a separate `nfc-attender` repo. `latest/` means the endpoint always follows the newest release |
| `pubkey` | A minisign public key, inline | Safe to commit. It is the verification half |
| `installMode` | `passive` (Windows) | Installer runs with a progress bar but no prompts |
| `createUpdaterArtifacts` | `true` | Emits the updater tarball plus `.sig` alongside the normal bundle |
| Current version | `0.4.0` | In `tauri.conf.json`; this is what gets compared against `latest.json` |

These are Tauri **v2** keys. If you find documentation mentioning `"active": true`,
`"dialog": true`, or a `tauri.conf.json` `"updater"` block at the top level, it is
v1 and does not apply.

Permissions matter too. `src-tauri/capabilities/default.json` must grant
`updater:default` (for `check()` and `downloadAndInstall()`) and
`process:allow-restart` (for `relaunch()`). Both are present. Remove either and the
updater fails at runtime with a permission error, not at build time.

## The flow, as implemented

`src/app/components/UpdateNotification.tsx`, mounted on `/` and `/kiosk`:

```
mount
  └─ check()                        → null, or an Update
       ├─ null                      → phase "idle", renders nothing
       └─ Update                    → phase "available", blocking modal
              └─ user clicks Install
                   └─ update.downloadAndInstall(onEvent)
                        ├─ "Started"   → capture contentLength
                        ├─ "Progress"  → accumulate chunkLength, show a percentage
                        └─ "Finished"
                   ├─ resolves → phase "ready" → user clicks Restart → relaunch()
                   └─ rejects  → phase "error" → "Continue without updating"
```

Points worth knowing:

- **The check runs once, on mount.** There is no polling loop. An app left open for a
  week never notices a release; it notices on next launch.
- **A failed check is silent.** It is caught and passed to `debug.error`, so in a
  production build the console shows only `[error]`. The user sees nothing and the app
  continues normally. This is why "the updater isn't working" usually needs a debug
  build to diagnose.
- **The percentage needs `contentLength`.** If the server does not report a content
  length, `contentLength` stays 0 and the bar sits at 0% while the download proceeds.
  The download still completes.
- **Restart is user-initiated.** The app never relaunches on its own.
- **Nothing checks for updates outside Tauri.** In `pnpm dev` in a browser, `check()`
  rejects immediately.

## Releasing a new version

### 1. Bump three files

They must agree. `tauri.conf.json` is the one compared against `latest.json`.

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `version`

### 2. Tag and push from the repo root

```bash
git tag v0.4.1
git push origin v0.4.1
```

That triggers `.github/workflows/nfc-release.yml` at the **repo root**, which:

1. Lints and tests (`pnpm --filter nfc-attender lint`, then `test`) — the release
   job `needs: test`, so a failing test blocks the release.
2. Builds on `macos-latest` for `aarch64-apple-darwin` and on `windows-latest` for
   x64, via `tauri-apps/tauri-action@v0` with `projectPath: apps/nfc-attender`.
3. Signs the updater artifacts using `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from repository secrets.
4. Publishes a non-draft GitHub release named `NFC Attender v0.4.1`, with
   `latest.json` and the signed artifacts attached.

`tauri-action` generates and uploads `latest.json` itself. You do not write it by
hand, and you do not need to construct the `platforms` map — the shape shown in
older documentation is informational only.

**Platforms actually produced:** `darwin-aarch64` and `windows-x86_64`. That is it.
No Intel macOS, no Linux. An Intel Mac or a Linux box will find no matching platform
entry in `latest.json` and will not update. If you need those, add matrix entries to
the workflow.

Workflow topology across the repo is documented in
[`../../../docs/CI.md`](../../../docs/CI.md). Note in particular that
`apps/nfc-attender/.github/workflows/release.yml` is a **stale duplicate** that is
inert inside the monorepo — see
[`../README.md`](../README.md#two-release-workflows-exist-and-one-of-them-is-a-trap).
Do not edit it expecting a release to change.

### 3. Verify

Launch a copy of the *previous* version. It should show the update modal within a few
seconds of startup. If it does not, work through the troubleshooting below.

## Signing keys

This only needs doing once, and it has already been done. Documented for key
rotation or disaster recovery.

```bash
cd apps/nfc-attender
pnpm tauri signer generate -w ~/.tauri/nfc-attender.key
```

That writes the private key to `~/.tauri/nfc-attender.key` and prints the public key.
The public key goes into `tauri.conf.json` → `plugins.updater.pubkey`. The private
key goes into the repository secrets as `TAURI_SIGNING_PRIVATE_KEY`, with its
passphrase as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

- **Never commit the private key.** `.gitignore` covers `*.pem` but not `*.key`;
  keep it out of the repo directory entirely.
- The public key is fine to commit. It only verifies.
- **Rotating the key breaks the update path for every installed copy.** Builds signed
  with a new private key fail signature verification against the old public key
  baked into the running app. Every existing install has to be reinstalled by hand.
  Treat the key as permanent; back it up somewhere you will still have in two years.

### Signing a local build

Normally unnecessary — CI does it. If you need signed artifacts locally:

```bash
cd apps/nfc-attender
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/nfc-attender.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='…'
pnpm tauri:build
```

Without `TAURI_SIGNING_PRIVATE_KEY` the build **still succeeds** and simply skips the
updater artifacts. That is the usual reason a manual build produces no `.sig` files.

## Troubleshooting

### The app never shows an update

Work down this list:

| Check | How |
| --- | --- |
| Is the endpoint reachable? | Open `https://github.com/lilylilylily123/learnlife/releases/latest/download/latest.json` in a browser. A 404 means the release has no `latest.json` attached |
| Is `latest.json`'s version actually higher? | Tauri compares semver. `0.4.0` does not update to `0.4.0` |
| Did the three version fields agree at build time? | If `tauri.conf.json` was not bumped, the running app reports the old version and the release reports the same one |
| Is there a `darwin-aarch64` / `windows-x86_64` entry? | An Intel Mac or Linux host has no matching platform and will never update |
| Is the check silently failing? | Run a debug build (`pnpm tauri:build:debug` or `pnpm tauri:dev`) — `debug.error` prints the real cause only outside production |
| Is `updater:default` still in `capabilities/default.json`? | Removing it makes `check()` fail with a permission error |

### "Invalid signature"

The public key in the running app does not match the private key that signed the
release. Either the key was rotated, or the release was built without
`TAURI_SIGNING_PRIVATE_KEY` and the `.sig` files are missing or stale. Confirm the
release assets include a `.sig` for each artifact, and that `pubkey` in
`tauri.conf.json` matches the key CI used.

### The download starts but the bar stays at 0%

`contentLength` was not reported. Cosmetic — the install still completes. Wait for
the Restart button.

### The download completes but nothing installs

On macOS, an app running from a quarantined location may not be able to replace
itself. On Windows, `installMode: "passive"` still needs the installer to be able to
write to the install directory. Check the debug-build console for the underlying
error.

### CSP blocks the download

If you change `app.security.csp` in `tauri.conf.json`, note that the updater fetches
from `github.com` and its CDN. The current CSP restricts `connect-src` to `'self'`
and `learnlife.pockethost.io` — the updater works because the plugin fetches from
Rust, not from the WebView, and is not subject to the page CSP. Do not "fix" this by
adding GitHub to `connect-src`; it is not needed and it widens the WebView's reach.

## References

- [Tauri v2 updater plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri signer CLI](https://v2.tauri.app/reference/cli#signer)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github)
- [`../README.md`](../README.md) — build and release commands
- [`../../../docs/CI.md`](../../../docs/CI.md) — workflow topology
