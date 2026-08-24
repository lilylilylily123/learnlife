#pragma once

// Offline scan queue behaviour. Pure: no Arduino, no filesystem, no network.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
//
// The queue is the durability boundary of the whole device. A tap that has
// been acknowledged on the OLED but not yet accepted by PocketBase lives only
// here — so if the queue loses it, the learner believes they signed in and no
// record of it exists anywhere. Nobody finds out until someone audits the day.
//
// Until now the queue was a 64-slot array in RAM that dropped the oldest entry
// silently when full and lost everything on power loss, despite queue.h
// promising on-disk durability. This is that promise, implemented.
//
// The behaviour lives here, separated from LittleFS by the LineStore
// interface, because the interesting cases — a corrupt tail from a power cut,
// a permanent failure blocking the head, compaction failing halfway — are all
// far easier to provoke in a host test than on hardware.

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

#include "line_store.h"
#include "pb_result.h"
#include "queue.h"

namespace llattender::queue_core {

// Caps. Reached only if the device is offline for a long stretch; at ~61
// learners with a handful of taps each, a normal day is well under 200
// entries and roughly 20 KB.
//
// LittleFS on the default partition has ~1.4 MB, so these are conservative on
// purpose: the queue must never be the thing that fills the filesystem and
// takes the roster cache down with it.
constexpr size_t kMaxEntries = 200;
constexpr size_t kMaxBytes = 32 * 1024;

// The writer attempts one PocketBase write and reports what happened.
using Writer = std::function<WriteOutcome(const queue::PendingScan&)>;

class Queue {
 public:
  // `live` holds pending entries; `dead` receives entries that can never
  // succeed, for manual review. Both are borrowed, not owned.
  Queue(LineStore& live, LineStore& dead) : live_(live), dead_(dead) {}

  // Read the backing store into memory. Unparseable lines are skipped and
  // counted in `out_skipped` rather than aborting — a single corrupt tail
  // (the signature of a power cut mid-append) must not make the entire queue
  // unreadable and strand every entry behind it.
  bool load(int& out_skipped);

  // Append a scan. Enforces the caps by dropping the OLDEST entries first,
  // which is the right direction: an old unsent scan is more likely already
  // stale than a new one, and check-outs matter more than check-ins.
  //
  // Dropping is REPORTED via out_dropped, never silent. Losing attendance
  // data quietly is the failure mode this whole module exists to prevent.
  bool append(const queue::PendingScan& s, int& out_dropped);

  // Attempt to write queued entries in order.
  //
  //   Ok            -> entry is removed
  //   PermanentFail -> entry is moved to the dead-letter store, drain continues
  //   RetryLater    -> drain STOPS; this entry and everything after it remain,
  //                    in order
  //
  // Stopping on RetryLater preserves ordering, which matters because a
  // learner's check-in must land before their check-out. Continuing past a
  // transient failure could invert them.
  //
  // Returns the number successfully written.
  int drain(const Writer& writer);

  size_t size() const { return entries_.size(); }
  bool empty() const { return entries_.empty(); }

  // Entries currently pending, oldest first. For diagnostics and the `q`
  // serial command.
  const std::vector<queue::PendingScan>& entries() const { return entries_; }

 private:
  // Rewrite the live store from the in-memory list.
  bool compact();

  LineStore& live_;
  LineStore& dead_;
  std::vector<queue::PendingScan> entries_;
};

}  // namespace llattender::queue_core
