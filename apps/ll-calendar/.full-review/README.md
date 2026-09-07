# `.full-review/` — an abandoned code audit, and what became of it

This folder is the partial output of a staged, automated code review of this app, run once around
**14 April 2026** and never finished. It is kept because roughly a third of its findings are still
open and the reasoning in them is good. It is **not** a status report: several findings have since
been fixed in code without the audit being updated, one is a false lead, and the audit's own
`state.json` never advanced past step 0. Read this file before trusting anything in the other three.

The table at the bottom is the useful part: every finding, and its **verified** status against the
code as of this documentation pass. Each "closed" claim below was checked by reading the current
source, not by trusting the audit.

## What is here, and what is missing

| File | Contents |
|---|---|
| `00-scope.md` | Target, file list, flags, and a five-phase plan. |
| `01-quality-architecture.md` | Phase 1 — 26 code-quality findings (C/H/M/L) plus 16 architecture findings (A-*). |
| `02-security-performance.md` | Phase 2 — 13 security findings (S-*) plus 16 performance findings (P-*). |
| `state.json` | Machine state for the run. |

`00-scope.md` plans five phases. **Only three exist.** Never produced:

3. Testing & Documentation
4. Best Practices & Standards
5. Consolidated Report

Phase 5 is the one that hurts. There is no consolidated report, so the ~71 findings across phases 1
and 2 were never deduplicated — and they overlap heavily by design, because each phase re-reported
the previous phase's criticals from its own angle. The filter-injection issue alone appears three
times (C-1, A-H3, S-C1); the auth-reactivity issue appears four (C-2, A-C1, S-C2, and P-H1 covers its
performance half). Counting findings in this folder overstates the problem count by roughly a third.

## Why it stalled

The honest answer is that the repo does not record a reason. What it does record is an inconsistency:

```json
{ "status": "in_progress", "current_step": 0, "current_phase": 0,
  "completed_steps": [], "files_created": [],
  "started_at": "2026-04-14T00:00:00Z", "last_updated": "2026-04-14T00:00:00Z" }
```

`completed_steps` and `files_created` are empty and `last_updated` equals `started_at`, yet three
phase files exist on disk. So the state file was **never written back** after the run began — the
process that produced `01-` and `02-` did not update its own bookkeeping. Whatever stopped the run
stopped it in a way that left no trace, and a resumed run would restart from phase 0 and redo the
work.

The more useful signal is that the codebase moved on without it. `00-scope.md` lists eight app
screens including `app/(tabs)/explore.tsx` and `app/modal.tsx` — **both files are gone**, deleted as
scaffolding. Today `app/` has 17 route files. The audit therefore covered under half of the current
route surface: registration, settings, forgot/change password, chat, event detail, event roster,
invite management and new-conversation did not exist or were not in scope. Everything in RSVP
post-dates it entirely.

Judgement call for the next person: **do not resume this run.** Its scope no longer matches the app,
its plan would redo phases 1 and 2 from step 0, and the still-open findings below are already
extracted. If another audit is wanted, start a fresh one against the current file list.

## Findings still open

Verified present in the code today. The highest-value one first.

### Session expiry leaves the UI signed in — the most important open finding

Audit refs: **C-2 / A-C1 / S-C2** (CWE-613), plus **P-M5** for the missing refresh.

`AuthContext` exposes `isAuthenticated: pb.authStore.isValid`, read at render time. `onChange` fires
on login, logout and token rotation, but **not on expiry** — nothing re-renders when a token simply
ages out, so `isValid` is never re-evaluated. And there is no refresh: **`authRefresh` appears in no
source file anywhere in this repo** (`apps/ll-calendar`, `apps/nfc-attender/src`, `packages`,
`pb_hooks` — zero matches). So an expired session leaves every screen rendering as authenticated
while every request 401s.

What has changed since the audit is only the symptom's presentation: `lib/errors.ts` now maps 401 to
"Your session expired. Please sign in again." So the user gets told, per-request, in an alert — but
is never actually signed out, and the only recovery is to find Settings and log out manually. The
underlying finding is **fully open**, and the audit's severity is if anything understated because the
fix is not one line: it needs both a refresh call and a way to make expiry observable.

