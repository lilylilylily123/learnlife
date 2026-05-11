// Unit tests for pb_response — JSON parsing of PocketBase responses.

#include <unity.h>

#include <string>

#include "pb_client.h"
#include "pb_response.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

// ── login ────────────────────────────────────────────────────────────────────

void test_parse_login_extracts_token() {
  // Real-shape response — the SDK returns both `token` and `record`.
  const std::string body =
      "{\"token\":\"eyJhbGciOiJIUzI1NiIs.payload.sig\","
      "\"record\":{\"id\":\"u1\",\"email\":\"x@y.com\"}}";
  std::string tok;
  TEST_ASSERT_TRUE(pb_response::parse_login(body, tok));
  TEST_ASSERT_EQUAL_STRING("eyJhbGciOiJIUzI1NiIs.payload.sig", tok.c_str());
}

void test_parse_login_rejects_missing_token() {
  std::string tok = "preserved";
  TEST_ASSERT_FALSE(pb_response::parse_login("{\"record\":{}}", tok));
  // On failure the out param is left untouched.
  TEST_ASSERT_EQUAL_STRING("preserved", tok.c_str());
}

void test_parse_login_rejects_bad_json() {
  std::string tok;
  TEST_ASSERT_FALSE(pb_response::parse_login("not json", tok));
}

// ── learners list ────────────────────────────────────────────────────────────

void test_parse_learners_page_basic() {
  const std::string body =
      "{\"page\":1,\"perPage\":2,\"totalItems\":3,\"totalPages\":2,"
      "\"items\":["
        "{\"id\":\"l1\",\"name\":\"Alice\",\"NFC_ID\":\"deadbeef\","
         "\"program\":\"chmk\"},"
        "{\"id\":\"l2\",\"name\":\"Bob\",\"NFC_ID\":null,"
         "\"program\":\"cre\"}"
      "]}";
  pb_response::LearnersPage page;
  TEST_ASSERT_TRUE(pb_response::parse_learners_page(body, page));
  TEST_ASSERT_EQUAL_INT(1, page.page);
  TEST_ASSERT_EQUAL_INT(2, page.total_pages);
  TEST_ASSERT_EQUAL_INT(3, page.total_items);
  TEST_ASSERT_EQUAL_size_t(2u, page.items.size());

  TEST_ASSERT_EQUAL_STRING("l1",       page.items[0].id.c_str());
  TEST_ASSERT_EQUAL_STRING("Alice",    page.items[0].name.c_str());
  TEST_ASSERT_EQUAL_STRING("deadbeef", page.items[0].nfc_id.c_str());
  TEST_ASSERT_EQUAL_STRING("chmk",     page.items[0].program.c_str());

  TEST_ASSERT_EQUAL_STRING("l2",   page.items[1].id.c_str());
  TEST_ASSERT_EQUAL_STRING("Bob",  page.items[1].name.c_str());
  // null NFC_ID becomes empty — learner is still in the roster but won't match
  // any UID. Mirrors the TS shape `string | null`.
  TEST_ASSERT_EQUAL_STRING("",     page.items[1].nfc_id.c_str());
}

void test_parse_learners_page_empty_items() {
  const std::string body =
      "{\"page\":1,\"perPage\":50,\"totalItems\":0,\"totalPages\":1,\"items\":[]}";
  pb_response::LearnersPage page;
  TEST_ASSERT_TRUE(pb_response::parse_learners_page(body, page));
  TEST_ASSERT_EQUAL_size_t(0u, page.items.size());
  TEST_ASSERT_EQUAL_INT(1, page.total_pages);
}

void test_parse_learners_page_skips_rows_without_id() {
  // Malformed row missing `id` — skip it but keep parsing.
  const std::string body =
      "{\"items\":["
        "{\"name\":\"NoId\"},"
        "{\"id\":\"l1\",\"name\":\"Alice\"}"
      "]}";
  pb_response::LearnersPage page;
  TEST_ASSERT_TRUE(pb_response::parse_learners_page(body, page));
  TEST_ASSERT_EQUAL_size_t(1u, page.items.size());
  TEST_ASSERT_EQUAL_STRING("l1", page.items[0].id.c_str());
}

void test_parse_learners_page_rejects_bad_json() {
  pb_response::LearnersPage page;
  TEST_ASSERT_FALSE(pb_response::parse_learners_page("nope", page));
}

// ── attendance search (list response) ────────────────────────────────────────

