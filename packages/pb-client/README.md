> [!IMPORTANT]
> **`src/queries/attendance.ts` duplicates `deriveStatus` from `@learnlife/shared`, and `scripts/backfill-arrival.ts` duplicates `splitStatus`. Two further implementations live in `packages/shared` and in C++.**
> The `shared`/C++ pair is now compared in CI against a shared fixture; these two copies are not. See [The duplicated `deriveStatus`](#the-duplicated-derivestatus).

# `@learnlife/pb-client`

Every PocketBase read and write in the TypeScript half of this repository goes
through this package. It owns the connection URL, the collection field types,
the domain constants, and one query function per operation the product
performs.

It exists to keep a specific class of bug from happening twice. The backend is
a **hosted PocketBase at `https://learnlife.pockethost.io/` that is not in this
repository** — there is no schema migration file, no local instance, and no
type generation step. The record shapes in `src/types.ts` are hand-maintained
against a database you cannot see from the source tree. If each app declared
its own `AttendanceRecord`, they would drift from the real schema
independently, and the drift would surface as a runtime `undefined` in one app
only. One hand-maintained copy is still risky; two would be unmanageable.

The same reasoning applies to filters. PocketBase filters are strings, and
string interpolation into a filter is an injection vector. Centralising the
queries here means `pb.filter()` parameter binding and `YYYY-MM-DD` validation
happen once, in one file, rather than at every call site.

For the backend itself — collection-by-collection field lists, API rules, the
request budget, and what is and is not verifiable about the live instance — read
[`docs/POCKETBASE.md`](../../docs/POCKETBASE.md). This README documents the
client: what to call, what it does, and where it will surprise you.

| Field | Value |
|---|---|
| Package name | `@learnlife/pb-client` |
| Entry point | `src/index.ts` (source — consumers bundle the TS directly) |
| Runtime deps | `pocketbase` ^0.26.3 |
| Own test script | **none** — see [How this package is checked](#how-this-package-is-checked) |
| Backend | hosted PocketHost instance, **not** in this repo |

`tsconfig.json` here adds `"dom"` to `lib`, which `tsconfig.base.json`
deliberately omits. This package is isomorphic — it runs in a Next.js static
export, in React Native, and in Node — and it uses `console` and `setTimeout`,
which all three hosts provide but the language does not declare. `"dom"` is the
smallest lib that declares them. **Do not move that into `tsconfig.base.json`:**
`packages/shared` is pure logic with no host globals, and the absence of those
declarations is what keeps it that way.

## Layout

| File | Contents |
|---|---|
| `src/client.ts` | `createPBClient` factory |
| `src/constants.ts` | `PB_URL`, program codes, status enums, `TIME_THRESHOLDS` |
| `src/types.ts` | One interface per collection, hand-maintained |
| `src/queries/attendance.ts` | `attendance` collection — list, get, upsert, justify, reset |
| `src/queries/auth.ts` | `users` collection auth: login, logout, password reset/change |
| `src/queries/calendar.ts` | `calendar` collection CRUD |
| `src/queries/invites.ts` | `invites` collection + the `/api/redeem-invite` hook |
| `src/queries/learners.ts` | `learners` collection |
| `src/queries/messages.ts` | `conversations` + `messages`, including realtime |
| `src/queries/rsvp.ts` | `event_rsvps` collection |
| `src/utils/retry.ts` | `withRetry` — 429 back-off |
| `scripts/backfill-arrival.ts` | One-off migration, not part of the public surface |
| `src/index.ts` | The public surface. Nothing outside this file is a supported import path. |

## Install / run

Nothing to build. Consumers reference the workspace package:

```jsonc
// apps/*/package.json
"@learnlife/pb-client": "workspace:*"
```

The only command this package has, run from the repo root:

```bash
pnpm --filter @learnlife/pb-client typecheck   # tsc --noEmit
```

## Import shape

Query modules are exported as **namespaces**, not flat functions, so call sites
read as `attendance.listAttendance(pb, …)` and the collection being touched is
visible at the call site:

```ts
import { createPBClient, PB_URL, attendance, withRetry } from "@learnlife/pb-client";
import type { AttendanceRecord } from "@learnlife/pb-client";

const pb = createPBClient({ url: PB_URL });
const today = await withRetry(() => attendance.listAttendance(pb, {}));
```

**Every query function takes the `PocketBase` instance as its first argument.**
This package holds no module-level client and no ambient auth state; see below.

### Which function do I call?

| Collection | Namespace | Functions |
|---|---|---|
| `attendance` | `attendance` | `listAttendance`, `listAllAttendance`, `getAttendance`, `batchUpdateAttendance`, `justifyAttendance`, `resetAttendance` |
| `users` (auth) | `auth` | `login`, `loginAsLearner`, `logout`, `isAuthenticated`, `getCurrentUser`, `requestPasswordReset`, `changePassword` |
| `users` (directory) | `messages` | `listMessageableUsers` |
| `learners` | `learners` | `listLearners`, `getLearnerByNfc`, `getLearnerById`, `createLearner`, `updateLearnerComment` |
| `calendar` | `calendar` | `fetchCalendarEvents`, `createCalendarEntry`, `getCalendarEntry`, `updateCalendarEntry`, `deleteCalendarEntry` |
| `conversations` | `messages` | `fetchConversations`, `createConversation`, `findDirectConversation` |
| `messages` | `messages` | `fetchMessages`, `sendMessage`, `markMessagesRead`, `subscribeToMessages` |
| `invites` | `invites` | `generateInviteCode`, `createInvite`, `listInvites`, `lookupInvite`, `redeemInvite` |
| `event_rsvps` | `rsvp` | `fetchRsvpsForOccurrence`, `fetchMyRsvp`, `fetchMyUpcomingRsvps`, `submitRsvp`, `cancelRsvp` |
| `audit_log` | — | **no client function.** Written server-side by `pb_hooks/`; nothing in this package reads or writes it. |

---

## `createPBClient(options?)`

```ts
interface PBClientOptions {
  url?: string;        // defaults to PB_URL
  authStore?: any;     // PocketBase AuthStore or AsyncAuthStore
}

createPBClient(options?: PBClientOptions): PocketBase
```

A factory, and **only** a factory. There is no singleton in this package, no
`export const pb`, and no lazily-initialised module global. That is deliberate:
the two apps need genuinely different auth persistence, and a module-level
instance created at import time cannot be configured per host.

| App | Where the instance lives | Auth store |
|---|---|---|
| `apps/nfc-attender` | `src/app/pb.ts` — `getPb()` caches on `window.__pb` so Next.js Fast Refresh does not create a second client per reload | default (PB's own in-memory store) |
| `apps/ll-calendar` | `lib/pocketbase.ts` — `export const pb = createPBClient({ url: PB_URL, authStore: createAuthStore() })` | `AsyncAuthStore`: `localStorage` on web, `expo-secure-store` on native, key `pb_auth` |

`options.authStore` is typed `any` because PocketBase's `AsyncAuthStore` is not
in the base type bundle.

**The factory does one thing beyond construction: `pb.autoCancellation(false)`.**
PocketBase by default cancels an in-flight request when an identical one is
issued, which is a sensible default for a search-as-you-type box and a
data-loss bug for an NFC terminal. Two learners tapping within the same second
produce two identical-looking `getFirstListItem` calls; with auto-cancellation
on, one of them is silently dropped and that learner is never checked in.

## `constants.ts`

### `PB_URL`

```ts
export const PB_URL = "https://learnlife.pockethost.io/";
```

Hard-coded, not read from the environment. There is exactly one backend and it
is a hosted PocketHost instance. `createPBClient({ url })` is the override
hook, used for tests and any self-hosted setup.

### `PROGRAM_CODES`

The three programmes, mapping display name → the code stored in
`learners.program` and in `calendar.programs`:

| `ProgramName` | `ProgramCode` |
|---|---|
| `Changemaker` | `chmk` |
| `Creator` | `cre` |
| `Explorer` | `exp` |

> [!IMPORTANT]
> **The codes must remain mutually non-substring. This is a correctness
> constraint on the deployed access-control rule, not a naming preference —
> and until now it was recorded in exactly one place: a docblock above
> `fetchCalendarEvents`.**
>
> The hosted `calendar` List/View rule scopes events to a learner's programme
> with PocketBase's `~` (substring) operator:
>
> ```
> programs ~ @request.auth.learner.program
> ```
>
> `~` is used instead of the correct set-membership operator `?=` because
> **`?=` does not match on the multi-select `programs` field in the deployed
> PocketBase version.** `~` is a workaround, and it is only sound because
> `chmk`, `cre` and `exp` are pairwise non-substrings of one another — no code
> appears inside another, so a substring test cannot produce a false positive.
>
> Add a code that *is* a substring of another and the rule starts matching
> events it should not, **silently**. There is no error, no test, and no
> runtime assertion anywhere in this repository that would catch it; the
> symptom is learners seeing another programme's events. Before adding a
> fourth code, verify disjointness by hand, or fix the rule.
>
> This constraint is also the reason the docblock on `fetchCalendarEvents`
> should not be deleted as "just a comment": it is the **only** record in the
> repo of the `calendar` collection's List/View rule at all. See
> [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md#rules-not-documented-anywhere-in-this-repo).

> [!WARNING]
> **A fourth programme code, `pf` ("Pathfinders"), exists in the dashboard but
> not in `PROGRAM_CODES`.** It is hard-coded into three separate label maps in
> `apps/nfc-attender/src/app/` (`components/AttenderD.tsx`, `history/page.tsx`,
> `kiosk/page.tsx`) and is absent from this file. `pf` happens to satisfy the
> non-substring constraint above, so the calendar rule still works — but
> `PROGRAM_CODES` is no longer the complete list, and anything driven off it
> (for example the programme filter dropdown in
> `apps/nfc-attender/src/app/history/admin/page.tsx`) will not offer
> Pathfinders. Not verifiable from the repo: whether `pf` is a real programme
> in the hosted database or leftover from a rename.

### Status enums

```ts
ALLOWED_STATUSES = ["present", "late", "absent", "jLate", "jAbsent"]  // AttendanceStatus — legacy combined enum
ALLOWED_ARRIVALS = ["present", "late", "absent"]                      // ArrivalStatus  — the fact half
```

`arrival` is the *fact* half of a split model: did the learner show up on time,
late, or not at all. Justification is a separate boolean, so the arrival fact
survives a guide marking the day excused. The legacy combined enum is retained
so pre-split queries and reports keep working. The full model, including the
`deriveStatus` mapping table, is documented in
[`packages/shared/README.md`](../shared/README.md#the-status-model-arrival--justified-plus-a-legacy-enum).

### `TIME_THRESHOLDS`

The attendance rule's numbers live here rather than in `packages/shared`
because the firmware's C++ port also needs them as a single citable source
(`apps/nfc-attender-fw/src/state_machine.cpp` copies them as `constexpr` and
cites this file). That import direction — `shared` depends on `pb-client` for
these constants — is also why `pb-client` cannot depend on `shared`, and hence
why `deriveStatus` is duplicated here.

| Constant | Value | Governs |
|---|---|---|
| `LATE_HOUR` / `LATE_MINUTE` | `10` / `1` | Present/late boundary: first tap at ≥ 10:01:00 local is `late`. |
| `LUNCH_START_HOUR` | `13` | Lunch window opens, inclusive. |
| `LUNCH_END_HOUR` | `14` | Lunch window closes, **exclusive** (13:00:00–13:59:59.999). |
| `LUNCH_LATE_HOUR` / `LUNCH_LATE_MINUTE` | `14` / `1` | Nominal late-return boundary. `LUNCH_LATE_HOUR` alone is the floor for the late-lunch-return step. The 14:01 pair is unreachable inside the lunch window — see the warning in [`packages/shared/README.md`](../shared/README.md#time-thresholds). |
| `CHECKOUT_HOUR` / `CHECKOUT_MINUTE` | `16` / `59` | Non-Friday check-out opens at 16:59. **The firmware uses 17:00.** |
| `FRIDAY_CHECKOUT_HOUR` / `FRIDAY_CHECKOUT_MINUTE` | `14` / `0` | Friday check-out opens at 14:00 — Fridays are short days. |
| `ABSENT_HOUR` / `ABSENT_MINUTE` | `10` / `30` | Auto-absent cutoff. Any active learner without a check-in by 10:30 on a weekday is flipped to `arrival: "absent"` by the dashboard's sweep timer (`useAutoAbsentSweep` in `apps/nfc-attender`). 29 minutes of grace past the late boundary, so the arrival rush the boundary creates does not collide with the sweep. |

These constants are consumed by `packages/shared/src/attendance.ts`. **Nothing
in this package reads them.**

## `types.ts`

One hand-maintained interface per collection. Field-level schema — types,
nullability, who writes what — belongs to
[`docs/POCKETBASE.md`](../../docs/POCKETBASE.md#collections) and is not
restated here. What this section covers is the mapping from collection to type
name, and the places where the TypeScript and the database do not line up.

| Collection | Interface |
|---|---|
| `users` | `User` (`role: UserRole` = `"learner" \| "lg" \| "admin"`) |
| `learners` | `Learner` |
| `attendance` | `AttendanceRecord` (+ `LunchEvent`) |
| `calendar` | `CalRecord` (+ `CalRecurrence`, `CreateCalEntryPayload`) |
| `event_rsvps` | `EventRsvp` (+ `RsvpStatus`) |
| `conversations` | `Conversation` |
| `messages` | `Message` |
| `invites` | `Invite` |
| `audit_log` | **none** — not modelled here |

`CalEvent` is not a collection. It is the expanded, display-ready form produced
by `expandEvents` in `@learnlife/shared`: `id` is the record id for a one-off
event and `` `${recordId}-YEAR-M-D` `` for a recurring occurrence, while
`recordId` always points at the row to mutate. `MessageableUser`, a flat
projection of `users`, is exported from `queries/messages.ts` rather than here.

### Where the types and the database disagree

Nothing generates these interfaces and nothing checks them against the live
schema. A field renamed in the PocketBase admin UI produces a green typecheck,
a green test suite, and a runtime `undefined`. Three known gaps:

> [!WARNING]
> **`Learner.email` and `Learner.dob` are declared as required `string`, but a
> writer in this repo creates learners without them.**
> `apps/nfc-attender/tools/enroll/src/main.rs` — the Rust enrolment CLI used to
> pair NFC cards with new learners — posts `CreateLearnerBody { name, program,
> NFC_ID }` and nothing else. Exactly one of the following is true, and the
> repository cannot tell you which:
>
> - the live schema has `email` and `dob` optional, and the TS type overstates
>   them, so any code that trusts `learner.email` to be a non-empty string is
>   wrong; **or**
> - the live schema requires them, and PocketBase is filling in `""`, so
>   CLI-enrolled learners carry empty strings that satisfy the type and fail
>   any downstream use (an invite email, a date calculation).
>
> Either way, treat `Learner.email` and `Learner.dob` as possibly-empty at
> every call site until the collection is inspected in the admin UI. Resolving
> this needs one look at the `learners` collection; see
> [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md#learners).

**PocketBase defaults a newly-added select field to `""`, not `null`.**
`AttendanceRecord.arrival` is typed `ArrivalStatus | null`, but rows that
predate the split-status migration hold `""` in that column. Code testing for
"not yet migrated" must therefore treat `null`, `undefined` and `""` alike —
the canonical marker is one of the three valid enum values, not
non-emptiness. `scripts/backfill-arrival.ts` and `withDerivedStatus` in
`queries/attendance.ts` both do this correctly; new code must remember to.

**`lunch_events` is typed as an array but stored as a JSON column.** Reads come
back as `LunchEvent[]`; writes must send a JSON **string**. The attendance
state machine emits `JSON.stringify(...)` for exactly this reason. Sending an
array works by accident in some paths and not others.

---

# Queries

## `attendance`

Collection: `attendance`. The largest module, and the only one with
non-trivial logic of its own.

| Export | Signature | Notes |
|---|---|---|
| `listAttendance` | `(pb, params?: ListAttendanceParams) => Promise<ListAttendanceResult>` | Paginated. Always `expand: "learner"` so the UI can render names without a second query. Sorted `-date,-created`. |
| `listAllAttendance` | `(pb, params?: ListAttendanceParams) => Promise<AttendanceRecord[]>` | Pages until exhausted, `perPage` 200. For a multi-week range this can be thousands of records and dozens of requests — prefer `listAttendance` with a page where possible. |
| `getAttendance` | `(pb, learnerId, date?) => Promise<{ attendance: AttendanceRecord \| null; exists: boolean }>` | Returns `{ null, false }` instead of throwing when absent, so "first scan of the day" is not an exception path. |
| `batchUpdateAttendance` | `(pb, { learnerId, date?, fields? }) => Promise<{ attendance; existing; created }>` | Get-or-create, then optionally patch. Detailed below. |
| `justifyAttendance` | `(pb, { attendanceId, justified, reason?, userId }) => Promise<AttendanceRecord>` | Apply or revoke a justification. Detailed below. |
| `resetAttendance` | `(pb, learnerId, date?) => Promise<{ status: "reset" \| "no_record"; attendance? }>` | Nulls every time/status field on the row. Lets a guide undo a mistaken check-in without deleting the record. Deliberately does **not** clear `justified_by` / `justified_at`. |

`ListAttendanceParams` — all optional, defaults to today:

| Param | Notes |
|---|---|
| `date` | `YYYY-MM-DD`. **Ignored when `dateFrom`/`dateTo` is set.** |
| `dateFrom` / `dateTo` | `YYYY-MM-DD`, inclusive. Either alone implies both. |
| `learnerId` | Single-learner filter. |
| `page` / `perPage` | Default 1 / 50. |

`ListAttendanceResult` is `{ items, totalItems, totalPages, date }`, where
`date` is the resolved single day or a `"from..to"` label.

**Date handling is the sharp edge here.** Two mechanisms, both deliberate:

- Every date input passes through `assertDate`, which rejects anything not
  matching `/^\d{4}-\d{2}-\d{2}$/` with a thrown `Error`. That regex is what
  makes the subsequent interpolation safe — a user-controlled quote character
  cannot reach the filter string.
- Single-day queries use `date ~ {:date}` (substring), because the column
  stores a full timestamp, not a date. Range queries use
  `date >= "{from} 00:00:00" && date <= "{to} 23:59:59"`, with explicit time
  bounds so PocketBase's timestamp comparison covers the whole day at both
  ends.

The default date, when none is passed, comes from a local `todayStr()` that is
**UTC, not local time** (`toISOString()`). West of Greenwich after 00:00 UTC —
any evening in the Americas — this is tomorrow's date, so an un-dated query
there can miss the records it just wrote. Pass `date` explicitly when the
operator's local day matters.

### `batchUpdateAttendance`

Despite the name it upserts **one** record; "batch" refers to combining a fetch
and an optional update in a single call. It returns three things:

| Return field | Meaning |
|---|---|
| `attendance` | Final state after any patch. |
| `existing` | Snapshot taken **before** the patch. |
| `created` | Whether a blank row had to be created. |

`existing` is the point of the function. The attendance state machine
(`computeCheckInAction`) needs the pre-update state to decide what to write, so
this call hands the caller a get-or-create *and* the snapshot to feed the
decision, in one round trip. `fields` is `Record<string, unknown>` rather than
`Record<string, string>` so booleans and nulls can be sent for the split model.

**It silently adds `status` to your patch.** If the patch touches `arrival` or
`justified` and does *not* explicitly set `status`, `withDerivedStatus`
computes `status = deriveStatus(nextArrival, nextJustified)` and includes it,
merging the patch over the pre-update snapshot to resolve whichever of the pair
you did not send. This is what keeps the legacy enum aligned during the
migration window. Passing `status` yourself opts out entirely. Values of
`arrival` other than the three valid codes — including `""` and `null` — are
coerced to `null`, so PocketBase's empty-string default does not produce a
bogus status.

### `justifyAttendance`

| `justified` | What is written |
|---|---|
| `true` | `justified: true`, `justified_by: userId`, `justified_at: now`, `status` re-derived; `justification_reason` if `reason` was passed |
| `false` | `justified: false` and re-derived `status` **only** — `justified_by` and `justified_at` are left in place as a breadcrumb of who last applied it, and the reason is left intact |

Retaining `justified_by` / `justified_at` through a revoke is deliberate: the
question a later audit asks is "who handled this day", and clearing the fields
on un-justify would erase the only answer. Clearing the reason requires passing
`reason: ""` explicitly; omitting it leaves the field untouched, and passing
`null` writes `null`.

The function reads the record first to get its current `arrival`, so it costs a
`getOne` plus an `update`. It takes `userId` as an argument rather than reading
`pb.authStore`, keeping the module free of ambient auth state.

### Who writes `justified`, and which writers are coherent

`arrival`, `justified` and `status` encode the same fact twice, so any writer
that touches one and not the others can leave a row contradicting itself. Four
writers hit this collection; they do not all get it right.

| Writer | Path | Coherent? |
|---|---|---|
| `batchUpdateAttendance` | this package | yes — `withDerivedStatus` re-derives `status` from the incoming `arrival` plus the existing `justified` |
| `justifyAttendance` | this package | yes — re-derives `status` from the existing `arrival` plus the incoming `justified` |
| `computeCheckInAction` → dashboard | `packages/shared`, written by `checkLearnerIn` in `apps/nfc-attender` | yes — emits `time_in` + `arrival` + `justified` + `status` in one patch, as a fixpoint of `deriveStatus`/`splitStatus`. **Note this path bypasses `batchUpdateAttendance`** and PATCHes `action.fields` directly, so the coherence has to come from the action itself |
| `compute_check_in_action` → ESP32 | `apps/nfc-attender-fw`, written by `fields.cpp` | **no** — PATCHes only `time_in`, `arrival`, `status`, leaving `justified` at whatever the row held. Registered as divergence **D5** |

The device path therefore still writes rows like
`arrival: "late", justified: false, status: "jLate"` for an excused learner who
turns up. `summarizeAttendance` prefers the split pair and counts that day as
an unjustified `late`, while anything reading the legacy enum sees `jLate`.
See [Registered divergences](../shared/README.md#registered-divergences).

`resetAttendance` sets `justified: false` and nulls `arrival` and `status`
together, so it is coherent by construction.

### The duplicated `deriveStatus`

> [!WARNING]
> `deriveStatus` at the top of `src/queries/attendance.ts` is a hand-written
> copy of the function in `packages/shared/src/attendance.ts`. Two more copies
> exist: `derive_status` in C++ at
> `apps/nfc-attender-fw/src/state_machine.cpp`, and a private `splitStatus` in
> this package's own `scripts/backfill-arrival.ts`. All of them carry
> stay-in-sync comments.
>
> There are **four** implementations in total, and the fixture's own
> `implementations` array names all of them. `packages/shared` and the C++ port
> are compared in CI against that committed conformance fixture,
> `packages/shared/fixtures/attendance-state-machine.json`. **The two copies in
> this package are guarded by nothing** — the fixture constrains
> `computeCheckInAction` across the other two only, and nothing anywhere
> imports these alongside `shared` and asserts they agree.

The copies exist because the dependency edge only runs one way:
`packages/shared` imports `TIME_THRESHOLDS` from this package, so importing
`shared` from here would close a workspace cycle. The choice was a duplicated
six-line pure function over a cycle or a fourth package.

What that costs, concretely: `deriveStatus` here is exercised solely by
*indirection*, through `batchUpdateAttendance` and `justifyAttendance` cases in
`apps/nfc-attender/src/__tests__/pb-client-shared.test.ts` that assert
end-result statuses (`"jLate"`, `"late"`) rather than comparing against
`shared`. **A divergence in the mapping would be caught only by luck** — if it
happened to break one of those specific cases. `backfill-arrival.ts`'s
`splitStatus` is covered by nothing at all. Both are pure six-line functions
and would be cheap to fold into the fixture harness.

The TS/C++ pair **has already drifted** on other parts of the rule; six
divergences are registered in the fixture and tabulated in
[`packages/shared/README.md`](../shared/README.md#registered-divergences).

When you change one, change all four — and regenerate the fixture with
`pnpm gen:attendance-fixture`.

## `auth`

Collection: `users`. Thin wrappers over PocketBase auth, so the collection name
`"users"` appears in one place.

| Export | Signature | Notes |
|---|---|---|
| `login` | `(pb, email, password) => Promise<RecordAuthResponse>` | `users.authWithPassword`. |
| `loginAsLearner` | `(pb, email, password) => Promise<RecordAuthResponse>` | **Currently identical to `login`** — it does not check the role. Its own comment says the caller must verify `record.role === "learner"`. The name promises a guarantee the function does not provide; treat it as an alias. |
| `logout` | `(pb) => void` | `pb.authStore.clear()`. |
| `isAuthenticated` | `(pb) => boolean` | `pb.authStore.isValid`. |
| `getCurrentUser` | `(pb) => AuthRecord \| null` | `pb.authStore.record`. |
| `requestPasswordReset` | `(pb, email) => Promise<void>` | Sends PB's reset email. |
| `changePassword` | `(pb, { oldPassword, newPassword }) => Promise<void>` | Requires a signed-in user; throws `"Not signed in."` otherwise. |

`changePassword` sends `oldPassword` alongside `password`/`passwordConfirm`
because PocketBase rejects an authenticated password change without it. PB then
rotates the token and invalidates other sessions, so the function
**re-authenticates immediately** with the new password — otherwise every
subsequent request from the same client would 401 with no obvious cause.

## `learners`

Collection: `learners`.

| Export | Signature | Notes |
|---|---|---|
| `listLearners` | `(pb, params?: ListLearnersParams) => Promise<ListLearnersResult>` | `search` matches `name` or `email` (substring); `program` is an exact match. Sorted by `name`. Default page 1, `perPage` 50. |
| `getLearnerByNfc` | `(pb, nfcId) => Promise<Learner \| null>` | **The terminal's lookup.** Exact match on `NFC_ID`. Returns `null` rather than throwing on an unknown card. |
| `getLearnerById` | `(pb, id) => Promise<Learner \| null>` | `null` on miss. |
| `createLearner` | `(pb, { name, email, program, dob, NFC_ID? }) => Promise<Learner>` | Note this signature requires `email` and `dob`, unlike the Rust enrolment CLI — see the `types.ts` warning above. |
| `updateLearnerComment` | `(pb, learnerId, comment) => Promise<Learner>` | Patches `comments` only. |

`ListLearnersParams` is `{ page?, perPage?, search?, program? }`;
`ListLearnersResult` is `{ items, totalItems, totalPages, page }`.

Creating a learner is a guide/admin operation per the hosted collection rules;
this module does not check the role, it issues the request and lets PocketBase
reject it.

## `calendar`

Collection: `calendar`.

| Export | Signature |
|---|---|
| `fetchCalendarEvents` | `(pb) => Promise<CalRecord[]>` |
| `createCalendarEntry` | `(pb, data: CreateCalEntryPayload) => Promise<CalRecord>` |
| `getCalendarEntry` | `(pb, id) => Promise<CalRecord>` |
| `updateCalendarEntry` | `(pb, id, data: Partial<CreateCalEntryPayload>) => Promise<CalRecord>` |
| `deleteCalendarEntry` | `(pb, id) => Promise<void>` |

> [!WARNING]
> **`fetchCalendarEvents` applies no filtering at all. Its docstring describes
> filtering that lives — or is assumed to live — somewhere this repository
> cannot see.**
>
> The entire implementation is:
>
> ```ts
> return pb.collection("calendar").getFullList<CalRecord>({ sort: "start" });
> ```
>
> No `filter` option, no `type = "event"` clause, no programme predicate. The
> docstring above it describes a `type = "event"` privacy gate as
> "load-bearing" and a `programs ~ @request.auth.learner.program` clause as the
> programme filter, and states that both are enforced by the hosted PocketBase
> **collection List/View rule** rather than by the client. That framing is
> internally consistent — a client-side filter would be security theatre
> anyway, since any authenticated user can issue their own request — but two
> things follow that a reader should not have to discover the hard way:
>
> 1. **Neither gate can be verified from this repository.** The hosted schema
>    and rules are not in version control, and that docstring is the only place
>    in the repo where the `calendar` List/View rule is recorded at all —
>    `pb_hooks/README.md` documents rules for `users`, `event_rsvps` and
>    `invites`, but not `calendar`. It is a comment, so nothing verifies it
>    matches what is deployed. See
>    [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md#rules-not-documented-anywhere-in-this-repo).
> 2. **The failure mode if the rule is missing or wrong is silent
>    over-disclosure, not an error.** Every learner's `type: "class"` rows —
>    their personal schedule — would be returned to every caller, and
>    `expandEvents` in `@learnlife/shared` would render them, because it also
>    does no filtering and its own docstring likewise defers to "the PocketBase
>    list rule". There is no assertion, no test, and no runtime check anywhere
>    in the TypeScript that would notice.
>
> The rule's `~`-instead-of-`?=` workaround and the non-substring constraint it
> imposes on programme codes are documented under
> [`PROGRAM_CODES`](#program_codes). To confirm the deployed state you must
> open the PocketBase admin UI for the `calendar` collection and read its
> List/View rule. Do that before trusting the docstring.

## `invites`

Collection: `invites`, plus the custom `/api/redeem-invite` endpoint.

| Export | Signature | Notes |
|---|---|---|
| `generateInviteCode` | `() => string` | 6 characters. |
| `createInvite` | `(pb, { learnerId, email, createdBy }) => Promise<Invite>` | Expiry is set to **now + 7 days**, client-side. |
| `listInvites` | `(pb, { showUsed? }) => Promise<Invite[]>` | Defaults to active only (`used = false && expires_at > @now`). `showUsed: true` returns all history. Expands `learner`. |
| `lookupInvite` | `(pb, code) => Promise<Invite \| null>` | Upper-cases the code. Returns `null` — not an error — when the code is unknown, used, or expired, so the three cases are indistinguishable to the caller by design. |
| `redeemInvite` | `(pb, { code, password }) => Promise<{ success: true } \| { success: false; error: string }>` | Detailed below. |

`generateInviteCode` uses the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` —
**`0`, `O`, `1` and `I` are excluded** because these codes get read aloud and
transcribed by hand, and those four are where that goes wrong. The alphabet is
exactly 32 characters, a power of two, so `byte % 32` is uniformly distributed
and no rejection sampling is needed. It requires
`globalThis.crypto.getRandomValues` and **throws** if absent rather than
falling back to `Math.random` — a guessable invite code is an account takeover.
`crypto` is reached through `globalThis` explicitly because the base tsconfig
does not declare `dom`.

`redeemInvite` does **not** write to the collections itself. It `POST`s to
`/api/redeem-invite`, a custom route implemented in
[`pb_hooks/invites.pb.js`](../../pb_hooks/invites.pb.js), which performs the
invite lookup, user creation, learner back-reference update, and
mark-invite-used inside **one PocketBase transaction** and then mints an auth
token. Doing this client-side would mean four sequential unsynchronised
requests, and a failure between any two of them would leave a half-registered
user or a burned invite. The client saves the returned token into
`pb.authStore` so the app's auth context picks it up like a normal login.

Error mapping, all returned as `{ success: false, error }` rather than thrown:

| HTTP | Returned error |
|---|---|
| 400 | The hook's own message (invalid code, weak password) passed through — these are already user-safe |
| 404 | `"Registration is temporarily unavailable. Please try again later."` — **this is what you get when the hook is not deployed**, since the route simply does not exist |
| anything else | `"Couldn't redeem invite. Please try again."` |

The 404 case matters because `pb_hooks/` is uploaded to PocketHost **by hand**
with no CI. A deploy that forgets the hooks produces exactly this error, and
the message deliberately does not say "the hook is missing" because end users
see it.

## `messages`

Collections: `conversations` and `messages`.

| Export | Signature | Notes |
|---|---|---|
| `fetchConversations` | `(pb, userId) => Promise<Conversation[]>` | Filter `participants.id ?= {userId}`. Sorted `-last_message_at`. Expands `participants,last_sender`. |
| `fetchMessages` | `(pb, conversationId, { page?, perPage? }) => Promise<Message[]>` | Fetches newest-first then reverses, so the caller gets the most recent page in chronological order. `perPage` defaults to 100 and is **hard-capped at 200**. |
| `sendMessage` | `(pb, conversationId, senderId, body) => Promise<Message>` | Detailed below. |
| `createConversation` | `(pb, participantIds) => Promise<Conversation>` | Does not de-duplicate — the caller must check first. |
| `findDirectConversation` | `(pb, participantIds) => Promise<Conversation \| null>` | Builds an `AND` of `participants.id ?=` clauses, then keeps only a conversation whose participant count equals the requested count, so a 2-person query does not match a 3-person group. Order-independent. |
| `listMessageableUsers` | `(pb, { excludeUserId, search?, roles? }) => Promise<MessageableUser[]>` | Detailed below. |
| `markMessagesRead` | `(pb, conversationId, userId) => Promise<void>` | Detailed below. |
| `subscribeToMessages` | `(pb, conversationId, cb) => Promise<() => void>` | Realtime. Returns an unsubscribe function — **call it on unmount or conversation change**, or you leak a subscription. Subscribes to `"*"` and filters by `conversation` **client-side**, because PB realtime delivers all message events. |

`MessageableUser` is `{ id, name, username, email, avatar, role }` — a flat
projection, not the `User` record.

**`sendMessage` is deliberately non-atomic.** It performs two writes:
`messages.create` (with `read_by: [senderId]`, so your own message is never
unread to you) and then a `conversations.update` denormalising
`last_message` / `last_message_at` / `last_sender` for inbox rendering.
PocketBase exposes no client-side transactions, so these cannot be atomic
without a server hook. The message create is the source of truth; the
conversation update is best-effort. **If the second write fails the function
logs a warning and returns the message successfully** — throwing would tell the
user "send failed" about a message that was in fact delivered. The visible
consequence of that failure is a stale inbox preview until the next successful
send. A stronger guarantee needs a PB hook on `messages` mirroring these fields
server-side.

`listMessageableUsers` **must not filter on `email`.** PocketBase's `users`
collection protects email by default (`emailVisibility: false`), and filtering
on it returns HTTP 400 for non-owner records. The search clause is therefore
`(name ~ q || username ~ q)` only — even though `MessageableUser` still carries
an `email` field for records where it is visible. `roles` is an optional
allowlist, OR-ed together; `excludeUserId` drops the current user.

`markMessagesRead` updates each unread message individually — PB has no bulk
update — and is capped at **100 messages per call** (`MARK_READ_BATCH`) so one
user opening a long-stale conversation cannot fire thousands of writes against
the shared rate budget. The cap is well above any realistic in-session unread
count; callers can simply re-invoke if more remain.

## `rsvp`

Collection: `event_rsvps`, one row per `(event, occurrence_date, user)`.

| Export | Signature | Notes |
|---|---|---|
| `fetchRsvpsForOccurrence` | `(pb, eventId, occurrenceDate) => Promise<EventRsvp[]>` | The roster. Sorted `+position,+responded_at`; expands `user`. Used by the **guide-only** roster modal — the restriction is enforced by the collection List rule, not here. |
| `fetchMyRsvp` | `(pb, eventId, occurrenceDate, userId) => Promise<EventRsvp \| null>` | Translates PB's 404 to `null`; **re-throws any other status**, unlike most `null`-returning helpers in this package. |
| `fetchMyUpcomingRsvps` | `(pb, userId) => Promise<EventRsvp[]>` | `status != "not_going"`, sorted `-responded_at`. Badges upcoming events. |
| `submitRsvp` | `(pb, input: SubmitRsvpInput) => Promise<EventRsvp>` | Upsert — reads `fetchMyRsvp` first, then updates or creates. |
| `cancelRsvp` | `(pb, rsvpId) => Promise<void>` | Deletes the row. Triggers waitlist promotion server-side. |

`SubmitRsvpInput` is `{ eventId, occurrenceDate: string | null, userId, choice: "going" | "not_going" }`.

`occurrence_date` is `null` for a one-off event and `"YYYY-MM-DD"` for a
recurring occurrence, so `occurrenceFilter` builds two different clauses
(`occurrence_date = null` vs a bound value). Callers get the key from
`toOccurrenceDate` / `dateKeyToOccurrenceDate` in `@learnlife/shared`.

**`submitRsvp` sends the user's *intent*, not the final state.** The client
writes `status: choice` (`"going"` or `"not_going"`); the server hook
(`pb_hooks/event_rsvps.pb.js`) may rewrite it to `"waitlisted"` and assign a
`position` before persisting. Capacity and promotion arithmetic has to be
atomic — two people claiming the last seat simultaneously would both succeed if
the client did the counting — so the client never computes the final status.
`packages/shared/src/rsvp.ts` holds the same rules in pure form for optimistic
UI, but the server is authoritative.

The module's docstring records the expected `event_rsvps` API rules; they are
also in [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md#api-rules) and
[`docs/RSVP_MIGRATION.md`](../../docs/RSVP_MIGRATION.md). As with `calendar`,
these are documented expectations about a hosted instance, not something this
repo can verify.

---

## `utils/retry.ts` — `withRetry`

```ts
withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 800): Promise<T>
```

Retries `fn` **only** when the thrown error has `status === 429`. Every other
error — 400, 404, network failure — is re-thrown immediately and unwrapped.
Back-off is exponential with a factor of 1.5: 800 ms, 1200 ms, 1800 ms, for a
worst case of 3.8 s of waiting across 4 total attempts.

`fn` should be idempotent. A 429 means the request was *rejected*, so retrying
is safe in that case — but the guard only inspects `err.status`, so a `create`
retried after any 429 that did partially land would double-write. In practice
it wraps get-or-create and patch calls, which are idempotent by construction.

**Why 429 specifically, and why this exists at all.** The backend is hosted on
PocketHost, which allows **1000 requests/hour per IP**. Both NFC terminals and
the dashboard sit behind the school's single NAT address, so they share one
budget — it is not per-device. The firmware's 30-second delta-sync interval is
*derived* from that number rather than chosen (see
[`apps/nfc-attender-fw/README.md`](../../apps/nfc-attender-fw/README.md) and
[`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)):
at 10 s two devices would burn 720 req/h idle, 72% of budget; at 30 s it is 240.
Peak load is the arrival hour at roughly 500/hour against 1000 — about 2x
headroom.

429 is therefore not an exotic failure here, it is the *expected* symptom of
the morning rush overlapping something else, and it is transient by definition:
the budget is per hour, so waiting is the correct response. Nothing else in the
error space has that property, which is why the filter is exact rather than a
generic "retry on failure".

Usage in the repo is narrow — `apps/nfc-attender/src/app/utils/utils.ts` wraps
the two attendance writes in `checkLearnerIn`, the hottest path during the
arrival rush. Nothing in `apps/ll-calendar` uses it. `withRetry` is exported
from the package root; the query functions do **not** wrap themselves, so
callers opt in.

---

## `scripts/backfill-arrival.ts`

One-off migration that derives `arrival` + `justified` from the legacy `status`
enum on every `attendance` record. Not part of the public surface and not
imported by anything; it is run by hand.

```bash
# from the repo root
PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... pnpm tsx packages/pb-client/scripts/backfill-arrival.ts --dry-run
```

Drop `--dry-run` to write. `tsx` is a root devDependency, so `pnpm tsx` works
from the repo root without installing anything.

| Flag | Default | Effect |
|---|---|---|
| `--dry-run` | off | Log what would change, write nothing. |
| `--per-page=N` | 50 | Records per page. |
| `--no-sort` | off | Skip the `-date` sort. Faster on free-tier PB instances, where sorting a large collection can time out. |
| `--request-timeout=ms` | 30000 | Per-request hard timeout. |

`PB_ADMIN_EMAIL` and `PB_ADMIN_PASSWORD` are required and the script exits 1
without them. It authenticates against the `_superusers` collection — this is a
**superuser-credentialled script that writes to production**, since `PB_URL` is
the live hosted instance and there is no other environment. Run `--dry-run`
first, every time.

Mapping applied:

| Legacy `status` | → `arrival` | → `justified` |
|---|---|---|
| `present` | `present` | `false` |
| `late` | `late` | `false` |
| `absent` | `absent` | `false` |
| `jLate` | `late` | `true` |
| `jAbsent` | `absent` | `true` |
| `null` / anything else | `null` | `false` — record is skipped |

**Safe to re-run.** Two independent skip conditions make it idempotent:

- A record whose `arrival` is already one of the three valid enum values is
  skipped. The test is for a valid value, not for non-emptiness, precisely
  because PocketBase defaults a newly-added select field to `""` on pre-existing
  rows — so `""`, `null` and `undefined` all correctly read as "not yet
  migrated".
- A record whose legacy `status` maps to `arrival: null` has nothing to
  migrate and is skipped.

It never overwrites a populated `arrival`, so a guide's manual correction made
between runs survives.

Two operational details worth knowing before running it against a slow
instance: every request is wrapped in a hard timeout, because PocketBase hangs
silently on free-tier cold boots and dropped connections rather than erroring,
and there is a **50 ms sleep between writes** to stay inside the rate budget.
At 50 ms plus round-trip, a few thousand records takes minutes, not seconds.
Per-record update failures are logged and skipped, not fatal — the run
continues, and the final tally shows the gap between `would-update` and
`updated`.

It duplicates the `status → split` mapping locally rather than importing
`splitStatus` from `@learnlife/shared`, for the same dependency-cycle reason as
`deriveStatus`. **That is a fourth copy of part of this mapping.**

---

## How this package is checked

> [!WARNING]
> **This package defines no `test` script.** `pnpm test` at the repo root runs
> `pnpm -r test`, which finds test scripts in `apps/nfc-attender` and
> `apps/ll-calendar` only. `packages/pb-client` is never invoked directly by it.

| Check | Command (from repo root) | Covers |
|---|---|---|
| Types | `pnpm typecheck` → `pnpm -r --filter "./packages/*" typecheck` | The only check that targets this package directly. Runs in CI in both `.github/workflows/calendar-test.yml` and `.github/workflows/nfc-test-build.yml`. |
| Behaviour | `pnpm --filter nfc-attender test` (vitest) | `apps/nfc-attender/src/__tests__/pb-client-shared.test.ts` covers `attendance` (`batchUpdateAttendance`, `resetAttendance`, `listAttendance`, `justifyAttendance`), `invites` (all five exports), and `messages` (`sendMessage`, `markMessagesRead`, `subscribeToMessages`) against a stubbed PocketBase. Its own header notes it lives there because "the pb-client package has no test runner of its own". |

**Untested by anything:** `client.ts`, `auth.ts`, `calendar.ts`,
`learners.ts`, `rsvp.ts`, `utils/retry.ts`, and `scripts/backfill-arrival.ts`.
`retry.ts` in particular has a recursive back-off path that nothing exercises.

Nothing in this repository tests against the real PocketBase, and nothing
verifies that `src/types.ts` matches the deployed schema — see
[Where the types and the database disagree](#where-the-types-and-the-database-disagree)
and [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md#verifying-the-live-instance).

## Consumers

| Consumer | Uses |
|---|---|
| `apps/nfc-attender` (dashboard) | `createPBClient`, `PB_URL`, `PROGRAM_CODES`, `withRetry`, `attendance`, `learners`, most types |
| `apps/ll-calendar` (Expo app) | `createPBClient`, `PB_URL`, `auth`, `learners`, `calendar`, `messages`, `invites`, `rsvp`, most types |
| `packages/shared` | `TIME_THRESHOLDS` and types only — **the reason this dependency edge cannot be reversed** |
| `apps/nfc-attender-fw` (ESP32) | Nothing at runtime. It has its own C++ HTTP client and copies `TIME_THRESHOLDS` as `constexpr`, citing `src/constants.ts`. |
| `apps/nfc-attender/tools/enroll` (Rust CLI) | Nothing at runtime. It posts to `/api/collections/learners/records` directly with its own struct. |

## Related

- [`docs/POCKETBASE.md`](../../docs/POCKETBASE.md) — the backend reference: collections, fields, API rules, request budget, what cannot be verified from the repo
- [`packages/shared/README.md`](../shared/README.md) — the attendance rule specification, and the other `deriveStatus`
- [`pb_hooks/README.md`](../../pb_hooks/README.md) — the server-side hooks and the rules that are written down
- [`docs/MONOREPO_ARCHITECTURE.md`](../../docs/MONOREPO_ARCHITECTURE.md)
- [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md)
- [`docs/RSVP_MIGRATION.md`](../../docs/RSVP_MIGRATION.md) — the `event_rsvps` collection setup
- [`docs/SECURITY.md`](../../docs/SECURITY.md)
