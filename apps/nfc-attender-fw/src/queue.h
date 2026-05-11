#pragma once

// Append-only offline scan queue persisted as JSONL on LittleFS.
// On every successful PocketBase write the corresponding line is dropped.
// The queue is the durability boundary: a scan that's been written here is
// guaranteed to eventually reach PB (or end up in `/queue.dead.jsonl` for
// manual review on a permanent 4xx).

#include <ctime>
#include <functional>
#include <string>

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

// Drain queued entries by calling `writer` on each. If `writer` returns true,
// the entry is removed from the queue. If false, drain stops and the entry
// (and everything after it) stays for the next attempt.
//
// Returns the number of entries successfully drained.
int drain(const std::function<bool(const PendingScan&)>& writer);

// Number of entries still pending.
int size();

}  // namespace llattender::queue
