# PocketBase Hooks

Server-side JavaScript hooks for the LearnLife PocketBase backend. Upload
`*.pb.js` files to Pockethost (Settings → Files → `pb_hooks/`) for them to take
effect.

## Required collection rules

These rules must be set in the Pockethost admin UI — hooks alone are not
enough; PB evaluates collection rules before hooks fire.

### `users`

| Rule    | Expression                                                                |
| ------- | ------------------------------------------------------------------------- |
| List    | `id = @request.auth.id \|\| @request.auth.role = "admin"`                 |
| View    | `id = @request.auth.id \|\| @request.auth.role = "admin"`                 |
| Create  | `@request.body.role:isset = false \|\| @request.body.role = "learner"`    |
| Update  | `id = @request.auth.id \|\| @request.auth.role = "admin"`                 |
| Delete  | `@request.auth.role = "admin"`                                            |

`users.pb.js` enforces the same constraints again at the hook layer.

### `learners`, `attendance`

Both should restrict reads to guides/admins:

```
@request.auth.role = "lg" || @request.auth.role = "admin"
```

### `event_rsvps`

| Rule    | Expression                                                                            |
| ------- | ------------------------------------------------------------------------------------- |
| List    | `user = @request.auth.id \|\| @request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| View    | `user = @request.auth.id \|\| @request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| Create  | `@request.auth.id != "" && user = @request.auth.id`                                   |
| Update  | `user = @request.auth.id \|\| @request.auth.role = "lg" \|\| @request.auth.role = "admin"` |
| Delete  | `user = @request.auth.id \|\| @request.auth.role = "admin"`                           |

`event_rsvps.pb.js` re-checks the `user` field against `@request.auth.id` on
every create/update so a misconfigured rule can't be exploited to RSVP on
another user's behalf.

### `audit_log` (optional, but recommended)

Append-only log of privileged user actions (CSV exports, bulk edits). Created
by `apps/nfc-attender/src/lib/audit.ts`; failure to write is non-blocking.

| Field   | Type                          | Notes                                |
| ------- | ----------------------------- | ------------------------------------ |
| actor   | relation → users (optional)   | null for anonymous events            |
| action  | text (required)               | stable id, e.g. `csv_export`         |
| details | json (optional)               | structured context                   |

| Rule    | Expression                                                                |
| ------- | ------------------------------------------------------------------------- |
| List    | `@request.auth.role = "admin"`                                            |
| View    | `@request.auth.role = "admin"`                                            |
| Create  | `@request.auth.role = "lg" \|\| @request.auth.role = "admin"`             |
| Update  | _(empty — block all writes)_                                              |
| Delete  | _(empty — block all writes)_                                              |

## Custom routes

### `POST /api/redeem-invite` (invites.pb.js)

Atomic invite redemption. Replaces the old client-side multi-call flow.
Body: `{ code: "ABC123", password: "..." }`. Returns the standard PB
record-auth response (`{ token, record }`). The hook runs the invite lookup,
user creation, learner back-reference update, and invite-mark-used inside a
single transaction — failure rolls everything back.

Requires the `invites` collection to have:
- `code` (text, unique), `learner` (relation), `email` (email)
- `expires_at` (datetime), `used` (bool), `used_at` (datetime, optional)

The route is unauthenticated by design (anonymous users redeeming codes), but
guards the input with regex (`/^[A-Z0-9]{6}$/` on code, min length on
password) before any DB work.
