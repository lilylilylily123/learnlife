#pragma once

// C++ port of computeCheckInAction() from
//   packages/shared/src/attendance.ts:50-164
// Constants come from
//   packages/pb-client/src/constants.ts:15-26
//
// Pure logic — no Arduino, no PocketBase. Compiles on the native PlatformIO
// env so we can run the same fixture cases as the TS Vitest suite.

#include <ctime>
#include <string>
#include <vector>

namespace llattender {

// Mirror of `AttendanceStatus` in packages/pb-client/src/constants.ts:12.
enum class Status {
  None,
  Present,
  Late,
  Absent,
  JLate,
  JAbsent,
};

const char* status_to_str(Status s);
Status status_from_str(const char* s);  // returns None on unknown

// Map the split (arrival, justified) representation onto the legacy combined
// `status` enum. Mirrors deriveStatus in packages/shared/src/attendance.ts:24-32
// (and its copy in packages/pb-client/src/queries/attendance.ts). Being on
// time is never justified, so Present always maps to Present.
Status derive_status(Status arrival, bool justified);

struct LunchEvent {
  enum Type { Out, In } type;
  // Stored as both unix seconds (for math) and the ISO-8601 string PocketBase
  // expects. The state machine emits new events with both fields populated.
  std::time_t time_unix = 0;
  std::string time_iso;
};

// Snapshot of today's PocketBase row for one learner. NO LONGER a full mirror
// of the `AttendanceState` struct in attendance.ts: the spec carries a
// `justified` field and this does not, so prior justification can only be
// decoded here from the legacy `status` enum. An excusal recorded only in
// PocketBase's `justified` column is invisible to this port, which then
// derives `late` where the spec derives `jLate` — divergence D5, undecided.
// See packages/shared/fixtures/attendance-state-machine.json and
// docs/TESTING.md. The write half of D5 is in fields.cpp.
struct AttendanceState {
  bool has_time_in = false;
  bool has_time_out = false;
  std::vector<LunchEvent> lunch_events;
  // Legacy single-field fallback (attendance.ts:127). True iff the legacy
  // column was set on the row.
  bool has_lunch_out_legacy = false;
  bool has_lunch_in_legacy = false;
  Status status = Status::None;
  Status lunch_status = Status::None;
};

enum class ActionType {
  CheckIn,
  LunchEvent,
  LateLunchReturn,
  CheckOut,
  Locked,    // scan rejected because we're in the no-scan window
  NoAction,
};

// Discriminated outcome of the state machine. The caller reads the fields
// relevant to `type` and ignores the rest.
struct CheckInAction {
  ActionType type = ActionType::NoAction;

  // CheckIn
  std::string time_in_iso;
  Status status = Status::None;
  // `arrival` is the source of truth; `status` is written alongside it so
  // legacy consumers keep working (attendance.ts:82-90).
  Status arrival = Status::None;

  // CheckOut
  std::string time_out_iso;

  // LunchEvent / LateLunchReturn — full updated array, ready to JSON-encode.
  std::vector<LunchEvent> lunch_events_after;
  bool set_lunch_status = false;
  Status lunch_status = Status::None;

  // NoAction
  const char* reason = nullptr;
};

// Compute the next attendance action. `local_now` carries hour/minute/weekday
// in the school's local timezone (matches the TS code which uses Date.getHours
// etc., not UTC). `now_unix` is the same instant as a unix timestamp used to
// build ISO-8601 strings written into the PocketBase fields.
CheckInAction compute_check_in_action(const AttendanceState& state,
                                      const std::tm& local_now,
                                      std::time_t now_unix);

// Format a unix timestamp as PocketBase-compatible ISO-8601 with millisecond
// precision and a trailing "Z" — same shape as JS `Date.toISOString()`.
std::string format_iso8601(std::time_t t);

}  // namespace llattender
