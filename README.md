# LearnLife Monorepo

LearnLife is a pnpm workspace monorepo for two production apps backed by PocketBase:

- `apps/ll-calendar` — Expo + React Native calendar and messaging app (iOS/Android/Web)
- `apps/nfc-attender` — Next.js + Tauri desktop app for NFC-based attendance
- `packages/pb-client` — shared PocketBase client, types, and query modules
- `packages/shared` — shared business logic (attendance state machine, calendar expansion, date utils, roles)

PocketBase host used by both apps: `https://learnlife.pockethost.io/`.

## Prerequisites

- Node.js `>=18`
- pnpm `>=9` (repo currently works with pnpm 10)
- Rust + Tauri prerequisites (only for NFC desktop builds)
- Xcode/Android tooling if running native Expo targets

## Quick start

```bash
git clone https://github.com/lilylilylily123/learnlife.git
cd learnlife
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
```

## Workspace commands

```bash
# Development
pnpm dev:calendar    # Expo dev server for ll-calendar
pnpm dev:nfc         # Tauri dev mode for nfc-attender

# Quality
pnpm lint            # Lint all workspaces
pnpm test            # Run all workspace tests

# Builds
pnpm build:calendar  # Expo build
pnpm build:nfc       # Tauri production build
```

## Package-level commands

```bash
pnpm --filter ll_calendar start
pnpm --filter ll_calendar test

pnpm --filter nfc-attender dev
pnpm --filter nfc-attender test
pnpm --filter nfc-attender tauri:dev
```

## Repository structure

```text
apps/
  ll-calendar/
  nfc-attender/
packages/
  pb-client/
  shared/
```

## Architecture summary

- `packages/pb-client` centralizes PocketBase types + query functions (`auth`, `learners`, `attendance`, `calendar`, `messages`, `invites`).
- `packages/shared` contains pure business logic used by both apps.
- `apps/nfc-attender` receives NFC scan events from Rust/Tauri, resolves learner data, then applies attendance transitions using shared logic.
- `apps/ll-calendar` handles auth/session persistence and provides calendar + messaging UIs using the shared PB client.

For deeper details, see:

- `/docs/monorepo-architecture.md`
- `/apps/ll-calendar/README.md`
- `/apps/nfc-attender/README.md`
