# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

NFC Attender — a Tauri 2 desktop app for NFC-based attendance tracking. Rust backend reads NFC tags via PC/SC, Next.js frontend handles UI, PocketBase (hosted at `learnlife.pockethost.io`) handles data persistence.

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm dev                  # Next.js dev server (port 3000)
pnpm tauri:dev            # Full Tauri dev build with hot reload (preferred for development)
pnpm tauri:build          # Production build (macOS .app/.dmg)
pnpm tauri:build:debug    # Debug production build
pnpm lint                 # ESLint
```

### Scheduler Jobs (server-side)

```bash
node src/server/jobs/scheduledAttendance.js --dry-run           # Test both jobs
node src/server/jobs/scheduledAttendance.js mark-absent         # Run single job
node src/server/worker/scheduler.js                             # Start scheduler
TEST_MODE=true DRY_RUN=true node src/server/worker/scheduler.js --test --exit-after-test  # Test mode
```

Scheduler requires `PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD` env vars.

## Architecture

### Tauri IPC / NFC Event Flow

The core data flow spans Rust and TypeScript:

1. **Rust** (`src-tauri/src/main.rs`): Background thread polls NFC reader via `pcsc` crate every 500ms, extracts card UID via APDU command, emits `nfc-scanned` Tauri event
2. **React hook** (`src/app/hooks/useNfcLearner.ts`): Listens for `nfc-scanned` events via `@tauri-apps/api/event`, resolves UID to learner record, triggers check-in
3. **Main page** (`src/app/page.tsx`): Consumes the hook, renders learner cards with attendance state

### Data Layer

- `src/lib/pb-client.ts` — PocketBase API wrapper (learners, attendance, lunch tracking, comments)
- `src/app/pb.ts` — PocketBase client singleton (stored on `window.__pb` to prevent duplicates)
- PocketBase collections: `learners`, `attendance`

### Static Export

Next.js is configured with `output: "export"` — generates static files into `/out/` which Tauri bundles as the frontend. No server-side rendering; all data fetching happens client-side.

### Test Mode

The main page supports a test mode with custom date/time inputs, passed through to `useNfcLearner` for simulating attendance scenarios during development.

## Key Conventions

- **Package manager**: pnpm
- **Path alias**: `@/*` maps to `./src/*`
- **TypeScript**: Strict mode, ES2017 target
- **React Compiler** is enabled in Next.js config
- **Styling**: Tailwind CSS 4 + Radix UI components + Lucide icons
- **Tauri targets**: macOS Apple Silicon (primary), Windows via cross-compilation (`cargo-xwin`)
- **Auto-updater**: Enabled via `tauri-plugin-updater`, checks GitHub releases
