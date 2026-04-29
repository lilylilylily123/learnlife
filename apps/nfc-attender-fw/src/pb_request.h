#pragma once

// URL + body construction for the PocketBase calls the firmware makes.
// Pure stdlib; the actual HTTPS call lives in pb_client.cpp.
//
// Mirrors the request shapes used by the existing TS clients:
//   packages/pb-client/src/queries/learners.ts:18-43       (listLearners)
//   packages/pb-client/src/queries/attendance.ts           (batchUpdateAttendance)
//   PocketBase SDK auth: POST /api/collections/users/auth-with-password
//
// Keeping these as pure functions lets us cover URL encoding and JSON body
// shape with native tests, leaving pb_client.cpp focused on the network call.

#include <string>

namespace llattender::pb_request {

// Percent-encode for use inside a URL query string (RFC 3986 unreserved
// set is left unmodified; everything else is %XX-encoded).
std::string percent_encode(const std::string& s);

// Strip a single trailing slash so we can join paths without doubling up.
std::string canonical_base(const std::string& base);

// POST <base>/api/collections/users/auth-with-password
std::string login_url(const std::string& base);
std::string login_body(const std::string& identity, const std::string& password);

// GET <base>/api/collections/learners/records?page=N&perPage=M&sort=name
std::string list_learners_url(const std::string& base, int page, int per_page);

// GET <base>/api/collections/attendance/records?perPage=1&page=1&filter=…
// Filter: learner = "<id>" && date ~ "<YYYY-MM-DD>"  (URL-encoded)
std::string find_today_attendance_url(const std::string& base,
                                      const std::string& learner_id,
                                      const std::string& date_yyyy_mm_dd);

// POST <base>/api/collections/attendance/records
// Body: {"learner":"<id>","date":"<YYYY-MM-DD>"}
std::string create_attendance_url(const std::string& base);
std::string create_attendance_body(const std::string& learner_id,
                                   const std::string& date_yyyy_mm_dd);

// PATCH <base>/api/collections/attendance/records/<id>
std::string patch_attendance_url(const std::string& base,
                                 const std::string& attendance_id);

}  // namespace llattender::pb_request