### The rest

| Audit ref | Finding | Verified state |
|---|---|---|
| P-C1 | Unbounded `getFullList` on the calendar | Open. `fetchCalendarEvents` in `packages/pb-client` still fetches every visible record with no date filter; the month window is applied client-side by `expandEvents`. The audit's *other* complaint about it (H-1: accepting `_monthStart`/`_monthEnd` and ignoring them) is closed — those misleading parameters are gone. |
| S-M1 / A-M4 / P-H3 | No error boundary at the root | Open. No `ErrorBoundary` anywhere in `app/`. |
| A-M4 (second half) | No auth-hydration guard | Open. On native the auth store's `initial` is a promise, so the first render precedes the token read and a signed-in user can see the login screen flash. |
| P-H1 | Context value recreated every render | Open. `AuthContext` still passes an inline object literal; no `useMemo`. |
| M-5 | Weekly recurrence ignores the series start date | Open, and now in `packages/shared/src/calendar.ts`. The expansion loop checks the weekday and `recurrence_end` but never compares against `rec.start`, so a weekly series shows up in months before it began. |
| M-10 | No end-time validation in create-event | Open. `handleSubmit` validates the title and the selected weekdays; nothing compares `endTime` to `startTime`. |
| H-5 | `any` in catch blocks | Open and slightly worse — 8 sites now (`inbox`, `calendar`, `manage-invites` ×2, `create-event`, `event-detail` ×3) versus the 5 the audit counted. |
| H-6 / A-M2 | No dark mode in real screens | Open, and structural. `constants/theme.ts` builds `Colors` from `colorsLight` only, so the flat `Colors.*` every screen reads is light-mode by construction. `colorsDark` exists in `@learnlife/design-tokens` and is re-exported as `T.colors.dark`, which nothing imports. Dark mode currently changes navigation chrome and nothing else. |
| H-4 | Hardcoded colours | Mostly closed, three screens open. 13 files now import `Colors` from `@/constants/theme`; `app/register.tsx`, `app/(modals)/chat.tsx` and `app/(modals)/manage-invites.tsx` still do not, and hardcode 6–10 hex literals each. The literals happen to *match* current tokens, so the bug is invisible until someone changes the palette. The specific hexes the audit named (`#2D1B4E`, `#C4F34A`, `#F9FAFC`) are all gone — those were the Stitch-mockup palette, since replaced. |
| M-6 / A-L1 | Unused boilerplate components | Mostly open. `explore.tsx` and `modal.tsx` are deleted, but `HelloWave`, `ParallaxScrollView`, `ExternalLink`, `Collapsible`, `IconSymbol` (+ `.ios`), `ThemedText`, `ThemedView` and `useThemeColor` all remain with zero product imports. Two of them no longer typecheck. |
| M-7 | `parallax-scroll-view.tsx` has an unused `styles.container` | Open (inside a file that is itself unused). |
| M-8 / A-L2 | Mixed `@/` and relative import paths | Open. `app/(tabs)/index.tsx` imports `@/components/bottom-nav` and `../../lib/pocketbase` in the same file. |
| A-L3 | Date keys are not zero-padded | Open by design and now load-bearing. `makeDateKey` produces `"2026-4-12"`, the format is pinned by tests, and `dateKeyToOccurrenceDate` exists in `@learnlife/shared` specifically to convert it to the padded `YYYY-MM-DD` that RSVP rows need. Changing it now would be a data-format change, not a cleanup. |
| A-L5 | `role` cast without runtime validation | Open. `user?.role as UserRole` in `AuthContext`. |
| S-L1 | Client-side role checks are not authorization | Open by design, and the audit's severity (Low) is right. Five screens compute `role === "lg" \|\| role === "admin"` inline; these are UX affordances and the real boundary is the PocketBase collection rules. Worth noting `@learnlife/shared` already exports `isGuide()` with exactly that predicate and no screen uses it. |
| S-L2 | No client-side login rate limiting | Open. `mapPbError`/`mapLoginError` handle a 429 from the server, but the client applies no backoff or lockout of its own. |
| P-M4 / L-3 / P-L2 | Month-navigation race, no debounce, no dedup | Open. Each `useFocusEffect` run has a `cancelled` flag, which stops a superseded *effect* from writing state — but nothing prevents overlapping in-flight requests, and `createPBClient` explicitly disables PocketBase auto-cancellation, so the SDK will not dedupe them either. |
| P-M6 | `expandEvents` is O(records × daysInMonth) | Open. |
| P-L3 | Inline style objects in the calendar grid | Open. |
| P-L4 | Reanimated loaded for side effects, barely used | Open, and sharper than the audit put it: the *only* consumers of Reanimated's animation API are the two unused scaffolding components. |
| L-2 | `unstable_settings` may be unnecessary | Open, but the audit was wrong to doubt it. `anchor: "(tabs)"` gives deep links into modals a back target instead of an empty stack. Keep it. |
| L-4 | Notification dot is hardcoded | Open. `components/bottom-nav.tsx` sets `notifDot: true` on the Inbox tab unconditionally; it is decoration, not a real unread indicator. (The dashboard's unread count *is* real — it just is not wired to this dot.) |
| A-M1 | Dual navigation system | Open, and intentional. The native tab bar is hidden and `BottomNav` is hand-rolled; the tradeoff and its cost are documented in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#navigation-two-tab-bars-one-visible). The audit's specific complaint about `router.push` is closed — see below. |
| A-M5 | No abstraction layer over PocketBase | Partly addressed, arguably closed. `lib/pocketbase.ts` now wraps every query and re-exports the types, so screens never touch the SDK; `__mocks__/pocketbase.ts` exists for tests. Still module-level rather than injected. |
| H-3 / A-H1 / P-H4 | Monolithic `index.tsx` | Reduced, not closed. 825 → 651 lines, and the dashboard now uses real data — but login and dashboard still share the file. The bigger offender today is `create-event.tsx` at 1212 lines, which the audit never saw. |

## Findings closed since the audit

Each verified by reading the current code.

| Audit ref | Finding | How it was closed |
|---|---|---|
| **C-1 / A-H3 / S-C1** | PocketBase filter injection (CVSS 8.6, CWE-943) | **Closed.** Every filter in `packages/pb-client/src/queries/` is now built with `pb.filter("… {:param}", { param })`. There is no template-literal interpolation into a filter string anywhere in the client packages. |
| **S-M4** | Auth token in unencrypted AsyncStorage (CWE-312) | **Closed.** `createAuthStore()` uses `expo-secure-store` on native — iOS Keychain / Android Keystore — with a one-shot migration that copies any legacy AsyncStorage token in and deletes it. Web uses `localStorage`, which is the only option there. Details in [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#auth-flow-exactly-what-happens). |
| H-2 / S-H2 / A-M3 / P-L1 | `register()` takes `userData: any`, auto-logs-in, double-authenticates | **Closed by deletion.** There is no `register()` in the app or in `@learnlife/pb-client`. Registration is now invite redemption: `lookupInvite` then `redeemInvite`, with the code and password as typed parameters. |
| H-1 | `fetchCalendarEvents` accepts and ignores `_monthStart`/`_monthEnd` | **Closed.** The parameters are gone; the signature no longer lies. (The unbounded fetch behind it is still open — P-C1 above.) |
| H-7 / P-M2 | `BottomNav` uses `router.push`, growing the stack | **Closed.** `components/bottom-nav.tsx` now calls `router.replace`; zero `router.push` occurrences in the file. |
| H-8 / S-H1 / P-M1 | `console.log` + `JSON.stringify` of user IDs and full records | **Mostly closed.** No `JSON.stringify` logging remains and no user IDs are logged. Eight `console.error`/`console.warn` sites survive, logging `err.message` and record IDs, with no `__DEV__` guard — hygiene rather than the leak the audit described. |
| M-1 | `useFocusEffect` captures a stale loader | **Closed.** All three tab screens now wrap the effect body in `useCallback` with a correct dependency array plus a `cancelled` flag. |
| M-2 / P-H2 | `FlatList` nested in a `ScrollView` | **Closed.** `app/(tabs)/index.tsx` contains no `FlatList` at all now. |
| M-3 / A-M6 | Dashboard data is hardcoded mock data | **Closed.** `DashboardMainScreen` fetches real events via `fetchCalendarEvents` and a real unread count via `fetchConversations`, and uses the same unread heuristic as the inbox so the two views agree. |
| A-M7 | Inbox screen is entirely static | **Closed.** `app/(tabs)/inbox.tsx` loads conversations from PocketBase. |
| L-1 | Copyright hardcoded to 2024 | **Closed** — the footer is gone. |
| L-5 | Unused `Modal` import in `create-event.tsx` | **Closed** — no such import. |
| L-6 | `Fonts` unused by app screens | **Closed** — 11 files import it. |
| S-L3 | Raw PocketBase error messages shown to users | **Mostly closed.** `lib/errors.ts` was added and maps status codes to neutral copy — `mapPbError`, `mapLoginError` (which deliberately collapses 400/401/403 so wrong-email and wrong-password are indistinguishable), `mapInviteError`. Not universal: `create-event.tsx` and `event-detail.tsx` still surface `err?.message` directly in a few alerts. |
| S-M2 | Unprotected routes | **Partly closed.** `calendar.tsx` and `inbox.tsx` now `Redirect` to `/` when unauthenticated; `event-roster.tsx` and `manage-invites.tsx` render a refusal to non-guides. The remaining modals (`chat`, `create-event`, `event-detail`, `new-conversation`, `settings`, `change-password`) have **no** auth gate, so a deep link renders them for a signed-out user. What they would then show depends on the PocketBase collection rules, which this repo cannot confirm — expect empty state and error alerts rather than data, but that is an inference, not a verified behaviour. |
| S-L4 | Hardcoded external image URLs (Google-hosted) | **Closed as described** — no `googleusercontent` URLs remain. A related issue took its place: `inbox.tsx` and `new-conversation.tsx` hand-build `https://learnlife.pockethost.io/api/files/users/…` instead of deriving from `PB_URL`. |
| M-4 | `ThemedText` uses repetitive ternaries | Moot — the file is dead scaffolding. |

## What the audit missed

Not criticism of the audit — most of this post-dates it — but a reader should not treat these files as
a complete problem list. Verified issues that appear nowhere in phases 1 or 2:

- **TypeScript was enforced nowhere in this app.** *Now closed:* a `typecheck` script exists and
  runs in `calendar-test.yml`, and the 9 errors `tsc --noEmit` used to report are fixed. `expo lint`
  is still ESLint-only and `ts-jest` still sets `diagnostics: false`. See
  [the README](../README.md#typescript-enforcement).
- **The jest `testMatch` could not collect `.tsx`.** *Now closed:* both `.test.ts` and `.test.tsx`
  are collected. See [the README](../README.md#testmatch-collects-ts-and-tsx).
- **RSVP capacity logic was implemented twice** — in `lib/pocketbase.ts` and in
  `pb_hooks/event_rsvps.pb.js` — and the two disagreed about what `status` means on the wire, so
  only one could work at a time. RSVPing to a full waitlist-enabled event returned a 400.
  *Now closed:* the client sends intent and the server owns capacity, waitlist and promotion. The
  client-side capacity math, the `position` write and the non-functional client promotion path are
  gone; two `not_going`-only guards remain because the hook skips them on that path. See
  [the RSVP section](../docs/ARCHITECTURE.md#rsvp-the-server-owns-capacity-the-client-sends-intent).
- **`pnpm build:calendar` was broken** at the repo root because this app defined no `build` script.
  *Now closed:* `pnpm build` runs `expo export --platform web`.
- **`pnpm reset-project` deleted the application.** *Now closed:* the scaffold script and its
  `package.json` entry are removed.
- **`HapticTab` can never render**, because the tab bar it is attached to has `display: "none"`.
- **`stitch/*.html` is stale**, and its palette is the source of the very hardcoded hexes the audit
  flagged in H-4.

## Reading order if you want to act on this

1. This file, for status.
2. [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — the current, verified description.
3. `01-quality-architecture.md` and `02-security-performance.md` for the *reasoning* behind the
   findings still marked open. Ignore their severity labels where this file contradicts them.
4. `00-scope.md` last, and only to see what the app looked like in April.
