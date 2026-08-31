// Tests for the cached-roster line format.
//
// Why this matters: the roster is the UID -> learner mapping. If a row fails
// to round-trip, that learner's card stops working and there is no error
// anywhere to explain it — the device just says "Unknown card" at them every
// morning. The cases below are the realistic ways that could happen.

#include <unity.h>

#include <string>

#include "pb_client.h"
#include "roster_format.h"

using namespace llattender;

void setUp(void) {}
void tearDown(void) {}

namespace {

pb_client::LearnerRow make_row(const std::string& id, const std::string& uid,
                               const std::string& program,
                               const std::string& name) {
  pb_client::LearnerRow r;
  r.id = id;
  r.nfc_id = uid;
  r.program = program;
  r.name = name;
  return r;
}

}  // namespace

void test_round_trip_basic() {
  const auto in = make_row("abc123def456789", "04a1b2c3", "Creator", "Ada Lovelace");
  const std::string line = roster_format::serialize(in);
  TEST_ASSERT_EQUAL_STRING("v1|abc123def456789|04a1b2c3|Creator|Ada Lovelace",
                           line.c_str());

  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse(line, out));
  TEST_ASSERT_EQUAL_STRING(in.id.c_str(), out.id.c_str());
  TEST_ASSERT_EQUAL_STRING(in.nfc_id.c_str(), out.nfc_id.c_str());
  TEST_ASSERT_EQUAL_STRING(in.program.c_str(), out.program.c_str());
  TEST_ASSERT_EQUAL_STRING(in.name.c_str(), out.name.c_str());
}

void test_pipe_in_name_survives() {
  // `name` is the only human-typed field, so it is the only one that can
  // contain a delimiter. Parsing it as "everything after the 4th pipe" is what
  // stops this corrupting the row.
  const auto in = make_row("id1", "04ff", "Explorer", "Ana | Sofia");
  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse(roster_format::serialize(in), out));
  TEST_ASSERT_EQUAL_STRING("Ana | Sofia", out.name.c_str());
}

void test_utf8_accents_survive() {
  // The school is in Spain. Accented names are the norm, not an edge case.
  // Safe because the parser only looks for ASCII '|', which cannot appear
  // inside a multi-byte UTF-8 sequence.
  const auto in = make_row("id2", "04ee", "Changemaker", "José Martínez Peña");
  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse(roster_format::serialize(in), out));
  TEST_ASSERT_EQUAL_STRING("José Martínez Peña", out.name.c_str());
}

void test_uid_is_lowercased_on_write_and_read() {
  // nfc.cpp emits lowercase hex, but NFC_ID is free text in the dashboard.
  // A guide pasting an uppercase UID would otherwise create a card that never
  // matches, with nothing to explain why.
  const auto in = make_row("id3", "04A1B2C3", "Creator", "Grace");
  const std::string line = roster_format::serialize(in);
  TEST_ASSERT_TRUE(line.find("04a1b2c3") != std::string::npos);

  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse("v1|id3|04A1B2C3|Creator|Grace", out));
  TEST_ASSERT_EQUAL_STRING("04a1b2c3", out.nfc_id.c_str());
}

void test_normalize_uid_directly() {
  TEST_ASSERT_EQUAL_STRING("04a1b2c3",
                           roster_format::normalize_uid("04A1B2C3").c_str());
  TEST_ASSERT_EQUAL_STRING("deadbeef",
                           roster_format::normalize_uid("DeAdBeEf").c_str());
  TEST_ASSERT_EQUAL_STRING("", roster_format::normalize_uid("").c_str());
}

void test_learner_without_card_is_kept() {
  // PocketBase legitimately holds learners with no card issued yet. They must
  // be stored (so the roster stays a faithful copy) but can never match a scan.
  const auto in = make_row("id4", "", "Creator", "New Learner");
  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse(roster_format::serialize(in), out));
  TEST_ASSERT_EQUAL_STRING("id4", out.id.c_str());
  TEST_ASSERT_TRUE(out.nfc_id.empty());
}

void test_empty_name_is_valid() {
  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse("v1|id5|04aa|Creator|", out));
  TEST_ASSERT_TRUE(out.name.empty());
  TEST_ASSERT_EQUAL_STRING("id5", out.id.c_str());
}

void test_rejects_wrong_version() {
  pb_client::LearnerRow out;
  TEST_ASSERT_FALSE(roster_format::parse("v2|id|04aa|Creator|Name", out));
}

void test_rejects_too_few_fields() {
  pb_client::LearnerRow out;
  TEST_ASSERT_FALSE(roster_format::parse("v1|id|04aa|Creator", out));
  TEST_ASSERT_FALSE(roster_format::parse("v1|id", out));
  TEST_ASSERT_FALSE(roster_format::parse("v1", out));
  TEST_ASSERT_FALSE(roster_format::parse("", out));
}

void test_rejects_empty_id() {
  // A row with no id can't be written back to PocketBase, so it is useless.
  pb_client::LearnerRow out;
  TEST_ASSERT_FALSE(roster_format::parse("v1||04aa|Creator|Name", out));
}

void test_newlines_are_stripped_on_write() {
  // A newline inside a field would split one record into two and corrupt
  // everything after it in the file.
  const auto in = make_row("id6", "04bb", "Creator", "Bad\nName\r\n");
  const std::string line = roster_format::serialize(in);
  TEST_ASSERT_TRUE(line.find('\n') == std::string::npos);
  TEST_ASSERT_TRUE(line.find('\r') == std::string::npos);

  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse(line, out));
  TEST_ASSERT_EQUAL_STRING("BadName", out.name.c_str());
}

void test_pipe_in_machine_field_is_stripped() {
  // Should never happen, but a stray '|' in an id must corrupt at most its own
  // row rather than shifting every field after it.
  const auto in = make_row("id|7", "04cc", "Creator", "Name");
  pb_client::LearnerRow out;
  TEST_ASSERT_TRUE(roster_format::parse(roster_format::serialize(in), out));
  TEST_ASSERT_EQUAL_STRING("id7", out.id.c_str());
  TEST_ASSERT_EQUAL_STRING("Name", out.name.c_str());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_round_trip_basic);
  RUN_TEST(test_pipe_in_name_survives);
  RUN_TEST(test_utf8_accents_survive);
  RUN_TEST(test_uid_is_lowercased_on_write_and_read);
  RUN_TEST(test_normalize_uid_directly);
  RUN_TEST(test_learner_without_card_is_kept);
  RUN_TEST(test_empty_name_is_valid);
  RUN_TEST(test_rejects_wrong_version);
  RUN_TEST(test_rejects_too_few_fields);
  RUN_TEST(test_rejects_empty_id);
  RUN_TEST(test_newlines_are_stripped_on_write);
  RUN_TEST(test_pipe_in_machine_field_is_stripped);
  return UNITY_END();
}
