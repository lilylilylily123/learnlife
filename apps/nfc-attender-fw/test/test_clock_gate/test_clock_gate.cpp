// Tests for the "is the clock trustworthy enough to record attendance" rule.
//
// The rule is small, but it is the thing standing between a bad-WiFi morning
// and a day of attendance rows timestamped 1970 with everyone marked present.
// See src/clock_gate.h for the full rationale.

#include <unity.h>

#include "clock_gate.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_blocks_before_ntp_sync() {
  // The case this whole gate exists for: device powers on before the router
  // is up. System clock is 1970, no override set. Record nothing.
  TEST_ASSERT_FALSE(clock_gate::may_write_attendance(
      /*ntp_synced=*/false, /*override_active=*/false));
}

void test_allows_after_ntp_sync() {
  // Normal operation: NTP landed, clock is real, proceed.
  TEST_ASSERT_TRUE(clock_gate::may_write_attendance(
      /*ntp_synced=*/true, /*override_active=*/false));
}

void test_allows_when_override_active_without_ntp() {
  // Bench testing with no network at all. `t 09:30 1` on the serial console
  // is the operator asserting the time, which is exactly the assurance the
  // gate wants. If this returned false the whole time-travel test workflow
  // would break the moment the device was offline — which is precisely when
  // it gets used.
  TEST_ASSERT_TRUE(clock_gate::may_write_attendance(
      /*ntp_synced=*/false, /*override_active=*/true));
}

void test_allows_when_both_synced_and_overridden() {
  // Override set while online: still allowed, and the override still wins for
  // time-of-day purposes (time_sync::now_local applies the shift).
  TEST_ASSERT_TRUE(clock_gate::may_write_attendance(
      /*ntp_synced=*/true, /*override_active=*/true));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_blocks_before_ntp_sync);
  RUN_TEST(test_allows_after_ntp_sync);
  RUN_TEST(test_allows_when_override_active_without_ntp);
  RUN_TEST(test_allows_when_both_synced_and_overridden);
  return UNITY_END();
}
