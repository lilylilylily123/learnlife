#pragma once

// Serialise a CheckInAction into the JSON body PocketBase expects on the
// attendance PATCH/POST. Mirrors the field set that the existing TS code
// produces (see attendance.ts:30-34 — the discriminated union's `fields`
// payload) so PocketBase rows look identical regardless of which client
// wrote them.
//
// Pure stdlib so it builds on the native test env. No ArduinoJson dep —
// the field set is small and well-known, so a hand-rolled emitter with
// proper string escaping is simpler than dragging the lib into native.

#include <string>

#include "state_machine.h"

namespace llattender::fields {

// Returns the JSON object body for the PATCH request, or an empty string
// for ActionType::NoAction (caller should not write in that case).
//
// Examples:
//   CheckIn (present)   → {"time_in":"2026-04-08T09:00:00.000Z","arrival":"present","status":"present"}
//   CheckIn (late)      → {"time_in":"…","arrival":"late","status":"late"}
//   CheckIn (excused)   → {"time_in":"…","arrival":"late","status":"jLate"}
//   LunchEvent (out)    → {"lunch_events":"[{\"type\":\"out\",\"time\":\"…\"}]"}
//   LunchEvent (in,ok)  → {"lunch_events":"[…]","lunch_status":"present"}
//   LateLunchReturn     → {"lunch_events":"[…]","lunch_status":"late"}
//   CheckOut            → {"time_out":"…"}
//   NoAction            → "" (empty)
//
// NB: the CheckIn bodies above are this port's field set, NOT the spec's. The
// TS check_in also emits `justified` alongside arrival/status, so a device tap
// on a justified learner leaves that column untouched and the row contradicts
// itself — divergence D5, undecided. See
// packages/shared/fixtures/attendance-state-machine.json and docs/TESTING.md.
// Do not "align" either side without a decision on both.
std::string serialize_action(const CheckInAction& action);

// Build the lunch_events ARRAY (not an object) — emitted as compact JSON,
// no whitespace. Exposed for tests; serialize_action wraps and escapes it
// before placing it as a string value in the PATCH body.
std::string serialize_lunch_events_array(const std::vector<LunchEvent>& events);

// JSON-escape a single string value (does NOT add surrounding quotes).
// Handles ", \, control chars, newlines.
std::string json_escape(const std::string& s);

}  // namespace llattender::fields
