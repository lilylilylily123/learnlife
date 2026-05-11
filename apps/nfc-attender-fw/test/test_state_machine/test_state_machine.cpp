// Native unit tests for compute_check_in_action.
// Mirror the Vitest cases in
//   apps/nfc-attender/src/__tests__/check-learner-in.test.ts
// so a TS regression and a C++ regression land in the same place.

#include <unity.h>

#include <ctime>

#include "state_machine.h"

using llattender::ActionType;
using llattender::AttendanceState;
using llattender::CheckInAction;
using llattender::LunchEvent;
using llattender::Status;
using llattender::compute_check_in_action;

// Build a local-time tm at 2026-04-08 (a Wednesday, matches the TS fixture
// dates) at the given hour:minute. Year/month/day populate tm_wday too.
static std::tm make_local(int year, int month_1based, int mday, int hour,
                          int minute) {
  std::tm t{};
  t.tm_year = year - 1900;
  t.tm_mon = month_1based - 1;
  t.tm_mday = mday;
  t.tm_hour = hour;
  t.tm_min = minute;
  t.tm_sec = 0;
  t.tm_isdst = -1;
  // mktime normalises and fills tm_wday.
  std::mktime(&t);
  return t;
}

static std::time_t to_unix(const std::tm& local) {
  std::tm copy = local;
  copy.tm_isdst = -1;
  return std::mktime(&copy);
}

void setUp(void) {}
void tearDown(void) {}

// 9:00 AM, no prior state → CheckIn, status = Present.
// Mirrors check-learner-in.test.ts:60-84 ("checks in as present before 10:01 AM").
void test_check_in_present_at_9am() {
  AttendanceState state;
  auto now = make_local(2026, 4, 8, 9, 0);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::CheckIn),
                    static_cast<int>(action.type));
  TEST_ASSERT_EQUAL(static_cast<int>(Status::Present),
                    static_cast<int>(action.status));
  TEST_ASSERT_TRUE(!action.time_in_iso.empty());
}

// 10:01 AM, no prior state → CheckIn, status = Late.
// check-learner-in.test.ts:86-100.
void test_check_in_late_at_1001() {
  AttendanceState state;
  auto now = make_local(2026, 4, 8, 10, 1);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::CheckIn),
                    static_cast<int>(action.type));
  TEST_ASSERT_EQUAL(static_cast<int>(Status::Late),
                    static_cast<int>(action.status));
}

// 11:00 AM with time_in already set, outside lunch + checkout windows
// → NoAction. check-learner-in.test.ts:102-120.
void test_no_action_when_already_checked_in_midmorning() {
  AttendanceState state;
  state.has_time_in = true;
  state.status = Status::Present;
  auto now = make_local(2026, 4, 8, 11, 0);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::NoAction),
                    static_cast<int>(action.type));
}

// 1:00 PM, time_in present, no lunch events → LunchEvent with one Out event.
// check-learner-in.test.ts:122-148.
void test_lunch_out_at_1pm() {
  AttendanceState state;
  state.has_time_in = true;
  auto now = make_local(2026, 4, 8, 13, 0);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::LunchEvent),
                    static_cast<int>(action.type));
  TEST_ASSERT_EQUAL(1u, action.lunch_events_after.size());
  TEST_ASSERT_EQUAL(static_cast<int>(LunchEvent::Out),
                    static_cast<int>(action.lunch_events_after[0].type));
  TEST_ASSERT_FALSE(action.set_lunch_status);
}

// 1:30 PM, last event was Out → LunchEvent appends an In, lunch_status set.
// check-learner-in.test.ts:150-173.
void test_lunch_in_after_out() {
  AttendanceState state;
  state.has_time_in = true;
  LunchEvent prior;
  prior.type = LunchEvent::Out;
  prior.time_unix = to_unix(make_local(2026, 4, 8, 13, 0));
  prior.time_iso = "2026-04-08T13:00:00.000Z";
  state.lunch_events.push_back(prior);

  auto now = make_local(2026, 4, 8, 13, 30);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::LunchEvent),
                    static_cast<int>(action.type));
  TEST_ASSERT_EQUAL(2u, action.lunch_events_after.size());
  TEST_ASSERT_EQUAL(static_cast<int>(LunchEvent::In),
                    static_cast<int>(action.lunch_events_after.back().type));
  TEST_ASSERT_TRUE(action.set_lunch_status);
  // 13:30 is before 14:01, so on-time return → Present.
  TEST_ASSERT_EQUAL(static_cast<int>(Status::Present),
                    static_cast<int>(action.lunch_status));
}

