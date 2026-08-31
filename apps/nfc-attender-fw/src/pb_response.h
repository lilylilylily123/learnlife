#pragma once

// JSON parsing for PocketBase responses. Pure ArduinoJson — compiles on the
// native test target so we can cover the field plumbing with unit tests.
//
// Mirrors the response shapes documented at:
//   https://pocketbase.io/docs/api-records/#list-search-records
//   https://pocketbase.io/docs/api-records/#auth-with-password
// and the existing TS clients in packages/pb-client/src/queries/.

#include <ctime>
#include <functional>
#include <string>
#include <vector>

#include "json_source.h"
#include "pb_client.h"

namespace llattender::pb_response {

// ── Streaming API ────────────────────────────────────────────────────────
//
// The whole-string parsers below are convenient but allocate the response
// twice: once as a std::string holding the body, and again inside
// ArduinoJson's arena. With 61 learners and TLS already holding ~40 KB, that
// is more than the ESP32 has — which is why the periodic prefetch was
// disabled with an OOM note rather than shipped.
//
// The streaming versions parse straight from the socket and hand each row to
// a sink as it is decoded, so no vector of rows ever exists. They also apply
// a DeserializationOption::Filter, so fields nothing reads (collectionId,
// collectionName, created, expand) are skipped without being allocated at all.
//
// The std::string overloads are kept as thin wrappers over these — same code
// path, one extra copy — because every existing test exercises them and they
// are still the right tool for a single small record.

struct PageMeta {
  int page = 0;
  int total_pages = 0;
  int total_items = 0;
};

// Return false from a sink to stop parsing early (e.g. a cache filled up).
// Rows are moved in, so a sink that keeps one pays no copy.
using AttendanceRowSink = std::function<bool(pb_client::AttendanceRow&&)>;
using LearnerRowSink = std::function<bool(pb_client::LearnerRow&&)>;

// PocketBase emits page/perPage/totalItems/totalPages BEFORE items, so `meta`
// is fully populated by the time the first sink call happens — callers can
// rely on it for pagination decisions inside the sink.
bool stream_attendance_page(ByteSource& src, PageMeta& meta,
                            const AttendanceRowSink& sink);
bool stream_learners_page(ByteSource& src, PageMeta& meta,
                          const LearnerRowSink& sink);

// Parse the body of `POST /api/collections/users/auth-with-password`.
// On success, populates `out_token`. Returns false on JSON error or missing
// `token` field.
bool parse_login(const std::string& json, std::string& out_token);

struct LearnersPage {
  std::vector<pb_client::LearnerRow> items;
  int page = 0;
  int total_pages = 0;
  int total_items = 0;
};

// Parse the body of `GET /api/collections/learners/records?...`.
// PocketBase returns a paged list; the caller iterates pages until
// `page == total_pages`.
bool parse_learners_page(const std::string& json, LearnersPage& out);

// Parse the body of the find-today filter request (a paged list).
// If `items` is empty, returns true with `out.id` empty so the caller can
// decide to create a new record. Returns false only on JSON parse failure.
bool parse_attendance_search(const std::string& json,
                             pb_client::AttendanceRow& out);

struct AttendancePage {
  std::vector<pb_client::AttendanceRow> items;
  int page = 0;
  int total_pages = 0;
  int total_items = 0;
};

// Parse the body of `GET /api/collections/attendance/records?filter=date~"…"`.
// Used by the boot-time pre-fetch that populates the cache so the first tap
// of every card is fast.
bool parse_attendance_page(const std::string& json, AttendancePage& out);

// Parse a single attendance record payload (the body of a create or patch
// response). Returns false on JSON error or missing `id`.
bool parse_attendance_record(const std::string& json,
                             pb_client::AttendanceRow& out);

}  // namespace llattender::pb_response
