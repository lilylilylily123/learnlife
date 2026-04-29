// Round-trip tests for the offline-queue line format.

#include <unity.h>

#include "queue.h"
#include "queue_format.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_serialize_round_trip_check_in() {
  queue::PendingScan in;
  in.learner_id = "abc123def456789";
  in.attendance_id = "xyz789ghi012345";
  in.ts_unix = 1714316400;  // arbitrary
  in.fields_json = "{\"time_in\":\"2026-04-08T09:00:00.000Z\",\"status\":\"present\"}";

  std::string line = queue_format::serialize(in);
  TEST_ASSERT_EQUAL_STRING(
      "v1|abc123def456789|xyz789ghi012345|1714316400|"
      "{\"time_in\":\"2026-04-08T09:00:00.000Z\",\"status\":\"present\"}",
      line.c_str());

  queue::PendingScan out;
  TEST_ASSERT_TRUE(queue_format::parse(line, out));
  TEST_ASSERT_EQUAL_STRING(in.learner_id.c_str(), out.learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING(in.attendance_id.c_str(), out.attendance_id.c_str());
  TEST_ASSERT_EQUAL_INT64(in.ts_unix, out.ts_unix);
  TEST_ASSERT_EQUAL_STRING(in.fields_json.c_str(), out.fields_json.c_str());
}

void test_serialize_empty_attendance_id_first_scan_of_day() {
  // First scan of the day: PocketBase row hasn't been created yet, so
  // attendance_id is empty. The format must still round-trip.
  queue::PendingScan in;
  in.learner_id = "learner_id_15ch";
  in.attendance_id = "";
  in.ts_unix = 1714316400;
  in.fields_json = "{}";

  std::string line = queue_format::serialize(in);
  TEST_ASSERT_EQUAL_STRING("v1|learner_id_15ch||1714316400|{}", line.c_str());

  queue::PendingScan out;
  TEST_ASSERT_TRUE(queue_format::parse(line, out));
  TEST_ASSERT_EQUAL_STRING("", out.attendance_id.c_str());
}

void test_parse_rejects_wrong_version() {
  queue::PendingScan out;
  TEST_ASSERT_FALSE(
      queue_format::parse("v2|abc|xyz|1|{}", out));
}

void test_parse_rejects_too_few_fields() {
  queue::PendingScan out;
  TEST_ASSERT_FALSE(queue_format::parse("v1|abc|xyz|1", out));
  TEST_ASSERT_FALSE(queue_format::parse("v1|abc|xyz", out));
  TEST_ASSERT_FALSE(queue_format::parse("v1", out));
  TEST_ASSERT_FALSE(queue_format::parse("", out));
}

void test_parse_rejects_too_many_fields() {
  // 5 delimiters means an unexpected trailing pipe in the data — be strict.
  queue::PendingScan out;
  TEST_ASSERT_FALSE(queue_format::parse("v1|abc|xyz|1|{}|extra", out));
}

void test_parse_rejects_empty_learner_id() {
  queue::PendingScan out;
  TEST_ASSERT_FALSE(queue_format::parse("v1||xyz|1|{}", out));
}

void test_parse_preserves_json_brace_chars_in_fields() {
  queue::PendingScan out;
  // Fields JSON containing nested-looking quotes survives because the fields
  // value is everything after the 4th pipe, even if it has braces or quotes.
  std::string line =
      "v1|L|A|0|{\"lunch_events\":\"[{\\\"type\\\":\\\"out\\\"}]\"}";
  TEST_ASSERT_TRUE(queue_format::parse(line, out));
  TEST_ASSERT_EQUAL_STRING(
      "{\"lunch_events\":\"[{\\\"type\\\":\\\"out\\\"}]\"}",
      out.fields_json.c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_serialize_round_trip_check_in);
  RUN_TEST(test_serialize_empty_attendance_id_first_scan_of_day);
  RUN_TEST(test_parse_rejects_wrong_version);
  RUN_TEST(test_parse_rejects_too_few_fields);
  RUN_TEST(test_parse_rejects_too_many_fields);
  RUN_TEST(test_parse_rejects_empty_learner_id);
  RUN_TEST(test_parse_preserves_json_brace_chars_in_fields);
  return UNITY_END();
}
