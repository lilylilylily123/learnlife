#include "chunked_source.h"

namespace llattender {

namespace {

// Value of a hex digit, or -1 if the character isn't one.
int hex_val(int c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

}  // namespace

// Consume a chunk header and set `remaining_` to that chunk's data length.
//
// Wire format:
//     1f4\r\n              length in hex, optionally ";ext=value" after it
//     <0x1f4 data bytes>
//     \r\n                 terminates the data, NOT part of it
//     0\r\n\r\n            terminating chunk
//
// Returns false at the terminator or on malformed framing; the two are
// distinguished by done_ vs malformed_.
bool ChunkedByteSource::begin_next_chunk() {
  if (done_ || malformed_) return false;

  // Every chunk after the first is preceded by the CRLF that terminated the
  // previous chunk's data.
  if (!at_first_) {
    if (in_.read() != '\r' || in_.read() != '\n') {
      malformed_ = true;
      return false;
    }
  }
  at_first_ = false;

  size_t size = 0;
  int digits = 0;
  int c = in_.read();
  for (int v = hex_val(c); v >= 0; v = hex_val(c)) {
    size = size * 16 + static_cast<size_t>(v);
    ++digits;
    c = in_.read();
  }

  // A header with no hex digits at all means the stream ended early or the
  // framing is corrupt. A well-formed chunked body always closes with 0\r\n.
  if (digits == 0) {
    malformed_ = true;
    return false;
  }

  // Skip chunk extensions (";name=value"). Nothing here needs them, but they
  // are legal and must not be mistaken for data.
  if (c == ';') {
    while (c != '\r' && c != -1) c = in_.read();
  }
  if (c != '\r' || in_.read() != '\n') {
    malformed_ = true;
    return false;
  }

  if (size == 0) {
    // Terminating chunk. Trailer headers may follow; they are ignored, because
    // the body is complete and nothing downstream reads past this point.
    done_ = true;
    return false;
  }

  remaining_ = size;
  return true;
}

int ChunkedByteSource::read() {
  if (done_ || malformed_) return -1;
  if (remaining_ == 0 && !begin_next_chunk()) return -1;

  const int c = in_.read();
  if (c < 0) {
    // EOF in the middle of a chunk whose length we were promised: the
    // connection dropped. Surface it rather than reporting a clean end, so a
    // truncated response can't be parsed as a valid-but-short document.
    malformed_ = true;
    return -1;
  }
  --remaining_;
  return c;
}

size_t ChunkedByteSource::readBytes(char* buffer, size_t length) {
  size_t total = 0;
  while (total < length) {
    if (done_ || malformed_) break;
    if (remaining_ == 0 && !begin_next_chunk()) break;

    // Never read past the end of the current chunk — the bytes immediately
    // after it are framing, not payload.
    size_t want = length - total;
    if (want > remaining_) want = remaining_;

    const size_t got = in_.readBytes(buffer + total, want);
    if (got == 0) {
      malformed_ = true;
      break;
    }
    remaining_ -= got;
    total += got;
  }
  return total;
}

}  // namespace llattender
