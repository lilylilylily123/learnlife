# NFC Attender (`nfc-attender`)

The attendance **dashboard**: a Tauri 2 desktop app wrapping a statically-exported
Next.js frontend. Guides use it to see who is on site right now, correct arrival
and lunch times, apply and justify statuses, run reports over a date range, and
export CSV. It talks to the hosted PocketBase at `https://learnlife.pockethost.io/`
directly from the WebView — there is no server tier in this app at all.

It also still contains a working PC/SC card reader path (`src-tauri/src/main.rs`),
which is how the whole system started: this app was the tap terminal. That role
now belongs to [`../nfc-attender-fw`](../nfc-attender-fw/README.md), the standalone
ESP32 terminal, because a laptop that has to stay awake, logged in, and plugged
into a USB reader is a fragile way to run a doorway. What is left here:

| Surface | Status | Notes |
| --- | --- | --- |
| Dashboard (`/`) | Current, primary | History, justifications, bulk edits, live activity |
| Reports (`/history`, `/history/admin`) | Current | Day roster, range reports, CSV export |
| PC/SC reader (Rust `nfc-scanned` event) | Legacy but live | Works if a reader is attached; the firmware is the deployed tap path |
| Kiosk screen (`/kiosk`) | Legacy | Full-screen "tap to check in" display, superseded by the firmware's own OLED |
| Auto-absent sweep | Load-bearing **and fragile** | Only runs while this app is open — see [`README_SCHEDULER.md`](README_SCHEDULER.md) |

Deep dives:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — internal map: routes, hooks, components, the Rust/TS boundary, `tools/enroll`
- [`README_SCHEDULER.md`](README_SCHEDULER.md) — how absences actually get marked, and why nobody marks them in a device-only deployment
- [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) — for non-technical staff
- [`docs/AUTO_UPDATER_GUIDE.md`](docs/AUTO_UPDATER_GUIDE.md) — signing keys, `latest.json`, the release path
- [`CLAUDE.md`](CLAUDE.md) — invariants and traps, for AI agents and for anyone new

Repo-wide references this app relies on rather than restating:

- [`../../docs/POCKETBASE.md`](../../docs/POCKETBASE.md) — collection schema and rules
- [`../../docs/GLOSSARY.md`](../../docs/GLOSSARY.md) — `lg`, `arrival`, `justified`, program codes
- [`../../docs/CI.md`](../../docs/CI.md) — workflow topology
- [`../../docs/MONOREPO_ARCHITECTURE.md`](../../docs/MONOREPO_ARCHITECTURE.md) — where this app sits in the workspace

## Prerequisites

| Tool | Version | Where the constraint comes from |
| --- | --- | --- |
| Node | `>=20` | root `package.json` `engines` |
| pnpm | `>=10` (pinned `10.33.0`) | root `package.json` `engines` + `packageManager` |
| Rust | `>=1.77.2` | `src-tauri/Cargo.toml` `rust-version` |
| Xcode CLT | any recent | Tauri needs a linker + WebKit on macOS |
| PC/SC reader | optional | Only for the legacy local reader path (`ACR122U` is what the UI labels it) |
| `cargo-xwin` | latest | Only for cross-compiling the Windows build from macOS/Linux |

macOS is the developed-and-shipped platform. Windows is produced by
cross-compilation and by CI, and is not routinely tested by hand.

No runtime environment variables are needed by the app. The PocketBase URL is a
compile-time constant (`PB_URL` in `packages/pb-client/src/constants.ts`), not an
env var — changing it also means editing the CSP in `src-tauri/tauri.conf.json`.
The only `process.env` read in this app is `NODE_ENV`, in `src/lib/debug.ts`.

Two variables exist for adjacent purposes:

