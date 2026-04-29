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
};

// Authenticate with the device account stored in NVS. Caches the token.
bool login();

// Pull every learner. Equivalent to listLearners({ perPage: 500 }).
bool fetch_roster(std::vector<LearnerRow>& out);

// Get-or-create today's attendance row for `learner_id`. On success, fills
// `out` and sets `created` true if a new row was inserted.
bool ensure_today_row(const std::string& learner_id,
                      const std::string& date_yyyy_mm_dd,
                      AttendanceRow& out, bool& created);

// PATCH an existing attendance row with the fields produced by the state
// machine. `fields_json` is a serialised object like {"time_in":"…","status":"present"}.
bool patch_attendance(const std::string& attendance_id,
                      const std::string& fields_json);

}  // namespace llattender::pb_client
