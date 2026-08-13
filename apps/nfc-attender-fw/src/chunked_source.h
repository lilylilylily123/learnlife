#pragma once

// A ByteSource decorator that strips HTTP `Transfer-Encoding: chunked` framing.
//
// ── WHY THIS IS NEEDED ───────────────────────────────────────────────────
//
// The streaming parse reads straight from HTTPClient::getStream(), which hands
// back the RAW socket. HTTPClient only de-chunks inside getString() and
// writeToStream() — the two methods we are deliberately avoiding, because they
// are what allocate a full copy of the body and cause the OOM.
//
// PocketHost sits behind Cloudflare (responses carry `cf-cache-status` and
// `x-powered-by: Express`), and Cloudflare may use chunked encoding on the
// HTTP/1.1 leg. If it does, the byte stream contains chunk headers:
//
//     1f4\r\n            <- chunk length in HEX, optionally ";ext=value"
//     {"page":1,...      <- exactly 0x1f4 bytes of body
//     \r\n               <- trailing CRLF, not part of the body
//     0\r\n\r\n          <- terminator
//
// Feeding that to a JSON parser produces garbage. Wrap the stream in this when
// `http.getSize() < 0`, which is how HTTPClient reports "no Content-Length",
// i.e. chunked.
//
// Pure C++ with no Arduino dependency, so the framing logic is unit-tested on
// the host by feeding it a chunked body as a StringByteSource — rather than
// being discovered to be wrong against a live server.

#include <cstddef>

#include "json_source.h"

namespace llattender {

class ChunkedByteSource : public ByteSource {
 public:
  explicit ChunkedByteSource(ByteSource& inner) : in_(inner) {}

  int read() override;
  size_t readBytes(char* buffer, size_t length) override;

  // True once the 0-length terminating chunk has been consumed. A parse that
  // ends without this saw a truncated response.
  bool complete() const { return done_; }

  // True if the framing itself was malformed (a bad length line, or the
  // stream ending mid-chunk). Distinct from `complete()`: a caller can tell a
  // clean end from a corrupt one.
  bool malformed() const { return malformed_; }

 private:
  // Consume the next `<hex>\r\n` header, plus the CRLF trailing the previous
  // chunk's data. Returns false at the terminator or on malformed input.
  bool begin_next_chunk();

  ByteSource& in_;
  size_t remaining_ = 0;      // bytes left in the current chunk's data
  bool at_first_ = true;      // no preceding chunk, so no leading CRLF to eat
  bool done_ = false;
  bool malformed_ = false;
};

}  // namespace llattender
