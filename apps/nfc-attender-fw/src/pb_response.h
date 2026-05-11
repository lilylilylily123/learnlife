#pragma once

// JSON parsing for PocketBase responses. Pure ArduinoJson — compiles on the
// native test target so we can cover the field plumbing with unit tests.
//
// Mirrors the response shapes documented at:
//   https://pocketbase.io/docs/api-records/#list-search-records
//   https://pocketbase.io/docs/api-records/#auth-with-password
// and the existing TS clients in packages/pb-client/src/queries/.

#include <ctime>
#include <string>
#include <vector>

#include "pb_client.h"

namespace llattender::pb_response {

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
