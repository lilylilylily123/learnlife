#pragma once

// Cross-language conformance harness for compute_check_in_action().
//
// Loads packages/shared/fixtures/attendance-state-machine.json — the SAME file
// the Vitest suite in apps/nfc-attender/src/__tests__/attendance-fixture.test.ts
// loads — and runs every case against the C++ port.
//
// The attendance rule is implemented four times and the copies had already
// drifted. This harness plus its TypeScript twin is the structural fix: a case
// both harnesses run is a case where drift fails a build.
//
// Cases carrying a `divergence` block are the known TS/C++ disagreements. This
// harness asserts against the RECORDED C++ behaviour and reports the case as
// KNOWN DIVERGENT, so both behaviours stay pinned while the product decision is
// outstanding. Unmarked cases must match the specification exactly.
//
// Call from main() after the hand-written tests; the runner drives Unity
// itself, emitting one named Unity test per fixture case.

namespace llattender_fixture {

// Runs every fixture case plus the divergence guards and reports.
// Must be called between UNITY_BEGIN() and UNITY_END().
void run_all();

}  // namespace llattender_fixture
