# Phase 1: Code Quality & Architecture Review

## Code Quality Findings

### Critical

- **C-1. PocketBase Filter Injection** (`lib/pocketbase.ts:74`) — `userId` is interpolated directly into a PocketBase filter string via template literal. This is equivalent to SQL injection for PocketBase queries. Use parameterized filters (`pb.filter()`).
- **C-2. AuthContext `isAuthenticated` Is Not Reactive** (`context/AuthContext.tsx:33`) — `isAuthenticated` is computed as `pb.authStore.isValid` at render time but only re-renders when `user` state changes. Token expiry won't trigger a re-render, leaving the UI in a stale authenticated state.

### High

- **H-1. `fetchCalendarEvents` Ignores Date Range Parameters** (`lib/pocketbase.ts:68-78`) — `_monthStart` and `_monthEnd` are accepted but unused. All records are fetched with `getFullList`, creating unbounded data growth.
- **H-2. `register()` Uses `any` Type** (`lib/pocketbase.ts:36`) — `userData: any` disables all type checking. Also silently calls `login()` as a side effect.
- **H-3. Monolithic `index.tsx` — 825 Lines** (`app/(tabs)/index.tsx`) — Login screen + dashboard + 484 lines of styles in one file. Violates SRP.
- **H-4. Hardcoded Colors Throughout** (all screen files) — `#2D1B4E`, `#8A7E9E`, `#C4F34A`, `#F9FAFC` repeated dozens of times. `constants/theme.ts` exists but is only used by boilerplate.
- **H-5. `error: any` in All Catch Blocks** (5 locations) — Bypasses TypeScript strict mode.
- **H-6. No Dark Mode in Custom Screens** (all custom screens) — Light-mode colors hardcoded despite `ThemeProvider` and `useColorScheme` being set up.
- **H-7. `BottomNav` Uses `router.push`** (`components/bottom-nav.tsx:29`) — Tab navigation via `push` builds up a deep back-stack. Should use `replace` or `navigate`.
- **H-8. Console Logging Leaks Data** (`app/(tabs)/calendar.tsx:58-65`) — User IDs, event titles, and full records logged via `console.log` + `JSON.stringify` in production paths.

### Medium

- **M-1. `useFocusEffect` Closure Captures Stale `loadEvents`** (`app/(tabs)/calendar.tsx:72-76`) — `loadEvents` not wrapped in `useCallback`.
- **M-2. `FlatList` Nested Inside `ScrollView`** (`app/(tabs)/index.tsx:208-231`) — Triggers RN warning; replace with horizontal `ScrollView` for small static data.
- **M-3. Dashboard Data Is Hardcoded** (`app/(tabs)/index.tsx:21-32, 179-195`) — Static mock data (names, dates, events) presented as real.
- **M-4. `ThemedText` Style Uses Repetitive Ternaries** (`components/themed-text.tsx:24-28`) — Use record lookup instead.
- **M-5. `expandEvents` Doesn't Check Start Date for Weekly Recurrence** (`lib/calendar-utils.ts:80-101`) — Shows occurrences before the event's actual start date.
- **M-6. Unused Boilerplate Components** (~8 files) — `HelloWave`, `ParallaxScrollView`, `ExternalLink`, `Collapsible`, `IconSymbol`, `explore.tsx`, `modal.tsx`.
- **M-7. `parallax-scroll-view.tsx` Has Unused Style** (line 67) — `styles.container` defined but never used.
- **M-8. Inconsistent Import Path Style** — Mixed `@/` alias and relative paths for the same modules.
- **M-9. `recurrence_end` Boundary Check Fragile** (`lib/calendar-utils.ts:96`) — Works but relies on time-component assumptions.
- **M-10. No End-Time Validation in Create Event** (`app/(modals)/create-event.tsx:143-191`) — User can create events where end < start.

### Low

- **L-1. Copyright Year Hardcoded to 2024** (`app/(tabs)/index.tsx:170`)
- **L-2. `unstable_settings` May Be Unnecessary** (`app/_layout.tsx:13`)
- **L-3. `loadEvents` Not Debounced** — Rapid month switching causes concurrent requests.
- **L-4. Notification Dot Hardcoded** (`components/bottom-nav.tsx:16`)
- **L-5. Unused `Modal` Import** (`app/(modals)/create-event.tsx:10`)
- **L-6. `Fonts` Constant Unused by App Screens** (`constants/theme.ts:30`)

## Architecture Findings

### Critical

- **A-C1. AuthContext `isAuthenticated` Not Reactive** — Same as C-2. Token expiry doesn't trigger re-render; context value object not memoized, causing unnecessary consumer re-renders.

### High

- **A-H1. God Component: HomeScreen** — 825 lines with dual responsibility (login + dashboard). Auth gating should be at layout level, not in render body.
- **A-H2. `fetchCalendarEvents` Ignores Date Range** — Same as H-1. Misleading API contract; unbounded data fetch.
- **A-H3. PocketBase Filter Injection** — Same as C-1. Sets dangerous precedent for future filters.

### Medium

- **A-M1. Dual Navigation System** (`app/(tabs)/_layout.tsx` + `components/bottom-nav.tsx`) — Native tab bar hidden; custom BottomNav duplicated in each screen with `router.push`. Tab state can diverge.
- **A-M2. Theme System Bypassed** — Dark mode broken for all real screens. Boilerplate-only usage of `ThemedText`/`ThemedView`.
- **A-M3. `register()` Has Hidden Side Effects** — Auto-login after registration with no way to opt out; partial failure not handled.
- **A-M4. No Error Boundary or Auth Hydration Guard** (`app/_layout.tsx`) — Flash of login screen on app launch; unhandled errors crash the app.
- **A-M5. No Abstraction Layer Over PocketBase** — Tight coupling between UI and SDK; testing requires module-level mocking.
- **A-M6. Dashboard vs Calendar Data Inconsistency** — Dashboard shows hardcoded timeline; calendar shows real PocketBase data for the same user/day.
- **A-M7. Inbox Screen Is Entirely Static** — No API integration; hardcoded mock data.

### Low

- **A-L1. Boilerplate Files Still Present** — `explore.tsx`, `modal.tsx` and associated components.
- **A-L2. Inconsistent Import Paths** — Same as M-8.
- **A-L3. Date Key Format Lacks Zero-Padding** (`lib/calendar-utils.ts:43-45`) — `"2026-4-1"` instead of `"2026-04-01"`; format duplicated in calendar screen.
- **A-L4. Hardcoded Notification Dot** — Same as L-4.
- **A-L5. Missing Type Safety for PocketBase User Model** — `role` cast with `as UserRole` without runtime validation.

## Critical Issues for Phase 2 Context

1. **PocketBase filter injection** — Security review should assess all PocketBase query patterns and recommend parameterized filters.
2. **Unbounded `getFullList` fetch** — Performance review should assess data growth impact and pagination needs.
3. **Console logging of user data** — Security review should flag information leakage in production.
4. **No error boundary** — Performance/reliability review should assess crash resilience.
5. **Auth state reactivity bug** — Could cause stale authenticated state, impacting both security and UX.
