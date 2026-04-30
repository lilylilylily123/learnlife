# Security Operations

Operational follow-ups from the security audit. Each section closes a finding
that can't be solved by a code change alone — it requires a deployment or
admin-console action.

---

## NFC card hardening (audit H-2)

### Threat

The Tauri Rust backend reads card UIDs via the standard PC/SC `FF CA 00 00 00`
APDU (see `apps/nfc-attender/src-tauri/src/main.rs`). UID-only authentication
is trivially cloneable — a $30 ACR122U + a blank Mifare Classic UID-changeable
card lets anyone reproduce a learner's "credential" in under a minute. Anyone
with five seconds of card access (lost-and-found, desk drawer) can swipe a
clone in later.

### Mitigations, in order of strength

1. **Move to cryptographic-auth cards** — NTAG 424 DNA (SUN messages) or
   DESFire EV2/EV3 with AES-128 mutual auth. Each tap produces a fresh,
   cryptographically signed payload that can't be replayed. This is the
   only fix that closes the cloning hole; the rest are layered controls.

2. **Add a PIN at the kiosk** — after a UID match, the learner enters a 4-digit
   PIN on the desktop touchscreen. Cheap, but adds friction and the PIN must
   be stored hashed (Argon2id) on the user record. Ship as a fallback if (1)
   is delayed.

3. **Time-window + photo log** — accept scans only during the program's
   posted hours and capture a webcam still on every check-in (stored
   short-term, audited weekly). Doesn't prevent cloning but makes after-the-
   fact detection trivial.

### Recommended rollout

- Decide on (1) vs (2). If (1), pick NTAG 424 DNA — cheaper than DESFire and
  the SUN URL flow is well-documented.
- Pilot with a single program (e.g. Changemaker) before re-issuing cards
  campus-wide.
- Keep the existing UID flow operational during the transition; gate the
  cryptographic-auth path behind a per-learner flag in the `learners`
  collection.

---

## Tauri release signing key (audit H-8)

### Current state

`apps/nfc-attender/src-tauri/tauri.conf.json` enables the auto-updater,
which verifies updates with a minisign public key. The matching private key
is loaded from `secrets.TAURI_SIGNING_PRIVATE_KEY` in
`.github/workflows/nfc-release.yml`. As long as the **only** copy of the
private key lives in GitHub Secrets, this is fine.

### Risk

If a developer ran `tauri signer generate` on their laptop and still has the
private key file (default path `~/.tauri/<key-name>.key`), that file is now a
hijack-the-auto-updater key. Anyone who copies it can ship signed updates to
every installed copy of the app.

### Verification + rotation runbook

1. **Inventory.** On every developer laptop that ever built a release:
   ```sh
   ls -la ~/.tauri/*.key 2>/dev/null
   ```
   Any hits are a problem.

2. **If a key file exists:** rotate.
   ```sh
   tauri signer generate -w ~/.tauri/learnlife-new.key
   ```
   - Update `tauri.conf.json` `pubkey` to the new public key.
   - Update GitHub `TAURI_SIGNING_PRIVATE_KEY` secret to the new private key.
   - Update GitHub `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the new passphrase.
   - Securely delete the old `.key` file: `srm ~/.tauri/learnlife-OLD.key`.
   - Cut a new release; existing installs will pick up the new pubkey on the
     next update via the rotated key.

3. **Going forward:** generate signing keys only inside CI, or on a
   dedicated hardware token (YubiKey + age-plugin-yubikey). Never let the
   private key touch a laptop disk.

---

## PocketBase admin hardening (audit L-8)

Verify these in the PocketBase admin UI at
`https://learnlife.pockethost.io/_/`:

### Settings → Application

- **App URL** is exactly `https://learnlife.pockethost.io` (no trailing
  slash, no http://). The app URL is used in password-reset emails and
  CORS-adjacent logic.
- **Hide collection create/delete API** is **on** for the production
  superuser unless actively schema-editing. Toggle off only during
  migrations.

### Settings → Mail

- **From address** is on a domain you control (not `pockethost.io`).
  Otherwise password-reset emails land in spam, which trains users to
  ignore them.

### Settings → SMTP / S3

- Confirm credentials there are scoped to that one purpose. The SMTP user
  should not be your personal email password.

### Collections → users → Options

- `Allow OAuth2 Auth` — disable any provider you're not actively using.
- `Min password length` ≥ 10 (the redeem-invite hook already enforces 8;
  bump this to 10 to keep new accounts above the floor).
- `Require email auth verification` — recommend **on** so a stolen invite
  email + guessed password can't sign in without inbox access. (Currently
  the `invites.pb.js` hook sets `verified: true` since the invite proves
  email control; revisit if you accept email/password signups outside the
  invite flow.)

### Per-collection rules

Verify the rules documented in `pb_hooks/README.md` are actually set —
collection rules in PocketBase are evaluated **before** the JS hooks fire,
so the hooks are defense in depth, not the primary gate.

### Logs

- Settings → Logs → confirm log retention is finite (default is 7 days).
- Spot-check the logs for `_smoketest` references to confirm the deleted
  hook isn't somehow still being invoked.
