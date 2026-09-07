#pragma once

// A line-oriented persistent store, behind an interface.
//
// ── WHY AN INTERFACE ─────────────────────────────────────────────────────
//
// The offline queue and the roster cache both need "keep a list of lines on
// disk, survive a reboot". That logic has real edge cases — a corrupt tail
// after a power cut, a cap that drops the oldest entry, a compaction that
// must not lose data if it fails halfway — and every one of them is a
// correctness bug that only shows up on a bad day at a school front desk.
//
// LittleFS only exists on the device, so testing that logic against real
// files would mean testing on hardware, which is exactly where these cases
// are hardest to provoke. Instead the behaviour lives in pure modules
// (queue_core, roster) that talk to this interface, and the filesystem is a
// thin adapter with no branching in it. InMemoryLineStore then lets the host
// tests provoke a mid-compaction disk failure on demand.
//
// ── FORMAT ───────────────────────────────────────────────────────────────
//
// One record per line, '\n' terminated. Callers are responsible for their own
// escaping — both current formats (queue_format, roster_format) are
// pipe-delimited and strip CR/LF on write, so a record can never contain a
// newline and split itself in two.

#include <cstddef>
#include <string>
#include <vector>

namespace llattender {

class LineStore {
 public:
  virtual ~LineStore() = default;

  // Append one line. Must be durable enough that a power cut immediately
  // afterwards keeps it.
  virtual bool append(const std::string& line) = 0;

  // Read every line. Blank lines are skipped. A truncated final line (the
  // signature of a power cut mid-append) is returned as-is — the caller
  // decides whether it parses, because only the caller knows the format.
  virtual bool read_all(std::vector<std::string>& out) = 0;

  // Atomically replace the entire contents. Used for compaction after a
  // drain. "Atomically" here means: either the old contents or the new ones
  // survive a power cut, never a half-written mixture, and never nothing.
  //
  // That last clause is the load-bearing one, and it is why the LittleFS
  // implementation is a two-phase rename rather than the shorter
  // remove-then-rename: the short version has an instant where the only
  // complete copy sits under a temp name nothing looks for on boot.
  virtual bool replace_all(const std::vector<std::string>& lines) = 0;

  // Approximate bytes on disk. Used to enforce a size cap without reading
  // everything back.
  virtual size_t size_bytes() const = 0;

  // Remove the backing file entirely.
  virtual bool clear() = 0;
};

// Test double. Header-only so the native build needs no extra .cpp, and so
// tests can construct one inline.
//
// The fail_* flags exist because the interesting bugs are all in the failure
// paths: a queue that loses entries when compaction fails is far worse than
// one that occasionally fails to compact.
class InMemoryLineStore : public LineStore {
 public:
  bool fail_next_append = false;
  bool fail_next_replace = false;
  int append_calls = 0;
  int replace_calls = 0;

  bool append(const std::string& line) override {
    ++append_calls;
    if (fail_next_append) {
      fail_next_append = false;
      return false;
    }
    lines_.push_back(line);
    return true;
  }

  bool read_all(std::vector<std::string>& out) override {
    out = lines_;
    return true;
  }

  bool replace_all(const std::vector<std::string>& lines) override {
    ++replace_calls;
    if (fail_next_replace) {
      fail_next_replace = false;
      // Deliberately leaves the old contents intact — that is the behaviour a
      // real atomic write-then-rename gives, and the tests assert on it.
      return false;
    }
    lines_ = lines;
    return true;
  }

  size_t size_bytes() const override {
    size_t n = 0;
    for (const auto& l : lines_) n += l.size() + 1;  // +1 for the newline
    return n;
  }

  bool clear() override {
    lines_.clear();
    return true;
  }

  // Test-only accessor: what is actually "on disk" right now.
  const std::vector<std::string>& lines() const { return lines_; }

 private:
  std::vector<std::string> lines_;
};

}  // namespace llattender

#ifndef LLATTENDER_NATIVE_BUILD

namespace llattender {

// LittleFS-backed store. Thin on purpose: all the interesting behaviour is in
// queue_core / roster, which are testable on the host.
class LittleFsLineStore : public LineStore {
 public:
  explicit LittleFsLineStore(const char* path) : path_(path) {}

  bool append(const std::string& line) override;
  bool read_all(std::vector<std::string>& out) override;
  bool replace_all(const std::vector<std::string>& lines) override;
  size_t size_bytes() const override;
  bool clear() override;

 private:
  // Roll a power-cut-interrupted replace_all forward or back. Idempotent and
  // self-triggering: every public method calls it, and the first call per
  // boot does the work. const because size_bytes() is.
  void recover() const;

  const char* path_;
  mutable bool recovered_ = false;
};

}  // namespace llattender

#endif  // LLATTENDER_NATIVE_BUILD
