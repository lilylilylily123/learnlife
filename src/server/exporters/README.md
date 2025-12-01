PowerSchool exporter
====================

This folder contains a minimal skeleton to export attendance to a PowerSchool instance.

Usage and next steps
- Replace the endpoint URL and payload mapping in `powerschool.ts` with your district's API.
- Implement secure storage for credentials (do not keep plaintext env in production).
- Run exports from a background worker (BullMQ, sidekiq-like worker, or serverless cron).
- Add idempotency and retry tracking in a job store so repeated calls don't double-post.

Environment variables
- `PS_BASE_URL` - base url for PowerSchool API.
- `PS_USERNAME` / `PS_PASSWORD` - basic auth credentials (if used).
- `PS_API_KEY` - bearer token (if used).
- `PS_SCHOOL_ID` - (optional) id to include in the export payload.

Local test
1. Populate `.env` with the required variables.
2. Call the `runAttendanceExport` helper from a Node script with a sample batch.
