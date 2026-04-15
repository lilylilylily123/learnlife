# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Overview

LearnLife is a pnpm workspace monorepo for a school/learning community platform. Two apps share code through two internal packages, all backed by a hosted PocketBase instance at `https://learnlife.pockethost.io/`.

- **apps/ll-calendar** — Expo + React Native calendar/messaging app (iOS, Android, Web)
- **apps/nfc-attender** — Next.js + Tauri 2 desktop app for NFC-based attendance tracking
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
