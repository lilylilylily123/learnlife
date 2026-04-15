# Phase 2: Security & Performance Review

## Security Findings

### Critical

- **S-C1. PocketBase Filter Injection** (`lib/pocketbase.ts:74`) — CVSS 8.6, CWE-943. `userId` interpolated directly into filter string. AsyncStorage is writable client-side; a crafted `user.id` like `" || created_by != "` returns all users' records. Use `pb.filter()` for parameterized queries.
- **S-C2. Auth State Not Reactive to Token Expiry** (`context/AuthContext.tsx:33`) — CVSS 7.4, CWE-613. `isAuthenticated` computed from `pb.authStore.isValid` but no re-render fires on token expiry. User stays "authenticated" in UI while API calls fail with 401.

### High

- **S-H1. Sensitive Data Logged in Production** (`calendar.tsx:51-65`, `pocketbase.ts:27,42`) — CWE-532. User IDs, event titles, and full error objects logged via `console.log`/`console.error` with no `__DEV__` guard. Accessible via Xcode Console, adb logcat, browser DevTools.
- **S-H2. `register()` Accepts Arbitrary Unvalidated Data** (`lib/pocketbase.ts:36`) — CWE-20. `userData: any` passed directly to PocketBase `create`. Could allow setting `role: "admin"` or `verified: true` depending on collection rules.
- **S-H3. Missing Authorization Checks on Calendar CRUD** (`lib/pocketbase.ts:80-88`) — CWE-862. `deleteCalendarEntry(id)` accepts any record ID with no ownership check. `createCalendarEntry` passes client-supplied `created_by` with no server-side enforcement visible.

### Medium

- **S-M1. No Error Boundary at Root** (`app/_layout.tsx`) — CWE-209. Unhandled exceptions crash the app; dev overlay may expose stack traces with sensitive info.
- **S-M2. Unprotected Routes** (`calendar.tsx`, `inbox.tsx`, `create-event.tsx`) — CWE-306. Only `index.tsx` checks `isAuthenticated`. Other screens accessible via deep links without auth.
- **S-M3. Deep Link Scheme Without Validation** (`app.json:8`) — CWE-601. `llcalendar://` scheme registered but no parameter validation or auth guard. Any external app can navigate users to unprotected screens.
- **S-M4. Auth Token in Unencrypted AsyncStorage** (`lib/pocketbase.ts:12-16`) — CWE-312, CVSS 4.6. JWT + user model stored in cleartext AsyncStorage. Accessible on rooted/jailbroken devices or via `adb backup`. Should use `expo-secure-store`.

### Low

- **S-L1. Client-Side Role Check for Authorization** (`create-event.tsx:82-83`) — CWE-602. `isGuide` check is client-only; role could be manipulated via AsyncStorage.
- **S-L2. No Rate Limiting on Login** (`index.tsx:46-58`) — CWE-307. No exponential backoff or lockout after failed attempts.
- **S-L3. Error Messages Leak Implementation Details** (`index.tsx:53`, `create-event.tsx:187`) — CWE-209. Raw PocketBase error messages shown to user.
- **S-L4. Hardcoded External Image URLs** (`index.tsx:22-32`, `inbox.tsx:35-68`) — CWE-829. Google-hosted images loaded at runtime without integrity checks.

## Performance Findings

### Critical

- **P-C1. `fetchCalendarEvents` Ignores Date Range** (`lib/pocketbase.ts:68-78`) — Fetches ALL records with `getFullList()` regardless of `_monthStart`/`_monthEnd` params. Linear degradation as data grows. 500 events downloaded when only 20-30 needed.

### High

- **P-H1. AuthContext Value Recreated Every Render** (`context/AuthContext.tsx:33`) — Inline object `{ user, isAuthenticated, role }` creates new reference on every render, causing all `useAuth()` consumers to re-render unnecessarily. Fix with `useMemo`.
- **P-H2. FlatList Nested Inside ScrollView** (`app/(tabs)/index.tsx:208-232`) — Defeats virtualization. Replace with horizontal `ScrollView` for small static dataset.
- **P-H3. No Error Boundary** (`app/_layout.tsx`) — Any unhandled error crashes entire app. No recovery path.
- **P-H4. 825-Line Monolithic index.tsx** (`app/(tabs)/index.tsx`) — Login + dashboard in one file. Cannot code-split or lazy-load. Both loaded at startup regardless of auth state.
- **P-H5. Calendar Data Refetched on Every Focus** (`calendar.tsx:72-76`) — `useFocusEffect` fires `loadEvents` on every tab switch. No caching, stale-while-revalidate, or deduplication.

### Medium

- **P-M1. Console Logging with JSON.stringify** (`calendar.tsx:58-61`) — Synchronous serialization blocks JS thread. 50-200ms on low-end Android with 100+ records.
- **P-M2. BottomNav `router.push` Creates Unbounded Stack** (`bottom-nav.tsx:29`) — Each tab switch pushes new screen. 20 tab switches = 20 screen instances in memory.
- **P-M3. No Image Caching Strategy** (`index.tsx:22-32`, `inbox.tsx:28-80`) — No explicit cache policy, placeholder, or prefetch for remote images.
- **P-M4. Race Condition in Month Navigation** (`calendar.tsx:49-69, 99-111`) — Rapid month switching fires concurrent requests. Out-of-order responses display wrong month's events. No AbortController or request sequencing.
- **P-M5. No Token Refresh Logic** (`lib/pocketbase.ts`, `context/AuthContext.tsx`) — No proactive refresh before expiry. API calls fail with 401; user sees generic errors instead of re-login prompt.
- **P-M6. `expandEvents` O(records * daysInMonth)** (`lib/calendar-utils.ts:54-105`) — Could be reduced to O(records + daysInMonth) with day-of-week pre-grouping.

### Low

- **P-L1. `register()` Double-Authenticates** (`lib/pocketbase.ts:36-44`) — Extra HTTP request after create.
- **P-L2. No Request Deduplication** (`calendar.tsx`) — Concurrent identical requests possible.
- **P-L3. Inline Style Objects in Calendar Grid** (`calendar.tsx:151-152`) — Up to 126 inline objects per render.
- **P-L4. `react-native-reanimated` Imported but Minimally Used** (`app/_layout.tsx:8`) — ~200KB+ library loaded for side effects; only used by unused `ParallaxScrollView`.

## Critical Issues for Phase 3 Context

1. **No test coverage for security-critical paths** — auth flow, PocketBase queries, role-based access, input validation untested.
2. **No error boundary** — testing strategy should include error scenario tests.
3. **Race conditions** — calendar month navigation needs concurrency tests.
4. **Token expiry handling** — no tests for session lifecycle.
5. **Filter injection** — needs security-specific test cases.
6. **Documentation gaps** — PocketBase collection rules, auth flow, and deep link handling are undocumented.
