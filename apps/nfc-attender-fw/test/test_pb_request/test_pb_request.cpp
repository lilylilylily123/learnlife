// Unit tests for pb_request URL + body builders.

#include <unity.h>

#include <string>

#include "pb_request.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_percent_encode_unreserved_passthrough() {
  TEST_ASSERT_EQUAL_STRING(
      "abcXYZ-_.~0123",
      pb_request::percent_encode("abcXYZ-_.~0123").c_str());
}

void test_percent_encode_special_chars() {
  TEST_ASSERT_EQUAL_STRING(
      "a%20b", pb_request::percent_encode("a b").c_str());
  TEST_ASSERT_EQUAL_STRING(
      "%22hello%22", pb_request::percent_encode("\"hello\"").c_str());
  TEST_ASSERT_EQUAL_STRING(
      "%26%3D%3F", pb_request::percent_encode("&=?").c_str());
}

void test_canonical_base_strips_trailing_slash() {
  TEST_ASSERT_EQUAL_STRING(
      "https://pb.example",
      pb_request::canonical_base("https://pb.example/").c_str());
  TEST_ASSERT_EQUAL_STRING(
      "https://pb.example",
      pb_request::canonical_base("https://pb.example").c_str());
}

void test_login_url() {
  TEST_ASSERT_EQUAL_STRING(
      "https://learnlife.pockethost.io/api/collections/users/auth-with-password",
      pb_request::login_url("https://learnlife.pockethost.io/").c_str());
}

void test_login_body_escapes_password() {
  std::string body = pb_request::login_body("a@b.com", "p\"sw\\d");
  TEST_ASSERT_EQUAL_STRING(
      "{\"identity\":\"a@b.com\",\"password\":\"p\\\"sw\\\\d\"}",
      body.c_str());
}

void test_list_learners_url() {
  TEST_ASSERT_EQUAL_STRING(
      "https://pb.example/api/collections/learners/records"
      "?page=1&perPage=500&sort=name",
      pb_request::list_learners_url("https://pb.example", 1, 500).c_str());
}

void test_find_today_attendance_url_encodes_filter() {
  // The filter part `learner = "abc123" && date ~ "2026-04-08"` should be
  // percent-encoded so the URL is HTTP-safe.
  std::string url = pb_request::find_today_attendance_url(
      "https://pb.example", "abc123", "2026-04-08");
  // Spot-check a few key encodings rather than the full string so the test
  // doesn't break if the unreserved-set choice changes.
  TEST_ASSERT_TRUE(url.find("/api/collections/attendance/records") != std::string::npos);
  TEST_ASSERT_TRUE(url.find("perPage=1") != std::string::npos);
  TEST_ASSERT_TRUE(url.find("filter=") != std::string::npos);
  TEST_ASSERT_TRUE(url.find("%22abc123%22") != std::string::npos);   // "abc123"
  TEST_ASSERT_TRUE(url.find("%22") != std::string::npos);            // quote
  TEST_ASSERT_TRUE(url.find("%26%26") != std::string::npos);         // &&
}

void test_create_attendance_url_and_body() {
  TEST_ASSERT_EQUAL_STRING(
      "https://pb.example/api/collections/attendance/records",
      pb_request::create_attendance_url("https://pb.example").c_str());
  TEST_ASSERT_EQUAL_STRING(
      "{\"learner\":\"abc\",\"date\":\"2026-04-08\"}",
      pb_request::create_attendance_body("abc", "2026-04-08").c_str());
}

void test_patch_attendance_url() {
  TEST_ASSERT_EQUAL_STRING(
      "https://pb.example/api/collections/attendance/records/xyz789",
      pb_request::patch_attendance_url("https://pb.example", "xyz789").c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_percent_encode_unreserved_passthrough);
  RUN_TEST(test_percent_encode_special_chars);
  RUN_TEST(test_canonical_base_strips_trailing_slash);
  RUN_TEST(test_login_url);
  RUN_TEST(test_login_body_escapes_password);
  RUN_TEST(test_list_learners_url);
  RUN_TEST(test_find_today_attendance_url_encodes_filter);
  RUN_TEST(test_create_attendance_url_and_body);
  RUN_TEST(test_patch_attendance_url);
  return UNITY_END();
}
