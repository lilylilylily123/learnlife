Scheduler & Test Mode
=====================

Overview
--------
This repo includes light-weight scheduled attendance jobs that mark:

- Absent: learners who never checked-in by the morning cutoff (10:05 local time)
- Lunch Late: learners who went `lunch_out` but did not `lunch_in` by the lunch cutoff (14:05 local time)

Files
-----

- `src/server/jobs/scheduledAttendance.js` — job implementations. Exposes `markAbsent({dryRun})` and `markLunchLate({dryRun})`. Also runnable from CLI.
- `src/server/worker/scheduler.js` — a simple scheduler that runs the two jobs daily at the configured local times. Supports test mode.

Environment
-----------

Set these environment variables (or provide via your process manager):

```
PB_URL=https://learnlife.pockethost.io
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=secret
TEST_MODE=true        # optional — run jobs immediately for testing
DRY_RUN=true          # optional — do not perform writes; only logs what would change
```

How to run
----------

Run a one-off dry-run of both jobs:

```bash
node src/server/jobs/scheduledAttendance.js --dry-run
```

Run a single job (apply changes):

```bash
PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node src/server/jobs/scheduledAttendance.js mark-absent
```

Start the scheduler (production):

```bash
PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node src/server/worker/scheduler.js
```

Start the scheduler in test mode (runs immediately, then schedules):

```bash
TEST_MODE=true DRY_RUN=true node src/server/worker/scheduler.js --test --exit-after-test
```

Notes
-----

- These scripts are intentionally simple and have no external queue dependency so they are easy to run locally for testing.
- For production scale you should run a managed worker (systemd, PM2, or a container) and add proper monitoring, retries, and idempotency keys.
- The job logic uses the PocketBase admin credentials when present; if none are supplied the scripts attempt unauthenticated reads/updates and may fail due to PB permissions.
