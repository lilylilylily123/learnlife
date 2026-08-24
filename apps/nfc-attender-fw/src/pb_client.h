#pragma once

// HTTPS calls to PocketBase — mirrors the request shape of
//   packages/pb-client/src/queries/learners.ts:18-43
//   packages/pb-client/src/queries/attendance.ts (batchUpdateAttendance)

#include <string>
#include <vector>

#include "state_machine.h"

namespace llattender::pb_client {

struct LearnerRow {
  std::string id;
  std::string name;
  std::string nfc_id;   // matches `NFC_ID` field in the learners collection
  std::string program;
};

struct AttendanceRow {
  std::string id;
  std::string learner_id;
  std::string date;     // YYYY-MM-DD
  // The remaining fields are reflected as a snapshot consumable by the
  // state machine. Empty strings represent NULL.
  std::string time_in;
  std::string time_out;
  std::string lunch_events_json;  // raw JSON array; parsed elsewhere
  std::string status;
  std::string lunch_status;
  // Legacy fields kept for compatibility with rows created before the
  // lunch_events array was introduced. The state machine consults them as
  // a fallback (mirrors attendance.ts:127).
  std::string lunch_out_legacy;
  std::string lunch_in_legacy;
  // PocketBase's own last-modified timestamp. Drives the delta-sync
  // watermark: the device asks for rows with `updated > <max seen>` rather
  // than re-fetching the whole day, which is what keeps the poll inside
  // PocketHost's per-IP request budget.
  std::string updated;
};

// Create the mutex guarding this module's shared state. MUST be called from
// setup() before any task starts.
//
// Everything in pb_client.cpp's anonymous namespace — the bearer token, the
// config snapshot, and the today-cache — is reachable from three different
// FreeRTOS contexts:
//
//   processor_task (core 1)  ensure_today_row, update_today_cache_after_action
//   network_task   (core 0)  login, fetch_roster, prefetch, patch_attendance
//   the Arduino loop task    the `w` and `c` serial console commands
//
// std::map and std::string are not thread-safe, and two of those paths also
// write /today.json. Concurrent access corrupts the heap, which surfaces as an
// unexplained reboot long after the fact.
void init();

// Authenticate with the device account stored in NVS. Caches the token in RAM
// and NVS, with the expiry read from the token's own `exp` claim.
bool login();

// Ensure a usable bearer token exists, logging in only if the cached one is
// missing or close to expiry. Prefer this over login() — on a reboot it
// normally reuses the token from NVS and skips the round-trip entirely.
bool ensure_token();

// Drop the cached token from RAM and NVS. Called after a 401, so the next
// request re-authenticates rather than retrying a credential the server has
// already rejected.
void clear_token();

// Pull every learner. Equivalent to listLearners({ perPage: 500 }).
bool fetch_roster(std::vector<LearnerRow>& out);

// Fetch every attendance row for `date` and stash them in the in-memory
// today-cache. Called once at boot so every learner's first tap of the day
// is fast (no synchronous network roundtrip on the scan path).
bool prefetch_today_attendance(const std::string& date_yyyy_mm_dd);

// Pull only the attendance rows PocketBase has modified since the last poll,
// and merge them into the today-cache. `out_changed` receives how many rows
// actually came back — usually zero.
//
// This is what makes a dashboard edit (Reset day, a justification, a manual
// time correction) reach the device without a reboot. A full re-fetch would do
// the same job, but PocketHost allows 1000 requests/hour per IP and both
// devices plus the dashboard share the school's NAT — so the poll asks for a
// delta instead, which is normally a single request returning an empty page.
//
// Returns false if there is no watermark yet (nothing fetched for `date`), in
// which case the caller should run a full prefetch first.
bool refresh_today_delta(const std::string& date_yyyy_mm_dd, int& out_changed);

// Restore the today-cache from /today.json on LittleFS, but only if the
// persisted date matches `today`. Returns true if the cache was repopulated
// so the caller can skip the network pre-fetch.
bool load_today_cache_from_disk(const std::string& date_yyyy_mm_dd);

// Wipe the in-memory + on-disk today-cache. The PB row itself is untouched —
// the next tap will re-fetch (and may still see existing time_in/lunch_events
// from PB). Intended for test mode; combine with manual PB row deletion for a
// fully clean slate.
void clear_today_cache();

// Get-or-create today's attendance row for `learner_id`. On success, fills
// `out` and sets `created` true if a new row was inserted.
bool ensure_today_row(const std::string& learner_id,
                      const std::string& date_yyyy_mm_dd,
                      AttendanceRow& out, bool& created);

// PATCH an existing attendance row with the fields produced by the state
// machine. `fields_json` is a serialised object like {"time_in":"…","status":"present"}.
bool patch_attendance(const std::string& attendance_id,
                      const std::string& fields_json);

// As patch_attendance, but returns the HTTP status so the caller can tell a
// transient failure from a permanent one. Negative values are HTTPClient
// transport errors, matching its own convention.
//
// The queue drain needs this: a 404 means the row was deleted server-side and
// retrying can never succeed, and because a failed drain stops at the head of
// the queue, retrying forever would block every scan behind it. Feed the
// result to classify_http_status() in pb_result.h.
int patch_attendance_status(const std::string& attendance_id,
                            const std::string& fields_json);

// Apply an action's field changes to the in-memory cached row for `learner_id`
// so the next scan reads the predicted post-action state instead of hitting
// the network. Caller passes the action they're about to enqueue.
void update_today_cache_after_action(const std::string& learner_id,
                                     const CheckInAction& action);

}  // namespace llattender::pb_client
