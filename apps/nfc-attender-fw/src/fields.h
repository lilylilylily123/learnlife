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
//   CheckIn (present)   → {"time_in":"2026-04-08T09:00:00.000Z","status":"present"}
//   CheckIn (late)      → {"time_in":"…","status":"late"}
//   LunchEvent (out)    → {"lunch_events":"[{\"type\":\"out\",\"time\":\"…\"}]"}
//   LunchEvent (in,ok)  → {"lunch_events":"[…]","lunch_status":"present"}
//   LateLunchReturn     → {"lunch_events":"[…]","lunch_status":"late"}
//   CheckOut            → {"time_out":"…"}
//   NoAction            → "" (empty)
std::string serialize_action(const CheckInAction& action);

// Build the lunch_events ARRAY (not an object) — emitted as compact JSON,
// no whitespace. Exposed for tests; serialize_action wraps and escapes it
// before placing it as a string value in the PATCH body.
std::string serialize_lunch_events_array(const std::vector<LunchEvent>& events);

// JSON-escape a single string value (does NOT add surrounding quotes).
// Handles ", \, control chars, newlines.
std::string json_escape(const std::string& s);

}  // namespace llattender::fields
