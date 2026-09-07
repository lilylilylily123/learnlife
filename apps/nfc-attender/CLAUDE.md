# CLAUDE.md — `apps/nfc-attender`

Guidance for AI agents working inside this app. Read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything
structural; it is the map. This file is the short list of things that will bite
you, and the invariants you must not break.

## What this is

The attendance **dashboard**: Tauri 2 desktop shell + statically-exported Next.js
frontend, talking directly to hosted PocketBase at `learnlife.pockethost.io`.

It used to be the tap terminal. It is not any more — `apps/nfc-attender-fw` (the
ESP32 device) took that role. The PC/SC reader path in `src-tauri/src/main.rs` and
the `/kiosk` route still work, but they are legacy. Be precise about which you are
touching; do not describe this app as "the NFC terminal" in comments or docs.

## Commands

All from `apps/nfc-attender/`:

```bash
pnpm tauri:dev     # the dev command — starts `pnpm dev` and the Rust shell together
pnpm dev           # browser only; Tauri APIs fail (see traps below)
pnpm test          # vitest run
pnpm lint          # eslint
pnpm tauri:build   # release bundle
```

There is **no `typecheck` script here.** Root `pnpm typecheck` covers only
`./packages/*`. Type errors in this app surface at `next build` (hence
`tauri:build`), and `pnpm lint` will not catch them. If you change types, run
`pnpm build` — not just lint.

## Reference docs — link, do not restate

| For | Read |
| --- | --- |
| PocketBase collections, fields, rules | [`../../docs/POCKETBASE.md`](../../docs/POCKETBASE.md) |
| Vocabulary: `lg`, `arrival`, `justified`, program codes | [`../../docs/GLOSSARY.md`](../../docs/GLOSSARY.md) |
| CI workflow topology | [`../../docs/CI.md`](../../docs/CI.md) |
| This app's internals | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| How absences actually get marked | [`README_SCHEDULER.md`](README_SCHEDULER.md) |

Do not re-derive the schema by reading code. Do not redefine terms locally.

---

## The five traps

### 1. Static export — there is no server, and there cannot be one

`next.config.ts` sets `output: "export"`. `next build` emits `out/`, which Tauri
bundles as the frontend.

**Never add:** a Route Handler (`app/api/**/route.ts`), a Server Action,
`cookies()`/`headers()`/server-side `redirect()`, a data-fetching Server Component,
`next/image` optimization, middleware, or a runtime env var read. There is no
`route.ts` anywhere in the repo, and adding one here silently produces nothing.

Every data-touching file is `"use client"`. All fetching happens in `useEffect`.
The app's only `process.env` read is `NODE_ENV` in `src/lib/debug.ts`, resolved at
build time.

### 2. `window.__pb` — one PocketBase client, always

Import `pb` from `@/app/pb`. **Never construct a `PocketBase` instance.** The
singleton is cached on `window.__pb` because a second instance brings its own
`authStore` and its own realtime SSE connection, which means the auth state the UI
reads can disagree with the auth state a write uses, and the activity feed gets
duplicate entries.

`pb.authStore` is the only auth state in the app.

### 3. `window.confirm` and `window.alert` do not render in Tauri's WKWebView

Any code path gated on `confirm()` silently no-ops in the packaged app. Use
`ConfirmModal` (`src/app/components/ConfirmModal.tsx`), which is a portaled React
dialog that works in both the WebView and `pnpm dev`.

`src/app/history/page.tsx` still uses raw `confirm`/`alert` in three places
(the multi-lunch-event overwrite guard, `resetRecord`, and the save-failure path).
Those are known-broken in the packaged build. If you touch that file, migrating them
is in scope; do not add new ones anywhere.

### 4. Anchor downloads do not work in Tauri either

`<a download>` with a blob URL does nothing in WKWebView — no error, no file. Use
`saveTextFile` from `@/lib/file-save`, which routes through the dialog + fs plugins
inside Tauri and falls back to the blob anchor in a browser.

### 5. `pnpm dev` alone is a degraded environment

In a plain browser: `useNfcLearner`'s `listen()` rejects unhandled (no scan listener
is ever registered), `check()` and `getVersion()` fail, and CSV export takes the
fallback path. Use `pnpm tauri:dev` for anything touching scans, updates, or files.

---

## Invariants — do not break these

### Pure logic lives in `packages/`, not here

The split is strict and load-bearing:

| Layer | Contains | Rule |
| --- | --- | --- |
| `packages/shared` | Pure business logic — the attendance state machine, date utils, aggregation, RSVP | No I/O, no PocketBase, no React |
| `packages/pb-client` | All PocketBase access — client factory, types, constants, queries per collection | No business rules beyond `deriveStatus` |
| `apps/nfc-attender/src/lib`, `src/app/utils` | This app's glue: binding `pb` into queries, writes, formatting | May be impure |
| `apps/nfc-attender/src/app/components` | Rendering | Should be presentational; `page.tsx` owns state |

