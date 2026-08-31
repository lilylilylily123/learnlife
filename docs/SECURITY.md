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

## Standalone device: credentials at rest (OPEN DECISION)

Applies to `apps/nfc-attender-fw` — the ESP32 desk terminal.

### Threat

The device stores its PocketBase account email and password **unencrypted in
NVS**. Anyone with five minutes of physical access and a USB cable can read the
whole flash:

```sh
esptool.py --port /dev/tty.usbserial-XXXX read_flash 0x9000 0x5000 nvs.bin
strings nvs.bin
```

That account has role `lg`, so it can read every learner record and every
attendance row for the whole school. The device lives on an open front desk.

### What already reduces the blast radius

- **One PocketBase account per device.** A compromised or stolen unit is
  revoked by disabling that one account, without touching the other device or
  re-provisioning it.
- **Token caching** means the password itself crosses the network far less
  often than it used to (was: every boot and every reconnect).
- **The setup AP is closed.** It used to be an open access point accepting that
  same password over plain HTTP; it now uses a random per-boot WPA2 password
  displayed on the OLED, and times out after 10 minutes.
- **TLS is verified** against a pinned root (`src/pb_ca.h`), so the credential
  can't be harvested by a rogue AP impersonating PocketHost.

### Options, with honest costs

1. **Accept and document.** ← *current state*
   Physical access to the device is already a serious compromise for other
   reasons (someone holding the box can also just tap cards). The per-device
   account bounds the damage and makes revocation cheap.

2. **A dedicated `device` role** with tighter collection rules — read the
   roster, write attendance, nothing else. Genuine hardening, but it touches
   the shared backend: `packages/shared/src/roles.ts`, the rules in
   `pb_hooks/README.md`, and anything asserting the three-role model. Worth
   doing if the device count grows.

3. **Flash/NVS encryption.** The real fix, and it permanently ties the flash to
   that specific chip. Bricking risk is real, and a bricked unit cannot be
   recovered by reflashing.

**Recommendation: (1) for the two-unit pilot, revisit (2) before any wider
rollout.** This is a decision to make explicitly, not to leave implied.

### If a device is lost or stolen

1. Disable that device's user in the PocketBase admin UI — `users` → the
   `device-NN@…` record → deactivate. This alone stops all access.
2. Rotate the password on the remaining device only if the two ever shared one
   (they should not).
3. Check Settings → Logs for requests from that account after the loss.

---

## Standalone device: firmware update path

`apps/nfc-attender-fw` supports LAN OTA updates. Notes for whoever operates it:

- **OTA fails closed.** With no password provisioned, the OTA port does not
  open at all. An unauthenticated OTA port on a school network is remote code
  execution for anyone who runs a port scan.
- **The password is generated once**, at provisioning, and displayed once on
  the setup confirmation page. The device stores only its MD5. If it is lost,
  re-provision (type `RESET` within 2 s of boot) to generate a new one.
- **It is LAN-only.** The device does not pull firmware from the internet;
  someone has to be on the school network and hold the password.
- **Keep the USB runbook current.** The partition table can only be changed
  over USB, and a pinned-CA failure (see below) would need a USB reflash if
  OTA were somehow unavailable.

### Pinned certificate — operational risk

`src/pb_ca.h` pins **GTS Root R4** (valid to 2036), verified against the live
host. If PocketHost ever migrates to a different certificate authority, **every
device goes offline until updated**. Diagnose with:

```sh
openssl s_client -connect learnlife.pockethost.io:443 \
    -servername learnlife.pockethost.io -showcerts | grep "^ *i:"
```

If the issuer chain no longer ends at GTS Root R4, update `src/pb_ca.h` and
push an OTA update. This is exactly why OTA shipped before pinning.

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
