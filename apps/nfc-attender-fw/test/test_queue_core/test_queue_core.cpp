// Tests for the offline scan queue.
//
// The queue is the durability boundary of the device: a tap acknowledged on
// the OLED but not yet accepted by PocketBase exists ONLY here. If it is lost,
// a learner believes they signed in and no record exists anywhere — and nobody
// finds out until someone audits the day.
//
// So these tests are mostly about failure: power cuts mid-write, corrupt
// lines, permanent server rejections, and compaction failing halfway.

#include <unity.h>

#include <string>
#include <vector>

#include "line_store.h"
#include "pb_result.h"
#include "queue_core.h"
#include "queue_format.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

namespace {

queue::PendingScan make_scan(const std::string& learner,
                             std::time_t ts = 1756000000) {
  queue::PendingScan s;
  s.learner_id = learner;
  s.attendance_id = "att" + learner;
  s.ts_unix = ts;
  s.fields_json = R"({"time_in":"2026-08-24T09:00:00.000Z","status":"present"})";
  return s;
}

// A writer that always reports the same outcome, recording what it saw.
struct RecordingWriter {
  WriteOutcome outcome = WriteOutcome::Ok;
  std::vector<std::string> seen;

  WriteOutcome operator()(const queue::PendingScan& s) {
    seen.push_back(s.learner_id);
    return outcome;
  }
};

}  // namespace

void test_append_then_size() {
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);

  int dropped = 0;
  TEST_ASSERT_TRUE(q.append(make_scan("a"), dropped));
  TEST_ASSERT_TRUE(q.append(make_scan("b"), dropped));

  TEST_ASSERT_EQUAL_UINT(2, q.size());
  TEST_ASSERT_EQUAL_INT(0, dropped);
  TEST_ASSERT_EQUAL_UINT(2, live.lines().size());
}

void test_survives_reboot() {
  // THE test. Entries written before a power cut must come back afterwards.
  InMemoryLineStore live, dead;
  {
    queue_core::Queue q(live, dead);
    int dropped = 0;
    q.append(make_scan("a"), dropped);
    q.append(make_scan("b"), dropped);
    q.append(make_scan("c"), dropped);
  }  // "power cut" — the Queue object is gone, the store persists

  queue_core::Queue reborn(live, dead);
  int skipped = 0;
  TEST_ASSERT_TRUE(reborn.load(skipped));
  TEST_ASSERT_EQUAL_INT(0, skipped);
  TEST_ASSERT_EQUAL_UINT(3, reborn.size());
  TEST_ASSERT_EQUAL_STRING("a", reborn.entries()[0].learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING("c", reborn.entries()[2].learner_id.c_str());
}

void test_drain_all_ok_empties_queue() {
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);
  int dropped = 0;
  q.append(make_scan("a"), dropped);
  q.append(make_scan("b"), dropped);

  RecordingWriter w;
  w.outcome = WriteOutcome::Ok;
  const int written = q.drain([&](const queue::PendingScan& s) { return w(s); });

  TEST_ASSERT_EQUAL_INT(2, written);
  TEST_ASSERT_TRUE(q.empty());
  TEST_ASSERT_EQUAL_UINT(0, live.lines().size());
  TEST_ASSERT_EQUAL_UINT(0, dead.lines().size());
}

void test_retry_later_stops_and_preserves_order() {
  // Ordering matters: a learner's check-in must reach PocketBase before their
  // check-out. Continuing past a transient failure could invert them.
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);
  int dropped = 0;
  q.append(make_scan("a"), dropped);
  q.append(make_scan("b"), dropped);
  q.append(make_scan("c"), dropped);

  int calls = 0;
  const int written = q.drain([&](const queue::PendingScan&) {
    ++calls;
    return calls == 1 ? WriteOutcome::Ok : WriteOutcome::RetryLater;
  });

  TEST_ASSERT_EQUAL_INT(1, written);
  TEST_ASSERT_EQUAL_INT(2, calls);           // stopped at the failure
  TEST_ASSERT_EQUAL_UINT(2, q.size());       // b and c remain
  TEST_ASSERT_EQUAL_STRING("b", q.entries()[0].learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING("c", q.entries()[1].learner_id.c_str());
}

