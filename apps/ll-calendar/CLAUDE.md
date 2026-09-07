# CLAUDE.md — `apps/ll-calendar`

Guidance for AI coding agents working in this app. Human-facing docs:
[`README.md`](README.md) for commands and routes, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for
how and why the pieces fit, [`.full-review/README.md`](.full-review/README.md) for the audit backlog.

**Luminous Scholar** (pnpm package `ll_calendar`) is an Expo + React Native app for iOS, Android and
web. It is the learner/guide surface: calendar, RSVP, messaging, invite registration. It talks to a
hosted PocketBase at `https://learnlife.pockethost.io/`. **The backend is not in this repo.** Do not
propose server-side changes here; the only server code the repo owns is `pb_hooks/`, which is
uploaded by hand.

## Read this before your first edit

Five things about this app will mislead you if you assume the defaults:

1. **Nothing typechecks this app.** No `typecheck` script, `expo lint` is ESLint-only, and the
   `ts-jest` transform sets `diagnostics: false`. `tsc --noEmit` reports **9 pre-existing errors**.
   If you see type errors, they are probably not yours — run `npx tsc --noEmit -p tsconfig.json`
   *before* your change to get a baseline, and compare. Do not "fix" the four route-type errors: they
   come from a stale generated `.expo/types/router.d.ts` and disappear when `pnpm start` regenerates
   it.
2. **Jest only collects `.ts`.** `testMatch` is `**/__tests__/**/*.test.ts`. A `.tsx` test is
   silently never run. If you write the first component test, widen the pattern to
   `**/__tests__/**/*.test.ts?(x)` **in the same change**, and prove the test actually executed.
