// Unit tests for pb_response — JSON parsing of PocketBase responses.

#include <unity.h>

#include <string>
#include <vector>

#include "json_source.h"
#include "pb_client.h"
#include "pb_response.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

// ── login ────────────────────────────────────────────────────────────────────

void test_parse_login_extracts_token() {
  // Real-shape response — the SDK returns both `token` and `record`.
  const std::string body =
      "{\"token\":\"eyJhbGciOiJIUzI1NiIs.payload.sig\","
      "\"record\":{\"id\":\"u1\",\"email\":\"x@y.com\"}}";
  std::string tok;
  TEST_ASSERT_TRUE(pb_response::parse_login(body, tok));
  TEST_ASSERT_EQUAL_STRING("eyJhbGciOiJIUzI1NiIs.payload.sig", tok.c_str());
}

void test_parse_login_rejects_missing_token() {
  std::string tok = "preserved";
  TEST_ASSERT_FALSE(pb_response::parse_login("{\"record\":{}}", tok));
  // On failure the out param is left untouched.
  TEST_ASSERT_EQUAL_STRING("preserved", tok.c_str());
}

void test_parse_login_rejects_bad_json() {
  std::string tok;
  TEST_ASSERT_FALSE(pb_response::parse_login("not json", tok));
}

// ── learners list ────────────────────────────────────────────────────────────

void test_parse_learners_page_basic() {
  const std::string body =
      "{\"page\":1,\"perPage\":2,\"totalItems\":3,\"totalPages\":2,"
      "\"items\":["
        "{\"id\":\"l1\",\"name\":\"Alice\",\"NFC_ID\":\"deadbeef\","
         "\"program\":\"chmk\"},"
        "{\"id\":\"l2\",\"name\":\"Bob\",\"NFC_ID\":null,"
         "\"program\":\"cre\"}"
      "]}";
  pb_response::LearnersPage page;
  TEST_ASSERT_TRUE(pb_response::parse_learners_page(body, page));
  TEST_ASSERT_EQUAL_INT(1, page.page);
  TEST_ASSERT_EQUAL_INT(2, page.total_pages);
  TEST_ASSERT_EQUAL_INT(3, page.total_items);
  TEST_ASSERT_EQUAL_size_t(2u, page.items.size());

  TEST_ASSERT_EQUAL_STRING("l1",       page.items[0].id.c_str());
  TEST_ASSERT_EQUAL_STRING("Alice",    page.items[0].name.c_str());
  TEST_ASSERT_EQUAL_STRING("deadbeef", page.items[0].nfc_id.c_str());
  TEST_ASSERT_EQUAL_STRING("chmk",     page.items[0].program.c_str());

  TEST_ASSERT_EQUAL_STRING("l2",   page.items[1].id.c_str());
  TEST_ASSERT_EQUAL_STRING("Bob",  page.items[1].name.c_str());
  // null NFC_ID becomes empty — learner is still in the roster but won't match
  // any UID. Mirrors the TS shape `string | null`.
  TEST_ASSERT_EQUAL_STRING("",     page.items[1].nfc_id.c_str());
}

void test_parse_learners_page_empty_items() {
  const std::string body =
      "{\"page\":1,\"perPage\":50,\"totalItems\":0,\"totalPages\":1,\"items\":[]}";
  pb_response::LearnersPage page;
  TEST_ASSERT_TRUE(pb_response::parse_learners_page(body, page));
  TEST_ASSERT_EQUAL_size_t(0u, page.items.size());
  TEST_ASSERT_EQUAL_INT(1, page.total_pages);
}

void test_parse_learners_page_skips_rows_without_id() {
  // Malformed row missing `id` — skip it but keep parsing.
  const std::string body =
      "{\"items\":["
        "{\"name\":\"NoId\"},"
        "{\"id\":\"l1\",\"name\":\"Alice\"}"
      "]}";
  pb_response::LearnersPage page;
  TEST_ASSERT_TRUE(pb_response::parse_learners_page(body, page));
  TEST_ASSERT_EQUAL_size_t(1u, page.items.size());
  TEST_ASSERT_EQUAL_STRING("l1", page.items[0].id.c_str());
}