**Never reimplement a threshold or a rule locally.** `TIME_THRESHOLDS` in
`packages/pb-client/src/constants.ts` is the only source of cutoffs. If you find
yourself writing `hour >= 10`, stop.

Exported-for-test pure helpers (`groupRosterRows`, `getWallTone`,
`buildScanHistory`, `resolveRange`) may stay in the app — they are view logic, not
business logic.

### The attendance rule exists three times and has already drifted

| Implementation | File |
| --- | --- |
| Reference | `packages/shared/src/attendance.ts` — `computeCheckInAction`, `deriveStatus` |
| Hand-duplicated | `packages/pb-client/src/queries/attendance.ts` — `deriveStatus`, with a `MUST STAY IN SYNC` banner |
| C++ port | `apps/nfc-attender-fw/src/state_machine.cpp` |

`pb-client` cannot import `shared` because `shared` imports `TIME_THRESHOLDS` from
`pb-client` — that is the cycle the duplication exists to avoid. The firmware has
its own copy so the device can decide while offline.

**Nothing in CI compares them.** Known live divergences:

- Checkout: TypeScript `16:59`, firmware `17:00`.
- The firmware adds a `LOCKED_END_HOUR` no-scan window (14:00–17:00) that the
  TypeScript has no concept of.
- Step ordering differs. TypeScript evaluates checkout *before* late-lunch-return
  and folds closing an open lunch into the checkout write; the firmware evaluates
  late-lunch-return first, so a learner still at lunch tapping at 17:30 gets only
  the lunch close on the device, and needs a second tap to check out.

**If you change any of the three, change all three, and say so in the commit
message.** If you add a comparison test, that is a genuine improvement — put the
fixtures somewhere all three can consume them.

### Known data-correctness bug: `justified` is not written on check-in

Documented in full in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#known-data-correctness-bug-justified-is-never-written-on-check-in).
The short version:

`AttendanceState` has no `justified` field, so `computeCheckInAction` decodes prior
justification from the legacy `status` enum and returns `{ time_in, arrival, status }`
— no `justified`. `checkLearnerIn` writes those fields verbatim. On a row where
`status` says justified but the boolean does not, the result is
`arrival: "late"`, `status: "jLate"`, `justified: false` — contradictory.
`summarizeAttendance` prefers the split fields, so reports show an unexcused late
while the UI shows `jLate`.

Routing through `batchUpdateAttendance` does **not** fix it: `withDerivedStatus`
short-circuits on `if ("status" in fields)`, and `action.fields` always sets
`status`. A real fix means adding `justified` to `AttendanceState` — which touches
all three implementations above.

**Do not "tidy" this by making `checkLearnerIn` write `justified: false`.** That
would destroy real justifications rather than preserve stale ones.

### Split status model

`arrival` (`present` | `late` | `absent`) is the fact. `justified` (boolean) is the
excusal. `status` is the derived legacy enum kept for older consumers. Write
`arrival` and `justified`; let `status` follow from `deriveStatus`.

`lunch_status` deliberately keeps the single-enum model. Do not "finish the
migration" by splitting it — nothing needs it.

### Writes are optimistic, and rollback is mandatory

Every write handler in `page.tsx` follows the same shape: update local state, write,
roll back the local state on failure, surface a toast. If you add a handler, match
it. A handler that mutates state and swallows the error leaves the UI lying.

Also: when the demo overlay is active (`demoMap !== null`), **every handler must
return early before writing.** That is what makes demo mode safe. A new handler that
forgets the `if (demoActive) return;` will write synthetic data into production
during a stage demo.

### Realtime is the single source for the activity feed

Do not wire the feed from `useNfcLearner`'s `lastAction`. It is driven off
`pb.collection("attendance").subscribe("*")` + `inferAttendanceAction` precisely so
that firmware taps — which never touch this app's JS — appear in the feed. That path
used to exist and was removed deliberately.

### Multi-write coherence

`handleCheckAction`'s `morning-in` writes `time_in`, `arrival`, and `status` in a
**single** PocketBase call. This is not incidental: the realtime subscription diffs
records, and a row observed with `time_in` set but `arrival` still null produces a
wrong activity entry. Keep related fields in one write.

### Secrets and logging

- **NFC UIDs are credentials.** The Rust `println!` of a UID is behind
  `#[cfg(debug_assertions)]`. Keep it that way.
- Use `debug` from `@/lib/debug`, not bare `console.*`, for anything that could
  carry a learner name, a UID, or a PocketBase error payload. In production
  `debug.error` prints `"[error]"` with no payload.
- `useAutoAbsentSweep` and a few fetch handlers still use bare `console.*`. Those
  lines reach production consoles. Prefer `debug` in new code.
- `react/no-danger` is an **error** in `eslint.config.mjs`. Do not opt out. A live
  auth token sits on `window.__pb`; an injection here is an account compromise.

