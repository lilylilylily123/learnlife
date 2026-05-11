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
};

// Authenticate with the device account stored in NVS. Caches the token.
bool login();

// Pull every learner. Equivalent to listLearners({ perPage: 500 }).
bool fetch_roster(std::vector<LearnerRow>& out);

// Fetch every attendance row for `date` and stash them in the in-memory
// today-cache. Called once at boot so every learner's first tap of the day
// is fast (no synchronous network roundtrip on the scan path).
bool prefetch_today_attendance(const std::string& date_yyyy_mm_dd);

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

// Apply an action's field changes to the in-memory cached row for `learner_id`
// so the next scan reads the predicted post-action state instead of hitting
// the network. Caller passes the action they're about to enqueue.
void update_today_cache_after_action(const std::string& learner_id,
                                     const CheckInAction& action);

}  // namespace llattender::pb_client