3. **Most of `components/` and one hook are dead scaffolding.** `create-expo-app` leftovers with zero
   product imports. Do not extend them, do not use them as a style reference, and do not assume
   `ThemedText`/`ThemedView`/`useThemeColor` work — two of those files are the source of the five real
   type errors. The inventory is in
   [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#components-product-versus-scaffolding).
4. **RSVP capacity logic exists twice**, in `lib/pocketbase.ts` and `pb_hooks/event_rsvps.pb.js`, and
   the two disagree about whether `status` on the wire is *intent* or *final state*. Do not touch
   either side without reading
   [the analysis](docs/ARCHITECTURE.md#the-rsvp-divergence-client-and-server-both-enforce-capacity).
   The stale comment in `submitRsvp` claiming hooks cannot run is wrong.
5. **`pnpm reset-project` deletes the application.** Never run it. Never suggest it.

## Commands

Run from `apps/ll-calendar`. Install from the repo root — this is a pnpm workspace with three
`workspace:*` dependencies.

```bash
pnpm start                              # Expo dev server (also regenerates .expo/types)
pnpm ios | pnpm android | pnpm web      # dev server + that target
pnpm lint                               # expo lint (ESLint 9 flat config)
pnpm test                               # TZ=UTC jest — 1 file, 27 cases
npx tsc --noEmit -p tsconfig.json       # the only typecheck; not a script, not in CI
npx expo export --platform web          # the web build → dist/ (no `build` script exists)
```

There is no `build` script, so `pnpm build:calendar` from the repo root fails. Do not add the script
without being asked — it is a real gap, documented as one, and the owner's decision.

## Invariants — do not break these

| Invariant | Why |
|---|---|
| Exactly one PocketBase client. | `lib/pocketbase.ts` exports the singleton `pb`. Never construct a `PocketBase` or an auth store anywhere else — a second client means a second auth store and a split session. |
| Screens never import `@learnlife/pb-client` for *queries*. | Add a singleton-bound wrapper to `lib/pocketbase.ts` and call that. Importing *types* from `@learnlife/pb-client` in a screen is fine and common. |
| Never write a PocketBase filter with string interpolation. | Use `pb.filter("field = {:name}", { name })`. Filter injection was a real CVSS-8.6 finding here and was fixed everywhere; do not reintroduce it. Filters belong in `packages/pb-client`, not in this app. |
| Never surface a raw PocketBase error to the user. | Route it through `mapPbError` / `mapLoginError` / `mapInviteError` in `lib/errors.ts`. PB bodies leak schema and field details. |
| `mapLoginError` must keep collapsing 400/401/403 into one string. | Distinguishing wrong-email from wrong-password is account enumeration. Same reason `forgot-password.tsx` has a 600 ms delay floor and one fixed confirmation message — do not remove either. |
| Never use `dangerouslySetInnerHTML`. | `react/no-danger` is an ESLint **error**, because the web CSP allows `script-src 'unsafe-inline'`. The lint rule is the compensating control for that CSP. If you change one, reason about the other. |
| Auth-store platform split stays intact. | `expo-secure-store` on native, `localStorage` on web, and the AsyncStorage→SecureStore one-shot migration. Removing the migration signs out every user who has not opened the app since it landed. |
| The EventSource polyfill stays at the very top of `app/_layout.tsx`, using `require`. | It must be installed before `lib/pocketbase.ts` is evaluated. ES `import`s are hoisted and would run too late. The 5-minute `heartbeatTimeout` is deliberate — PocketBase's SSE pings are too sparse for the library's 45 s default. |
| Role gates are UX, not security. | `role === "lg" \|\| role === "admin"` in a screen hides a button. It does not protect data — PocketBase collection rules do. Never describe a client-side role check as an authorization fix. |
| `makeDateKey`'s unpadded `"2026-4-12"` format is load-bearing. | Pinned by tests, and `dateKeyToOccurrenceDate` converts it to the padded `YYYY-MM-DD` that RSVP rows require. Changing it is a data-format migration, not a tidy-up. |

## Conventions

- **Styling: `StyleSheet.create()` only.** No CSS-in-JS, no styled-components, no Tailwind. Every
  screen ends with a `const s = StyleSheet.create({...})`. Match that, including the local name `s`
  (the scaffolding files use `styles`; follow the file you are in).
- **Colours and fonts come from `@/constants/theme`** — `import { Colors, Fonts } from "@/constants/theme"`.
  Never hardcode a hex literal in new code. `constants/theme.ts` is the only file that may import
  `@learnlife/design-tokens`. Note `Colors` is **light-only**; there is no dark variant to reach for,
  and `T`/`c` are exported but unused.
- **Path alias `@/*` maps to the app root** (`tsconfig.json`). The codebase is inconsistent — some
  files use `@/lib/pocketbase`, others `../../lib/pocketbase`. Prefer `@/`; do not churn existing
  imports just to normalise them.
- **Platform-specific files** use `.ios.tsx` / `.web.ts` suffixes, and only when the *implementations*
  differ (`use-color-scheme.web.ts`, `icon-symbol.ios.tsx`). When only a *value* differs, branch
  inline with `Platform.OS` / `Platform.select` — that is what the rest of the app does.
- **Route groups**: `(tabs)` is a real navigator (it has a `_layout.tsx`); `(modals)` is naming only —
  modal presentation is declared per-screen in the root `Stack`. A new modal needs a `Stack.Screen`
  entry in `app/_layout.tsx` with `presentation: "modal"`, or it renders as a plain pushed screen with
  a header (which is exactly what happened to `change-password`).
- **Data loading in screens**: `useFocusEffect(useCallback(…))` with a `cancelled` flag and a
  `hasLoaded` boolean, so a refetch keeps the previous render visible and only the first load shows a
  spinner. Copy that shape.
- **Expo experiments are on**: `typedRoutes` (route strings are typed from the file tree — a new
  route needs `pnpm start` to regenerate types) and `reactCompiler` (the React Compiler auto-memoises;
  do not add `useMemo`/`useCallback` purely for render performance, only where a stable identity is
  semantically required, e.g. effect dependencies).
- **TypeScript `strict` is on** in `tsconfig.json`. Honour it in new code even though nothing checks
  it. Do not add new `catch (e: any)` — there are already eight and they are a logged finding.
- **No emoji in code comments or docs.** Emoji *in UI copy* is existing product style
  (`"You're going 🎉"`, the emoji picker) — leave that alone.

## What must stay in sync with `packages/`

This app owns no domain logic. If you find yourself writing a date, calendar, role or RSVP rule here,
it belongs in `packages/shared` instead.

| Concern | Lives in | This app's relationship |
|---|---|---|
| Calendar expansion, date parsing/formatting | `packages/shared` (`expandEvents`, `parsePBDate`, `formatTimeRange`, `makeDateKey`, `dateKeyToOccurrenceDate`) | `lib/calendar-utils.ts` is a **pure re-export shim with no logic**. Never add logic to it. Note `lib/pocketbase.ts` also re-exports `expandEvents`, so two import paths reach the same function. |
| RSVP decisions | `packages/shared` (`computeRsvpAction`, `promoteFromWaitlist`, `countRsvps`) | Called from `lib/pocketbase.ts` and `event-detail.tsx`. The pure functions are tested in `packages/shared`; the orchestration here is not tested at all. |
| Role predicates | `packages/shared` (`isGuide`, `isAdmin`, `isLearner`) | **Currently duplicated.** Five screens inline `role === "lg" \|\| role === "admin"`, which is byte-for-byte what `isGuide()` does. Use `isGuide(role)` in new code. |
| Queries, filters, PB types, `PB_URL` | `packages/pb-client` | Reached only through `lib/pocketbase.ts` wrappers (queries) or direct type imports (types). |
| Design tokens | `packages/design-tokens` | Only `constants/theme.ts` imports it. |
| Attendance | `packages/shared` (`deriveStatus`, `computeCheckInAction`, …) | **Not used by this app at all.** Attendance belongs to `apps/nfc-attender` and the firmware. Do not import it here. |

Repo-wide caution: the attendance rule is implemented three times — `packages/shared/src/attendance.ts`,
a hand-duplicated `deriveStatus` in `packages/pb-client/src/queries/attendance.ts`, and a C++ port in
`apps/nfc-attender-fw/src/state_machine.cpp` — with nothing in CI comparing them. That does not touch
this app, but if you are asked to change attendance logic, all three need it.

## Testing guidance

`pnpm test` runs one file. Before adding tests, know the constraints:

- Only `**/__tests__/**/*.test.ts` is collected. `.tsx` is not. (See invariant 2 above.)
- `moduleNameMapper` resolves `@learnlife/*` to package **source**, and `pocketbase` to
  `__mocks__/pocketbase.ts` — a 13-line stub whose `collection()` returns empty lists. Anything
  data-dependent needs a better fake, which does not exist yet.
- `TZ=UTC` is set in the test script. Any test involving dates must assume UTC and must not read the
  host timezone.
- Highest-value untested surfaces, in order: `lib/errors.ts` (pure, trivial), the RSVP orchestration
  in `lib/pocketbase.ts`, `AuthContext`. Screens need the `testMatch` fix first.

## Scope boundaries

- Do not edit `packages/*`, `pb_hooks/`, `.github/`, root `docs/`, or other apps from a task scoped to
  this app. Report cross-cutting problems instead of fixing them here.
- `.expo/`, `dist/`, `expo-env.d.ts`, `/ios`, `/android` are generated and gitignored. Never
  hand-edit; never commit.
- `stitch/*.html` are stale Google Stitch mockups with an obsolete palette. They are not a design
  spec and not runtime code. Do not implement against them without checking with the owner.
- `.full-review/` is a historical audit. Update `.full-review/README.md` if a finding's status
  changes; do not edit the phase files themselves — they are a record of what was found in April.
