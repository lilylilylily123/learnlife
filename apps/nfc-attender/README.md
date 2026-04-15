# NFC Attender (`nfc-attender`)

Desktop attendance app that reads NFC cards and writes attendance events to PocketBase.

## Tech Stack

- Next.js App Router frontend (`src/app`)
- Tauri 2 desktop shell + Rust NFC integration (`src-tauri`)
- TypeScript (strict) + Vitest
- Shared API/domain packages: `@learnlife/pb-client`, `@learnlife/shared`

## Run Locally

From monorepo root:

```bash
pnpm install
pnpm dev:nfc
```

From this app directory:

```bash
pnpm install
pnpm tauri:dev
```

## Build

From monorepo root:

```bash
pnpm build:nfc
```

From app directory:

```bash
pnpm tauri:build
pnpm tauri:build:windows
```

## Quality Commands

From app directory:

```bash
pnpm lint
pnpm test
```

From monorepo root:

```bash
pnpm --filter nfc-attender lint
pnpm --filter nfc-attender test
```

## Key Structure

- `src/app/hooks/useNfcLearner.ts` — listens for `nfc-scanned` events and processes scans
- `src/app/utils/` — attendance write/update helpers
- `src/app/pb.ts` — PocketBase singleton setup for the frontend
- `src-tauri/src/main.rs` — NFC reader polling + Tauri event emission
- `docs/` — end-user and updater documentation

## Data Flow (High-Level)

1. Rust backend polls NFC reader and emits `nfc-scanned` events.
2. Frontend hook resolves card UID to learner.
3. Attendance transitions are computed via shared logic (`computeCheckInAction`).
4. PocketBase records are created/updated.

## Related Docs

- User guide: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
- Auto-updater setup: [`docs/AUTO_UPDATER_GUIDE.md`](docs/AUTO_UPDATER_GUIDE.md)
- Scheduler notes: [`README_SCHEDULER.md`](README_SCHEDULER.md)
- Monorepo architecture: [`../../docs/MONOREPO_ARCHITECTURE.md`](../../docs/MONOREPO_ARCHITECTURE.md)
