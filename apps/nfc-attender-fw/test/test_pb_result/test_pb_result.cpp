// Tests for the HTTP-status -> retry-policy mapping.
//
// The distinction this encodes is load-bearing. A failed drain stops at the
// head of the queue, so an entry that can never succeed would block every scan
// behind it — forever, retrying every few seconds, burning PocketHost's
// request budget. See src/pb_result.h.

#include <unity.h>

#include "pb_result.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_success_codes_are_ok() {
  TEST_ASSERT_TRUE(classify_http_status(200) == WriteOutcome::Ok);
  TEST_ASSERT_TRUE(classify_http_status(201) == WriteOutcome::Ok);
  TEST_ASSERT_TRUE(classify_http_status(204) == WriteOutcome::Ok);
}

void test_deleted_row_is_permanent() {
  // The motivating case: a guide deletes an attendance record while a PATCH
  // for it is queued. Retrying can never succeed.
  TEST_ASSERT_TRUE(classify_http_status(404) == WriteOutcome::PermanentFail);
}

void test_client_errors_are_permanent() {
  TEST_ASSERT_TRUE(classify_http_status(400) == WriteOutcome::PermanentFail);
  TEST_ASSERT_TRUE(classify_http_status(403) == WriteOutcome::PermanentFail);
}

void test_unauthorized_is_retryable() {
  // An expired token is worth one re-login, so the entry must be kept.
  // Classifying this as permanent would discard real attendance data every
  // time the token aged out.
  TEST_ASSERT_TRUE(classify_http_status(401) == WriteOutcome::RetryLater);
}

void test_rate_limit_and_timeout_are_retryable() {
  TEST_ASSERT_TRUE(classify_http_status(429) == WriteOutcome::RetryLater);
  TEST_ASSERT_TRUE(classify_http_status(408) == WriteOutcome::RetryLater);
}

void test_server_errors_are_retryable() {
  TEST_ASSERT_TRUE(classify_http_status(500) == WriteOutcome::RetryLater);
  TEST_ASSERT_TRUE(classify_http_status(502) == WriteOutcome::RetryLater);
  TEST_ASSERT_TRUE(classify_http_status(503) == WriteOutcome::RetryLater);
}

void test_transport_errors_are_retryable() {
  // HTTPClient reports its own failures as negative codes: connection
  // refused, timeout, TLS handshake failure. All transient by definition.
  TEST_ASSERT_TRUE(classify_http_status(-1) == WriteOutcome::RetryLater);
  TEST_ASSERT_TRUE(classify_http_status(-11) == WriteOutcome::RetryLater);
}

void test_unknown_codes_default_to_retry() {
  // Erring toward RetryLater is the safe direction: a retried write wastes
  // effort, a discarded one is attendance that silently never existed.
  TEST_ASSERT_TRUE(classify_http_status(418) == WriteOutcome::RetryLater);
  TEST_ASSERT_TRUE(classify_http_status(302) == WriteOutcome::RetryLater);
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_success_codes_are_ok);
  RUN_TEST(test_deleted_row_is_permanent);
  RUN_TEST(test_client_errors_are_permanent);
  RUN_TEST(test_unauthorized_is_retryable);
  RUN_TEST(test_rate_limit_and_timeout_are_retryable);
  RUN_TEST(test_server_errors_are_retryable);
  RUN_TEST(test_transport_errors_are_retryable);
  RUN_TEST(test_unknown_codes_default_to_retry);
  return UNITY_END();
}
