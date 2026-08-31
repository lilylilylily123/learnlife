// Tests for JWT expiry extraction.
//
// The device uses this only to decide "is the token I already hold worth
// trying, or should I log in first?" — never as an authorization decision, so
// the signature is deliberately not verified (see src/jwt.h).
//
// The important property is therefore: every malformed input must return
// false, because false means "log in again", which is always safe. A false
// POSITIVE would mean sending a junk token and eating a 401 round-trip.

#include <unity.h>

#include <string>

#include "jwt.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

namespace {

// Real-shaped PocketBase token. Payload decodes to:
//   {"collectionId":"_pb_users_auth_","exp":1756054800,"id":"abc123",
//    "type":"authRecord"}
// Signature is nonsense on purpose — nothing here verifies it.
const char* kToken =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    "."
    "eyJjb2xsZWN0aW9uSWQiOiJfcGJfdXNlcnNfYXV0aF8iLCJleHAiOjE3NTYwNTQ4MDAsImlkIjoiYWJjMTIzIiwidHlwZSI6ImF1dGhSZWNvcmQifQ"
    "."
    "not-a-real-signature";

}  // namespace

void test_extracts_exp_from_realistic_token() {
  std::time_t exp = 0;
  TEST_ASSERT_TRUE(jwt::extract_exp(kToken, exp));
  TEST_ASSERT_EQUAL_INT64(1756054800, exp);
}

void test_base64url_alphabet() {
  // '-' and '_' replace '+' and '/'. A decoder that only handles standard
  // base64 fails on roughly half of real tokens, and it fails intermittently,
  // which is the worst way for it to fail.
  std::string out;
  TEST_ASSERT_TRUE(jwt::base64url_decode("eyJhIjoxfQ", out));  // {"a":1}
  TEST_ASSERT_EQUAL_STRING("{\"a\":1}", out.c_str());
}

void test_unpadded_payload_decodes() {
  // JWT encoders strip '=' padding. Payload lengths therefore rarely land on
  // a 4-character boundary, and a strict decoder rejects them.
  std::string out;
  TEST_ASSERT_TRUE(jwt::base64url_decode("eyJleHAiOjF9", out));  // {"exp":1}
  TEST_ASSERT_EQUAL_STRING("{\"exp\":1}", out.c_str());
}

void test_padded_payload_also_decodes() {
  std::string out;
  TEST_ASSERT_TRUE(jwt::base64url_decode("eyJhIjoxfQ==", out));
  TEST_ASSERT_EQUAL_STRING("{\"a\":1}", out.c_str());
}

void test_rejects_missing_exp() {
  // {"id":"abc"} — valid JWT shape, no exp claim.
  const std::string t = "aaa.eyJpZCI6ImFiYyJ9.bbb";
  std::time_t exp = 0;
  TEST_ASSERT_FALSE(jwt::extract_exp(t, exp));
}

void test_rejects_non_numeric_exp() {
  // {"exp":"soon"} — present but not a number.
  const std::string t = "aaa.eyJleHAiOiJzb29uIn0.bbb";
  std::time_t exp = 0;
  TEST_ASSERT_FALSE(jwt::extract_exp(t, exp));
}

void test_rejects_not_a_jwt() {
  std::time_t exp = 0;
  TEST_ASSERT_FALSE(jwt::extract_exp("", exp));
  TEST_ASSERT_FALSE(jwt::extract_exp("plain-string", exp));
  TEST_ASSERT_FALSE(jwt::extract_exp("only.two", exp));
  TEST_ASSERT_FALSE(jwt::extract_exp("...", exp));
}

void test_rejects_invalid_base64_payload() {
  std::time_t exp = 0;
  // '!' is not in the base64url alphabet.
  TEST_ASSERT_FALSE(jwt::extract_exp("aaa.not!valid!b64.bbb", exp));
}

void test_rejects_payload_that_is_not_json() {
  // "hello world" base64url-encoded — decodes fine, isn't JSON.
  std::time_t exp = 0;
  TEST_ASSERT_FALSE(jwt::extract_exp("aaa.aGVsbG8gd29ybGQ.bbb", exp));
}

void test_rejects_negative_or_zero_exp() {
  std::time_t exp = 0;
  TEST_ASSERT_FALSE(jwt::extract_exp("aaa.eyJleHAiOjB9.bbb", exp));    // {"exp":0}
  TEST_ASSERT_FALSE(jwt::extract_exp("aaa.eyJleHAiOi0xfQ.bbb", exp));  // {"exp":-1}
}

void test_is_usable_respects_skew() {
  const std::string tok = "non-empty";
  const std::time_t now = 1756000000;

  // Comfortably in the future.
  TEST_ASSERT_TRUE(jwt::is_usable(tok, now + 3600, now));
  // Already expired.
  TEST_ASSERT_FALSE(jwt::is_usable(tok, now - 1, now));
  // Inside the skew window: technically valid, but could expire mid-request.
  TEST_ASSERT_FALSE(jwt::is_usable(tok, now + 60, now));
  // Just outside it.
  TEST_ASSERT_TRUE(jwt::is_usable(tok, now + 301, now));
}

void test_is_usable_rejects_missing_inputs() {
  const std::time_t now = 1756000000;
  TEST_ASSERT_FALSE(jwt::is_usable("", now + 3600, now));      // no token
  TEST_ASSERT_FALSE(jwt::is_usable("tok", 0, now));            // no expiry
  // No trusted clock yet (pre-NTP). Refuse rather than guess — the cost is one
  // extra login, and the alternative is using a token that may be long dead.
  TEST_ASSERT_FALSE(jwt::is_usable("tok", now + 3600, 0));
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_extracts_exp_from_realistic_token);
  RUN_TEST(test_base64url_alphabet);
  RUN_TEST(test_unpadded_payload_decodes);
  RUN_TEST(test_padded_payload_also_decodes);
  RUN_TEST(test_rejects_missing_exp);
  RUN_TEST(test_rejects_non_numeric_exp);
  RUN_TEST(test_rejects_not_a_jwt);
  RUN_TEST(test_rejects_invalid_base64_payload);
  RUN_TEST(test_rejects_payload_that_is_not_json);
  RUN_TEST(test_rejects_negative_or_zero_exp);
  RUN_TEST(test_is_usable_respects_skew);
  RUN_TEST(test_is_usable_rejects_missing_inputs);
  return UNITY_END();
}
