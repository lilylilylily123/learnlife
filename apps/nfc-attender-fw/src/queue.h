#pragma once

// Append-only offline scan queue persisted as JSONL on LittleFS.
// On every successful PocketBase write the corresponding line is dropped.
// The queue is the durability boundary: a scan that's been written here is
// guaranteed to eventually reach PB (or end up in `/queue.dead.jsonl` for
// manual review on a permanent 4xx).

#include <ctime>
#include <functional>
#include <string>

#include "pb_result.h"

namespace llattender::queue {

struct PendingScan {
  std::string learner_id;
  std::string attendance_id;   // empty if today's row doesn't exist yet
  std::string fields_json;     // body of the PATCH/POST
  std::time_t ts_unix = 0;
};

bool init();

// Append a pending write to the on-disk queue. Returns false on disk error.
bool append(const PendingScan& s);

// Drain queued entries by calling `writer` on each, removing the ones it
// reports as written. Stops at the first entry that must be retried, leaving
// it and everything after it for the next attempt; a `Permanent` outcome
// moves the entry to `/queue.dead.jsonl` instead of blocking the head of the
// queue forever.
//
// Returns the number of entries successfully drained.
int drain_ex(const std::function<WriteOutcome(const PendingScan&)>& writer);

// Number of entries still pending.
int size();

// Print the queue's contents to Serial. Backs the `q` console command.
void debug_dump(int max_entries = 5);

}  // namespace llattender::queue
