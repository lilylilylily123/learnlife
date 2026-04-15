# LearnLife Calendar App (`apps/ll-calendar`)

Expo + React Native app for learners and guides, including calendar views, inbox, and role-based flows.

> Package name in `package.json`: `ll_calendar`

## Tech Stack

- Expo + React Native + Expo Router
- TypeScript (strict)
- PocketBase via `@learnlife/pb-client`
- Shared domain logic via `@learnlife/shared`

## Run Locally

From repo root:

```bash
pnpm install
pnpm dev:calendar
```

Or from this app directory:

```bash
pnpm install
pnpm start
```

Platform targets:

```bash
pnpm android
pnpm ios
pnpm web
```

## Quality Commands

From app directory:

```bash
pnpm lint
pnpm test
```

From monorepo root:

```bash
pnpm --filter ./apps/ll-calendar lint
pnpm --filter ./apps/ll-calendar test
```

## Key Structure

- `app/` — Expo Router routes (tabs, modals, auth/register)
- `context/` — auth and app-level context providers
- `lib/pocketbase.ts` — PocketBase client + auth persistence (`pb_auth`)
- `components/`, `hooks/`, `constants/` — UI and feature modules
- `__tests__/` — Jest/ts-jest tests

## Auth & Data Notes

- Auth store is persisted (AsyncStorage/native, localStorage/web) under key `pb_auth`.
- Role and shared logic are consumed from `@learnlife/shared`.
- API types and query helpers come from `@learnlife/pb-client`.

## Related Docs

- Monorepo overview: [`../../README.md`](../../README.md)
- Architecture details: [`../../docs/MONOREPO_ARCHITECTURE.md`](../../docs/MONOREPO_ARCHITECTURE.md)
