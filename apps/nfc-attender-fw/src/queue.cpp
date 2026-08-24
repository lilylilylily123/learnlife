#include "queue.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

#include "line_store.h"
#include "queue_core.h"

namespace llattender::queue {

// Arduino wiring only. Every decision — caps, ordering, dead-lettering,
// corrupt-line recovery — lives in queue_core, which is tested on the host.
// This file just supplies the filesystem and a mutex.

namespace {

constexpr const char* kLivePath = "/queue.jsonl";
constexpr const char* kDeadPath = "/queue.dead.jsonl";

LittleFsLineStore g_live(kLivePath);
LittleFsLineStore g_dead(kDeadPath);
queue_core::Queue g_queue(g_live, g_dead);

// append() runs on processor_task (core 1) while drain() runs on network_task
// (core 0). Both mutate the same in-memory vector and the same file.
SemaphoreHandle_t g_mtx = nullptr;

class Lock {
 public:
  Lock() : held_(false) {
    if (g_mtx) held_ = xSemaphoreTakeRecursive(g_mtx, portMAX_DELAY) == pdTRUE;
  }
  ~Lock() { if (held_) xSemaphoreGiveRecursive(g_mtx); }
  Lock(const Lock&) = delete;
  Lock& operator=(const Lock&) = delete;
 private:
  bool held_;
};

}  // namespace

bool init() {
  if (!g_mtx) g_mtx = xSemaphoreCreateRecursiveMutex();
  Lock lk;

  int skipped = 0;
  if (!g_queue.load(skipped)) {
    Serial.println("[queue] load failed — starting empty");
    return false;
  }
  if (skipped > 0) {
    // Almost always a truncated final line from a power cut mid-append. Worth
    // saying out loud: it means one scan was lost, and the count is the only
    // evidence that will ever exist.
    Serial.printf("[queue] dropped %d unparseable line(s) — likely a power "
                  "cut mid-write\n", skipped);
  }
  Serial.printf("[queue] init ok — %u pending on disk\n",
                static_cast<unsigned>(g_queue.size()));
  return true;
}

bool append(const PendingScan& s) {
  Lock lk;
  int dropped = 0;
  const bool ok = g_queue.append(s, dropped);
  if (dropped > 0) {
    // Never silent. The old in-RAM queue dropped the oldest entry with a
    // single println and no count; this is attendance data going missing.
    Serial.printf("[queue] FULL — dropped %d oldest entr%s (cap %u/%uB). "
                  "These scans are LOST.\n",
                  dropped, dropped == 1 ? "y" : "ies",
                  static_cast<unsigned>(queue_core::kMaxEntries),
                  static_cast<unsigned>(queue_core::kMaxBytes));
  }
  if (!ok) Serial.println("[queue] append failed — disk full?");
  return ok;
}

int drain(const std::function<bool(const PendingScan&)>& writer) {
  Lock lk;
  // Adapt the legacy bool-returning writer to the richer outcome the core
  // wants. A plain `false` can't distinguish "retry later" from "never going
  // to work", so it is treated as transient — the safe direction, since the
  // alternative is discarding real attendance data. Callers that can tell the
  // difference should use drain_ex().
  return g_queue.drain([&](const PendingScan& s) {
    return writer(s) ? WriteOutcome::Ok : WriteOutcome::RetryLater;
  });
}

int drain_ex(const std::function<WriteOutcome(const PendingScan&)>& writer) {
  Lock lk;
  return g_queue.drain(writer);
}

int size() {
  Lock lk;
  return static_cast<int>(g_queue.size());
}

void debug_dump(int max_entries) {
  Lock lk;
  const auto& es = g_queue.entries();
  Serial.printf("[queue] %u pending, %u bytes on disk\n",
                static_cast<unsigned>(es.size()),
                static_cast<unsigned>(g_live.size_bytes()));
  int shown = 0;
  for (const auto& e : es) {
    if (shown++ >= max_entries) {
      Serial.printf("[queue]   ... and %u more\n",
                    static_cast<unsigned>(es.size() - shown + 1));
      break;
    }
    Serial.printf("[queue]   learner=%s attendance=%s ts=%ld %s\n",
                  e.learner_id.c_str(),
                  e.attendance_id.empty() ? "(none)" : e.attendance_id.c_str(),
                  static_cast<long>(e.ts_unix),
                  e.fields_json.c_str());
  }
  const size_t dead_bytes = g_dead.size_bytes();
  if (dead_bytes > 0) {
    Serial.printf("[queue] dead-letter file holds %u bytes — entries that can "
                  "never be written (deleted rows, bad ids)\n",
                  static_cast<unsigned>(dead_bytes));
  }
}

}  // namespace llattender::queue

#endif  // LLATTENDER_NATIVE_BUILD
