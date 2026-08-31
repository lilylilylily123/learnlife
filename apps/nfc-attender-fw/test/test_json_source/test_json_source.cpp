// Proves ArduinoJson can deserialize through a VIRTUAL ByteSource.
//
// The entire streaming-parse design in pb_response rests on this. ArduinoJson's
// generic Reader stores a TSource* and calls source_->read() through it, which
// should mean an abstract base with virtual methods works — but "should mean"
// is not the same as "does", so this test exists before anything is built on
// top of it. If this file ever stops compiling, the streaming parse needs a
// different seam.

#include <unity.h>

#include <ArduinoJson.h>

#include "json_source.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

void test_deserialize_through_virtual_byte_source() {
  const std::string json = R"({"page":1,"totalItems":3,"name":"hello"})";
  StringByteSource src(json);

  JsonDocument doc;
  // The load-bearing line: `src` is passed as a ByteSource&, so ArduinoJson
  // instantiates Reader<StringByteSource> (or Reader<ByteSource> when passed
  // by base reference) and dispatches virtually.
  DeserializationError err = deserializeJson(doc, src);

  TEST_ASSERT_EQUAL_STRING("Ok", err.c_str());
  TEST_ASSERT_EQUAL_INT(1, doc["page"].as<int>());
  TEST_ASSERT_EQUAL_INT(3, doc["totalItems"].as<int>());
  TEST_ASSERT_EQUAL_STRING("hello", doc["name"].as<const char*>());
}

void test_deserialize_through_abstract_base_reference() {
  // Same thing, but the static type at the call site is the abstract base —
  // which is how pb_response will actually receive it. If ArduinoJson tried to
  // copy the source this would fail to compile (abstract types can't be
  // instantiated), so compiling at all is half the assertion.
  const std::string json = R"({"items":[{"id":"a"},{"id":"b"}]})";
  StringByteSource concrete(json);
  ByteSource& src = concrete;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, src);

  TEST_ASSERT_EQUAL_STRING("Ok", err.c_str());
  TEST_ASSERT_EQUAL_INT(2, doc["items"].as<JsonArrayConst>().size());
  TEST_ASSERT_EQUAL_STRING("b", doc["items"][1]["id"].as<const char*>());
}

void test_filter_applies_while_streaming() {
  // DeserializationOption::Filter is what keeps the 61-row prefetch inside the
  // heap budget: fields not named in the filter are parsed and discarded
  // without ever being allocated. Here `junk` stands in for PocketBase's
  // collectionId / collectionName / created / expand.
  const std::string json =
      R"({"page":2,"junk":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","items":[{"id":"a","junk":"yyyyyyyyyyyyyyyy"}]})";

  JsonDocument filter;
  filter["page"] = true;
  filter["items"][0]["id"] = true;

  StringByteSource concrete(json);
  ByteSource& src = concrete;

  JsonDocument doc;
  DeserializationError err =
      deserializeJson(doc, src, DeserializationOption::Filter(filter));

  TEST_ASSERT_EQUAL_STRING("Ok", err.c_str());
  TEST_ASSERT_EQUAL_INT(2, doc["page"].as<int>());
  TEST_ASSERT_EQUAL_STRING("a", doc["items"][0]["id"].as<const char*>());
  // The filtered-out fields must not be present at all.
  TEST_ASSERT_TRUE(doc["junk"].isNull());
  TEST_ASSERT_TRUE(doc["items"][0]["junk"].isNull());
}

void test_truncated_input_reports_error_not_crash() {
  // A dropped TLS connection mid-body must surface as an error, not a hang or
  // a half-populated document that later code treats as authoritative.
  const std::string json = R"({"items":[{"id":"a"},{"id":)";
  StringByteSource concrete(json);
  ByteSource& src = concrete;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, src);

  TEST_ASSERT_NOT_EQUAL(DeserializationError::Ok, err.code());
}

void test_read_and_readbytes_semantics() {
  // Guards the ByteSource contract itself: read() returns -1 at EOF (not 0,
  // which is a legitimate NUL byte), and readBytes() short-reads rather than
  // blocking or over-running.
  const std::string s = "abc";
  StringByteSource src(s);

  TEST_ASSERT_EQUAL_INT('a', src.read());

  char buf[8] = {0};
  TEST_ASSERT_EQUAL_UINT(2, src.readBytes(buf, sizeof(buf)));
  TEST_ASSERT_EQUAL_INT('b', buf[0]);
  TEST_ASSERT_EQUAL_INT('c', buf[1]);

  TEST_ASSERT_EQUAL_INT(-1, src.read());
  TEST_ASSERT_EQUAL_UINT(0, src.readBytes(buf, sizeof(buf)));
  TEST_ASSERT_EQUAL_UINT(3, src.consumed());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_deserialize_through_virtual_byte_source);
  RUN_TEST(test_deserialize_through_abstract_base_reference);
  RUN_TEST(test_filter_applies_while_streaming);
  RUN_TEST(test_truncated_input_reports_error_not_crash);
  RUN_TEST(test_read_and_readbytes_semantics);
  return UNITY_END();
}
