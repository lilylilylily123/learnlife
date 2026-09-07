# CLAUDE.md

Orientation for AI coding agents working in this repository. Human-facing entry
point is [`README.md`](README.md); this file is the shortest path to being
useful here without breaking something.

Each app has its own agent guide with app-specific invariants:
[`apps/nfc-attender/CLAUDE.md`](apps/nfc-attender/CLAUDE.md),
[`apps/ll-calendar/CLAUDE.md`](apps/ll-calendar/CLAUDE.md).

---

## Read these first

| Doc | Why |
|---|---|
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | Domain vocabulary. `lg` and `arrival` mean something narrower than they look, and getting them wrong produces confidently wrong code |
| [`docs/MONOREPO_ARCHITECTURE.md`](docs/MONOREPO_ARCHITECTURE.md) | How the parts fit, and the four-copy attendance problem |
| [`docs/CI.md`](docs/CI.md) | What is actually checked. Large parts of this repo are unchecked |
| [`docs/POCKETBASE.md`](docs/POCKETBASE.md) | Backend schema and access rules |

Full documentation map: the "Documentation map" section of
[`README.md`](README.md).

---

## Monorepo overview

pnpm workspace for a school attendance and calendar platform, backed by a
**hosted PocketBase at `https://learnlife.pockethost.io/` that is not in this
repo**.

- `apps/ll-calendar` — Expo + React Native calendar/messaging (iOS, Android, Web)
- `apps/nfc-attender` — Next.js + Tauri 2 desktop app; the attendance **dashboard**
- `apps/nfc-attender-fw` — ESP32 firmware; the **tap terminal**. **Not** a pnpm package
- `packages/pb-client` — all PocketBase access
- `packages/shared` — pure business logic
- `packages/design-tokens` — visual tokens
- `pb_hooks/` — PocketBase server-side hooks, uploaded by hand

---

## Commands

```bash
# Development
pnpm dev:nfc              # Tauri dev build with hot reload (dashboard)
pnpm dev:calendar         # Expo dev server (calendar)

# Build
pnpm build:nfc            # Tauri production build (macOS .app/.dmg)

# Quality
pnpm lint                 # ESLint across workspace packages
pnpm test                 # Tests across the workspace — does NOT cover packages/*
pnpm typecheck            # tsc --noEmit across packages/* — their only direct check

# Per-app tests
pnpm --filter nfc-attender test    # Vitest (jsdom)
pnpm --filter ll-calendar test     # Jest (ts-jest)
```

`pnpm build:calendar` is **broken** — `apps/ll-calendar` defines no `build`
script. The web build that works is `npx expo export --platform web` from that
app's directory.

Firmware, from `apps/nfc-attender-fw/`:

```bash
pio test -e native      # 134 host-side unit tests, no hardware needed
pio run -e esp32dev     # build firmware
pio run -e esp32dev -t upload   # flash over USB
pio run -e esp32dev_ota -t upload --upload-port ll-attender-<id>.local
```

---

## Traps

Ordered by how much damage getting them wrong causes.

**1. The attendance rule exists four times, and the copies have already
drifted.** The spec is `packages/shared/src/attendance.ts`; `deriveStatus` is
duplicated in `packages/pb-client/src/queries/attendance.ts`; `splitStatus` is
duplicated again in `packages/pb-client/scripts/backfill-arrival.ts`; and
`apps/nfc-attender-fw/src/state_machine.cpp` is a C++ port. **Nothing in CI
compares them.** Known live divergences: check-out is 16:59 in TS but 17:00 in
C++, check-out and late-lunch-return are evaluated in opposite orders, the
device has a `Locked` action the dashboard lacks, and `findLearnersToMarkAbsent`
was never ported. If you change a rule, change every copy and say so in the
commit message.

**2. `build_src_filter` and `test_filter` in `platformio.ini` are explicit
allow-lists.** A new pure firmware module missing from **both** is silently
never compiled and never run. It will not fail — it will not exist. Header-only
modules need only a `test_filter` entry. See
[`apps/nfc-attender-fw/docs/TESTING.md`](apps/nfc-attender-fw/docs/TESTING.md).

**3. Most of this repo is not checked by CI.** `pb_hooks/` has no workflow, no
tests and no lint. `apps/nfc-attender/src-tauri` has no `#[test]` anywhere.
`apps/ll-calendar` is never typechecked at all — no `typecheck` script,
`expo lint` is ESLint only, and its jest transform sets `diagnostics: false`.
Do not assume a green build means your change is verified; read
[`docs/CI.md`](docs/CI.md) and verify by running the thing.

**4. `apps/ll-calendar`'s jest `testMatch` is `**/__tests__/**/*.test.ts`** —
`.ts` only. A `.test.tsx` you add will be silently uncollected and will appear
to pass.

**5. The device has no RTC.** It refuses to record attendance until NTP succeeds
(`src/clock_gate.h`), because 10:01 is the present/late boundary and a 1970
clock would silently mis-mark everyone. Do not "fix" this by defaulting the
clock.

**6. Rate limit.** PocketHost allows 1000 requests/hour per IP, shared by both
devices and the dashboard behind one school NAT. The 30 s delta-sync interval is
*derived* from that budget, not chosen. Do not lower it, and do not add polling
without doing the arithmetic.

**7. `pnpm reset-project` in `apps/ll-calendar` destroys the app.** It is the
unmodified `create-expo-app` scaffold script and it deletes `app/`,
`components/`, `hooks/`, `constants/` and `scripts/`. Never run it.

**8. Do not run `npm install` at the root.** A vestigial `package-lock.json` is
tracked, nothing reads it, and its `engines` contradicts `package.json`. pnpm
only.

---

## Conventions

- **pnpm** workspace with `apps/*` and `packages/*`; `apps/nfc-attender-fw`
  explicitly excluded because it is PlatformIO/C++.
- **TypeScript strict mode** everywhere; base config in `tsconfig.base.json`.
  The base declares `lib: ["esnext"]` with no host globals — a package needing
  `console` or `setTimeout` adds `"dom"` itself, as `packages/pb-client` does.
  This is deliberate: it keeps `packages/shared` honestly pure.
- **Path aliases**: `@/*` → `./src/*` (nfc-attender) or `./*` (ll-calendar).
- **Styling**: Tailwind CSS 4 + Radix + Lucide (nfc-attender);
  `StyleSheet.create()` with platform files `.web.ts`/`.ios.tsx` (ll-calendar).
- **Firmware pure/impure split**: every non-trivial decision goes in a
  host-testable module; Arduino/WiFi/LittleFS code stays a thin adapter behind
  `#ifndef LLATTENDER_NATIVE_BUILD`. Put new logic on the pure side.
- **Put PocketBase calls in `packages/pb-client`**, not in an app.
- **Keep `packages/shared` pure** — no network, no storage, no clock of its own.
  Callers pass `now` in. That purity is what makes the C++ port and the serial
  console time-override possible.
- **Comment style**: explain *why*, and name the failure mode that motivated the
  design. Where a number or threshold exists, document what forces it. Match the
  surrounding voice; this repo's comments carry real reasoning and are the main
  reason it is navigable.

---

## Before you claim done

- `pnpm lint && pnpm typecheck && pnpm test` from the root.
- `pio test -e native && pio run -e esp32dev` from `apps/nfc-attender-fw/` if
  you touched firmware.
- For firmware behaviour, flash and read the serial log. `tap <uid>` injects a
  scan through the full pipeline without a working reader, and `t HH:MM [W]`
  overrides the clock, so most paths are exercisable at a desk.
- CI passing is weak evidence here. Say plainly which parts of your change you
  verified and which you did not.
