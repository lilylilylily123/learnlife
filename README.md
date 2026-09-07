# LearnLife

Attendance and calendar software for a learning community. Learners tap an NFC
card on a desk terminal; staff review and correct the record on a dashboard; a
mobile app carries the calendar and messaging.

**New here? Start with [`docs/GLOSSARY.md`](docs/GLOSSARY.md)** — the domain
vocabulary is specific, and two terms (`lg`, `arrival`) mean something narrower
than they look. Then [`docs/MONOREPO_ARCHITECTURE.md`](docs/MONOREPO_ARCHITECTURE.md)
for how the pieces fit, and [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) to get
a machine running.

---

## What's in here

| Path | What it is | Toolchain |
|---|---|---|
| [`apps/nfc-attender-fw`](apps/nfc-attender-fw/README.md) | ESP32 firmware — the **tap terminal** | PlatformIO / C++ |
| [`apps/nfc-attender`](apps/nfc-attender/README.md) | Next.js + Tauri 2 desktop app — the attendance **dashboard** | pnpm + Rust |
| [`apps/ll-calendar`](apps/ll-calendar/README.md) | Expo + React Native calendar/messaging (iOS, Android, Web) | pnpm |
| [`packages/pb-client`](packages/pb-client/README.md) | All PocketBase access: client, types, constants, queries | pnpm |
| [`packages/shared`](packages/shared/README.md) | Pure business logic — attendance rules, calendar, dates, roles | pnpm |
| [`packages/design-tokens`](packages/design-tokens/README.md) | Colour/spacing/type tokens | pnpm |
| [`pb_hooks`](pb_hooks/README.md) | PocketBase server-side hooks, uploaded by hand | none |

The backend is a **hosted PocketBase** at `https://learnlife.pockethost.io/`
and is **not in this repository**. See [`docs/POCKETBASE.md`](docs/POCKETBASE.md).

Two things trip everyone up once:

- **`nfc-attender` and `nfc-attender-fw` are different apps.** One is the
  TypeScript dashboard, the other the C++ firmware. CI path filters rely on the
  suffix.
- **`apps/nfc-attender-fw` is not in the pnpm workspace** (`pnpm-workspace.yaml`).
  Nothing in it runs `pnpm`; use `pio` from inside that directory.

---

## Prerequisites

- Node.js `>=20`, pnpm `>=10` (see `engines` in `package.json`)

```bash
# `corepack enable` alone is correct and sufficient — the pnpm version is
# pinned by `packageManager` in package.json. Do NOT run
# `corepack prepare pnpm@latest`; it activates a different version than the pin.
corepack enable
pnpm install
```

Rust is needed only for the desktop app, PlatformIO only for the firmware, and
OpenSCAD only for the enclosure. Per-area setup:
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

> Do not run `npm install` at the root. A vestigial `package-lock.json` is
> tracked; nothing reads it and its `engines` field contradicts
> `package.json`. This repo is pnpm-only.

---

## Commands

From the repository root:

| Command | What it does |
|---|---|
| `pnpm dev:nfc` | Tauri dev build with hot reload (dashboard) |
| `pnpm dev:calendar` | Expo dev server (calendar) |
| `pnpm build:nfc` | Tauri production build (macOS `.app`/`.dmg`) |
| `pnpm lint` | ESLint across workspace packages |
| `pnpm test` | Tests across the workspace — **note: does not cover `packages/*`**, which define no `test` script |
| `pnpm typecheck` | `tsc --noEmit` across `packages/*`. Their only direct check |
| `pnpm push:nfc` / `push:calendar` / `push:all` | Mirror an app to its own standalone repo via `git subtree` |

> `pnpm build:calendar` is currently **broken**: it runs
> `pnpm --filter ll_calendar build`, and `apps/ll-calendar` defines no `build`
> script, so it exits 1. See that app's README for the deploy path that actually
> works.

Firmware, from `apps/nfc-attender-fw/`:

| Command | What it does |
|---|---|
| `pio test -e native` | 134 host-side unit tests, no hardware needed |
| `pio run -e esp32dev` | Build firmware |
| `pio run -e esp32dev -t upload` | Flash over USB (**required for a board's first flash**) |
| `pio run -e esp32dev_ota -t upload --upload-port ll-attender-<id>.local` | Flash over WiFi |

Before pushing, the full local gate is `pnpm lint && pnpm typecheck && pnpm test`,
plus `pio test -e native && pio run -e esp32dev` from the firmware directory.
Ordered walkthrough with expected output: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

---

## Documentation map

Everything is documented. Start where your question is.

### Cross-cutting

| Doc | Answers |
|---|---|
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | What every domain term means. Read first |
| [`docs/MONOREPO_ARCHITECTURE.md`](docs/MONOREPO_ARCHITECTURE.md) | How the apps, packages and backend fit together, and why they're split that way |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Fresh machine to running app, per work area |
| [`docs/CI.md`](docs/CI.md) | What GitHub Actions checks — and the explicit list of what it does **not** |
| [`docs/POCKETBASE.md`](docs/POCKETBASE.md) | Backend schema, collections, roles, API rules, request budget |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model and open operational risks, with a status table |
| [`docs/RSVP_MIGRATION.md`](docs/RSVP_MIGRATION.md) | Historical record of the RSVP schema migration |
| [`CLAUDE.md`](CLAUDE.md) | Orientation for AI coding agents |

### Tap terminal — `apps/nfc-attender-fw`

| Doc | Answers |
|---|---|
| [`README.md`](apps/nfc-attender-fw/README.md) | Architecture, behaviour, quick start |
| [`docs/SOURCE_MAP.md`](apps/nfc-attender-fw/docs/SOURCE_MAP.md) | Per-module reference for every file in `src/` |
| [`docs/TESTING.md`](apps/nfc-attender-fw/docs/TESTING.md) | The 13 suites, and the allow-list trap when adding a module |
| [`docs/OPERATIONS.md`](apps/nfc-attender-fw/docs/OPERATIONS.md) | Runbook: provisioning, serial console, OTA, recovery |
| [`hardware/README.md`](apps/nfc-attender-fw/hardware/README.md) | BOM, wiring, assembly, troubleshooting |
| [`hardware/enclosure/README.md`](apps/nfc-attender-fw/hardware/enclosure/README.md) | Parametric OpenSCAD case |

### Dashboard — `apps/nfc-attender`

| Doc | Answers |
|---|---|
| [`README.md`](apps/nfc-attender/README.md) | Setup, scripts, build, release |
| [`docs/ARCHITECTURE.md`](apps/nfc-attender/docs/ARCHITECTURE.md) | Internal map: routes, components, hooks, the Rust/TS boundary |
| [`docs/USER_GUIDE.md`](apps/nfc-attender/docs/USER_GUIDE.md) | For non-technical staff |
| [`docs/AUTO_UPDATER_GUIDE.md`](apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md) | How updates reach installed copies |
| [`README_SCHEDULER.md`](apps/nfc-attender/README_SCHEDULER.md) | The absence-marking scheduler, and why it is unbuilt |

### Calendar — `apps/ll-calendar`

| Doc | Answers |
|---|---|
| [`README.md`](apps/ll-calendar/README.md) | Setup, running on three platforms, deploy |
| [`docs/ARCHITECTURE.md`](apps/ll-calendar/docs/ARCHITECTURE.md) | Auth flow, routes, components, platform splits |

---

## Known gaps

Documented rather than hidden, because each one will bite someone otherwise.
Full detail in the linked docs.

- **Nobody marks absences in a device-only deployment.** The auto-absent sweep
  runs only while a guide has the dashboard open — PocketBase cron is not
  available in this hosting setup. A learner who never taps keeps
  `arrival = null`.
- **The attendance rule exists four times** — the spec in `packages/shared`, a
  duplicated `deriveStatus` and a separate `splitStatus` in `packages/pb-client`,
  and a C++ port in the firmware. Nothing in CI compares them, and **they have
  already drifted**: check-out is 16:59 in TS but 17:00 in C++, check-out and
  late-lunch-return are evaluated in opposite orders, the device has a `Locked`
  action the dashboard lacks, and absence marking was never ported. See
  [`docs/MONOREPO_ARCHITECTURE.md`](docs/MONOREPO_ARCHITECTURE.md).
- **A `jAbsent` learner who taps in ends up internally contradictory** —
  `arrival: "late"`, `justified: false`, `status: "jLate"` — because the
  check-in path writes the action's fields raw instead of through
  `batchUpdateAttendance`. Reports and legacy consumers then disagree about
  that day.
- **`packages/*` have no test script**, so `pnpm test` does not reach them. All
  behavioural coverage of the core domain logic lives in
  `apps/nfc-attender/src/__tests__/` — extracting that app would silently
  delete the shared packages' test suite.
- **The calendar app's RSVP client and the server hook are mutually
  incompatible.** `computeRsvpAction` can return `status: "waitlisted"` and
  `submitRsvp` writes it verbatim, but `pb_hooks/event_rsvps.pb.js` rejects any
  status other than `going`/`not_going` on submit. So if the hook is loaded,
  RSVPing to a full waitlist-enabled event returns 400 — and the waitlist
  renumber that follows fails silently, swallowed by a `.catch(console.warn)`.
  Which side is live could not be determined from the repo; the two-learner test
  that settles it is in
  [`apps/ll-calendar/docs/ARCHITECTURE.md`](apps/ll-calendar/docs/ARCHITECTURE.md).
- **`expandEvents` shows weekly series before they start.** It checks weekday
  and `recurrence_end` but never compares an occurrence against `rec.start`, so
  a weekly event appears in months preceding its first date.
- **`pnpm reset-project` in `apps/ll-calendar` would destroy the app.** It is
  the unmodified `create-expo-app` scaffold script, still wired into
  `package.json`, and it moves or deletes `app/`, `components/`, `hooks/`,
  `constants/` and `scripts/`.
- **Collection API rules are largely not in the repo.** The device's permission
  to write `attendance` exists only as PocketHost admin-UI state, so a device
  cannot be provisioned from a fresh clone plus these docs alone.
- **`pb_hooks/` has no CI, no tests and no lint**, and deploys by manual upload.
- **`apps/ll-calendar` has no typecheck at all**, and its jest `testMatch`
  cannot collect `.tsx` tests.
- **`apps/nfc-attender/src-tauri` has no tests**; the card-reading path is
  compile-checked only.
