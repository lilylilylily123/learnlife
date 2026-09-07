# Luminous Scholar (`apps/ll-calendar`)

The learner- and guide-facing app: a month calendar, per-day event lists, RSVP with capacity and
waitlist, one-to-one messaging, and invite-code registration. It is an Expo + React Native app that
ships to **iOS, Android and web from one codebase**, and it talks to the hosted PocketBase at
`https://learnlife.pockethost.io/` — there is no backend in this repo. Every screen is a thin view
over PocketBase collections; all authorization that actually matters lives in PocketBase collection
rules, not here. This app is the *participant* surface. Attendance history, justifications and CSV
export live in the separate dashboard, [`apps/nfc-attender`](../nfc-attender/), and tap-in happens on
the [ESP32 terminal](../nfc-attender-fw/).

The display name is **Luminous Scholar** (`app.json` → `expo.name`). The pnpm package name is
`ll_calendar`, which is what `pnpm --filter` wants. The deep-link scheme is `llcalendar://`.

| | |
|---|---|
| pnpm package | `ll_calendar` |
| Expo slug | `ll_calendar` |
| URL scheme | `llcalendar://` |
| Expo SDK | 54 (`expo ~54.0.33`) |
| React Native | 0.81.5, React 19.1.0, new architecture on |
| Router | Expo Router 6, file-based, `typedRoutes` experiment on |
| Backend | hosted PocketBase, `PB_URL` from `@learnlife/pb-client` |
| Mirror remote | subtree-pushed to `github.com/lilylilylily123/ll_calendar` (`pnpm push:calendar` from the root) |

## Who uses it, in which role

`role` comes from the PocketBase `users` record and is surfaced by `useAuth()`. There are three
values; the app only ever distinguishes "guide-ish" (`lg` or `admin`) from `learner`.

| Role | Value | What they get |
|---|---|---|
| Learner | `learner` | Calendar of events visible to their program plus their own private classes; can add/edit their own `type: "class"` records; RSVP to events; message only guides and admins. |
| Learning guide | `lg` | Everything a learner has, plus create/edit/delete `type: "event"` records with program targeting and RSVP config, view event rosters, create invite codes, and message anyone. |
| Admin | `admin` | Identical to `lg` in this app — every gate is `role === "lg" \|\| role === "admin"`. There is no admin-only screen. |

A learner's `program` (`chmk` / `cre` / `exp`) is fetched separately by `AuthContext` from the
`learners` collection and is display-only in this app — the program-based visibility filter is
enforced by the PocketBase list rule, not the client. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#auth-flow-exactly-what-happens).

## Prerequisites

| Requirement | Why / where pinned |
|---|---|
| Node >= 20 | root `package.json` → `engines`; CI uses Node 22 |
| pnpm >= 10 | root `package.json` → `packageManager: pnpm@10.33.0` |
| Xcode + an iOS simulator | only for `pnpm ios` |
| Android Studio + an emulator (or a device) | only for `pnpm android` |

Install once from the **repo root** — this is a pnpm workspace and the app depends on three
`workspace:*` packages, so installing inside `apps/ll-calendar` alone will not link them:

```bash
# from the repo root
pnpm install
```

There are no environment variables. The PocketBase URL is a compile-time constant in
[`packages/pb-client/src/constants.ts`](../../packages/pb-client/src/constants.ts), not an env var,
so there is nothing to configure before first run.

`/ios` and `/android` are gitignored, and there is no `eas.json`. Nothing in the repo pins how a
native binary is produced — any native build starts from `expo prebuild`, and whether the two native
dependencies (`expo-secure-store`, `@react-native-community/datetimepicker`) work under Expo Go
versus requiring a development build is **not verifiable from the repo**. The Metro dev server
(`pnpm start`) and the web target need no native toolchain at all.

## Scripts

Run these from `apps/ll-calendar` unless noted.

