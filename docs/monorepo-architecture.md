# LearnLife Monorepo Architecture

## Workspace layout

LearnLife uses a pnpm workspace:

- `apps/ll-calendar` — Expo mobile/web app
- `apps/nfc-attender` — Next.js + Tauri desktop app
- `packages/pb-client` — PocketBase client factory, types, query modules, retry helpers
- `packages/shared` — pure domain logic shared by both apps

`pnpm-workspace.yaml` includes `apps/*` and `packages/*`.

## Shared package responsibilities

### `@learnlife/pb-client`

- Holds central app types (`Learner`, `AttendanceRecord`, calendar/message types)
- Exposes query modules per domain (`auth`, `learners`, `attendance`, `calendar`, `messages`, `invites`)
- Defines shared constants (`PB_URL`, time thresholds, status values)
- Provides retry utilities for PB operations

### `@learnlife/shared`

- `attendance.ts` — state machine for check-in/check-out/lunch transitions
- `calendar.ts` — recurring event expansion
- `date-utils.ts` — date parsing/formatting helpers
- `roles.ts` — role predicates and role-based helpers

These modules are intentionally side-effect free so both apps can share behavior consistently.

## App integration model

Both apps consume the same PocketBase backend and import shared logic from workspace packages.

- Each app creates or binds its own PocketBase singleton.
- App-level wrappers keep feature code simple and isolate UI from low-level query details.
- Shared business rules (attendance, date handling, roles) stay in `packages/shared` to avoid drift.

## Key runtime flows

### NFC attendance (desktop app)

1. Rust layer reads NFC UID from hardware.
2. Tauri emits UID to frontend.
3. Frontend hook queues scans to process serially.
4. Learner lookup + attendance transition are computed.
5. Attendance record is updated in PocketBase.

### Calendar/auth flow (Expo app)

1. PocketBase client is initialized with persisted auth store.
2. Auth context subscribes to PocketBase auth changes.
3. Route-level screens consume context and query data via shared client helpers.
4. Calendar and messaging screens read/write PocketBase data through package queries.

## Build and delivery model

### ll-calendar

- Expo project using Expo Router.
- Supports iOS, Android, and Web targets.
- Uses Jest (`ts-jest`) for tests.

### nfc-attender

- Next.js frontend is statically exported (`output: "export"`).
- Tauri bundles the generated frontend (`out/`) with Rust backend.
- Uses Vitest for frontend tests.
- Includes updater configuration for GitHub release artifacts.

## Operational notes

- Root scripts provide shared workflows (`dev:*`, `build:*`, `lint`, `test`).
- Subtree push scripts support splitting app directories into separate repos when needed.
- Existing app-specific docs:
  - `apps/nfc-attender/README_SCHEDULER.md`
  - `apps/nfc-attender/docs/USER_GUIDE.md`
