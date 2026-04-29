#include "queue.h"

#ifndef LLATTENDER_NATIVE_BUILD

#include <Arduino.h>

namespace llattender::queue {

// TODO: backed by /queue.jsonl in LittleFS. For now an in-memory deque keeps
// main.cpp wireable without a filesystem; phase 3 swaps the storage.

namespace {
constexpr int kMaxInMemory = 64;
PendingScan g_buf[kMaxInMemory];
int g_head = 0;
int g_count = 0;
}  // namespace

bool init() {
  Serial.println("[queue] init (stub, in-memory)");
  return true;
}

bool append(const PendingScan& s) {
  if (g_count >= kMaxInMemory) {
    Serial.println("[queue] full, dropping oldest");
    g_head = (g_head + 1) % kMaxInMemory;
    g_count--;
  }
  int slot = (g_head + g_count) % kMaxInMemory;
  g_buf[slot] = s;
  g_count++;
  return true;
}

int drain(const std::function<bool(const PendingScan&)>& writer) {
  int drained = 0;
  while (g_count > 0) {
    const auto& head = g_buf[g_head];
    if (!writer(head)) break;
    g_head = (g_head + 1) % kMaxInMemory;
    g_count--;
    drained++;
  }
  return drained;
}

int size() { return g_count; }

}  // namespace llattender::queue

#endif  // LLATTENDER_NATIVE_BUILD