| Command | What it does |
|---|---|
| `pnpm start` | Expo dev server; press `i`/`a`/`w` to open a target. |
| `pnpm ios` | `expo start --ios` — dev server plus iOS simulator. |
| `pnpm android` | `expo start --android` — dev server plus Android emulator. |
| `pnpm web` | `expo start --web` — dev server plus browser, `react-native-web`. |
| `pnpm lint` | `expo lint` (ESLint 9 flat config). |
| `pnpm test` | `TZ=UTC jest` — see [Testing](#testing-two-files) for what this does and does not cover. |
| `pnpm typecheck` | `tsc --noEmit`. Also runs in `calendar-test.yml`. |
| `pnpm build` | `expo export --platform web` → `dist/`. See below. |

From the repo root:

```bash
pnpm dev:calendar                            # == pnpm --filter ll_calendar start
pnpm --filter ll_calendar lint
pnpm --filter ll_calendar typecheck
pnpm --filter ll_calendar test
pnpm build:calendar                          # == pnpm --filter ll_calendar build
```

### The web build

`pnpm build` is Expo's static web export:

```bash
# from apps/ll-calendar
pnpm build          # expo export --platform web
```

Verified: exit 0 in ~10 s, writing `dist/`. `app.json` sets `web.output: "static"`, which
is what makes this a directory of prerendered HTML rather than a single-page bundle — one `.html`
per route plus `_expo/` and `assets/`. Two details worth knowing:

- **`public/` is copied verbatim into `dist/`**, so `public/_headers` ships with the site as
  `dist/_headers`. Confirmed in the export output.
- **Each grouped route is emitted twice**, once ungrouped and once grouped — `dist/chat.html` *and*
  `dist/(modals)/chat.html`. That is the route-group convention showing through into the output; see
  [the routing section](docs/ARCHITECTURE.md#routing-and-the-expo-router-group-conventions). Expo
  Router also generates `+not-found.html` and `_sitemap.html`.

CI still does not exercise the export, so a change that breaks the web build lands green; the
script at least makes the command discoverable and fixes the root `build:calendar` shortcut.

## Running on each platform

```bash
cd apps/ll-calendar

pnpm ios       # iOS simulator
pnpm android   # Android emulator
pnpm web       # browser at the URL Metro prints
```

Platform differences that will bite you:

- **Auth token storage differs by platform.** Web uses `localStorage`; native uses the OS keystore
  via `expo-secure-store`, with a one-shot migration out of the legacy AsyncStorage entry. Details in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#auth-flow-exactly-what-happens).
- **Realtime messaging needs an `EventSource` polyfill on native.** `app/_layout.tsx` installs
  `event-source-polyfill` with a 5-minute heartbeat timeout before any other import, because
  PocketBase's SSE pings are not frequent enough for the library's 45 s default and the app filled
  with spurious "Reconnecting" errors.
- **Date/time pickers behave differently.** iOS renders the native `compact` inline control; Android
  needs an explicitly-opened modal. `create-event.tsx` branches on `Platform.OS` for this.
- **Colour scheme detection is split** — `hooks/use-color-scheme.web.ts` defers to `'light'` until
  hydration so static web rendering does not mismatch.

## Routes

Expo Router maps files under `app/` to routes. Two conventions matter here:

- A directory in parentheses — `(tabs)`, `(modals)` — is a **route group**. It organises files and
  can carry its own `_layout.tsx`, but it contributes **no URL segment**. `app/(modals)/chat.tsx` is
  the route `/chat`.
- `_layout.tsx` is not a route; it is the wrapper for everything beneath it.

Every route below is reachable by any signed-in user unless the "Gate" column says otherwise. The
gates are client-side only — the real enforcement is the PocketBase collection rules.

| File | Route | What it shows | Gate |
|---|---|---|---|
| `app/_layout.tsx` | — | Root layout: EventSource polyfill, `AuthProvider`, navigation `ThemeProvider`, the `Stack` and its modal presentations. | — |
| `app/(tabs)/_layout.tsx` | — | `Tabs` navigator with the native tab bar hidden (`tabBarStyle: display: "none"`). | — |
| `app/(tabs)/index.tsx` | `/` | Signed out: the sign-in form. Signed in: the dashboard — greeting, a "Needs you" card (unread conversation count, plus a guide-only "Manage invites" row), and today's timeline. | Switches on `isAuthenticated` |
| `app/(tabs)/calendar.tsx` | `/calendar` | Month grid (Monday-first) with up to three coloured event dots per day, plus the selected day's event list and a create FAB. | `Redirect` to `/` if not authenticated |
| `app/(tabs)/inbox.tsx` | `/inbox` | Conversation list split into unread and read. Unread means "the last message was not sent by me". | `Redirect` to `/` if not authenticated |
| `app/(modals)/event-detail.tsx` | `/event-detail` | One event or class: type pill, time, RSVP block (counts, Going / Not going, waitlist position, clear), guide-only roster link, and Edit/Delete for the owner or any guide. | Edit/Delete need `isGuide \|\| isOwner` |
| `app/(modals)/create-event.tsx` | `/create-event` | Create **or** edit (pass `recordId`). Guides get program targeting, RSVP config (capacity, waitlist, deadline) and weekly recurrence, and write `type: "event"`. Learners get title/emoji/colour/schedule only, and write `type: "class"`. | Form branches on `isGuide`; the screen itself is not gated |
| `app/(modals)/event-roster.tsx` | `/event-roster` | Going / Waitlist / Not going tabs for one occurrence, waitlist ordered by `position`. | Renders "for guides only" to non-guides |
| `app/(modals)/chat.tsx` | `/chat` | One conversation: message bubbles, realtime subscription, read receipts on open and on each inbound message. | — |
| `app/(modals)/new-conversation.tsx` | `/new-conversation` | Debounced user search; reuses an existing direct conversation if one exists rather than creating a duplicate. | Learners see only `lg`/`admin` results (client-side filter) |
| `app/(modals)/manage-invites.tsx` | `/manage-invites` | Invite list, learner search, invite creation, and the generated 6-character code. | Renders "no permission" to non-guides |
| `app/register.tsx` | `/register` | Two-step invite redemption: verify a 6-character code, then set a password (min 8). Signs in on success. | Public |
| `app/forgot-password.tsx` | `/forgot-password` | Password-reset request. Always shows the same confirmation, with a 600 ms floor, so the response cannot be used to enumerate accounts. | Public |
| `app/change-password.tsx` | `/change-password` | Old + new password. PocketBase invalidates other sessions and `@learnlife/pb-client` re-authenticates this one. | Public route, but the call needs a session |
| `app/settings.tsx` | `/settings` | Profile card with role and program badges, change-password link, reset-email link, log out. | — |

Two navigation quirks worth knowing before you edit `_layout.tsx`:

- **`settings` is presented as a modal but lives outside `(modals)`.** The `presentation: "modal"`
  option is set per-screen in the root `Stack`, not by the folder name, so the folder and the
  presentation style are independent.
- **`change-password` is the only route not declared in the root `Stack`.** It therefore renders with
  the default stack header instead of the header-less treatment every other screen gets.

The visible bottom bar is **not** the Expo tab bar. `(tabs)/_layout.tsx` hides the real one and each
tab screen renders `components/bottom-nav.tsx`, which navigates with `router.replace` so switching
tabs does not grow the back stack. The rationale and the cost of this choice are in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#navigation-two-tab-bars-one-visible).

## Deployment

The only deployment artefact in the repo is HTTP response headers for the **web** target. There is
no native release pipeline here: no `eas.json`, no fastlane, no store metadata.

`vercel.json` sets one header block for `/(.*)`:

| Header | Value / effect |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` — two years, preload-eligible. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment and USB all denied — the app uses none of them. |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'`, with `connect-src` opened to `https://learnlife.pockethost.io` **and** `wss://learnlife.pockethost.io` (the second is required for PocketBase realtime), `img-src` opened to the same host plus `data:`/`blob:` for PocketBase-served avatars, `frame-ancestors 'none'`, `object-src 'none'`. |

`script-src` and `style-src` both allow `'unsafe-inline'`, which is what makes the CSP weaker than it
looks: an injected `<script>` in the page would execute. That is the reason
`eslint.config.js` sets `react/no-danger` and `react/no-danger-with-children` to `error` — with
`'unsafe-inline'` in play, `dangerouslySetInnerHTML` on PocketBase-supplied strings is the realistic
XSS path, so the lint rule is the compensating control. Do not relax either one without the other.

`public/_headers` is the **same policy** expressed in the Netlify / Cloudflare Pages `_headers`
format, plus cache rules: `.js`, `.css` and `/assets/*` get `max-age=31536000, immutable`, while
`.html` gets `no-cache` so a deploy rolls out immediately. Vercel ignores `_headers`; Vercel-only
readers should note the cache directives exist **only** in `_headers`, so on Vercel the caching is
whatever the platform defaults to. `public/` is Expo's static-asset directory and its contents are
copied into the export output — verified: an `expo export --platform web` run produced
`dist/_headers`.

The build command is [`pnpm build`](#the-web-build) (`expo export --platform web`), verified
working. What is **not** verifiable from the repo: which host actually serves the result, whether
that host is configured to run that command, and whether the project root is `apps/ll-calendar` or
the standalone mirror repo. There is no `.vercel/` directory and no CI deploy step — the
`vercel.json` filename is the only evidence pointing at Vercel at all.

## Testing: two files

`__tests__/calendar-utils.test.ts` — 27 cases in 9 `describe` blocks, all covering `expandEvents`,
`makeDateKey` and `formatTimeRange`, which since the shim refactor live in `@learnlife/shared`, not
in this app. The suite is genuinely good where it reaches: it pins the Monday-first weekday
convention, PocketBase's space-separated datetime format, `recurrence_days` being
`undefined`/`null`/`[]`, the `recurrence_end` inclusive boundary, and composite occurrence IDs.
`TZ=UTC` is set in the test script so date arithmetic does not depend on the developer's locale.

`__tests__/rsvp-errors.test.ts` — 13 cases over `mapRsvpError`. Since the client stopped computing
capacity, that function is the entire user-facing feedback for RSVP failures, so it pins each
distinct hook rejection, that an unrecognised body is not echoed, and that the client-only guards
(plain `Error`s with no `status`) are not misreported as network failures. See
[the RSVP section](docs/ARCHITECTURE.md#rsvp-the-server-owns-capacity-the-client-sends-intent).

Everything else is untested. Notably:

| Untested | Why it matters |
|---|---|
| RSVP submit orchestration | The `not_going` guards in `submitRsvp` are the only enforcement of `rsvp_enabled` / `rsvp_deadline` on withdrawal — the hook skips both on that path. Testing them needs a PocketBase fake that does not exist yet. Capacity and waitlist themselves are server-owned and tested nowhere, since `pb_hooks/` has no tests. |
| `AuthContext` | Token expiry, role derivation, the program fetch. |
| Every screen | No render test exists for any route. |
| `lib/errors.ts` beyond `mapRsvpError` | `mapPbError`, `mapLoginError` and `mapInviteError` are pure status→string tables; trivially testable, untested. |

### `testMatch` collects `.ts` and `.tsx`

`package.json` sets:

```json
"testMatch": [
  "**/__tests__/**/*.test.ts",
  "**/__tests__/**/*.test.tsx"
]
```

It used to be `.ts` only, which meant a component test written as `__tests__/event-detail.test.tsx`
was silently never collected — Jest reported success on the one existing file and nobody noticed the
new test never ran. Both extensions are collected now.

`moduleNameMapper` already points `@learnlife/*` at package **source** (not build output) and maps
`pocketbase` to `__mocks__/pocketbase.ts`, a 13-line stub that returns empty lists — so unit tests
never hit the network, but also cannot exercise anything data-dependent without a better fake.

### What CI runs

[`.github/workflows/calendar-test.yml`](../../.github/workflows/calendar-test.yml) runs on pushes and
PRs to `main` that touch `apps/ll-calendar/**`, `packages/**`, or the workspace/lock/root manifests.
On Node 22 with pnpm it does four things:

1. `pnpm --filter ll_calendar lint`
2. `pnpm -r --filter "./packages/*" typecheck`
3. `pnpm --filter ll_calendar typecheck`
4. `pnpm --filter ll_calendar test`

### TypeScript enforcement

`pnpm typecheck` (`tsc --noEmit`) is step 3 above and is the only layer that sees types: `expo lint`
is ESLint-only and the `ts-jest` transform sets `"diagnostics": false`, so type errors are invisible
during test runs — `ts-jest` is being used purely as a transpiler.

`tsc --noEmit` reports **zero errors** today. It used to report nine: five real ones where
`hooks/use-theme-color.ts` and `components/ui/collapsible.tsx` indexed a `Colors.light` /
`Colors.dark` this app's `constants/theme.ts` never had — both now read `T.colors[theme]`, which is
the real light/dark pair — and four route-string errors, of which one was a stale
`.expo/types/router.d.ts` artefact and three were genuine (`"/(tabs)/"` with a trailing slash is not
a route expo-router emits; it is `"/(tabs)"`).

`.expo/types/router.d.ts` is generated and gitignored, so it does not exist in CI and the route
strings are only checked locally, after `pnpm start` has regenerated it. A stale copy reports false
errors for routes that do exist — regenerate before believing one.

## Repository layout

| Path | Contents |
|---|---|
| `app/` | Expo Router routes. See the [route table](#routes). |
| `components/` | UI. `bottom-nav.tsx` is the only one the product actually uses; the rest is `create-expo-app` scaffolding — [audited here](docs/ARCHITECTURE.md#components-product-versus-scaffolding). |
| `context/AuthContext.tsx` | `AuthProvider` + `useAuth()`: `user`, `isAuthenticated`, `role`, `program`. |
| `hooks/` | `use-color-scheme.ts` (+ `.web.ts`), `use-theme-color.ts` (unused by product screens). |
| `lib/pocketbase.ts` | The single PocketBase client, its platform-specific auth store, and singleton-bound wrappers around every `@learnlife/pb-client` query. |
| `lib/errors.ts` | PocketBase error → neutral user-facing copy. |
| `lib/calendar-utils.ts` | Re-export shim over `@learnlife/shared`; contains no logic. |
| `constants/theme.ts` | `Colors` + `Fonts` derived from `@learnlife/design-tokens`. Light mode only. |
| `__tests__/`, `__mocks__/` | Two test files and the PocketBase stub. |
| `stitch/` | Google Stitch design mockups (HTML + PNG). Reference only, and stale — [details](docs/ARCHITECTURE.md#stitchhtml--generated-mockups-not-runtime-code). |
| `.full-review/` | An abandoned audit. Read [`.full-review/README.md`](.full-review/README.md) first — several of its findings are already fixed and one is a false lead. |
| `public/_headers` | Netlify/Cloudflare-format header + cache rules for the web export. |

## Related docs

- [App architecture](docs/ARCHITECTURE.md) — auth flow, routes, components, platform splits, theming.
- [Stalled audit](.full-review/README.md) — what is still open, what is fixed.
- [Agent guide](CLAUDE.md) — invariants and conventions for AI coding agents.
- Monorepo: [root README](../../README.md) · [architecture](../../docs/MONOREPO_ARCHITECTURE.md) ·
  [PocketBase schema/rules](../../docs/POCKETBASE.md) · [RSVP design](../../docs/RSVP_MIGRATION.md) ·
  [security](../../docs/SECURITY.md) · [glossary](../../docs/GLOSSARY.md)
- Shared code this app depends on: [`packages/pb-client`](../../packages/pb-client/) ·
  [`packages/shared`](../../packages/shared/) · [`packages/design-tokens`](../../packages/design-tokens/)