| Variable | Read by | When |
| --- | --- | --- |
| `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` | [`tools/enroll`](docs/ARCHITECTURE.md#toolsenroll--card-enrolment-cli), the separate card-enrolment CLI | Optional; it prompts if unset. PocketBase **superuser** credentials |
| `TAURI_SIGNING_PRIVATE_KEY`, `…_PASSWORD` | `tauri build` | Release builds only, to sign updater artifacts. Supplied by CI secrets |

`.env.example` documents exactly those and nothing else. It previously listed
PowerSchool and Redis variables under a header claiming they were "required for
server-side API routes" — there are no server routes and cannot be, nothing read
those variables, and it pointed at a `docs/POWERSCHOOL_SETUP.md` that is not in the
repository. That has been corrected. Note the file is gitignored (`.env*` in
`.gitignore`), so it is a local convenience only.

## Scripts

All `pnpm <script>` rows below run **from `apps/nfc-attender/`**.

| Script | What it does | Notes |
| --- | --- | --- |
| `pnpm dev` | `next dev` on port 3000 | Browser-only. The UI renders but every Tauri API fails — see "Browser vs Tauri" below |
| `pnpm build` | `next build` → `out/` | Static export. Run automatically by `tauri build` via `beforeBuildCommand` |
| `pnpm start` | `next start` | Vestigial `create-next-app` leftover. `next start` serves a `.next` server build, which `output: "export"` does not produce; nothing in this repo uses it. Serve `out/` with a static file server if you need a browser preview of a production build |
| `pnpm tauri:dev` | Full desktop app, hot reload | The normal dev command. Spawns `pnpm dev` itself |
| `pnpm tauri:build` | Release bundle for the host platform | macOS → `.app` + `.dmg` |
| `pnpm tauri:build:debug` | Same bundle, debug profile | Keeps `debug_assertions`, so UID logging and `debug.log()` are live |
| `pnpm tauri:build:windows` | Windows bundle via `cargo-xwin` | Prefer `./build-windows.sh`, which installs the prerequisites first |
| `pnpm test` | `vitest run` | 12 test files under `src/__tests__/` |
| `pnpm test:watch` | `vitest` | |
| `pnpm lint` | `eslint` | Config in `eslint.config.mjs` |
| `pnpm tauri <args>` | Raw Tauri CLI | e.g. `pnpm tauri signer generate` |

From the **monorepo root**:

```bash
pnpm install                          # required once, installs the whole workspace
pnpm dev:nfc                          # → pnpm --filter nfc-attender tauri:dev
pnpm build:nfc                        # → pnpm --filter nfc-attender tauri:build
pnpm --filter nfc-attender test
pnpm --filter nfc-attender lint
```

There is **no `typecheck` script in this app**. The root `pnpm typecheck` runs
`tsc` only across `./packages/*`. The app's TypeScript is checked as a side effect
of `next build` (and therefore of `tauri:build`); `pnpm lint` alone will not catch
a type error.

## Dev loop

```bash
cd apps/nfc-attender
pnpm tauri:dev
```

`tauri.conf.json` sets `beforeDevCommand: "pnpm dev"` and
`devUrl: "http://localhost:3000"`, so one command starts both halves: Next's dev
server and the Rust shell pointed at it. Rust changes trigger a recompile and app
restart; frontend changes hot-reload.

Sign-in is required before anything loads. `useIsPrivileged` treats a
`role: "learner"` account as logged out, so you need an `admin` or `lg` account
seeded in the PocketBase admin UI. Accounts cannot be created from this app —
the sign-up tab was removed.

### Browser vs Tauri

`pnpm dev` alone opens the app in a normal browser. This is useful for pure layout
work and is what the Vitest component tests emulate, but three things degrade:

- **`useNfcLearner` throws.** It calls `listen("nfc-scanned")` from
  `@tauri-apps/api/event` inside an un-`catch`ed async IIFE. Outside Tauri that
  rejects, and the rejection is unhandled — the console shows an error and no scan
  listener is ever registered. Harmless to the rest of the page, but noisy.
- **`UpdateNotification` and the app version silently no-op.** `check()` rejects
  and is swallowed; `getVersion()` is `.catch(() => {})`-ed, so the version string
  in the footer stays empty.
- **CSV export takes the browser path.** `saveTextFile` detects
  `window.__TAURI_INTERNALS__` and falls back to a blob + `<a download>` anchor.
  That path is the *fallback*; the Tauri path (native save sheet via the
  dialog + fs plugins) is the one users get, and the one worth testing in
  `tauri:dev`.

Use `tauri:dev` for anything touching scans, updates, or file saving.

### Test mode and demo data

Press `t` (or the "Test" pill) on the dashboard to open the test panel. It lets you
override the clock and date fed into the attendance state machine, and fire a
simulated scan against any learner's card without a reader. "Load demo" overlays a
synthesized mid-day roster (`src/lib/demo-data.ts`) — while the overlay is on,
**no writes reach PocketBase**, so it is safe for stage demos. Leaving test mode
clears the overlay.

## Production build

### macOS (primary)

```bash
cd apps/nfc-attender
pnpm tauri:build
```

`beforeBuildCommand` runs `pnpm build` first, producing `out/`, which
`frontendDist: "../out"` tells Tauri to bundle. Artifacts land in
`src-tauri/target/release/bundle/` (or
`src-tauri/target/<triple>/release/bundle/` when `--target` is passed).
`bundle.targets` is `"all"`, so macOS yields both a `.app` and a `.dmg`, and
`createUpdaterArtifacts: true` additionally emits the signed updater tarball plus
its `.sig` — but only when `TAURI_SIGNING_PRIVATE_KEY` is set. Without that
variable the bundle succeeds and the updater artifacts are skipped.

`bundle.macOS.minimumSystemVersion` is `10.13`. The app is not notarized or
Developer-ID signed by any script in this repo, so a downloaded `.dmg` gets
Gatekeeper-quarantined on a machine that did not build it.

### Windows (cross-compiled)

```bash
cd apps/nfc-attender
./build-windows.sh
```

The script is the documented procedure because it does the setup you would
otherwise get wrong once and then forget:

1. `cargo install cargo-xwin` if the binary is missing. `cargo-xwin` downloads the
   MSVC CRT and Windows SDK headers so an MSVC-ABI target can link on a non-Windows
   host — the GNU target would work without it but produces a binary that Tauri's
   NSIS/MSI bundlers and the MSVC-only `pcsc` linkage do not match.
2. `rustup target add x86_64-pc-windows-msvc` if not installed.
3. `pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc` —
   identical to `pnpm tauri:build:windows`.

Output goes to `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`, in a
`nsis/` and an `msi/` subdirectory. The filename pattern is:

```
bundle/nsis/NFC Attender_<version>_x64-setup.exe
bundle/msi/NFC Attender_<version>_x64_en-US.msi
```

where `<version>` is `tauri.conf.json`'s `version` — `0.4.0` today. Do not trust a
hardcoded filename: the script's completion message used to print
`NFC Attender_0.1.0_x64-setup.exe`, which was true when it was written and had been
wrong for three minor versions. It now lists what actually landed instead of
guessing.

`bundle.windows.certificateThumbprint` is `null`, so the installer is unsigned and
SmartScreen will warn on first run.

## Release and auto-update

Versions live in **three files that must be bumped together**:
`package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`. All three
read `0.4.0` today. `tauri.conf.json` is the one the updater compares against
`latest.json`; the other two just have to not contradict it.

The release is tag-driven from the monorepo root:

```bash
# from the repo root, after bumping all three version fields
git tag v0.4.1 && git push origin v0.4.1
```

That fires `.github/workflows/nfc-release.yml` (repo root, owned outside this app),
which lints and tests, then builds a `macos-latest` `aarch64-apple-darwin` bundle
and a `windows-latest` x64 bundle via `tauri-apps/tauri-action`, signs the updater
artifacts with `TAURI_SIGNING_PRIVATE_KEY`, and publishes a non-draft GitHub release
carrying `latest.json`.

The running app polls
`https://github.com/lilylilylily123/learnlife/releases/latest/download/latest.json`
on mount (`src/app/components/UpdateNotification.tsx`) and, if a newer version is
signed with the matching `pubkey`, shows a blocking modal. Full detail, key
generation, and the failure modes are in
[`docs/AUTO_UPDATER_GUIDE.md`](docs/AUTO_UPDATER_GUIDE.md).

### Two release workflows exist, and one of them is a trap

There is also `apps/nfc-attender/.github/workflows/release.yml` — an app-local
copy. It is inert inside the monorepo (GitHub only reads workflows from the
repository root), and it exists because `pnpm push:nfc` at the root does
`git subtree push --prefix=apps/nfc-attender nfc-attender main`, mirroring this
directory into a standalone `nfc-attender` repository where a root-level
`.github/workflows/` does appear.

Two things about it are wrong and neither has been fixed:

- Its checkout step is hardcoded to `repository: lilylilylily123/learnlife` at
  `ref: main`. So even when it runs in the mirror, it builds monorepo `main`, not
  the tag that triggered it and not the mirrored content.
- It pins `pnpm/action-setup` to `version: 9`, while the root `packageManager` is
  `pnpm@10.33.0` and `pnpm-lock.yaml` is `lockfileVersion: '9.0'` — which pnpm 9
  cannot read. It would fail at install even if the rest were right.
- It duplicates the root `nfc-release.yml` without the lint/test gate, so nothing
  stops it publishing a release from failing code.

Treat the root `nfc-release.yml` as the real release path. The app-local file is
documented here only so nobody assumes it is doing something.

## Tests

```bash
cd apps/nfc-attender
pnpm test
```

Vitest, `jsdom` environment, `globals: true`, setup file
`src/__tests__/setup.ts` (which only pulls in `@testing-library/jest-dom/vitest`).
`@/*` resolves to `./src/*` in both `tsconfig.json` and `vitest.config.ts`.

This app's suite is also where the shared packages get most of their coverage —
`packages/pb-client` and `packages/shared` have no test runner of their own, so
`pb-client-shared.test.ts`, `attendance-state-machine.test.ts`,
`attendance-summary.test.ts`, `date-utils.test.ts`, `expand-events.test.ts`, and
`rsvp.test.ts` all live here while testing code that lives elsewhere. That is why
CI runs `pnpm --filter nfc-attender test` even for changes confined to
`packages/`. Do not "tidy" those files out of this app without moving the coverage.

| Test file | Covers |
| --- | --- |
| `attendance-state-machine.test.ts` | `computeCheckInAction`, `deriveStatus`, `splitStatus`, `findLearnersToMarkAbsent` (from `@learnlife/shared`) |
| `attendance-summary.test.ts` | `summarizeAttendance` / `summarizeByLearner` aggregation |
| `check-learner-in.test.ts` | `src/app/utils/utils.ts:checkLearnerIn`, with `pb` and the query wrappers mocked |
| `date-utils.test.ts` | `parsePBDate`, `todayDateStr`, `countWeekdays` and friends |
| `expand-events.test.ts` | `expandEvents` — calendar recurrence expansion (used by the calendar app, tested here) |
| `learner-tile.test.tsx` | `WallView` / `getWallTone` tile rendering |
| `pb-client.test.ts` | `src/lib/pb-client.ts:updateAttendance` field/value validation |
| `pb-client-shared.test.ts` | `@learnlife/pb-client` query functions against a faked PocketBase |
| `rsvp.test.ts` | RSVP rules from `@learnlife/shared` |
| `status-and-history.test.tsx` | `StatusEditor` interactions, `groupRosterRows` |
| `useNfcLearner.test.ts` | Scan queue: sequencing, dedupe, staleness, auth gating |
| `wall-view-bulk-reset.test.tsx` | Wall-view select mode and bulk reset confirmation |

There is no test that compares the three copies of the attendance rule against
each other. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#the-attendance-rule-exists-three-times)
and [`CLAUDE.md`](CLAUDE.md).

## Known gaps

Each of these is documented in detail where it lives. Collected here so nobody has
to discover them the hard way.

**Data correctness**

- **`justified` is never written on the check-in path.** An excused learner who taps
  in can end up with `arrival: "late"`, `status: "jLate"`, `justified: false` — the
  reports then count it as an *unexcused* late while the UI shows it as justified.
  This is the most consequential defect in the app.
  [Detail](docs/ARCHITECTURE.md#known-data-correctness-bug-justified-is-never-written-on-check-in).
- **The attendance rule is implemented three times** (TS shared, TS pb-client, C++
  firmware) with nothing in CI comparing them, and they have already drifted: the
  firmware checks out at 17:00 where the TypeScript checks out at 16:59, adds a
  14:00–17:00 no-scan window, and orders the checkout / late-lunch-return steps
  differently.
- **Nothing marks absences unless this app is open.** The sweep is a browser timer.
  In a device-only deployment nobody is marked absent at all, and there is no
  catch-up pass for a missed day. [`README_SCHEDULER.md`](README_SCHEDULER.md) has
  the whole story.
- **`markLunchLate` does not exist in any form.** A learner who taps out for lunch
  and never returns keeps an unmatched `out` event forever; the CSV shows
  `(no return)`.
- **UTC/local asymmetry in `checkLearnerIn`**: the row's `date` comes from
  `toISOString()` while the state machine compares local `getHours()`. Latent in the
  deployed timezone.

**Observability**

- **The audit trail is thinner than the code suggests, for two independent
  reasons.** Only one of three declared `AuditAction` values is ever emitted — bulk
  attendance edits, the highest-consequence action in the app, are unaudited. And
  `audit_log` may not exist on the hosted instance, in which case even `csv_export`
  is silently discarded. [Detail](docs/ARCHITECTURE.md#libauditts--a-narrower-audit-trail-than-the-code-suggests).
- **`nfc-error` has no listener.** A dead or unplugged reader is invisible; the
  header still reads "Reader live".
- **`checkLearnerIn` failures are invisible to the user.** A scan that did not take
  looks exactly like one that did.

**Duplication with no guard**

- **The PC/SC reader and the firmware no longer debounce alike.** `last_uid` in
  `main.rs` is structurally dead; only the `card_present` edge suppresses duplicates.
  The firmware replaced that with a 1500 ms UID window to fix duplicate scans, and
  this path never got the fix.
- **`pf` ("Pathfinders") is a fourth program code** hard-coded in three label maps
  but absent from `PROGRAM_CODES`, so the admin report filter never offers it.
- **The palette is duplicated.** This app does not depend on
  `@learnlife/design-tokens`; `src/app/globals.css` re-declares all thirteen colours.
  Values are currently identical and nothing enforces it.

**Housekeeping**

- **`src/app/history/page.tsx` still uses `window.confirm`/`alert`** in three places,
  which do not render in Tauri's WKWebView. One of them guards a lunch-event
  overwrite, so the guard probably cancels the save instead of prompting.
  Unverified against a packaged build.
- **`event` and `node-fetch` are dependencies nothing imports.** `event` is a `link:`
  alias to `@tauri-apps/api/event`; no file in `src/` imports either.
- **No app-level `tsc` check.** Type errors only surface at `next build`.
- **`src-tauri/src/lib.rs` is dead scaffolding** for a mobile target that does not
  exist. `main.rs` never calls it.
- **CI builds only `darwin-aarch64` and `windows-x86_64`.** An Intel Mac or a Linux
  host will never auto-update.
