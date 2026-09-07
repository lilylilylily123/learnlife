# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Overview

LearnLife is a pnpm workspace monorepo for a school/learning community platform. Two apps share code through two internal packages, all backed by a hosted PocketBase instance at `https://learnlife.pockethost.io/`.

- **apps/ll-calendar** — Expo + React Native calendar/messaging app (iOS, Android, Web)
- **apps/nfc-attender** — Next.js + Tauri 2 desktop app for NFC-based attendance tracking
- **apps/nfc-attender-fw** — ESP32 firmware for a standalone NFC attendance terminal (**not** a pnpm package; see below)
- **packages/pb-client** — PocketBase API client (types, queries, constants)
- **packages/shared** — Business logic (attendance state machine, calendar expansion, date utils, role helpers)

## Commands

```bash
# Development
pnpm dev:nfc              # Tauri dev build with hot reload (NFC Attender)
pnpm dev:calendar         # Expo dev server (Calendar)

# Build
pnpm build:nfc            # Tauri production build (macOS .app/.dmg)
pnpm build:calendar       # Expo build

# Quality
pnpm lint                 # ESLint across all packages
pnpm test                 # Run all tests across workspace
pnpm typecheck            # tsc --noEmit across packages/* — the shared packages
                          # ship no tests, so this is their only coverage

# Per-app tests
pnpm --filter nfc-attender test    # Vitest (jsdom)
pnpm --filter ll-calendar test     # Jest (ts-jest)

# Git subtree pushes to separate repos
pnpm push:nfc             # Push apps/nfc-attender to its own repo
pnpm push:calendar        # Push apps/ll-calendar to its own repo
pnpm push:all             # Push both
```

## Architecture

### Shared Packages

**pb-client** (`packages/pb-client/src/`) exports a `createPBClient()` factory plus query functions organized by collection: `queries/auth.ts`, `queries/learners.ts`, `queries/attendance.ts`, `queries/calendar.ts`, `queries/messages.ts`. Types are in `types.ts`, constants (PB URL, program codes, time thresholds) in `constants.ts`.

**shared** (`packages/shared/src/`) contains pure business logic:
- `attendance.ts` — `computeCheckInAction()` state machine: given current attendance state + time, returns the next action (check_in, lunch_event, check_out, no_action). Pure function, no side effects.
- `calendar.ts` — `expandEvents()` expands recurring calendar records into a date-keyed map for month views.
- `date-utils.ts` — PocketBase date parsing, formatting, date keys.
- `roles.ts` — Role predicates (`isGuide`, `isAdmin`, `isLearner`) for the three roles: `learner`, `lg`, `admin`.

### NFC Attender Data Flow

Rust → Tauri IPC → React hook → state machine → PocketBase:

1. Rust (`src-tauri/src/main.rs`): Background thread polls NFC reader via `pcsc` every 500ms, extracts card UID via APDU, emits `nfc-scanned` Tauri event
2. React hook (`src/app/hooks/useNfcLearner.ts`): Listens for events, queue-processes scans sequentially, resolves UID → learner, runs check-in
3. Check-in (`src/app/utils/utils.ts`): Fetches/creates attendance record, calls `computeCheckInAction()` from shared, updates PocketBase

The app uses static export (`output: "export"`) — Next.js generates `/out/` which Tauri bundles as the frontend. No SSR; all data fetching is client-side. PocketBase singleton lives on `window.__pb`.

### NFC Attender Firmware (apps/nfc-attender-fw)

**This directory is deliberately excluded from the pnpm workspace** (see
`pnpm-workspace.yaml`) — it is a PlatformIO/C++ project, not a package. Nothing
here runs `pnpm`. Use `pio` from inside `apps/nfc-attender-fw/`:

```bash
pio test -e native      # 130 host-side unit tests, no hardware needed
pio run -e esp32dev     # build firmware
pio run -e esp32dev -t upload   # flash over USB
pio run -e esp32dev_ota -t upload --upload-port ll-attender-<id>.local
```

A standalone ESP32 + PN532 + OLED desk device that talks straight to
PocketBase, replacing the Mac/Tauri kiosk as the **tap terminal**. The Tauri app
remains the dashboard (history, justifications, bulk edits, export).

Key points when working in this codebase:

- **`state_machine.cpp` is a port of `computeCheckInAction`** from
  `packages/shared/src/attendance.ts`, verified against the same fixtures. If
  you change attendance rules in `packages/shared`, change them here too — they
  are two implementations of one specification.
- **Pure/impure split.** Everything testable lives in modules that compile on
  the host; anything touching Arduino/WiFi/LittleFS is wrapped in
  `#ifndef LLATTENDER_NATIVE_BUILD` and excluded. Put new logic on the pure
  side and keep the Arduino files as thin adapters.
- **`build_src_filter` and `test_filter` in `platformio.ini` are explicit
  allow-lists.** A new pure module missing from both is silently never compiled
  and never run.
- **The device has no RTC.** It refuses to record attendance until NTP succeeds
  (`src/clock_gate.h`), because 10:01 is the present/late boundary and a 1970
  clock would silently mis-mark everyone.
- **Rate limit.** PocketHost allows 1000 requests/hour per IP, shared by both
  devices and the dashboard. The 30 s delta-sync interval is derived from that
  budget — don't lower it casually.

Full detail: `apps/nfc-attender-fw/README.md`. Hardware and assembly:
`apps/nfc-attender-fw/hardware/README.md`.

### Calendar App Auth Flow

`lib/pocketbase.ts` creates PB client with AsyncStorage persistence (`pb_auth` key) → `context/AuthContext.tsx` subscribes to auth store changes → `useAuth()` hook provides `user`, `isAuthenticated`, `role` throughout the app. Expo Router file-based routing in `app/`.

## Conventions

- **pnpm** workspace with `apps/*` and `packages/*`
- **TypeScript strict mode** everywhere; base config in `tsconfig.base.json`
- Path aliases: `@/*` → `./src/*` (nfc-attender) or `./*` (ll-calendar)
- nfc-attender styling: Tailwind CSS 4 + Radix UI + Lucide icons
- ll-calendar styling: `StyleSheet.create()`, platform-specific files (`.web.ts`, `.ios.tsx`)
- Expo experimental features: `typedRoutes`, `reactCompiler`
- Next.js React Compiler enabled
- Tauri targets: macOS Apple Silicon (primary), Windows via cross-compilation (`cargo-xwin`)
- Auto-updater via `tauri-plugin-updater` checking GitHub releases