void test_parse_attendance_search_finds_record() {
  const std::string body =
      "{\"items\":["
        "{\"id\":\"a1\",\"learner\":\"l1\",\"date\":\"2026-05-06\","
         "\"time_in\":\"2026-05-06T09:30:00.000Z\","
         "\"time_out\":\"\","
         "\"status\":\"present\","
         "\"lunch_status\":\"\","
         "\"lunch_events\":[{\"type\":\"out\",\"time\":\"2026-05-06T13:05:00.000Z\"}]"
        "}"
      "]}";
  pb_client::AttendanceRow row;
  TEST_ASSERT_TRUE(pb_response::parse_attendance_search(body, row));
  TEST_ASSERT_EQUAL_STRING("a1",          row.id.c_str());
  TEST_ASSERT_EQUAL_STRING("l1",          row.learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-05-06",  row.date.c_str());
  TEST_ASSERT_EQUAL_STRING("present",     row.status.c_str());
  TEST_ASSERT_EQUAL_STRING("",            row.lunch_status.c_str());
  TEST_ASSERT_EQUAL_STRING(
      "[{\"type\":\"out\",\"time\":\"2026-05-06T13:05:00.000Z\"}]",
      row.lunch_events_json.c_str());
}

void test_parse_attendance_search_no_match_is_not_an_error() {
  // Empty items array means "no record exists yet" — caller should create one.
  pb_client::AttendanceRow row;
  row.id = "stale";  // ensure parser zeroes the row
  TEST_ASSERT_TRUE(pb_response::parse_attendance_search(
      "{\"items\":[],\"totalItems\":0}", row));
  TEST_ASSERT_EQUAL_STRING("", row.id.c_str());
}

void test_parse_attendance_search_propagates_legacy_lunch_fields() {
  // Records created before lunch_events array — state machine still consults
  // these (attendance.ts:127).
  const std::string body =
      "{\"items\":["
        "{\"id\":\"a2\",\"learner\":\"l2\",\"date\":\"2025-09-01\","
         "\"lunch_out\":\"2025-09-01T13:10:00.000Z\","
         "\"lunch_in\":null,"
         "\"lunch_events\":null}"
      "]}";
  pb_client::AttendanceRow row;
  TEST_ASSERT_TRUE(pb_response::parse_attendance_search(body, row));
  TEST_ASSERT_EQUAL_STRING("2025-09-01T13:10:00.000Z",
                           row.lunch_out_legacy.c_str());
  TEST_ASSERT_EQUAL_STRING("", row.lunch_in_legacy.c_str());
  TEST_ASSERT_EQUAL_STRING("", row.lunch_events_json.c_str());
}

void test_parse_attendance_search_rejects_bad_json() {
  pb_client::AttendanceRow row;
  TEST_ASSERT_FALSE(pb_response::parse_attendance_search("{", row));
}

// ── attendance single record (create / patch response) ───────────────────────

void test_parse_attendance_record_basic() {
  const std::string body =
      "{\"id\":\"a3\",\"learner\":\"l3\",\"date\":\"2026-05-07\","
       "\"time_in\":\"\",\"time_out\":\"\","
       "\"status\":\"\",\"lunch_status\":\"\","
       "\"lunch_events\":null}";
  pb_client::AttendanceRow row;
  TEST_ASSERT_TRUE(pb_response::parse_attendance_record(body, row));
  TEST_ASSERT_EQUAL_STRING("a3", row.id.c_str());
  TEST_ASSERT_EQUAL_STRING("l3", row.learner_id.c_str());
}

void test_parse_attendance_record_rejects_missing_id() {
  pb_client::AttendanceRow row;
  TEST_ASSERT_FALSE(pb_response::parse_attendance_record(
      "{\"learner\":\"l1\"}", row));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_parse_login_extracts_token);
  RUN_TEST(test_parse_login_rejects_missing_token);
  RUN_TEST(test_parse_login_rejects_bad_json);
  RUN_TEST(test_parse_learners_page_basic);
  RUN_TEST(test_parse_learners_page_empty_items);
  RUN_TEST(test_parse_learners_page_skips_rows_without_id);
  RUN_TEST(test_parse_learners_page_rejects_bad_json);
  RUN_TEST(test_parse_attendance_search_finds_record);
  RUN_TEST(test_parse_attendance_search_no_match_is_not_an_error);
  RUN_TEST(test_parse_attendance_search_propagates_legacy_lunch_fields);
  RUN_TEST(test_parse_attendance_search_rejects_bad_json);
  RUN_TEST(test_parse_attendance_record_basic);
  RUN_TEST(test_parse_attendance_record_rejects_missing_id);
  return UNITY_END();
}
