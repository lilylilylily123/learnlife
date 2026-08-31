// Tests for HTTP chunked transfer-encoding decoding.
//
// This exists because HTTPClient::getStream() hands back the RAW socket —
// de-chunking only happens inside getString()/writeToStream(), which are the
// allocating methods the streaming parse is specifically avoiding. PocketHost
// sits behind Cloudflare, so a chunked response is possible, and feeding chunk
// framing to a JSON parser produces garbage.
//
// Testing it on the host against synthetic bodies is much cheaper than
// discovering the framing is wrong against a live server on a school network.

#include <unity.h>

#include <ArduinoJson.h>

#include <string>

#include "chunked_source.h"
#include "json_source.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

namespace {

// Drain a ChunkedByteSource through read() and return the decoded payload.
std::string drain_by_read(ChunkedByteSource& src) {
  std::string out;
  for (int c = src.read(); c >= 0; c = src.read()) {
    out += static_cast<char>(c);
  }
  return out;
}

}  // namespace

void test_single_chunk() {
  const std::string wire = "5\r\nhello\r\n0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING("hello", drain_by_read(src).c_str());
  TEST_ASSERT_TRUE(src.complete());
  TEST_ASSERT_FALSE(src.malformed());
}

void test_multiple_chunks_concatenate() {
  const std::string wire = "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING("hello world", drain_by_read(src).c_str());
  TEST_ASSERT_TRUE(src.complete());
}

void test_uppercase_and_multidigit_hex_length() {
  // 0x1A = 26 bytes. Lengths are hex and may use either case.
  const std::string body = "abcdefghijklmnopqrstuvwxyz";
  const std::string wire = "1A\r\n" + body + "\r\n0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING(body.c_str(), drain_by_read(src).c_str());
  TEST_ASSERT_TRUE(src.complete());
}

void test_chunk_extension_is_ignored() {
  // "5;foo=bar\r\n" — extensions are legal and must not be read as data.
  const std::string wire = "5;foo=bar\r\nhello\r\n0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING("hello", drain_by_read(src).c_str());
  TEST_ASSERT_FALSE(src.malformed());
}

void test_trailer_headers_after_terminator_are_ignored() {
  const std::string wire =
      "5\r\nhello\r\n0\r\nX-Checksum: deadbeef\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING("hello", drain_by_read(src).c_str());
  TEST_ASSERT_TRUE(src.complete());
  TEST_ASSERT_FALSE(src.malformed());
}

void test_readbytes_spans_chunk_boundary() {
  // The bytes after a chunk's data are framing, not payload. readBytes must
  // stop at the boundary, consume the framing, and continue — never hand the
  // caller a buffer with "\r\n6\r\n" sitting in the middle of it.
  const std::string wire = "5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  char buf[32] = {0};
  const size_t n = src.readBytes(buf, 11);
  TEST_ASSERT_EQUAL_UINT(11, n);
  TEST_ASSERT_EQUAL_STRING("hello world", buf);
}

void test_json_parses_through_chunked_framing() {
  // The case that actually matters: a PocketBase-shaped page split across
  // chunk boundaries, including one that falls MID-TOKEN. If the de-chunker
  // is wrong this fails to parse, which is exactly the production symptom.
  const std::string json =
      R"({"page":1,"totalPages":1,"totalItems":2,)"
      R"("items":[{"id":"aaa","learner":"L1"},{"id":"bbb","learner":"L2"}]})";

  // Split into three pieces at awkward offsets.
  const std::string p1 = json.substr(0, 17);
  const std::string p2 = json.substr(17, 40);
  const std::string p3 = json.substr(57);

  char hdr[16];
  std::string wire;
  std::snprintf(hdr, sizeof(hdr), "%zx\r\n", p1.size()); wire += hdr; wire += p1 + "\r\n";
  std::snprintf(hdr, sizeof(hdr), "%zx\r\n", p2.size()); wire += hdr; wire += p2 + "\r\n";
  std::snprintf(hdr, sizeof(hdr), "%zx\r\n", p3.size()); wire += hdr; wire += p3 + "\r\n";
  wire += "0\r\n\r\n";

  StringByteSource raw(wire);
  ChunkedByteSource chunked(raw);
  ByteSource& src = chunked;

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, src);

  TEST_ASSERT_EQUAL_STRING("Ok", err.c_str());
  TEST_ASSERT_EQUAL_INT(1, doc["page"].as<int>());
  TEST_ASSERT_EQUAL_INT(2, doc["totalItems"].as<int>());
  TEST_ASSERT_EQUAL_INT(2, doc["items"].as<JsonArrayConst>().size());
  TEST_ASSERT_EQUAL_STRING("bbb", doc["items"][1]["id"].as<const char*>());
}

void test_truncated_mid_chunk_is_malformed() {
  // Connection dropped mid-body: the header promises 20 bytes and only 5
  // arrive. Must report malformed rather than a clean end, or a partial
  // response gets parsed as though it were the whole thing.
  const std::string wire = "14\r\nhello";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  drain_by_read(src);
  TEST_ASSERT_TRUE(src.malformed());
  TEST_ASSERT_FALSE(src.complete());
}

void test_missing_terminator_is_not_complete() {
  // All the data arrived but the 0-length chunk never did.
  const std::string wire = "5\r\nhello\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING("hello", drain_by_read(src).c_str());
  TEST_ASSERT_FALSE(src.complete());
  TEST_ASSERT_TRUE(src.malformed());
}

void test_garbage_length_is_malformed() {
  const std::string wire = "zzz\r\nhello\r\n0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_INT(-1, src.read());
  TEST_ASSERT_TRUE(src.malformed());
}

void test_empty_body_is_just_the_terminator() {
  const std::string wire = "0\r\n\r\n";
  StringByteSource raw(wire);
  ChunkedByteSource src(raw);

  TEST_ASSERT_EQUAL_STRING("", drain_by_read(src).c_str());
  TEST_ASSERT_TRUE(src.complete());
  TEST_ASSERT_FALSE(src.malformed());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_single_chunk);
  RUN_TEST(test_multiple_chunks_concatenate);
  RUN_TEST(test_uppercase_and_multidigit_hex_length);
  RUN_TEST(test_chunk_extension_is_ignored);
  RUN_TEST(test_trailer_headers_after_terminator_are_ignored);
  RUN_TEST(test_readbytes_spans_chunk_boundary);
  RUN_TEST(test_json_parses_through_chunked_framing);
  RUN_TEST(test_truncated_mid_chunk_is_malformed);
  RUN_TEST(test_missing_terminator_is_not_complete);
  RUN_TEST(test_garbage_length_is_malformed);
  RUN_TEST(test_empty_body_is_just_the_terminator);
  return UNITY_END();
}