void test_permanent_fail_moves_to_dead_and_continues() {
  // A row deleted from the dashboard 404s forever. It must not wedge every
  // scan queued behind it — that would block the whole queue indefinitely and
  // burn the request budget retrying something that can never succeed.
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);
  int dropped = 0;
  q.append(make_scan("a"), dropped);
  q.append(make_scan("bad"), dropped);
  q.append(make_scan("c"), dropped);

  const int written = q.drain([&](const queue::PendingScan& s) {
    return s.learner_id == "bad" ? WriteOutcome::PermanentFail
                                 : WriteOutcome::Ok;
  });

  TEST_ASSERT_EQUAL_INT(2, written);          // a and c got through
  TEST_ASSERT_TRUE(q.empty());
  TEST_ASSERT_EQUAL_UINT(1, dead.lines().size());
  TEST_ASSERT_TRUE(dead.lines()[0].find("bad") != std::string::npos);
}

void test_corrupt_line_is_skipped_not_fatal() {
  // A power cut mid-append leaves a truncated final line. One bad line must
  // not make the entire queue unreadable and strand every valid entry.
  InMemoryLineStore live, dead;
  live.append(queue_format::serialize(make_scan("a")));
  live.append("v1|truncated-garbage-with-no-delimiters");
  live.append(queue_format::serialize(make_scan("c")));

  queue_core::Queue q(live, dead);
  int skipped = 0;
  TEST_ASSERT_TRUE(q.load(skipped));

  TEST_ASSERT_EQUAL_INT(1, skipped);
  TEST_ASSERT_EQUAL_UINT(2, q.size());
  TEST_ASSERT_EQUAL_STRING("a", q.entries()[0].learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING("c", q.entries()[1].learner_id.c_str());
  // The corrupt line is rewritten away, so it isn't re-skipped every boot.
  TEST_ASSERT_EQUAL_UINT(2, live.lines().size());
}

void test_entry_cap_drops_oldest_and_reports_it() {
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);

  int total_dropped = 0;
  for (size_t i = 0; i < queue_core::kMaxEntries + 5; ++i) {
    int dropped = 0;
    q.append(make_scan("l" + std::to_string(i)), dropped);
    total_dropped += dropped;
  }

  TEST_ASSERT_EQUAL_UINT(queue_core::kMaxEntries, q.size());
  TEST_ASSERT_EQUAL_INT(5, total_dropped);
  // Oldest went first, so the newest entry is definitely still present.
  const auto& last = q.entries().back();
  TEST_ASSERT_EQUAL_STRING(
      ("l" + std::to_string(queue_core::kMaxEntries + 4)).c_str(),
      last.learner_id.c_str());
}

void test_dropping_is_never_silent() {
  // The cap exists to stop the filesystem filling up, but losing attendance
  // data without saying so is the exact failure this module exists to prevent.
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);

  int dropped_on_overflow = 0;
  for (size_t i = 0; i <= queue_core::kMaxEntries; ++i) {
    int dropped = 0;
    q.append(make_scan("l" + std::to_string(i)), dropped);
    if (dropped > 0) dropped_on_overflow = dropped;
  }
  TEST_ASSERT_EQUAL_INT(1, dropped_on_overflow);
}

void test_failed_compaction_leaves_live_store_intact() {
  // If the rewrite fails (full disk, bad rename) the old contents must
  // survive. Losing the file here would discard every pending scan at once.
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);
  int dropped = 0;
  q.append(make_scan("a"), dropped);
  q.append(make_scan("b"), dropped);

  const size_t before = live.lines().size();
  live.fail_next_replace = true;

  q.drain([&](const queue::PendingScan&) { return WriteOutcome::Ok; });

  // In-memory the entries are gone (they were written to PB successfully),
  // but the file still holds the old lines rather than being truncated.
  TEST_ASSERT_EQUAL_UINT(before, live.lines().size());
}

