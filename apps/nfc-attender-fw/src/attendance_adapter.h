#pragma once

// Bridge between the PocketBase response shape (`pb_client::AttendanceRow`)
// and the state-machine input (`AttendanceState`). Pure stdlib + ArduinoJson;
// compiles on the native target so we can unit-test the conversion.
//
// Mirrors the implicit conversion done in the TS code at
//   packages/shared/src/attendance.ts:50-79 (which reads AttendanceState
//   directly off the PB record).

#include "pb_client.h"
#include "state_machine.h"

namespace llattender::attendance_adapter {

// Populate `out` with a snapshot the state machine can consume. `now_unix` is
// used to fill `LunchEvent::time_unix` when the stored ISO timestamp is parsed
// (currently parses ISO-8601 with millisecond precision and a trailing Z).
void state_from_row(const pb_client::AttendanceRow& row,
                    AttendanceState& out);

}  // namespace llattender::attendance_adapter
