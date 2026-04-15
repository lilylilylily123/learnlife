# LearnLife Monorepo Architecture

This document describes how apps and shared packages are organized in this repository.

## Workspace Layout

- `apps/ll-calendar` — Expo/React Native app for calendar, messaging, and learner-facing flows
- `apps/nfc-attender` — Tauri desktop app for NFC attendance operations
- `packages/pb-client` — PocketBase client factory, typed models, and query modules
- `packages/shared` — pure shared business logic used by both apps

## Shared Packages

### `@learnlife/pb-client`

Responsibilities:

- creates PocketBase client instances (`createPBClient`)
- exports constants (PocketBase URL, program/status constants, time thresholds)
- centralizes query modules:
  - `queries/auth.ts`
  - `queries/learners.ts`
  - `queries/attendance.ts`
  - `queries/calendar.ts`
  - `queries/messages.ts`

Use this package for API calls and shared data models instead of duplicating request logic in apps.

### `@learnlife/shared`

Responsibilities:

- `attendance.ts` — attendance transition/state logic (`computeCheckInAction`)
- `calendar.ts` — event recurrence expansion (`expandEvents`)
- `date-utils.ts` — PocketBase and date formatting helpers
- `roles.ts` — role predicates (`isGuide`, `isAdmin`, `isLearner`)

Keep this package pure and side-effect free so both apps can reuse behavior consistently.

## Runtime Architecture

### NFC Attender

Core flow:

1. Rust (`src-tauri/src/main.rs`) reads NFC UID from the card reader via PC/SC.
2. Rust emits Tauri events (`nfc-scanned`) to the frontend.
3. React hook (`useNfcLearner`) queues scans and resolves learner records.
4. Attendance updates are computed via `@learnlife/shared` and persisted via PocketBase queries.

### Calendar App

Core flow:

1. `lib/pocketbase.ts` initializes PocketBase with persisted auth storage (`pb_auth`).
2. `AuthContext` subscribes to auth state and exposes session/user role data.
3. Expo Router routes consume auth + role state to render learner/guide experiences.
4. Calendar and messaging features call shared query/domain utilities from the workspace packages.

## Commands and Workflows

Root scripts are the default entry point:

- `pnpm dev:nfc` / `pnpm build:nfc`
- `pnpm dev:calendar` / `pnpm build:calendar`
- `pnpm lint` / `pnpm test`

Subtree publishing scripts exist for app-specific downstream repos:

- `pnpm push:nfc`
- `pnpm push:calendar`

## Documentation Strategy

- root `README.md`: onboarding + workspace commands + links
- app READMEs: app-specific setup, testing, structure
- deep topic docs (like updater/user docs): keep inside the app under `apps/<app>/docs`

When adding a new shared package or major cross-app workflow, update this file and root README links.
