# nfc-attender

`nfc-attender` is the LearnLife desktop attendance app.  
It combines Next.js UI + Tauri (Rust) NFC scanning to track learner check-in, lunch, and check-out events.

## Tech stack

- Next.js (App Router) frontend
- Tauri 2 desktop shell
- Rust NFC scanning (`pcsc`) in `src-tauri/`
- PocketBase access via `@learnlife/pb-client`
- Attendance decision logic via `@learnlife/shared`

## Run locally

From repository root:

```bash
pnpm install
pnpm dev:nfc
```

From this app:

```bash
pnpm --filter nfc-attender tauri:dev
```

## Build

```bash
pnpm build:nfc
```

Windows cross-build helper:

```bash
pnpm --filter nfc-attender tauri:build:windows
```

## Quality checks

```bash
pnpm --filter nfc-attender lint
pnpm --filter nfc-attender test
```

## App structure

- `src/app/` — Next.js pages/components/hooks
- `src/lib/pb-client.ts` — app-bound PocketBase query wrappers
- `src/app/hooks/useNfcLearner.ts` — scan listener + queue processing
- `src/app/utils/utils.ts` — attendance write/update workflow
- `src-tauri/src/main.rs` — NFC reader polling + Tauri event emission

## NFC attendance flow

1. Rust background thread polls the NFC reader.
2. Card UID is emitted to frontend as `nfc-scanned`.
3. React hook resolves UID to learner and invokes check-in workflow.
4. Shared attendance state logic computes next action.
5. PocketBase attendance record is updated.

## Related docs

- Scheduler jobs: `/apps/nfc-attender/README_SCHEDULER.md`
- User onboarding: `/apps/nfc-attender/docs/USER_GUIDE.md`
- Monorepo architecture: `/docs/monorepo-architecture.md`