void test_parse_learners_page_rejects_bad_json() {
  pb_response::LearnersPage page;
  TEST_ASSERT_FALSE(pb_response::parse_learners_page("nope", page));
}

// ── attendance search (list response) ────────────────────────────────────────

void test_parse_attendance_search_finds_record() {
  const std::string body =
      "{\"items\":["
        "{\"id\":\"a1\",\"learner\":\"l1\",\"date\":\"2026-05-06\","
         "\"time_in\":\"2026-05-06T09:30:00.000Z\","
         "\"time_out\":\"\","
         "\"status\":\"present\","
         "\"lunch_status\":\"\","
         "\"lunch_events\":[{\"type\":\"out\",\"time\":\"2026-05-06T13:05:00.000Z\"}]"
        "}"
      "]}";
  pb_client::AttendanceRow row;
  TEST_ASSERT_TRUE(pb_response::parse_attendance_search(body, row));
  TEST_ASSERT_EQUAL_STRING("a1",          row.id.c_str());
  TEST_ASSERT_EQUAL_STRING("l1",          row.learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-05-06",  row.date.c_str());
  TEST_ASSERT_EQUAL_STRING("present",     row.status.c_str());
  TEST_ASSERT_EQUAL_STRING("",            row.lunch_status.c_str());
  TEST_ASSERT_EQUAL_STRING(
      "[{\"type\":\"out\",\"time\":\"2026-05-06T13:05:00.000Z\"}]",
      row.lunch_events_json.c_str());
}

void test_parse_attendance_search_no_match_is_not_an_error() {
  // Empty items array means "no record exists yet" — caller should create one.
  pb_client::AttendanceRow row;
  row.id = "stale";  // ensure parser zeroes the row
  TEST_ASSERT_TRUE(pb_response::parse_attendance_search(
      "{\"items\":[],\"totalItems\":0}", row));
  TEST_ASSERT_EQUAL_STRING("", row.id.c_str());
}

void test_parse_attendance_search_propagates_legacy_lunch_fields() {
  // Records created before lunch_events array — state machine still consults
  // these (attendance.ts:127).
  const std::string body =
      "{\"items\":["
        "{\"id\":\"a2\",\"learner\":\"l2\",\"date\":\"2025-09-01\","
         "\"lunch_out\":\"2025-09-01T13:10:00.000Z\","
         "\"lunch_in\":null,"
         "\"lunch_events\":null}"
      "]}";
  pb_client::AttendanceRow row;
  TEST_ASSERT_TRUE(pb_response::parse_attendance_search(body, row));
  TEST_ASSERT_EQUAL_STRING("2025-09-01T13:10:00.000Z",
                           row.lunch_out_legacy.c_str());
  TEST_ASSERT_EQUAL_STRING("", row.lunch_in_legacy.c_str());
  TEST_ASSERT_EQUAL_STRING("", row.lunch_events_json.c_str());
}

void test_parse_attendance_search_rejects_bad_json() {
  pb_client::AttendanceRow row;
  TEST_ASSERT_FALSE(pb_response::parse_attendance_search("{", row));
}

// ── attendance single record (create / patch response) ───────────────────────

void test_parse_attendance_record_basic() {
  const std::string body =
      "{\"id\":\"a3\",\"learner\":\"l3\",\"date\":\"2026-05-07\","
       "\"time_in\":\"\",\"time_out\":\"\","
       "\"status\":\"\",\"lunch_status\":\"\","
       "\"lunch_events\":null}";
  pb_client::AttendanceRow row;
  TEST_ASSERT_TRUE(pb_response::parse_attendance_record(body, row));
  TEST_ASSERT_EQUAL_STRING("a3", row.id.c_str());
  TEST_ASSERT_EQUAL_STRING("l3", row.learner_id.c_str());
}

void test_parse_attendance_record_rejects_missing_id() {
  pb_client::AttendanceRow row;
  TEST_ASSERT_FALSE(pb_response::parse_attendance_record(
      "{\"learner\":\"l1\"}", row));
}


// ── Streaming parser ─────────────────────────────────────────────────────
//
// These cover the path the device actually uses for multi-row pages. The
// string-based parsers above are now thin wrappers over these, so the cases
// above double as coverage of the shared internals.

void test_stream_attendance_handles_61_rows() {
  // The exact size that OOMed. The old parser copied the body into a
  // JsonDocument AND built a vector of 61 rows, each holding ten std::strings,
  // then re-serialised lunch_events per row. Streaming into a sink never
  // materialises the vector.
  std::string json =
      "{\"page\":1,\"perPage\":100,\"totalItems\":61,\"totalPages\":1,\"items\":[";
  for (int i = 0; i < 61; ++i) {
    if (i) json += ',';
    char buf[320];
    std::snprintf(buf, sizeof(buf),
        "{\"id\":\"rec%03d\",\"learner\":\"lrn%03d\",\"date\":\"2026-08-24\","
        "\"time_in\":\"2026-08-24T09:0%d:00.000Z\",\"time_out\":null,"
        "\"status\":\"present\",\"lunch_status\":null,"
        "\"lunch_events\":[{\"type\":\"out\",\"time\":\"13:0%d\"}],"
        "\"updated\":\"2026-08-24 09:0%d:00.000Z\"}",
        i, i, i % 10, i % 10, i % 10);
    json += buf;
  }
  json += "]}";

  llattender::StringByteSource src(json);
  pb_response::PageMeta meta;
  int seen = 0;
  std::string last_id, last_updated;

  const bool ok = pb_response::stream_attendance_page(
      src, meta, [&](pb_client::AttendanceRow&& r) {
        ++seen;
        last_id = r.id;
        last_updated = r.updated;
        return true;
      });

  TEST_ASSERT_TRUE(ok);
  TEST_ASSERT_EQUAL_INT(61, seen);
  TEST_ASSERT_EQUAL_INT(61, meta.total_items);
  TEST_ASSERT_EQUAL_INT(1, meta.total_pages);
  TEST_ASSERT_EQUAL_STRING("rec060", last_id.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-08-24 09:00:00.000Z", last_updated.c_str());
}

void test_stream_attendance_filter_drops_unread_fields() {
  // PocketBase returns collectionId/collectionName/created on every row, and
  // `expand` can be arbitrarily large. The filter must skip them entirely —
  // if they were being allocated, the heap saving would be much smaller than
  // it looks.
  const std::string big_expand(4096, 'x');
  const std::string json =
      "{\"page\":1,\"totalPages\":1,\"totalItems\":1,\"items\":[{"
      "\"id\":\"abc\",\"learner\":\"L1\",\"date\":\"2026-08-24\","
      "\"collectionId\":\"pbc_123\",\"collectionName\":\"attendance\","
      "\"created\":\"2026-08-24 08:00:00.000Z\","
      "\"expand\":{\"junk\":\"" + big_expand + "\"},"
      "\"time_in\":\"2026-08-24T09:00:00.000Z\"}]}";

  llattender::StringByteSource src(json);
  pb_response::PageMeta meta;
  pb_client::AttendanceRow got;
  const bool ok = pb_response::stream_attendance_page(
      src, meta, [&](pb_client::AttendanceRow&& r) { got = std::move(r); return true; });

  TEST_ASSERT_TRUE(ok);
  TEST_ASSERT_EQUAL_STRING("abc", got.id.c_str());
  TEST_ASSERT_EQUAL_STRING("2026-08-24T09:00:00.000Z", got.time_in.c_str());
}

void test_stream_attendance_sink_can_stop_early() {
  const std::string json =
      "{\"page\":1,\"totalPages\":1,\"totalItems\":3,\"items\":["
      "{\"id\":\"a\",\"learner\":\"L1\"},"
      "{\"id\":\"b\",\"learner\":\"L2\"},"
      "{\"id\":\"c\",\"learner\":\"L3\"}]}";

  llattender::StringByteSource src(json);
  pb_response::PageMeta meta;
  int seen = 0;
  pb_response::stream_attendance_page(
      src, meta, [&](pb_client::AttendanceRow&&) { return ++seen < 2; });

  TEST_ASSERT_EQUAL_INT(2, seen);
}

void test_stream_attendance_truncated_returns_false() {
  // A dropped connection mid-body must be an error, not a short page that
  // downstream code treats as authoritative and caches.
  const std::string json =
      "{\"page\":1,\"totalPages\":1,\"items\":[{\"id\":\"a\",\"learner\":";

  llattender::StringByteSource src(json);
  pb_response::PageMeta meta;
  int seen = 0;
  const bool ok = pb_response::stream_attendance_page(
      src, meta, [&](pb_client::AttendanceRow&&) { ++seen; return true; });

  TEST_ASSERT_FALSE(ok);
}

void test_stream_attendance_meta_available_before_rows() {
  // PocketBase emits the pagination fields before `items`, so a sink can rely
  // on meta being populated on its very first call. The prefetch loop uses
  // this to decide whether another page is needed.
  const std::string json =
      "{\"page\":2,\"perPage\":25,\"totalItems\":40,\"totalPages\":2,\"items\":["
      "{\"id\":\"a\",\"learner\":\"L1\"}]}";

  llattender::StringByteSource src(json);
  pb_response::PageMeta meta;
  int page_seen_by_sink = -1;
  pb_response::stream_attendance_page(
      src, meta, [&](pb_client::AttendanceRow&&) {
        page_seen_by_sink = meta.page;
        return true;
      });

  TEST_ASSERT_EQUAL_INT(2, page_seen_by_sink);
  TEST_ASSERT_EQUAL_INT(2, meta.total_pages);
  TEST_ASSERT_EQUAL_INT(40, meta.total_items);
}

void test_stream_learners_page_basic() {
  const std::string json =
      "{\"page\":1,\"totalPages\":1,\"totalItems\":2,\"items\":["
      "{\"id\":\"l1\",\"name\":\"Ada\",\"NFC_ID\":\"04a1b2c3\",\"program\":\"Creator\"},"
      "{\"id\":\"l2\",\"name\":\"Grace\",\"NFC_ID\":\"04d4e5f6\",\"program\":\"Explorer\"}]}";

  llattender::StringByteSource src(json);
  pb_response::PageMeta meta;
  std::vector<pb_client::LearnerRow> rows;
  const bool ok = pb_response::stream_learners_page(
      src, meta, [&](pb_client::LearnerRow&& r) { rows.push_back(std::move(r)); return true; });

  TEST_ASSERT_TRUE(ok);
  TEST_ASSERT_EQUAL_UINT(2, rows.size());
  TEST_ASSERT_EQUAL_STRING("Ada", rows[0].name.c_str());
  TEST_ASSERT_EQUAL_STRING("04d4e5f6", rows[1].nfc_id.c_str());
  TEST_ASSERT_EQUAL_STRING("Explorer", rows[1].program.c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_parse_login_extracts_token);
  RUN_TEST(test_parse_login_rejects_missing_token);
  RUN_TEST(test_parse_login_rejects_bad_json);
  RUN_TEST(test_parse_learners_page_basic);
  RUN_TEST(test_parse_learners_page_empty_items);
  RUN_TEST(test_parse_learners_page_skips_rows_without_id);
  RUN_TEST(test_parse_learners_page_rejects_bad_json);
  RUN_TEST(test_parse_attendance_search_finds_record);
  RUN_TEST(test_parse_attendance_search_no_match_is_not_an_error);
  RUN_TEST(test_parse_attendance_search_propagates_legacy_lunch_fields);
  RUN_TEST(test_parse_attendance_search_rejects_bad_json);
  RUN_TEST(test_parse_attendance_record_basic);
  RUN_TEST(test_parse_attendance_record_rejects_missing_id);
  RUN_TEST(test_stream_attendance_handles_61_rows);
  RUN_TEST(test_stream_attendance_filter_drops_unread_fields);
  RUN_TEST(test_stream_attendance_sink_can_stop_early);
  RUN_TEST(test_stream_attendance_truncated_returns_false);
  RUN_TEST(test_stream_attendance_meta_available_before_rows);
  RUN_TEST(test_stream_learners_page_basic);
  return UNITY_END();
}
