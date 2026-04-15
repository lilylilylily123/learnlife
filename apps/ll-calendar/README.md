# ll-calendar

`ll-calendar` is the LearnLife Expo app for calendar, messaging, and learner-facing workflows.

## Tech stack

- Expo + React Native + Expo Router
- TypeScript
- PocketBase via `@learnlife/pb-client`
- Shared domain logic from `@learnlife/shared`

## Run locally

From repository root:

```bash
pnpm install
pnpm dev:calendar
```

Or directly in this app:

```bash
pnpm --filter ll_calendar start
```

Platform shortcuts:

```bash
pnpm --filter ll_calendar android
pnpm --filter ll_calendar ios
pnpm --filter ll_calendar web
```

## Quality checks

```bash
pnpm --filter ll_calendar lint
pnpm --filter ll_calendar test
```

## App structure

- `app/` — Expo Router routes (tabs, modals, register flow)
- `context/AuthContext.tsx` — auth state + user role context
- `lib/pocketbase.ts` — PocketBase singleton + auth store persistence (`pb_auth`)
- `components/`, `hooks/`, `constants/` — shared UI and utilities

## Auth and data flow

1. `lib/pocketbase.ts` creates a PocketBase client.
2. Auth state is persisted to `pb_auth` (web localStorage / native AsyncStorage).
3. `AuthContext` subscribes to auth changes and exposes `user`, `role`, and auth actions.
4. Screens call `@learnlife/pb-client` query helpers for learners, calendar, invites, and messages.

## Related docs

- Monorepo overview: `/README.md`
- Architecture details: `/docs/monorepo-architecture.md`
