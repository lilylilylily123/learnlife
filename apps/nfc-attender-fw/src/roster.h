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

// How many learners are cached. Backs the `r` console command and the boot log.
int count();

// Seconds since the cache was last loaded or refreshed, or -1 if never.
//
// A roster that hasn't refreshed in a long time will silently fail to
// recognise a newly-issued card, which presents as "Unknown card" at a learner
// who is certain their card is registered. Surfacing the age makes that
// diagnosable instead of mysterious.
std::time_t age_seconds();

// Print the first `max_items` cached learners with their UIDs. Backs the `r`
// console command: without a UID to hand, the `tap` injector is unusable, and
// reading one off the dashboard means leaving the console.
void debug_dump(int max_items = 5);

}  // namespace llattender::roster
