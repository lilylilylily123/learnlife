#pragma once

// On-disk format for /queue.jsonl entries (despite the name — we use a
// pipe-delimited format, not JSON, so the parser stays trivial).
//
// Line shape:
//   v1|<learner_id>|<attendance_id>|<ts_unix>|<fields_json>
//
// All four data fields are produced by code we control:
//   - learner_id / attendance_id are PocketBase 15-char alnum or empty
//   - ts_unix is a decimal integer
//   - fields_json is the body produced by fields::serialize_action(), which
//     by construction contains JSON syntax but never a literal pipe
// so a single pass split on '|' uniquely recovers the fields.
//
// The "v1" prefix lets us evolve the format later without breaking older
// queues — phase-3 firmware can detect "v2" lines and parse them differently
// while still draining old "v1" entries left over from a previous boot.

#include <string>

#include "queue.h"

namespace llattender::queue_format {

constexpr char kDelimiter = '|';
constexpr const char* kVersion = "v1";

std::string serialize(const queue::PendingScan& scan);

// Returns false if the line does not have exactly 4 delimiters, doesn't
// start with the version tag, or has an empty learner_id.
bool parse(const std::string& line, queue::PendingScan& out);

}  // namespace llattender::queue_format
