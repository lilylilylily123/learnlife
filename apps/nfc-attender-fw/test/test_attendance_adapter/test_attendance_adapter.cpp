// Unit tests for attendance_adapter — pb_client::AttendanceRow → AttendanceState.

#include <unity.h>

#include "attendance_adapter.h"
#include "pb_client.h"
#include "state_machine.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_empty_row_yields_empty_state() {
  pb_client::AttendanceRow row;
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  TEST_ASSERT_FALSE(state.has_time_in);
  TEST_ASSERT_FALSE(state.has_time_out);
  TEST_ASSERT_EQUAL_size_t(0u, state.lunch_events.size());
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Status::None),
                        static_cast<int>(state.status));
}

void test_time_in_marks_has_time_in() {
  pb_client::AttendanceRow row;
  row.time_in = "2026-05-06T09:30:00.000Z";
  row.status  = "present";
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  TEST_ASSERT_TRUE(state.has_time_in);
  TEST_ASSERT_FALSE(state.has_time_out);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Status::Present),
                        static_cast<int>(state.status));
}

void test_status_string_maps_to_enum() {
  pb_client::AttendanceRow row;
  row.status = "late";
  row.lunch_status = "jLate";
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Status::Late),
                        static_cast<int>(state.status));
  TEST_ASSERT_EQUAL_INT(static_cast<int>(Status::JLate),
                        static_cast<int>(state.lunch_status));
}

void test_lunch_events_parses_array() {
  pb_client::AttendanceRow row;
  row.lunch_events_json =
      "[{\"type\":\"out\",\"time\":\"2026-05-06T13:05:00.000Z\"},"
      "{\"type\":\"in\",\"time\":\"2026-05-06T13:50:00.000Z\"}]";
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  TEST_ASSERT_EQUAL_size_t(2u, state.lunch_events.size());
  TEST_ASSERT_EQUAL_INT(LunchEvent::Out, state.lunch_events[0].type);
  TEST_ASSERT_EQUAL_STRING("2026-05-06T13:05:00.000Z",
                           state.lunch_events[0].time_iso.c_str());
  TEST_ASSERT_TRUE(state.lunch_events[0].time_unix > 0);
  TEST_ASSERT_EQUAL_INT(LunchEvent::In, state.lunch_events[1].type);
}

void test_lunch_events_skips_unknown_type() {
  pb_client::AttendanceRow row;
  row.lunch_events_json =
      "[{\"type\":\"weird\",\"time\":\"2026-05-06T13:05:00.000Z\"},"
      "{\"type\":\"out\",\"time\":\"2026-05-06T13:10:00.000Z\"}]";
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  TEST_ASSERT_EQUAL_size_t(1u, state.lunch_events.size());
  TEST_ASSERT_EQUAL_INT(LunchEvent::Out, state.lunch_events[0].type);
}

void test_legacy_lunch_fields_set_flags() {
  pb_client::AttendanceRow row;
  row.lunch_out_legacy = "2025-09-01T13:10:00.000Z";
  // lunch_in_legacy intentionally empty — still at lunch.
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  TEST_ASSERT_TRUE(state.has_lunch_out_legacy);
  TEST_ASSERT_FALSE(state.has_lunch_in_legacy);
}

void test_malformed_lunch_events_json_does_not_crash() {
  pb_client::AttendanceRow row;
  row.lunch_events_json = "not valid json";
  AttendanceState state;
  attendance_adapter::state_from_row(row, state);
  // Still safely produces empty events; other fields untouched.
  TEST_ASSERT_EQUAL_size_t(0u, state.lunch_events.size());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_empty_row_yields_empty_state);
  RUN_TEST(test_time_in_marks_has_time_in);
  RUN_TEST(test_status_string_maps_to_enum);
  RUN_TEST(test_lunch_events_parses_array);
  RUN_TEST(test_lunch_events_skips_unknown_type);
  RUN_TEST(test_legacy_lunch_fields_set_flags);
  RUN_TEST(test_malformed_lunch_events_json_does_not_crash);
  return UNITY_END();
}
