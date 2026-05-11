// Unit tests for the action → JSON fields serialiser. Verifies the wire
// shape matches what apps/nfc-attender writes today via attendance.ts.

#include <unity.h>

#include "fields.h"
#include "state_machine.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_check_in_present() {
  CheckInAction a;
  a.type = ActionType::CheckIn;
  a.time_in_iso = "2026-04-08T09:00:00.000Z";
  a.status = Status::Present;
  std::string body = fields::serialize_action(a);
  TEST_ASSERT_EQUAL_STRING(
      "{\"time_in\":\"2026-04-08T09:00:00.000Z\",\"status\":\"present\"}",
      body.c_str());
}

void test_check_in_late() {
  CheckInAction a;
  a.type = ActionType::CheckIn;
  a.time_in_iso = "2026-04-08T10:01:00.000Z";
  a.status = Status::Late;
  std::string body = fields::serialize_action(a);
  TEST_ASSERT_EQUAL_STRING(
      "{\"time_in\":\"2026-04-08T10:01:00.000Z\",\"status\":\"late\"}",
      body.c_str());
}

void test_check_out() {
  CheckInAction a;
  a.type = ActionType::CheckOut;
  a.time_out_iso = "2026-04-08T17:00:00.000Z";
  std::string body = fields::serialize_action(a);
  TEST_ASSERT_EQUAL_STRING(
      "{\"time_out\":\"2026-04-08T17:00:00.000Z\"}",
      body.c_str());
}

void test_lunch_out_only() {
  CheckInAction a;
  a.type = ActionType::LunchEvent;
  LunchEvent e;
  e.type = LunchEvent::Out;
  e.time_iso = "2026-04-08T13:00:00.000Z";
  a.lunch_events_after.push_back(e);
  // set_lunch_status defaults to false → no lunch_status key.
  std::string body = fields::serialize_action(a);
  TEST_ASSERT_EQUAL_STRING(
      "{\"lunch_events\":"
      "\"[{\\\"type\\\":\\\"out\\\",\\\"time\\\":\\\"2026-04-08T13:00:00.000Z\\\"}]\"}",
      body.c_str());
}

void test_lunch_in_present() {
  CheckInAction a;
  a.type = ActionType::LunchEvent;
  LunchEvent out_ev;
  out_ev.type = LunchEvent::Out;
  out_ev.time_iso = "2026-04-08T13:00:00.000Z";
  LunchEvent in_ev;
  in_ev.type = LunchEvent::In;
  in_ev.time_iso = "2026-04-08T13:30:00.000Z";
  a.lunch_events_after.push_back(out_ev);
  a.lunch_events_after.push_back(in_ev);
  a.set_lunch_status = true;
  a.lunch_status = Status::Present;

  std::string body = fields::serialize_action(a);
  TEST_ASSERT_EQUAL_STRING(
      "{\"lunch_events\":"
      "\"[{\\\"type\\\":\\\"out\\\",\\\"time\\\":\\\"2026-04-08T13:00:00.000Z\\\"},"
      "{\\\"type\\\":\\\"in\\\",\\\"time\\\":\\\"2026-04-08T13:30:00.000Z\\\"}]\","
      "\"lunch_status\":\"present\"}",
      body.c_str());
}

void test_late_lunch_return() {
  CheckInAction a;
  a.type = ActionType::LateLunchReturn;
  LunchEvent out_ev;
  out_ev.type = LunchEvent::Out;
  out_ev.time_iso = "2026-04-08T13:50:00.000Z";
  LunchEvent in_ev;
  in_ev.type = LunchEvent::In;
  in_ev.time_iso = "2026-04-08T14:30:00.000Z";
  a.lunch_events_after.push_back(out_ev);
  a.lunch_events_after.push_back(in_ev);
  a.set_lunch_status = true;
  a.lunch_status = Status::Late;

  std::string body = fields::serialize_action(a);
  TEST_ASSERT_TRUE(body.find("\"lunch_status\":\"late\"") != std::string::npos);
  TEST_ASSERT_TRUE(body.find("\"lunch_events\":") != std::string::npos);
}

void test_no_action_returns_empty() {
  CheckInAction a;
  a.type = ActionType::NoAction;
  TEST_ASSERT_EQUAL_STRING("", fields::serialize_action(a).c_str());
}

void test_json_escape_handles_special_chars() {
  TEST_ASSERT_EQUAL_STRING("hello", fields::json_escape("hello").c_str());
  TEST_ASSERT_EQUAL_STRING("a\\\"b", fields::json_escape("a\"b").c_str());
  TEST_ASSERT_EQUAL_STRING("a\\\\b", fields::json_escape("a\\b").c_str());
  TEST_ASSERT_EQUAL_STRING("line1\\nline2", fields::json_escape("line1\nline2").c_str());
  TEST_ASSERT_EQUAL_STRING("tab\\there", fields::json_escape("tab\there").c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_check_in_present);
  RUN_TEST(test_check_in_late);
  RUN_TEST(test_check_out);
  RUN_TEST(test_lunch_out_only);
  RUN_TEST(test_lunch_in_present);
  RUN_TEST(test_late_lunch_return);
  RUN_TEST(test_no_action_returns_empty);
  RUN_TEST(test_json_escape_handles_special_chars);
  return UNITY_END();
}
