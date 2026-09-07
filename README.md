# LearnLife Monorepo

LearnLife is a pnpm workspace monorepo for the apps that share PocketBase API access and business logic.

- `apps/ll-calendar` — Expo + React Native calendar/messaging app (iOS, Android, Web)
- `apps/nfc-attender` — Next.js + Tauri desktop app; the attendance **dashboard** (history, justifications, bulk edits, CSV export)
- `apps/nfc-attender-fw` — ESP32 firmware for the standalone tap terminal. **Not a pnpm package** — it is a PlatformIO/C++ project excluded from the workspace, driven with `pio` from inside its own directory
- `packages/pb-client` — shared PocketBase client, types, constants, and query helpers
- `packages/shared` — shared business logic (attendance, calendar expansion, dates, roles)
- `packages/design-tokens` — shared colour/spacing/type tokens

PocketBase backend: `https://learnlife.pockethost.io/`

## Prerequisites

- Node.js `>=20`
- pnpm `>=10`

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
pnpm typecheck      # tsc --noEmit across packages/* — the only check that covers them

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
- NFC firmware: [`apps/nfc-attender-fw/README.md`](apps/nfc-attender-fw/README.md)
- NFC firmware hardware/assembly: [`apps/nfc-attender-fw/hardware/README.md`](apps/nfc-attender-fw/hardware/README.md)

## Monorepo Architecture

See [`docs/MONOREPO_ARCHITECTURE.md`](docs/MONOREPO_ARCHITECTURE.md) for:

- package responsibilities
- shared-data flows
- key runtime architecture for both apps
- conventions for adding new shared logic