void test_failed_append_is_reported() {
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);

  live.fail_next_append = true;
  int dropped = 0;
  TEST_ASSERT_FALSE(q.append(make_scan("a"), dropped));
}

void test_empty_store_loads_clean() {
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);
  int skipped = 0;

  TEST_ASSERT_TRUE(q.load(skipped));
  TEST_ASSERT_EQUAL_INT(0, skipped);
  TEST_ASSERT_TRUE(q.empty());
}

void test_dead_letter_store_is_append_only() {
  // Dead letters accumulate for manual review; a later drain must not clear
  // them out.
  InMemoryLineStore live, dead;
  queue_core::Queue q(live, dead);
  int dropped = 0;

  q.append(make_scan("bad1"), dropped);
  q.drain([&](const queue::PendingScan&) { return WriteOutcome::PermanentFail; });
  TEST_ASSERT_EQUAL_UINT(1, dead.lines().size());

  q.append(make_scan("bad2"), dropped);
  q.drain([&](const queue::PendingScan&) { return WriteOutcome::PermanentFail; });
  TEST_ASSERT_EQUAL_UINT(2, dead.lines().size());
}

void test_round_trip_preserves_every_field() {
  // Guards against a serialise/parse asymmetry quietly corrupting the PATCH
  // body — which would reach PocketBase as a malformed write.
  InMemoryLineStore live, dead;
  {
    queue_core::Queue q(live, dead);
    int dropped = 0;
    queue::PendingScan s = make_scan("learner15chars");
    s.attendance_id = "attend15charsX";
    s.ts_unix = 1756012345;
    s.fields_json = R"({"lunch_events":"[{\"type\":\"out\"}]","lunch_status":"late"})";
    q.append(s, dropped);
  }

  queue_core::Queue reborn(live, dead);
  int skipped = 0;
  reborn.load(skipped);

  const auto& got = reborn.entries()[0];
  TEST_ASSERT_EQUAL_STRING("learner15chars", got.learner_id.c_str());
  TEST_ASSERT_EQUAL_STRING("attend15charsX", got.attendance_id.c_str());
  TEST_ASSERT_EQUAL_INT64(1756012345, got.ts_unix);
  TEST_ASSERT_EQUAL_STRING(
      R"({"lunch_events":"[{\"type\":\"out\"}]","lunch_status":"late"})",
      got.fields_json.c_str());
}

void test_first_scan_of_day_has_no_attendance_id() {
  // Offline first tap: the PocketBase row doesn't exist yet, so attendance_id
  // is empty and the drain path has to create the row before patching.
  InMemoryLineStore live, dead;
  {
    queue_core::Queue q(live, dead);
    int dropped = 0;
    queue::PendingScan s = make_scan("a");
    s.attendance_id.clear();
    q.append(s, dropped);
  }

  queue_core::Queue reborn(live, dead);
  int skipped = 0;
  reborn.load(skipped);

  TEST_ASSERT_EQUAL_UINT(1, reborn.size());
  TEST_ASSERT_TRUE(reborn.entries()[0].attendance_id.empty());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_append_then_size);
  RUN_TEST(test_survives_reboot);
  RUN_TEST(test_drain_all_ok_empties_queue);
  RUN_TEST(test_retry_later_stops_and_preserves_order);
  RUN_TEST(test_permanent_fail_moves_to_dead_and_continues);
  RUN_TEST(test_corrupt_line_is_skipped_not_fatal);
  RUN_TEST(test_entry_cap_drops_oldest_and_reports_it);
  RUN_TEST(test_dropping_is_never_silent);
  RUN_TEST(test_failed_compaction_leaves_live_store_intact);
  RUN_TEST(test_failed_append_is_reported);
  RUN_TEST(test_empty_store_loads_clean);
  RUN_TEST(test_dead_letter_store_is_append_only);
  RUN_TEST(test_round_trip_preserves_every_field);
  RUN_TEST(test_first_scan_of_day_has_no_attendance_id);
  return UNITY_END();
}