### Tauri permissions are opt-in

Every Tauri API call needs a matching entry in `src-tauri/capabilities/default.json`
or it fails **at runtime**, not at build time. Adding `dialog:allow-open` or a new
`fs:` scope is a deliberate security decision — the current `fs` grant is
write-only, text-only, and scoped to five user directories.

The CSP in `tauri.conf.json` is default-deny with one allowed origin. Pointing at a
different PocketBase host means editing the CSP *and* `PB_URL`.

### There are no Tauri commands

`main.rs` never calls `.invoke_handler(...)`. The only Rust→TS traffic is the
`nfc-scanned` and `nfc-error` events. `src-tauri/src/lib.rs` is dead scaffolding —
`main.rs` does not call it. Do not add behaviour there expecting it to run.

---

## Things that look like bugs and are not

| Looks wrong | Why it is deliberate |
| --- | --- |
| `useAttendanceFilters` only filters by name while `search !== debouncedSearch` | After the debounce settles the server query has already narrowed the list |
| `useIsPrivileged` uses `useSyncExternalStore` with `getServerSnapshot: () => false` | The static export prerenders the signed-out shell. A synchronous `useState` initializer caused a hydration-mismatch crash |
| Scans are queued, not dropped, while one is in flight | Dropping loses legitimate back-to-back taps during arrival |
| `demo-data.ts` hashes the learner id instead of using `Math.random` | Toggling demo mode must not reshuffle who is late mid-presentation |
| `handleReset` does not confirm | The confirm lives in the caller — the row menu and the wall bulk bar each prompt once |
| `expectedDays` comes from `countWeekdays()`, not from the record count | Days with no record must still count, because the absence sweep may never have run |
| `lastSweptDateRef` is only set when every write succeeded | Partial failure must retry on the next tick |

## Known gaps — document, do not silently fix

Fixing any of these is welcome; doing it *by accident* while working on something
else is not. Each is recorded in the docs, so update the doc with the fix.

- **Nobody marks absences unless this app is open.** The sweep is a browser timer.
  See [`README_SCHEDULER.md`](README_SCHEDULER.md).
- **`markLunchLate` has no implementation at all.** A learner who taps out for lunch
  and never returns keeps a trailing unmatched `out` forever.
- **`nfc-error` has no listener.** A dead reader is invisible; the header still says
  "Reader live".
- **Two of three `AuditAction` values are never emitted.** Only `csv_export` has a
  call site. Bulk attendance edits — the highest-consequence action in the app — are
  unaudited. And `audit_log` may not exist on the hosted instance at all, in which
  case even `csv_export` is silently discarded.
- **`checkLearnerIn` failures are invisible to the user.** A scan that did not take
  looks identical to one that did.
- **UTC/local asymmetry in `checkLearnerIn`**: the `date` string uses
  `toISOString()` while the state machine compares local `getHours()`. Latent, not
  currently triggered.
- **The PC/SC reader has no time-based debounce.** `last_uid` is structurally dead
  (always empty when compared); only the `card_present` edge guards duplicates. The
  firmware replaced this with a 1500 ms UID window to fix duplicate scans. Inside the
  lunch window a duplicate inverts the learner's lunch state.
- **`pf` ("Pathfinders") is a fourth program code** hard-coded in three label maps
  but absent from `PROGRAM_CODES`, so the admin report filter never offers it.
- **The palette is duplicated.** This app does not use `@learnlife/design-tokens`;
  `src/app/globals.css` re-declares all thirteen colours. Values are currently
  identical, nothing enforces it.
- **`event` and `node-fetch` are unused dependencies.**
- **`.env.example` is gitignored and wrong** — it describes server routes that
  cannot exist here, and PowerSchool/Redis variables nothing reads.
- **`apps/nfc-attender/.github/workflows/release.yml` is a stale duplicate** of the
  root `nfc-release.yml`. See [`README.md`](README.md#two-release-workflows-exist-and-one-of-them-is-a-trap).

## Testing

This app's Vitest suite is where `packages/pb-client` and `packages/shared` get most
of their coverage — they have no test runner of their own. `pb-client-shared.test.ts`,
`attendance-state-machine.test.ts`, `attendance-summary.test.ts`,
`date-utils.test.ts`, `expand-events.test.ts`, and `rsvp.test.ts` all live here while
testing code that lives elsewhere. **Do not relocate or delete them without moving
the coverage.** That is why CI runs `pnpm --filter nfc-attender test` for changes
confined to `packages/`.

When adding a test, match the existing style: a `describe` per unit, a shared
default-record factory that each case overrides only where it matters, and hoisted
`vi.mock` factories for the `pb` singleton.

## Version bumps

Three files must agree, and `tauri.conf.json` is the one the updater compares
against `latest.json`:

- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

All three read `0.4.0` today. Release is tag-driven from the repo root; see
[`README.md`](README.md#release-and-auto-update).
