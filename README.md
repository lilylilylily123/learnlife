# LearnLife Monorepo

LearnLife is a pnpm workspace monorepo for two production apps that share PocketBase API access and business logic.

- `apps/ll-calendar` — Expo + React Native calendar/messaging app (iOS, Android, Web)
- `apps/nfc-attender` — Next.js + Tauri desktop app for NFC attendance tracking
- `packages/pb-client` — shared PocketBase client, types, constants, and query helpers
- `packages/shared` — shared business logic (attendance, calendar expansion, dates, roles)

PocketBase backend: `https://learnlife.pockethost.io/`

## Prerequisites

- Node.js `>=18`
- pnpm `>=9`

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## Install

```bash
pnpm install
```

## Workspace Commands

Run from the repository root:

```bash
# Development
pnpm dev:nfc
pnpm dev:calendar

# Build
pnpm build:nfc
pnpm build:calendar

# Quality
pnpm lint
pnpm test

# Publish app subtrees
pnpm push:nfc
pnpm push:calendar
pnpm push:all
```

## App Documentation

- Calendar app: [`apps/ll-calendar/README.md`](apps/ll-calendar/README.md)
- NFC Attender app: [`apps/nfc-attender/README.md`](apps/nfc-attender/README.md)
- NFC user docs: [`apps/nfc-attender/docs/USER_GUIDE.md`](apps/nfc-attender/docs/USER_GUIDE.md)
- NFC updater docs: [`apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md`](apps/nfc-attender/docs/AUTO_UPDATER_GUIDE.md)

## Monorepo Architecture

See [`docs/MONOREPO_ARCHITECTURE.md`](docs/MONOREPO_ARCHITECTURE.md) for:

- package responsibilities
- shared-data flows
- key runtime architecture for both apps
- conventions for adding new shared logic
