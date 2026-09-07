# Luminous Scholar — architecture

This document explains how the calendar app is put together and, where the structure looks odd, why
it ended up that way. The shape of the app is dictated by one constraint: **there is no backend in
this repo.** PocketBase is hosted on PocketHost, its collection rules are the only real
authorization boundary, and the server-side hooks that do exist
([`pb_hooks/`](../../../pb_hooks/)) are uploaded by hand with no CI. Every design decision below
falls out of that — a single module (`lib/pocketbase.ts`) owns all data access so the coupling to
PocketBase stays in one file, and client-side role gates are UX affordances rather than security.

Read [`../README.md`](../README.md) first for the route table and the commands. This document goes
one level deeper and is honest about the dead code: a meaningful fraction of `components/` and
`hooks/` is untouched `create-expo-app` scaffolding that no product screen imports.

## Contents

- [Auth flow, exactly what happens](#auth-flow-exactly-what-happens)
- [Data access: one client, one module](#data-access-one-client-one-module)
- [RSVP: the server owns capacity, the client sends intent](#rsvp-the-server-owns-capacity-the-client-sends-intent)
- [Routing and the Expo Router group conventions](#routing-and-the-expo-router-group-conventions)
- [Navigation: two tab bars, one visible](#navigation-two-tab-bars-one-visible)
- [Components: product versus scaffolding](#components-product-versus-scaffolding)
- [Hooks](#hooks)
- [The dead theming layer, and the 9 type errors that are now gone](#the-dead-theming-layer-and-the-9-type-errors-that-are-now-gone)
- [Platform-specific file conventions](#platform-specific-file-conventions)
- [`lib/calendar-utils.ts` is a shim](#libcalendar-utilsts-is-a-shim)
- [`constants/theme.ts` versus `@learnlife/design-tokens`](#constantsthemets-versus-learnlifedesign-tokens)
- [`stitch/*.html` — generated mockups, not runtime code](#stitchhtml--generated-mockups-not-runtime-code)
- [Realtime and the EventSource polyfill](#realtime-and-the-eventsource-polyfill)
- [Known gaps](#known-gaps)
- [Not verifiable from the repo](#not-verifiable-from-the-repo)

## Auth flow, exactly what happens

### 1. The client and its auth store — `lib/pocketbase.ts`

There is exactly one PocketBase client in the app, created at module scope:

```ts
export const pb = createPBClient({ url: PB_URL, authStore: createAuthStore() });
```

`createPBClient` is from `@learnlife/pb-client`; it also disables PocketBase's auto-cancellation,
which matters here — see [Known gaps](#known-gaps).

`createAuthStore()` branches on `Platform.OS` and returns a PocketBase `AsyncAuthStore` in both
cases. The key is `"pb_auth"` on every platform.

| Platform | Backend | Notes |
|---|---|---|
| Web | `localStorage` | Guarded by `typeof window !== "undefined" && !!window.localStorage` so static rendering does not throw. If `localStorage` is missing, every save/clear is a no-op and `initial` is `""` — the user is simply never persisted. |
| Native (iOS/Android) | **`expo-secure-store`** — iOS Keychain / Android Keystore | Not AsyncStorage. |

**The storage backend on native is `expo-secure-store`, not AsyncStorage.** The repo's own audit
(`.full-review/02-security-performance.md`, finding S-M4) describes a plaintext-AsyncStorage token
and is out of date. The current code keeps the token in the OS keystore, and the comment records the
sizing decision that made it safe: the PocketBase token is well under SecureStore's 2 KB per-value
limit, so there is no chunking to get wrong.

AsyncStorage is still a dependency, for exactly one reason — a **one-shot migration**. On native,
`initial` is a promise that:

1. reads `pb_auth` from SecureStore; if present, that wins and nothing else happens;
2. otherwise reads `pb_auth` from AsyncStorage — a token left behind by a build that predates the
   migration — copies it into SecureStore, deletes the AsyncStorage entry, and returns it;
3. on any thrown error, returns `""`, i.e. signed out. Failing closed is the right default: a user
   who has to sign in again is annoyed, a user whose token silently fails to reach the secure store
   is a security regression.

After step 2 has run once on a device, SecureStore is authoritative and the AsyncStorage read always
misses. The dependency cannot be dropped until you are willing to sign out every user who has not
opened the app since the migration landed.

### 2. React state — `context/AuthContext.tsx`

`AuthProvider` seeds `user` from `pb.authStore.model` and then subscribes:

```ts
const unsubscribe = pb.authStore.onChange((token, model) => setUser(model));
```

`onChange` fires on login, logout and token *rotation*. It does **not** fire when a token merely
expires, which is the root of the open session bug described in
[`../.full-review/README.md`](../.full-review/README.md).

A second effect fetches the learner's program, keyed on `[user?.id, user?.learner]`: if
`user.learner` is set it reads that record from the `learners` collection and stores
`learner.program`; otherwise `program` is `null`. Guides and admins have no `learner` relation, so
their `program` is always `null`, and a failed fetch also yields `null` rather than an error state.
`program` is display-only in this app — the badge on `/settings`. It is *not* used to filter the
calendar; that happens in the PocketBase list rule.

### 3. What `useAuth()` exposes

```ts
{ user: AuthModel | null, isAuthenticated: boolean, role: UserRole | null, program: ProgramCode | null }
```

- `user` — the raw PocketBase auth model. Screens read `user.id`, `user.name`, `user.username`,
  `user.email`, `user.learner` off it, untyped.
- `isAuthenticated` — `pb.authStore.isValid`, read **at render time**, not stored in state.
- `role` — `user?.role` cast `as UserRole | null`. No runtime validation; an unexpected server value
  flows straight through as if it were a valid role.
- `program` — from the effect above.

`useAuth()` throws if called outside `AuthProvider`, which is the correct fail-fast behaviour.

Two properties of this design are load-bearing and easy to break:

- **The context value is a fresh object literal on every render.** Every `useAuth()` consumer
  re-renders whenever `AuthProvider` re-renders. That is cheap today (two pieces of state), but
  memoising it is the obvious first optimisation if the provider grows.
- **`isAuthenticated` is not reactive to expiry.** `pb.authStore.isValid` is only re-evaluated when
  the provider re-renders, and expiry triggers no re-render. See [Known gaps](#known-gaps).

### 4. Sign-in, registration, password paths

| Flow | Entry point | Path through the code |
|---|---|---|
| Sign in | `app/(tabs)/index.tsx` | `login()` → `auth.login(pb, …)` → `pb.collection("users").authWithPassword`. Failures go through `mapLoginError`, which collapses 400/401/403 into a single "Invalid email or password" so the response cannot distinguish a wrong address from a wrong password. |
| Register | `app/register.tsx` | `lookupInvite(code)` to validate and show the learner's name, then `redeemInvite(code, password)`; PocketBase authenticates as part of redemption, `onChange` fires, and the screen does `router.replace("/(tabs)/")`. |
| Forgot password | `app/forgot-password.tsx` | `requestPasswordReset(email)` raced against a 600 ms floor via `Promise.allSettled`, then the same neutral confirmation either way — timing *and* content both refuse to confirm whether the account exists. |
| Change password | `app/change-password.tsx` | `changePassword(old, new)`. PocketBase requires `oldPassword` alongside `password`/`passwordConfirm` and invalidates other sessions; `@learnlife/pb-client` then re-authenticates with the new password so this device keeps working. The screen's copy ("You'll stay signed in on this device. Other sessions have been signed out.") is accurate. |
| Log out | `app/settings.tsx` | `logout()` → `pb.authStore.clear()` → `onChange` → `setUser(null)`, then `router.replace("/(tabs)")`. |

## Data access: one client, one module

`lib/pocketbase.ts` is the app's entire data layer. It does three things:

1. builds the singleton `pb` and its platform-specific auth store;
2. re-exports the types the screens need (`CalRecord`, `CalEvent`, `Conversation`, `Message`, …) so
   screens import from `@/lib/pocketbase` rather than reaching into `@learnlife/pb-client`;
3. wraps every `@learnlife/pb-client` query in a **singleton-bound** thin function — `listInvites()`
   instead of `invites.listInvites(pb, …)`. The wrapper exists purely so no screen has to know about
   `pb`; that is what keeps the client swappable and keeps `pb` out of sixteen files.

Everything here is a one-line delegation, including RSVP. That was not always true — RSVP used to
carry a second implementation of the capacity rules — and the design that replaced it is worth its
own section.

## RSVP: the server owns capacity, the client sends intent

**The contract.** The client sends `status` as the user's *intent* — `"going"` or `"not_going"`,
never anything else. [`pb_hooks/event_rsvps.pb.js`](../../../pb_hooks/event_rsvps.pb.js) computes
the persisted `status` and `position`, rewriting `"going"` to `"waitlisted"` with a queue position
when the event is full. `"waitlisted"` is a server-assigned *outcome*; the hook rejects it as an
inbound value with `BadRequestError("status must be 'going' or 'not_going' on submit")`.

**Why the server has to own it.** Capacity is a read-then-write. Two learners pressing "Going"
simultaneously would both read the same going-count and both conclude a seat was free. The hook
counts inside the request handler, so the check and the write are close enough together that the
window is not practically exploitable at this concurrency. No client can offer that.

`lib/pocketbase.ts` therefore delegates: `submitRsvp` calls `rsvp.submitRsvp` from
[`packages/pb-client`](../../../packages/pb-client/), which sends intent and no `position` at all;
`cancelRsvp` calls `rsvp.cancelRsvp` and does nothing else. Waitlist promotion after a departure is
entirely server-side, via the hook's `maybePromoteWaitlist` on `onRecordUpdateRequest` (after a
`going → not_going` change) and `onRecordAfterDeleteSuccess`.

### What the client still enforces, and why it is not redundant

Two checks remain in `submitRsvp`, and they are **load-bearing rather than leftover**. `applyRsvpRules`
returns early for `not_going` — it clears `position` and stops — so on a withdrawal the server checks
nothing beyond `assertOwner`:

| Check | `going` | `not_going` |
|---|---|---|
| ownership (`assertOwner`) | hook | hook |
| `rsvp_enabled` | hook (`event_rsvps.pb.js:61-63`) | **client only** |
| `rsvp_deadline` | hook (`event_rsvps.pb.js:65-68`) | **client only** |
| ID / `occurrence_date` format | hook | not reached |
| capacity, waitlist, `position` | hook | n/a |
| waitlist promotion | hook | hook |

So `submitRsvp` gates `rsvp_enabled` and `rsvp_deadline` on the `not_going` path only. Duplicating
them on the `going` path would add a round-trip and a stale second opinion; omitting them on
`not_going` would mean a learner could withdraw after RSVPs closed, freeing a seat and triggering a
promotion past the deadline. If you are tempted to delete those two guards as duplication, they are
not.

**Known gap, deliberately not closed here:** `cancelRsvp` (a record *delete*) has no deadline gate on
either side. The hook's only delete handler is `onRecordAfterDeleteSuccess`, which runs after the
fact and cannot reject. The UI hides the "Clear RSVP" control past the deadline
(`event-detail.tsx`), so this is not reachable through the app, but it is not enforced either. The
`not_going` guard above is trivially bypassable via delete for anyone calling the API directly.
Closing it properly needs a hook change, which this app does not own.

### Error copy is the whole of the user feedback

Because the client no longer computes capacity, the *only* way a user learns "this event is full" is
the message derived from the server's rejection. `mapRsvpError` in `lib/errors.ts` maps the hook's
fixed set of `BadRequestError` sentences onto our own copy and sends everything else through
`mapPbError`, so no raw PocketBase body reaches the UI. It matches on known sentences rather than
echoing `err.message`.

It also has to catch the two client-only guards above: those throw plain `Error`s with no `status`,
and `mapPbError` reads a missing status as `0` — a network failure. An unmatched client guard would
tell the user their connection was down. `__tests__/rsvp-errors.test.ts` pins that, and it is the
only test coverage the RSVP feature has, since `pb_hooks/` has none.

**Keep `mapRsvpError` in sync with the throws in `event_rsvps.pb.js`.** Nothing enforces that link.

### The rest of the RSVP client path

- `submitRsvp` no longer pre-reads the roster. `rsvp.submitRsvp` does one `fetchMyRsvp` to choose
  create vs update; the `not_going` path adds one calendar read for the guards above. The old code
  did three reads before every write to feed a capacity calculation the server redid anyway.
- `event-detail.tsx` refuses to submit at all when the choice is `"not_going"` and no row exists —
  there is nothing to record, and a `not_going` row with no history is noise on the roster.
- `countRsvps` from [`packages/shared`](../../../packages/shared/) still runs client-side, for the
  "12/20 going · 3 waitlisted" badge. That is aggregation of server-assigned state for display, not
  enforcement, and it stays.
- `computeRsvpAction` and `promoteFromWaitlist` in
  [`packages/shared/src/rsvp.ts`](../../../packages/shared/src/rsvp.ts) are **no longer called by
  this app**. They are kept because their ~15 tests are the only executable specification of the
  hook's rules anywhere in the repo — `pb_hooks/` has no tests and cannot easily get them. Treat them
  as a spec fixture, not as app code, and do not wire them back into the submit path.
- Every read-back after a mutation goes through `loadAll()` in `event-detail.tsx`, so the counts the
  user sees come from the server rather than from optimistic local state.

## Routing and the Expo Router group conventions

If you have not used Expo Router: it is file-based routing for React Native, the same idea as
Next.js's `pages`/`app` directory, and `app/` is the route tree.

| Convention | Meaning |
|---|---|
| `app/settings.tsx` | Route `/settings`. |
| `app/_layout.tsx` | Not a route. A wrapper component rendered around everything beneath it; it declares the navigator (`Stack`, `Tabs`) and per-screen options. |
| `app/(tabs)/calendar.tsx` | A directory in **parentheses** is a *route group*: it groups files and may carry its own `_layout.tsx`, but it adds **no URL segment**. This file is the route `/calendar`, not `/(tabs)/calendar`. |
| `app/(modals)/chat.tsx` | Route `/chat`. |
| `router.push("/(modals)/chat")` | Both the grouped and ungrouped forms are valid hrefs, and this codebase uses the grouped form. They resolve to the same route. |

So `(tabs)` and `(modals)` are two different mechanisms that look alike:

- **`(tabs)` is functional.** It has `app/(tabs)/_layout.tsx`, which declares a `Tabs` navigator with
  three screens. Being inside the group is what puts a screen in that navigator.
- **`(modals)` is documentation.** There is no `app/(modals)/_layout.tsx`. What makes those screens
  appear as modals is the root `Stack` in `app/_layout.tsx` declaring each one with
  `presentation: "modal"`. Proof the folder is not doing the work: `app/settings.tsx` lives *outside*
  `(modals)` and is still presented as a modal, because the root `Stack` says so.

`app/_layout.tsx` also sets:

```ts
export const unstable_settings = { anchor: "(tabs)" };
```

This tells Expo Router which route to treat as the back-stack root, so a deep link straight into a
modal (`llcalendar://chat?...`) has `(tabs)` beneath it to go back to rather than an empty stack.

`typedRoutes` (`app.json` → `experiments`) generates `.expo/types/router.d.ts` from the file tree, so
route strings are typechecked by `pnpm typecheck` — but only where that file exists. It is generated
and gitignored, so it is absent in CI (route strings go unchecked there) and a **stale** local copy
reports false errors for routes that do exist; see
[the type-error breakdown](#the-dead-theming-layer-and-the-9-type-errors-that-are-now-gone).

## Navigation: two tab bars, one visible

`app/(tabs)/_layout.tsx` is 20 lines and does something deliberately strange:

```ts
<Tabs screenOptions={{ headerShown: false, tabBarButton: HapticTab, tabBarStyle: { display: "none" } }}>
```

It creates the real tab navigator — so the three tabs get proper navigator state, focus events
(`useFocusEffect` in all three screens depends on this) and back behaviour — and then **hides the
native tab bar**. Each tab screen instead renders `components/bottom-nav.tsx`, a hand-rolled bar with
the app's editorial styling: a 1.5 px ink top border, mono uppercase labels, a top indicator on the
active item.

The tradeoff, stated plainly: this buys full visual control of the bar at the cost of a second source
of truth for "which tab is active". `BottomNav` takes an `active` prop that each screen hardcodes
(`<BottomNav active="calendar" />`), so navigator state and bar state can disagree if a screen passes
the wrong value. Nothing checks it.

Two consequences:

- `BottomNav` navigates with **`router.replace`**, not `push`. With `push`, every tab switch would
  stack another screen — twenty switches, twenty live screens. `replace` keeps the stack flat. (An
  earlier version used `push`; the audit flagged it and it was fixed.)
- **`HapticTab` never renders.** It is wired as `tabBarButton`, but the tab bar it belongs to has
  `display: "none"`, so its haptic feedback is unreachable. It is configured, not used.

## Components: product versus scaffolding

Only one component in `components/` is used by the product. The rest arrived with `create-expo-app`
and was never deleted. The status column comes from grepping imports across `app/`, `components/`,
`hooks/`, `lib/`, `constants/` and `context/`.

| File | Status | Detail |
|---|---|---|
| `bottom-nav.tsx` | **Product** | Imported by all three tab screens. The visible bottom bar. |
| `haptic-tab.tsx` | **Wired but unreachable** | Passed as `tabBarButton` in `(tabs)/_layout.tsx`, but that tab bar is hidden, so it never renders. Adds iOS haptics on tab press-in — a feature the app therefore does not have. |
| `themed-text.tsx` | Scaffolding | `ThemedText` — imported only by `ui/collapsible.tsx`, which is itself unused. Reads the `ink` token through `useThemeColor`. |
| `themed-view.tsx` | Scaffolding | `ThemedView` — imported only by `ui/collapsible.tsx` and `parallax-scroll-view.tsx`, both unused. |
| `hello-wave.tsx` | Scaffolding | Zero imports anywhere. A waving-hand emoji with a Reanimated keyframe. Pure `create-expo-app` demo content. |
| `parallax-scroll-view.tsx` | Scaffolding | Zero imports anywhere. Also carries a `styles.container` its own JSX never uses. This is the **only** consumer of `react-native-reanimated`'s animation API in the app — see [Known gaps](#known-gaps). |
| `external-link.tsx` | Scaffolding | Zero imports anywhere. The `expo-web-browser` dependency exists for it. |
| `ui/collapsible.tsx` | Scaffolding | Zero imports anywhere. Reads `T.colors.light.muted` / `T.colors.dark.muted` for the chevron; used to read a non-existent `Colors.light.icon`, which was two of the nine type errors. |
| `ui/icon-symbol.tsx` | Scaffolding | Zero imports anywhere. SF Symbols → Material Icons mapping table with four entries. |
| `ui/icon-symbol.ios.tsx` | Scaffolding | iOS variant of the same, using `expo-symbols`' native `SymbolView`. |

The product's own icons are `MaterialIcons` imported directly from `@expo/vector-icons/MaterialIcons`
in each screen — `IconSymbol` is not on that path at all.

**Deleting the scaffolding** (`hello-wave`, `parallax-scroll-view`, `external-link`,
`ui/collapsible`, `ui/icon-symbol*`, `themed-text`, `themed-view`, `hooks/use-theme-color.ts`) would
let `expo-web-browser`, `expo-symbols` and the Reanimated animation surface go with them. It has not
been done, and this pass is not doing it — but it is the single highest-value cleanup available in
this app.

## Hooks

| Hook | Status | What it does |
|---|---|---|
| `use-color-scheme.ts` | **Product** | One line: re-exports React Native's `useColorScheme`. Used by `app/_layout.tsx` to pick `DarkTheme` vs `DefaultTheme` for the navigation `ThemeProvider`. |
| `use-color-scheme.web.ts` | **Product** | The web override. Returns `'light'` until an effect confirms hydration, then the real scheme. Without this, a static web export renders with the server's assumption and then flips, producing a hydration mismatch. |
| `use-theme-color.ts` | Scaffolding | Indexes `T.colors[theme]` from `constants/theme.ts` and takes a real token key. Used only by the unused themed components. Used to index a non-existent `Colors.light`/`Colors.dark`, which was three of the nine type errors. |

## The dead theming layer, and the 9 type errors that are now gone

`pnpm typecheck` (`tsc --noEmit`) in `apps/ll-calendar` reports **zero errors** and runs in
[`calendar-test.yml`](../../../.github/workflows/calendar-test.yml). It used to report **9** with no
gate anywhere; see [the README](../README.md#typescript-enforcement). What those nine were, because
the shape they describe still matters:

**Five real errors — the scaffolding theme layer.** `create-expo-app` ships a `constants/theme.ts`
shaped `Colors = { light: {...}, dark: {...} }` with keys like `text` and `icon`. This app replaced
that file wholesale with a flat, semantic, light-only `Colors` derived from
`@learnlife/design-tokens`, and kept the light/dark pair on a separate export, `T.colors`. The
scaffolding components had never been updated:

| Location | Was | Now |
|---|---|---|
| `hooks/use-theme-color.ts` (3) | `keyof typeof Colors.light & keyof typeof Colors.dark`, then `Colors[theme][colorName]` | the same against `T.colors`, whose `light`/`dark` really exist and share a key set |
| `components/ui/collapsible.tsx` (2) | `Colors.light.icon` / `Colors.dark.icon` | `T.colors.light.muted` / `T.colors.dark.muted` — there is no `icon` token |

Tightening `useThemeColor`'s constraint to real token keys also moved its three call sites onto
token names: `'background'` → `'bg'` in `themed-view.tsx` and `parallax-scroll-view.tsx`, `'text'` →
`'ink'` in `themed-text.tsx`. Those components now typecheck; they are still imported by no product
screen.

**Four route-string errors — one artefact, three real.** `.expo/types/router.d.ts` is generated by
the Expo CLI from the file tree and is gitignored, so it does not exist in CI at all. The copy on
disk predated `app/change-password.tsx`, so `router.push("/change-password")` in `app/settings.tsx`
was reported as an unknown route — a pure staleness artefact, and `pnpm start` regenerating the file
cleared it. The other three were **not** artefacts: expo-router never emits a trailing-slash form of
a group route, so `"/(tabs)/"` in `app/register.tsx`, `app/(tabs)/calendar.tsx` and
`app/(tabs)/inbox.tsx` was simply wrong and is now `"/(tabs)"`. If you hit route-type errors,
regenerate first and re-measure — but do not assume every one is stale.

## Platform-specific file conventions

Expo/Metro resolves `foo.<platform>.ts` before `foo.ts`, where `<platform>` is `ios`, `android`,
`web` or `native`. The app uses this twice, and in both cases the split exists because the platforms
genuinely cannot share the implementation:

| Split | Why |
|---|---|
| `hooks/use-color-scheme.ts` + `hooks/use-color-scheme.web.ts` | Static web rendering has no client colour scheme at HTML-generation time. The web variant returns `'light'` until an effect proves hydration happened, then switches to the real value. On native the value is available immediately, so the native file is a bare re-export. |
| `components/ui/icon-symbol.tsx` + `components/ui/icon-symbol.ios.tsx` | iOS has SF Symbols and can render them natively via `expo-symbols`; Android and web cannot, so the default file maps SF Symbol names onto Material Icons through an explicit table. Both files are scaffolding and currently unused. |

Everywhere else, platform differences are handled in-file with `Platform.OS` / `Platform.select`
rather than by splitting the file — `createAuthStore()` in `lib/pocketbase.ts`,
`KeyboardAvoidingView behavior` in every form screen, the Android picker modals in
`create-event.tsx`, and the font stacks in `constants/theme.ts`. The rule the codebase follows: split
the file when the *implementations* differ, branch inline when only a *value* differs.

## `lib/calendar-utils.ts` is a shim

It contains **no logic**. All eight lines:

```ts
// Re-export from shared package — single source of truth
export type { CalRecurrence, CalRecord, CalEvent } from "@learnlife/pb-client";
export { expandEvents, parsePBDate, formatTimeRange, makeDateKey } from "@learnlife/shared";
```

The real implementations are in
[`packages/shared/src/calendar.ts`](../../../packages/shared/src/calendar.ts) and
`packages/shared/src/date-utils.ts`. The shim survives only because
`__tests__/calendar-utils.test.ts` and one screen import through it. Two things follow:

- **The test file is misfiled.** It is named after this app's module but exercises
  `@learnlife/shared` behaviour end to end. Changing the shared package can break a test in
  `apps/ll-calendar`, and the failure will point at the wrong package.
- **`lib/pocketbase.ts` re-exports `expandEvents` too**, so screens reach it by two paths:
  `app/(tabs)/index.tsx` imports from `../../lib/calendar-utils`, `app/(tabs)/calendar.tsx` imports
  from `@/lib/pocketbase`. Same function, two import routes, no reason for the split.

## `constants/theme.ts` versus `@learnlife/design-tokens`

**`constants/theme.ts` is authoritative for this app, and it is a projection of the shared token
package.** It imports `colorsLight`, `colorsDark`, `radius`, `spacing`, `shadow` from
`@learnlife/design-tokens` and is the **only** file in the app that imports that package. No screen
imports design tokens directly — they all import `{ Colors, Fonts }` from `@/constants/theme`.

The file exports four things; two are used:

| Export | Used? | Notes |
|---|---|---|
| `Colors` | Yes — 13 files | A flat, **light-only** map. Built entirely from `colorsLight`, with three literal values (`limeDark`, `limeSubtle`, `mutedLight`) that have no token equivalent, plus legacy aliases: `purple` → `ink`, `lavender` → `accent`, `green` → `accent`. |
| `Fonts` | Yes — 11 files | `Platform.select` font stacks. Native uses system serifs (`ui-serif` on iOS, `serif` on Android) so the editorial look costs **zero font loading**; web spells out a full Fraunces / Inter Tight / JetBrains Mono stack with fallbacks. |
| `T` | **No** | The richer namespace (`T.colors.light`, `T.colors.dark`, `T.radius`, `T.spacing`, `T.shadow`, `T.fontFamily`) intended for new work. Nothing imports it. |
| `c` | **No** | `T.colors.light` shorthand. Nothing imports it. |

Two things follow from `Colors` being light-only:

- **Dark mode is dead** despite the infrastructure existing. `app.json` sets
  `userInterfaceStyle: "automatic"`, `app/_layout.tsx` swaps `DarkTheme`/`DefaultTheme` on the
  navigation `ThemeProvider`, and `colorsDark` exists in the token package and is re-exported through
  `T`. But every screen reads flat `Colors.*`, which is `colorsLight` — so the only thing dark mode
  changes is navigation chrome. Wiring it up means routing screens through `T.colors[scheme]`, not
  adding tokens.
- **Three screens bypass the theme entirely.** `app/register.tsx`, `app/(modals)/chat.tsx` and
  `app/(modals)/manage-invites.tsx` import neither `Colors` nor `Fonts` and hardcode hex literals
  instead. They *look* right — the literals are the current token values (`#1F1B16` = `ink`,
  `#807663` = `muted`, `#C4D98B` = `lime`, `#4F6B4A` = `accent`) — but they are copies. `chat.tsx`
  has 6 distinct literals, `manage-invites.tsx` has 8 (two of which, `#4ADE80` and `#F97316`, match
  no token at all), and `register.tsx` repeats `#1F1B16` ten times. A palette change silently skips
  these three screens.

## `stitch/*.html` — generated mockups, not runtime code

Four HTML files with matching PNGs: `login`, `dashboard`, `calendar`, `inbox`. They are
**AI-generated design mockups from Google Stitch**, and they are **reference-only and stale**.

Evidence for each part of that claim:

- **Generated by Stitch.** `.claude/settings.local.json` allow-lists
  `mcp__stitch__generate_screen_from_text`, `mcp__stitch__list_screens`, `Skill(stitch-design)` and
  `WebFetch(domain:contribution.usercontent.google.com)` — the Stitch MCP tool plus the Google host
  that serves its output.
- **Not runtime code.** Each file is a standalone document loading Tailwind from
  `cdn.tailwindcss.com` and fonts from Google Fonts, with an inline `tailwind.config` using Material
  3 token names (`surface-container-highest`, `on-tertiary-fixed-variant`). Nothing in `app/`,
  `components/`, `lib/`, `hooks/`, `constants/`, `context/`, `app.json` or `package.json` references
  `stitch` — zero matches. The directory is not `public/`, so it is not copied into the web export
  either.
- **Stale.** The mockups' palette is `#C4F34A` lime on `#2D1B4E` purple. Those are the exact hex
  values the abandoned audit flagged as hardcoded throughout the app
  (`.full-review/01-quality-architecture.md`, finding H-4). The app has since moved to the
  Heritage × Editorial "Paper" palette — `#C4D98B` lime, `#1F1B16` ink, `#4F6B4A` sage — so the
  mockups no longer describe the shipping design. Treat them as a historical artefact of the design
  exploration, not as a spec.

They are also where the app's name came from: `login.html`'s `<title>` reads "Luminous Scholar -
Learner Login".

## Realtime and the EventSource polyfill

The first 21 lines of `app/_layout.tsx` run **before any other import**, and the ordering is
deliberate. PocketBase's realtime subscriptions use server-sent events, which need a global
`EventSource`; React Native has none. The polyfill has to be installed before `lib/pocketbase.ts` is
evaluated, which is why those lines use `require` at the top of the module rather than a hoisted
`import` — ES imports are hoisted above statements and would run too late.

The wrapper subclass exists for a specific failure mode: `event-source-polyfill` defaults to a 45 s
heartbeat timeout, PocketBase's SSE pings are not reliably that frequent, so the connection was being
torn down and rebuilt constantly and the UI filled with "Reconnecting" errors. The subclass forces
`heartbeatTimeout: 5 * 60 * 1000` on every PocketBase-initiated connection. The companion
`LogBox.ignoreLogs([/No activity within \d+ milliseconds/])` suppresses the residual warning.

Only `app/(modals)/chat.tsx` subscribes (`subscribeToMessages`), and it unsubscribes on unmount with
a `cancelled` flag guarding the async setup race — if the screen unmounts before the subscription
resolves, the resolved unsubscribe is invoked immediately.

## Known gaps

Current and verified against the code. Findings from the abandoned audit — including which are now
closed — are tracked separately in [`../.full-review/README.md`](../.full-review/README.md).

| Gap | Where | Consequence |
|---|---|---|
| Type errors are invisible during tests | `ts-jest` runs with `diagnostics: false` | `pnpm typecheck` is the gate and does run in CI, but a test run will never surface a type error, and `.expo/types/router.d.ts` is absent in CI so route strings go unchecked there. Detail in [the README](../README.md#typescript-enforcement). |
| No token refresh anywhere | `authRefresh` appears in **no** source file in the repo | An expired token leaves `isAuthenticated` true (nothing re-renders on expiry) while every request 401s. `mapPbError` turns those into "Your session expired. Please sign in again.", but the user is never actually signed out and there is no recovery path short of a manual log out. |
| Withdrawal is gated only client-side | `applyRsvpRules` returns early for `not_going`; delete has no gate at all | `rsvp_enabled` and `rsvp_deadline` on withdrawal are enforced in `submitRsvp` only, and a direct `delete` bypasses even that. Detail [above](#what-the-client-still-enforces-and-why-it-is-not-redundant). |
| No error boundary | no `ErrorBoundary` in `app/` | Any unhandled render error takes down the app with no recovery UI. |
| No auth-hydration guard | `app/_layout.tsx` | On native, `initial` is a promise; the first render happens before the token is read, so a signed-in user can see the login screen flash. |
| Unbounded calendar fetch | `fetchCalendarEvents` in `packages/pb-client` uses `getFullList` with no date filter | Every calendar focus downloads every visible record; the month is applied client-side by `expandEvents`. Fine at school scale, linear growth forever. |
| Weekly recurrence ignores the series start | `expandEvents` in `packages/shared/src/calendar.ts` | The loop checks the weekday and `recurrence_end` but never compares against `rec.start`, so a weekly series appears in months *before* it began. |
| Month-switch race | `app/(tabs)/calendar.tsx` `useFocusEffect` | Rapid prev/next fires overlapping requests. A per-effect `cancelled` flag prevents a stale *effect* from writing, but PocketBase auto-cancellation is disabled in `createPBClient`, so in-flight duplicates are not deduplicated either. |
| Client-only role gates | five screens compute `role === "lg" \|\| role === "admin"` inline | These are UX affordances, not security — the boundary is the PocketBase collection rules. Note `@learnlife/shared` already exports `isGuide()` with exactly this predicate, and no screen uses it. |
| No end-time validation | `handleSubmit` in `create-event.tsx` | Validates the title and the selected days, never that `endTime > startTime`. An event ending before it starts saves cleanly. |
| No `__DEV__` guard on logging | 8 `console.error` / `console.warn` sites | Reachable via Xcode Console, `adb logcat`, browser DevTools. Current payloads are `err.message` and record IDs — no tokens, no full records — so this is hygiene rather than a leak. |
| `role` cast without validation | `AuthContext` | `user?.role as UserRole` — an unexpected server value flows through as if it were valid. |
| Avatar URLs hardcode the host | `inbox.tsx`, `new-conversation.tsx` build `https://learnlife.pockethost.io/api/files/users/...` by hand | Bypasses `PB_URL`. If the backend moves, avatars break in exactly two files nobody would think to grep. |
| Reanimated paid for, barely used | `app/_layout.tsx` imports `react-native-reanimated` for side effects | The only consumers of its animation API are the two unused scaffolding components. |
| `create-event.tsx` is 1212 lines | | Both the guide and learner forms plus ~320 lines of styles. The app's largest file by a wide margin and the obvious split candidate (guide form / learner form / shared field primitives). |
| The web export is not exercised in CI | `calendar-test.yml` runs lint, typecheck and test only | `pnpm build` (`expo export --platform web`) exists and works, but a change that breaks the web build still lands green. |

## Not verifiable from the repo

Honest list of what a reader will want and cannot get from these files:

- **Whether `pb_hooks/event_rsvps.pb.js` is loaded on the live instance.** The app now depends on it
  for all capacity and waitlist behaviour, so this matters more than it used to: if the hook is not
  loaded, a "going" submission to a full event simply succeeds as `going` and capacity is not
  enforced at all. The smoke test that settles it is step 4-5 of
  [`docs/RSVP_MIGRATION.md`](../../../docs/RSVP_MIGRATION.md). Indirect evidence that hooks do run:
  `POST /api/redeem-invite` is created only by `pb_hooks/invites.pb.js`, and invite registration is
  a working, load-bearing flow.
- **PocketBase collection rules.** The expected rules are documented as comments in
  `packages/pb-client/src/queries/*.ts` and in [`docs/POCKETBASE.md`](../../../docs/POCKETBASE.md),
  but the live rules are configured in the PocketHost admin UI. Nothing in this repo can confirm what
  is actually deployed.
- **Web hosting.** `vercel.json` and `public/_headers` exist, but there is no `.vercel/` directory and
  no CI deploy step, so which host serves the build and whether the project root is
  `apps/ll-calendar` or the standalone mirror repo are unknown here. The build *command* is no longer
  a mystery — see [the README](../README.md#the-web-build).
- **Native builds.** No `eas.json`, no committed `ios/`/`android/`, no signing config. How — or
  whether — an installable binary is produced is not recorded.
- **Whether the app runs under Expo Go.** `plugins` includes a config plugin
  (`@react-native-community/datetimepicker`), and config plugins only take effect in a native build.
  Nothing in the repo states whether development happens in Expo Go or a dev client.
- **Invite code expiry.** `manage-invites.tsx` tells the guide "It expires in 7 days". That is a claim
  about server behaviour; the TTL is set wherever invites are created server-side, not in this app.
