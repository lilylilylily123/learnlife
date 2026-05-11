#pragma once

// In-memory + LittleFS-backed cache of the learners list. Refreshed once
// per day from PocketBase; falls back to the cached copy on boot when
// network is unreachable.

#include <string>
#include <vector>

#include "pb_client.h"

namespace llattender::roster {

bool init();

// Replace the cache with a freshly fetched roster (and persist).
bool replace(const std::vector<pb_client::LearnerRow>& items);

// Lookup by lowercase-hex NFC UID. Returns nullptr on miss.
const pb_client::LearnerRow* lookup_by_uid(const std::string& uid_hex);

// True if the cache has been loaded (from disk or network) at least once.
bool ready();

}  // namespace llattender::roster
