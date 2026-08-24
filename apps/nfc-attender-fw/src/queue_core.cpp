#include "queue_core.h"

#include "queue_format.h"

namespace llattender::queue_core {

bool Queue::load(int& out_skipped) {
  out_skipped = 0;
  entries_.clear();

  std::vector<std::string> lines;
  if (!live_.read_all(lines)) return false;

  bool any_skipped = false;
  for (const auto& line : lines) {
    queue::PendingScan s;
    if (queue_format::parse(line, s)) {
      entries_.push_back(std::move(s));
    } else {
      ++out_skipped;
      any_skipped = true;
    }
  }

  // Rewrite immediately if anything was dropped, so the corrupt line is gone
  // for good rather than being re-read and re-skipped on every boot.
  if (any_skipped) compact();
  return true;
}

bool Queue::append(const queue::PendingScan& s, int& out_dropped) {
  out_dropped = 0;

  entries_.push_back(s);

  // Enforce the entry cap.
  while (entries_.size() > kMaxEntries) {
    entries_.erase(entries_.begin());
    ++out_dropped;
  }

  // Enforce the byte cap. Measured from the serialised form, since that is
  // what actually occupies the filesystem.
  size_t bytes = 0;
  for (const auto& e : entries_) bytes += queue_format::serialize(e).size() + 1;
  while (bytes > kMaxBytes && entries_.size() > 1) {
    bytes -= queue_format::serialize(entries_.front()).size() + 1;
    entries_.erase(entries_.begin());
    ++out_dropped;
  }

  // A drop means the in-memory list no longer matches the file, so the whole
  // thing has to be rewritten. Otherwise just append — far cheaper, and it is
  // the common path.
  if (out_dropped > 0) return compact();
  return live_.append(queue_format::serialize(s));
}

int Queue::drain(const Writer& writer) {
  int written = 0;
  int dead_moved = 0;
  size_t i = 0;

  for (; i < entries_.size(); ++i) {
    const WriteOutcome outcome = writer(entries_[i]);

    if (outcome == WriteOutcome::Ok) {
      ++written;
      continue;
    }
    if (outcome == WriteOutcome::PermanentFail) {
      // Park it for manual review and keep going. A row deleted server-side
      // must not wedge every scan queued behind it.
      dead_.append(queue_format::serialize(entries_[i]));
      ++dead_moved;
      continue;
    }
    // RetryLater: stop here, keeping this entry and everything after it.
    break;
  }

  if (i > 0) {
    // Everything before `i` is resolved — written or dead-lettered.
    entries_.erase(entries_.begin(), entries_.begin() + static_cast<long>(i));
    compact();
  }

  (void)dead_moved;
  return written;
}

bool Queue::compact() {
  std::vector<std::string> lines;
  lines.reserve(entries_.size());
  for (const auto& e : entries_) lines.push_back(queue_format::serialize(e));
  return live_.replace_all(lines);
}

}  // namespace llattender::queue_core
