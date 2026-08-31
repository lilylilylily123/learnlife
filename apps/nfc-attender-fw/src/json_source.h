#pragma once

// A byte source that ArduinoJson can deserialize directly from.
//
// ── WHY ──────────────────────────────────────────────────────────────────
//
// The periodic attendance prefetch used to OOM: pb_client read the entire
// HTTP response into a std::string, then handed that string to ArduinoJson,
// which built a second full copy in its own arena. With 61 learners and TLS
// already holding ~40 KB of the heap, that is more memory than the ESP32 has.
//
// Parsing straight out of the socket removes both copies. But the parser then
// has to read from an Arduino `Stream` on device and from a plain string in
// the native tests — and the native build has no Arduino headers at all
// (everything Arduino-touching is compiled out by LLATTENDER_NATIVE_BUILD).
//
// So the parser talks to this abstract interface instead, and gets the same
// single code path in both worlds. No #ifdef inside pb_response.
//
// ── WHY THIS WORKS WITH ArduinoJson ──────────────────────────────────────
//
// ArduinoJson's generic reader (Deserialization/Reader.hpp) is:
//
//     template <typename TSource, typename Enable = void>
//     struct Reader {
//       Reader(TSource& source) : source_(&source) {}
//       int read()                               { return source_->read(); }
//       size_t readBytes(char* buf, size_t len)  { return source_->readBytes(buf, len); }
//       TSource* source_;
//     };
//
// It stores a POINTER and calls through it, explicitly documented as "a
// simple wrapper for Readers that are not copyable". An abstract base with
// virtual read()/readBytes() therefore works: nothing slices, nothing is
// copied, and the calls dispatch virtually.
//
// That is verified by test_json_source, which is deliberately the first test
// in this area — the whole streaming-parse design rests on it.

#include <cstddef>
#include <string>

namespace llattender {

// Matches the two methods ArduinoJson's generic Reader requires.
class ByteSource {
 public:
  virtual ~ByteSource() = default;

  // Return the next byte, or -1 at end of input.
  virtual int read() = 0;

  // Fill up to `length` bytes; return how many were actually read. A short
  // read (including 0) means end of input.
  virtual size_t readBytes(char* buffer, size_t length) = 0;
};

// Reads from an in-memory string. Used by every native test, and by the
// std::string overloads in pb_response that keep the old API working.
class StringByteSource : public ByteSource {
 public:
  explicit StringByteSource(const std::string& s) : s_(s), pos_(0) {}

  int read() override {
    if (pos_ >= s_.size()) return -1;
    return static_cast<unsigned char>(s_[pos_++]);
  }

  size_t readBytes(char* buffer, size_t length) override {
    const size_t avail = s_.size() - pos_;
    const size_t n = length < avail ? length : avail;
    for (size_t i = 0; i < n; ++i) buffer[i] = s_[pos_ + i];
    pos_ += n;
    return n;
  }

  // How many bytes have been consumed. Only used by tests, to assert that a
  // parse stopped early rather than swallowing the whole buffer.
  size_t consumed() const { return pos_; }

 private:
  const std::string& s_;
  size_t pos_;
};

}  // namespace llattender

#ifndef LLATTENDER_NATIVE_BUILD

#include <Stream.h>

namespace llattender {

// Reads straight from an Arduino Stream — in practice HTTPClient::getStream(),
// i.e. the TLS socket. This is the one that avoids the two full copies of the
// response body.
//
// Note HTTPClient::getStream() hands back the RAW body. When the server uses
// chunked transfer-encoding (PocketHost sits behind Cloudflare, so it can),
// the chunk framing is still in the byte stream and would corrupt the parse.
// Wrap this in a ChunkedByteSource when http.getSize() < 0 — see
// chunked_source.h.
class StreamByteSource : public ByteSource {
 public:
  explicit StreamByteSource(Stream& s) : s_(s) {}

  int read() override { return s_.read(); }

  size_t readBytes(char* buffer, size_t length) override {
    return s_.readBytes(buffer, length);
  }

 private:
  Stream& s_;
};

}  // namespace llattender

#endif  // LLATTENDER_NATIVE_BUILD
