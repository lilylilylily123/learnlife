#pragma once

// On-disk line format for the cached learner roster.
//
// Line shape:
//   v1|<id>|<nfc_id>|<program>|<name…>
//
// Deliberately mirrors queue_format so there is one format idiom in the
// codebase rather than two.
//
// ── WHY NAME GOES LAST ───────────────────────────────────────────────────
//
// The first four fields are machine-generated and safe: PocketBase ids are
// 15-char alphanumeric, nfc_id is lowercase hex, program is one of a fixed
// set. `name` is the only field a human types, so it is the only one that
// could contain a '|'.
//
// Putting it last and parsing it as "everything after the 4th delimiter"
// means a learner called "Ana | Sofía" round-trips correctly instead of
// corrupting the line and being silently dropped from the roster — which
// would present as that one learner's card never working, with no error
// anywhere.
//
// UTF-8 passes through untouched: the parser only ever looks for ASCII '|',
// which cannot appear inside a multi-byte UTF-8 sequence. Accented names are
// safe.
//
// CR and LF are stripped on write, since a newline inside a field would split
// one record into two and corrupt everything after it.

#include <string>

#include "pb_client.h"

namespace llattender::roster_format {

constexpr char kDelimiter = '|';
constexpr const char* kVersion = "v1";

std::string serialize(const pb_client::LearnerRow& row);

// Returns false if the line doesn't start with the version tag, has fewer
// than 4 delimiters, or has an empty id.
//
// A row with an empty nfc_id IS accepted: PocketBase legitimately holds
// learners who have not been issued a card yet. They simply never match a
// scan (see roster::lookup_by_uid, which refuses to match on empty).
bool parse(const std::string& line, pb_client::LearnerRow& out);

// Lowercase an NFC UID for storage and lookup.
//
// nfc.cpp emits lowercase hex, and PocketBase values are lowercase today —
// but NFC_ID is a free-text field in the dashboard, so a guide pasting an
// uppercase UID would otherwise produce a card that never matches, with no
// error to explain why. Normalising both sides makes that impossible.
std::string normalize_uid(const std::string& uid);

}  // namespace llattender::roster_format