// 2:30 PM with last event still Out → LateLunchReturn, lunch_status = Late.
// New case (TS doesn't cover this branch directly but it's in attendance.ts:122-143).
void test_late_lunch_return() {
  AttendanceState state;
  state.has_time_in = true;
  LunchEvent prior;
  prior.type = LunchEvent::Out;
  prior.time_unix = to_unix(make_local(2026, 4, 8, 13, 50));
  state.lunch_events.push_back(prior);

  auto now = make_local(2026, 4, 8, 14, 30);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::LateLunchReturn),
                    static_cast<int>(action.type));
  TEST_ASSERT_TRUE(action.set_lunch_status);
  TEST_ASSERT_EQUAL(static_cast<int>(Status::Late),
                    static_cast<int>(action.lunch_status));
}

// 5:00 PM Wednesday with time_in but no time_out → CheckOut.
// check-learner-in.test.ts:175-197.
void test_check_out_at_5pm_weekday() {
  AttendanceState state;
  state.has_time_in = true;
  auto now = make_local(2026, 4, 8, 17, 0);  // Wednesday
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::CheckOut),
                    static_cast<int>(action.type));
  TEST_ASSERT_TRUE(!action.time_out_iso.empty());
}

// 4:30 PM Wednesday with time_in → Locked (in the new 14:00–17:00 no-scan
// window; checkout doesn't open until 17:00).
void test_locked_between_2pm_and_5pm() {
  AttendanceState state;
  state.has_time_in = true;
  auto now = make_local(2026, 4, 8, 16, 30);  // Wednesday
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::Locked),
                    static_cast<int>(action.type));
}

// 4:59 PM Wednesday with time_in → Locked (one minute before checkout opens).
void test_locked_at_459pm() {
  AttendanceState state;
  state.has_time_in = true;
  auto now = make_local(2026, 4, 8, 16, 59);  // Wednesday
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::Locked),
                    static_cast<int>(action.type));
}

// 2:30 PM Wednesday with time_in AND currently at lunch (lunch_out without
// lunch_in) → LateLunchReturn, NOT Locked. The lock applies to everything
// EXCEPT a learner mid-lunch.
void test_lunch_return_beats_lock() {
  AttendanceState state;
  state.has_time_in = true;
  LunchEvent ev;
  ev.type = LunchEvent::Out;
  ev.time_unix = 0;
  state.lunch_events.push_back(ev);
  auto now = make_local(2026, 4, 8, 14, 30);  // Wednesday
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::LateLunchReturn),
                    static_cast<int>(action.type));
}

// 2:00 PM Friday with time_in → CheckOut (Friday's earlier cutoff).
// attendance.ts:148-160 Friday branch.
void test_friday_checkout_at_2pm() {
  AttendanceState state;
  state.has_time_in = true;
  auto now = make_local(2026, 4, 10, 14, 0);  // 2026-04-10 is a Friday
  TEST_ASSERT_EQUAL(5, now.tm_wday);  // sanity: confirm Friday
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::CheckOut),
                    static_cast<int>(action.type));
}

// CheckOut should not fire twice — once time_out is set, fall through to NoAction.
void test_no_double_checkout() {
  AttendanceState state;
  state.has_time_in = true;
  state.has_time_out = true;
  auto now = make_local(2026, 4, 8, 17, 30);
  auto action = compute_check_in_action(state, now, to_unix(now));

  TEST_ASSERT_EQUAL(static_cast<int>(ActionType::NoAction),
                    static_cast<int>(action.type));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_check_in_present_at_9am);
  RUN_TEST(test_check_in_late_at_1001);
  RUN_TEST(test_no_action_when_already_checked_in_midmorning);
  RUN_TEST(test_lunch_out_at_1pm);
  RUN_TEST(test_lunch_in_after_out);
  RUN_TEST(test_late_lunch_return);
  RUN_TEST(test_check_out_at_5pm_weekday);
  RUN_TEST(test_locked_between_2pm_and_5pm);
  RUN_TEST(test_locked_at_459pm);
  RUN_TEST(test_lunch_return_beats_lock);
  RUN_TEST(test_friday_checkout_at_2pm);
  RUN_TEST(test_no_double_checkout);
  return UNITY_END();
}
