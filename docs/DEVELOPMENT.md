# Development Environment

Everything needed to go from a fresh machine to a running LearnLife app, and the
exact sequence to run locally before pushing. It exists because the toolchain is
genuinely heterogeneous — TypeScript, Rust and C++ live in one tree — and
installing all of it is unnecessary for almost every change. Read the
[work areas](#work-areas-and-what-each-one-actually-needs) table first and
install only the column you need.

For what the code *is*, see [`MONOREPO_ARCHITECTURE.md`](MONOREPO_ARCHITECTURE.md)
and [`../CLAUDE.md`](../CLAUDE.md). For what CI checks (and what it does not),
see [`CI.md`](CI.md).

---

## The workspace boundary — read this first

`pnpm-workspace.yaml` declares:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  # apps/nfc-attender-fw is a PlatformIO/C++ firmware project, not a pnpm package
  - "!apps/nfc-attender-fw"
```

So the tree splits into two worlds that share no tooling at all:

| World | Paths | Driver | Run from |
|---|---|---|---|
| pnpm workspace | `apps/ll-calendar`, `apps/nfc-attender`, `packages/*` | `pnpm` | repo root (or the package dir) |
| PlatformIO project | `apps/nfc-attender-fw` | `pio` | `apps/nfc-attender-fw/` |

Nothing in `apps/nfc-attender-fw` runs `pnpm`. There is no `package.json` there,
it is not in `pnpm-lock.yaml`, and `pnpm -r <script>` never enters it. Likewise
`pio` has no idea the rest of the repo exists.

### Telling `nfc-attender` from `nfc-attender-fw`

The two names differ by three characters and mean completely different devices.

| | `apps/nfc-attender` | `apps/nfc-attender-fw` |
|---|---|---|
| What it is | Next.js 16 + Tauri 2 desktop app | ESP32 firmware (Arduino framework) |
| Role | The attendance **dashboard** — history, justifications, bulk edits, CSV export | The **tap terminal** — a standalone desk device |
| Language | TypeScript + Rust | C++17 |
| Build | `pnpm tauri build` | `pio run -e esp32dev` |
| In pnpm workspace | yes | **no** |

How to tell which one a command or a path refers to:

- A path with a `/` right after `nfc-attender` (`apps/nfc-attender/src/...`) is
  the desktop app. The firmware always has the `-fw` before its slash.
- Anything invoked with `pnpm`, or containing `--filter nfc-attender`, is the
  desktop app. `--filter nfc-attender` matches the pnpm package **name**
  `nfc-attender` (`apps/nfc-attender/package.json`), which the firmware does not
  have, so the filter can never accidentally hit it.
- Anything invoked with `pio`, or run from a directory ending `-fw`, is firmware.
- This distinction is load-bearing in CI too: `nfc-test-build.yml` filters on
  `apps/nfc-attender/**`, and that glob does **not** match `apps/nfc-attender-fw/`.
  See [`CI.md`](CI.md#path-filter-topology).

---

## Work areas and what each one actually needs

Install by column, not the whole table. A contributor touching only
`apps/ll-calendar` needs **none** of Rust, PlatformIO or OpenSCAD.

| Work area | Node + pnpm | Rust | PlatformIO | OpenSCAD |
|---|---|---|---|---|
| `apps/ll-calendar` (calendar app) | required | – | – | – |
| `packages/*` (shared logic, PB client, tokens) | required | – | – | – |
| `pb_hooks/` (PocketBase hooks) | not even that — see below | – | – | – |
| `apps/nfc-attender` frontend only (`src/`, tests) | required | – | – | – |
| `apps/nfc-attender` desktop build / `src-tauri/` | required | required | – | – |
| `apps/nfc-attender/tools/enroll` (Rust CLI) | – | required | – | – |
| `apps/nfc-attender-fw/src`, `test` (firmware) | – | – | required | – |
| `apps/nfc-attender-fw/hardware/enclosure` (`.scad`) | – | – | – | required |

`pb_hooks/*.pb.js` runs inside PocketBase's own JS VM on PocketHost. There is no
local runtime for it in this repo, no build step and no test harness — see
[Editing `pb_hooks`](#editing-pb_hooks).

### Node and pnpm — exact versions

From the root `package.json`:

| Field | Value |
|---|---|
| `engines.node` | `>=20` |
| `engines.pnpm` | `>=10` |
| `packageManager` | `pnpm@10.33.0` |

CI runs Node **22** (`node-version: 22` in `calendar-test.yml`,
`nfc-test-build.yml`, `nfc-release.yml`). There is no `.nvmrc` in the repo, so
nothing pins your local Node. Use Node 22 if you want to match CI exactly; 20 is
the floor `engines` will accept.

pnpm must be **10.x**. `pnpm-lock.yaml` is `lockfileVersion: '9.0'`, which pnpm 9
cannot read. The `packageManager` field pins the exact patch, so with Corepack
enabled you get 10.33.0 without asking:

```bash
corepack enable        # Corepack then honours packageManager: pnpm@10.33.0
```

If your Node build does not ship Corepack, install the pinned version directly:

```bash
npm install -g pnpm@10.33.0
```

Verify before going further — a pnpm 9 in `PATH` produces confusing lockfile
errors rather than a clear version complaint:

```bash
node --version   # v20.x or newer, v22.x to match CI
pnpm --version   # 10.33.0
```

> Do not run `npm install` at the repo root. There is a vestigial 14-line
> `package-lock.json` there claiming `node >=18, pnpm >=9`; it contradicts
> `package.json` and is not the lockfile this repo uses. Only `pnpm-lock.yaml` is
> authoritative. (Recorded as an open question below.)

### Rust — for the desktop app and the enroll CLI

`apps/nfc-attender/src-tauri/Cargo.toml` sets `rust-version = "1.77.2"`
(edition 2021), so that is the documented minimum for the Tauri crate. CI
installs `dtolnay/rust-toolchain@stable`, i.e. current stable, and there is no
`rust-toolchain.toml` in the repo pinning anything — stable is what is actually
tested.

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # rustup
rustc --version
```

CI builds the desktop app on **macOS (aarch64) and Windows only**. There is no
Linux job and no Linux bundle target, so Linux is untested territory.

Two system-level dependencies are **not pinned anywhere in this repo**, so they
are stated here as pointers rather than as verified facts:

- Tauri's own platform prerequisites (WebView, compiler, linker). Not documented
  in this repo — follow <https://tauri.app/start/prerequisites/>.
- A PC/SC smartcard stack, because both Rust crates depend on `pcsc = "2.9.0"`
  (`src-tauri/Cargo.toml` and `tools/enroll/Cargo.toml`). macOS and Windows ship
  one; a Linux host would need a pcsc-lite development package, which nothing in
  this repo names or tests. **Not verifiable from the repo: the exact Linux
  package names.**

Windows cross-compilation from macOS/Linux is scripted at
`apps/nfc-attender/build-windows.sh`, which installs `cargo-xwin` and the
`x86_64-pc-windows-msvc` target on demand.

### PlatformIO — for the firmware

PlatformIO is a Python tool. `nfc-fw.yml` uses Python **3.12** and installs it
with pip; do the same locally.

```bash
pip install --upgrade platformio
pio --version
```

`platformio.ini` pulls everything else itself — the `espressif32` platform, the
xtensa toolchain, and the four `lib_deps` (Adafruit PN532, SSD1306, GFX,
ArduinoJson). The first `pio run -e esp32dev` downloads several hundred megabytes
of toolchain; the `native` environment needs only a host compiler plus
ArduinoJson and warms in seconds. That asymmetry is why CI keeps two separate
`~/.platformio` caches.

### OpenSCAD — for the enclosure

Only needed to edit or re-render `apps/nfc-attender-fw/hardware/enclosure/*.scad`.
The printable STLs are committed, so you do not need OpenSCAD to print or review
geometry.

`export.sh` documents the install and the reason the old formula is wrong:

```bash
brew uninstall --cask openscad          # deprecated cask, disabled from 2026-09-01
brew install --cask openscad@snapshot   # installs the app and links an `openscad` CLI
```

Local machines run a 2026 snapshot; CI installs Ubuntu's `openscad` package
(2021.01 per the note in `nfc-fw.yml`). Binary STL output is not reproducible
across those two, which is why the freshness gate hashes `params.scad` instead of
diffing meshes. Consequence for you: **after changing `params.scad` you must run
`./export.sh` locally and commit `stl/`**, because CI cannot regenerate it for you.

---

## Install

One install covers both TypeScript apps and all three packages.

```bash
# from the repo root
pnpm install
```

Use the CI form when you want to prove the lockfile is honest:

```bash
pnpm install --frozen-lockfile
```

The firmware needs no install step beyond PlatformIO itself; `pio` resolves
`lib_deps` on first build.

---

## First run, per app

### Calendar app — `apps/ll-calendar`

Expo dev server. Node and pnpm only.

```bash
# from the repo root
pnpm dev:calendar          # -> pnpm --filter ll_calendar start -> expo start
```

Or from `apps/ll-calendar/`:

```bash
pnpm start                 # expo start
pnpm ios                   # expo start --ios
pnpm android               # expo start --android
pnpm web                   # expo start --web
```

Note the pnpm package name is `ll_calendar` (underscore), while the directory is
`ll-calendar` (hyphen). `--filter` needs the underscore form.

No environment variables are required: the PocketBase URL is a compile-time
constant (`PB_URL` in `packages/pb-client/src/constants.ts`), not an env var.

### Desktop dashboard — `apps/nfc-attender`

Needs Node, pnpm **and** Rust.

```bash
# from the repo root
pnpm dev:nfc               # -> pnpm --filter nfc-attender tauri:dev
```

Or from `apps/nfc-attender/`:

```bash
pnpm tauri:dev
```

`tauri.conf.json` sets `beforeDevCommand: pnpm dev` and
`devUrl: http://localhost:3000`, so `tauri:dev` starts Next.js itself — do not
start `next dev` separately. If you only want the web UI in a browser, run
`pnpm dev` from `apps/nfc-attender/` and skip Rust entirely; you lose NFC (the
`nfc-scanned` event comes from the Rust side) but everything else works.

Production build:

```bash
# from the repo root
pnpm build:nfc             # -> tauri build
```

`beforeBuildCommand: pnpm build` runs `next build`, which with
`output: "export"` writes `apps/nfc-attender/out/` — the `frontendDist` Tauri
bundles.

### Firmware — `apps/nfc-attender-fw`

```bash
cd apps/nfc-attender-fw

pio test -e native          # 134 host-side unit tests, no hardware needed
pio run -e esp32dev         # build the firmware image
pio run -e esp32dev -t upload   # flash over USB
pio device monitor          # 115200 baud, from platformio.ini
```

The first flash of any physical device **must** be over USB — the custom
partition table cannot be applied over the air. See
[`../apps/nfc-attender-fw/README.md`](../apps/nfc-attender-fw/README.md) for
provisioning, OTA and the hardware runbook.

### Enclosure — `apps/nfc-attender-fw/hardware/enclosure`

```bash
cd apps/nfc-attender-fw/hardware/enclosure

./export.sh                 # render every part into stl/ and stamp PARAMS.sha256
./export.sh coupon          # render one part
./export.sh --check         # parse/render everything, write nothing (what CI runs)
```

---

## Root scripts

Every script in the root `package.json`. Run all of them from the repository
root.

| Script | Expands to | What it does | When you use it |
|---|---|---|---|
| `dev:nfc` | `pnpm --filter nfc-attender tauri:dev` | Tauri dev shell + Next dev server with hot reload | Working on the dashboard with a card reader attached |
| `dev:calendar` | `pnpm --filter ll_calendar start` | `expo start` | Working on the calendar app |
| `build:nfc` | `pnpm --filter nfc-attender tauri:build` | Full desktop bundle (DMG/MSI) | Producing an installer locally; needs Rust |
| `build:calendar` | `pnpm --filter ll_calendar build` | **Broken — `ll_calendar` defines no `build` script.** Verified: exits 1 with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT  None of the selected packages has a "build" script` | Nothing. Use `pnpm --filter ll_calendar web` or an EAS build instead |
| `lint` | `pnpm -r lint` | ESLint in `nfc-attender`, `expo lint` in `ll_calendar` | Before every push |
| `test` | `pnpm -r test` | Vitest in `nfc-attender`, `TZ=UTC jest` in `ll_calendar` | Before every push |
| `typecheck` | `pnpm -r --filter "./packages/*" typecheck` | `tsc --noEmit` in `pb-client`, `shared`, `design-tokens` | Before every push, and always after touching `packages/*` |
| `clean` | `pnpm -r exec rm -rf node_modules && rm -rf node_modules` | Nukes every `node_modules` | Resolving a corrupted install; re-run `pnpm install` after |
| `push:nfc` | `git subtree push --prefix=apps/nfc-attender nfc-attender main` | Publishes the dashboard subtree to its standalone repo | Releasing the dashboard from its own repo |
| `push:calendar` | `git subtree push --prefix=apps/ll-calendar ll-calendar main` | Publishes the calendar subtree | Same, for the calendar |
| `push:all` | both of the above | | |

`push:*` require git remotes named `nfc-attender` and `ll-calendar`. Those
remotes are not configured by anything in the repo, so on a fresh clone these
scripts fail until you add them. **Not verifiable from the repo: the URLs of
those remotes** — `src-tauri/Cargo.toml` names
`https://github.com/lilylilylily123/nfc-attender` as the crate's `repository`,
which is consistent with the `nfc-attender` remote, but nothing states the
calendar's.

### Why `typecheck` is separate from `test`

`packages/pb-client`, `packages/shared` and `packages/design-tokens` each define
exactly one script — `typecheck` — and **no `test` script**. So:

- `pnpm test` (`pnpm -r test`) does not cover them at all. It runs two suites:
  the dashboard's and the calendar's. Whatever those two exercise transitively is
  the only behavioural coverage the shared packages have.
- `pnpm typecheck` is their only direct check. `tsc --noEmit` is the sole tool
  that reads every file in all three.
- They define no `lint` script either, so `pnpm lint` skips them silently.
  `pnpm -r` only fails when *no* selected package has the script (verified:
  `pnpm --filter ll_calendar build` exits 1 with
  `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`), and both apps do define `lint` — so the
  packages are passed over without a word.

This is why both TypeScript CI workflows run the typecheck step, and why
`packages/**` is in both of their path filters — see
[`CI.md`](CI.md#what-ci-does-not-cover).

Note the two apps have **no** `typecheck` script. The dashboard's app-level types
are checked only as a side effect of `next build` (nothing in `next.config.ts`
disables it), and `apps/nfc-attender/tsconfig.json` does not even extend
`tsconfig.base.json`. The calendar app's types are never checked by any script:
its jest transform sets `diagnostics: false`, so ts-jest ignores type errors too.

---

## Local verification before pushing

Ordered, with what each step proves. Steps 1–4 are the pnpm world; steps 5–6 are
the firmware world and are only needed if you touched `apps/nfc-attender-fw`.

```bash
# 1. from the repo root — proves the lockfile matches the manifests
pnpm install --frozen-lockfile

# 2. from the repo root
pnpm lint

# 3. from the repo root
pnpm typecheck

# 4. from the repo root
pnpm test

# 5. from apps/nfc-attender-fw
cd apps/nfc-attender-fw && pio test -e native

# 6. from apps/nfc-attender-fw
pio run -e esp32dev
```

| Step | Command | Directory | Expected outcome |
|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | root | Succeeds. Failure means `pnpm-lock.yaml` is out of date — run plain `pnpm install` and commit the lockfile |
| 2 | `pnpm lint` | root | Two lints pass (`nfc-attender` eslint, `ll_calendar` expo lint). `@typescript-eslint/no-explicit-any` is a **warning** by deliberate config, so `any` warnings do not fail the step |
| 3 | `pnpm typecheck` | root | Three `tsc --noEmit` runs pass. Leaves `*.tsbuildinfo` files behind — gitignored, because `tsconfig.base.json` sets `composite: true` |
| 4 | `pnpm test` | root | Vitest (jsdom, 12 test files under `apps/nfc-attender/src/__tests__/`) and jest (`TZ=UTC`, `apps/ll-calendar/__tests__/`) both green |
| 5 | `pio test -e native` | `apps/nfc-attender-fw/` | **134 cases** across 13 `test_*` directories, all passing |
| 6 | `pio run -e esp32dev` | `apps/nfc-attender-fw/` | Links successfully. The linker itself fails if the image outgrows a 1536 KB app slot; CI additionally fails at 95% and warns at 85% |

Two things CI runs that this sequence does not:

- **The Tauri compile.** `pnpm tauri build --no-bundle` on macOS and Windows.
  Locally, `pnpm build:nfc` (root) is the closest equivalent and needs Rust. If
  you did not touch `src-tauri/`, `Cargo.toml` or the frontend build config, the
  ubuntu lint/typecheck/test job is the part that matters.
- **The enclosure render.** From `apps/nfc-attender-fw/hardware/enclosure/`, run
  `./export.sh --check`. CI wraps it in `xvfb-run -a` because the runner is
  headless; on a desktop macOS or Linux machine you do not need `xvfb-run`.

Reproducing any CI job step-for-step is documented in
[`CI.md`](CI.md#reproducing-ci-locally).

---

## Environment variables and secrets

The short version: **a local development run of either app needs no environment
variables and no secrets at all.**

| Variable | Needed where | Needed locally? |
|---|---|---|
| `PB_ADMIN_EMAIL` | `packages/pb-client/scripts/backfill-arrival.ts` | Only to run that one-off migration script |
| `PB_ADMIN_PASSWORD` | same | Only to run that script |
| `TAURI_SIGNING_PRIVATE_KEY` | `nfc-release.yml`, `apps/nfc-attender/.github/workflows/release.yml` | **No** — CI-only |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | same | **No** — CI-only |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude.yml`, `claude-code-review.yml` | **No** — CI-only |
| `GITHUB_TOKEN` | the release workflows | **No** — supplied by Actions automatically |

Those five are the complete set of `secrets.*` references across all seven
workflow files. Nothing else in CI reads a secret.

The PocketBase URL is **not** an environment variable — `PB_URL` is a string
literal in `packages/pb-client/src/constants.ts`, and `createPBClient()` accepts
a `url` override for tests and self-hosted setups. So a fresh clone talks to the
production instance by default.

### Running the backfill script

```bash
# from the repo root
PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \
  pnpm tsx packages/pb-client/scripts/backfill-arrival.ts --dry-run
```

`tsx` is the root's only devDependency, which is why the command works from the
root. Drop `--dry-run` to write. The script is idempotent — it never overwrites a
record whose `arrival` is already populated. See
[`RSVP_MIGRATION.md`](RSVP_MIGRATION.md) for the related RSVP migration.

### Signing keys, if you ever need them

`TAURI_SIGNING_PRIVATE_KEY` only matters for updater artifacts. A local
`pnpm build:nfc` produces an unsigned bundle and does not need it; CI's
`nfc-test-build.yml` passes `--no-bundle` specifically to skip the signing step.
The corresponding public key is committed in
`apps/nfc-attender/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Key
generation is documented at
[`../apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md`](../apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md).

### `apps/nfc-attender/.env.example` is misleading

It exists and lists `PB_ADMIN_*`, four `PS_*` PowerSchool variables and
`REDIS_URL`. Verified against the tree:

- Its header says the `PB_ADMIN_*` pair is "required for server-side API routes".
  There are **no** API routes — `next.config.ts` sets `output: "export"`, which
  forbids them, and no `route.ts` exists anywhere in the repo.
- The `PS_*` block points at `packages/powerschool-client` and
  `docs/POWERSCHOOL_SETUP.md`. Neither is tracked in git. Nothing in the tracked
  tree reads any `PS_*` variable.
- `REDIS_URL` is labelled "for future worker queues". Nothing reads it.

The only `process.env` reads in tracked TypeScript are `PB_ADMIN_EMAIL` /
`PB_ADMIN_PASSWORD` in the backfill script, `NODE_ENV` in
`apps/nfc-attender/src/lib/debug.ts`, and `EXPO_OS` in two calendar components.
Treat `.env.example` as a historical artefact, not a setup checklist. (Reported
upstream; that file is not owned by this document.)

---

## Editing `pb_hooks`

Worth calling out because it looks like normal source and is not.

`pb_hooks/` holds three files — `users.pb.js`, `invites.pb.js`,
`event_rsvps.pb.js` — that run inside PocketBase's embedded JS VM on PocketHost.
Consequences for local development:

- No install, no build, no dev server, no local runtime. There is no PocketBase
  binary in this repo and no way to execute a hook on your machine.
- No tests and no lint. `pb_hooks/` is outside the pnpm workspace, so
  `pnpm -r lint` and `pnpm -r test` never see it.
- No CI. No workflow's path filter matches `pb_hooks/**` — see
  [`CI.md`](CI.md#paths-no-workflow-covers).
- Deployment is manual: upload the `*.pb.js` files through the PocketHost admin
  UI (Settings → Files → `pb_hooks/`). The collection rules the hooks depend on
  must be set in that UI too; hooks alone are insufficient because PocketBase
  evaluates collection rules first.

Read [`../pb_hooks/README.md`](../pb_hooks/README.md) before touching them, and
[`POCKETBASE.md`](POCKETBASE.md) for the collections and rules they act on. A
mistake here is discoverable only in production.

---

## Troubleshooting

Only problems substantiated by something in this repo.

**`ERR_PNPM_UNSUPPORTED_ENGINE` or a lockfile parse error on install.**
You are on pnpm 9 or older. `pnpm-lock.yaml` is `lockfileVersion: '9.0'`, written
by pnpm 10. Run `corepack enable` so the `packageManager: pnpm@10.33.0` pin takes
effect, then `pnpm --version` to confirm.

**`pnpm install --frozen-lockfile` fails but plain `pnpm install` works.**
The lockfile is behind the manifests. Run plain `pnpm install` and commit the
resulting `pnpm-lock.yaml` — CI uses `--frozen-lockfile` and will reject the push
otherwise.

**`pnpm build:calendar` fails immediately.**
Expected — the root script is stale. `apps/ll-calendar/package.json` has no
`build` script, so pnpm exits 1 with
`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT  None of the selected packages has a "build" script`.
Use `pnpm --filter ll_calendar web` for a local web bundle.

**`pnpm --filter ll-calendar ...` matches nothing.**
The package name is `ll_calendar` with an underscore; only the directory uses a
hyphen.

**`pnpm` commands appear to do nothing in `apps/nfc-attender-fw`.**
That directory is excluded from the workspace on purpose. Use `pio`. If you ran
`pnpm install` there and it created a stray `node_modules`, delete it.

**`pio test -e native` reports fewer than 134 cases after you added a module.**
`build_src_filter` and `test_filter` in `platformio.ini` are explicit
allow-lists. A new module missing from both is silently never compiled and never
run — it does not fail, it just does not exist. Add the `.cpp` to
`build_src_filter` and the `test_*` directory to `test_filter`. Header-only
modules need only the `test_filter` entry.

**`pio run -e esp32dev` fails at the link step with a size error.**
`hardware/partitions.csv` gives two equal 1536 KB app slots because OTA needs
two. The linker enforces that hard limit; CI's size gate warns at 85% and fails
at 95% to give you notice before the wall.

**`export.sh` exits with "openscad not found on PATH".**
The Homebrew cask changed. `brew uninstall --cask openscad` then
`brew install --cask openscad@snapshot`.

**CI's enclosure job fails on the params hash even though every part renders.**
`stl/PARAMS.sha256` disagrees with `params.scad`: the committed STLs were
exported from different parameters than the ones in the tree. Fix by running
`./export.sh` (a full run, no part argument — a partial run may not stamp the
hash) from `apps/nfc-attender-fw/hardware/enclosure/` and committing `stl/`.

**A `.tsx` test you added to `apps/ll-calendar` never runs.**
The calendar's jest `testMatch` is `["**/__tests__/**/*.test.ts"]` — `.ts` only.
A `.test.tsx` file is silently not collected: zero failures, zero coverage. The
dashboard's Vitest has no such restriction and does collect `.tsx` tests.

**Type errors in calendar tests are ignored.**
`apps/ll-calendar/package.json` sets `diagnostics: false` on the ts-jest
transform. Type errors there surface nowhere, since no script typechecks that app.

**A Tauri dev run cannot find the frontend.**
`tauri.conf.json` runs `pnpm dev` for you via `beforeDevCommand` and expects
`http://localhost:3000`. If something else already holds port 3000, Next.js picks
a different port and Tauri keeps waiting on 3000. Free the port and retry.

---

## Open questions

Things this document could not settle from the repo alone.

- The URLs behind the `nfc-attender` and `ll-calendar` git remotes used by
  `pnpm push:*` are not recorded anywhere in the tree.
- Whether the root `package-lock.json` is intentional. It is 14 lines, declares
  engines that contradict `package.json`, and no tooling here reads it.
- Whether `packages/powerschool-client` and `docs/POWERSCHOOL_SETUP.md` — both
  referenced by `apps/nfc-attender/.env.example`, neither tracked — are planned
  or abandoned.
- Exact Linux system-package names for a Tauri + pcsc-lite build. No Linux job
  exists in CI and nothing in the repo names them.
