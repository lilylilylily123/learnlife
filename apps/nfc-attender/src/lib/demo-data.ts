// Synthesize a believable mid-day attendance snapshot from the real roster.
//
// Used by Test Mode's "Load demo" toggle so a stage demo can show a varied
// attendance state without writing to PocketBase. The output is shaped like
// the `attendanceMap` the dashboard already consumes — same field names,
// same value types — so the rest of the UI doesn't need to know it's fake.
//
// The distribution is deterministic per learner (hash of id) so toggling
// demo on/off doesn't reshuffle who is "late" vs "absent" mid-presentation.

import type { RecordModel } from "pocketbase";

interface DemoAttendanceRecord {
  id: string;
  learner: string;
  time_in: string | null;
  time_out: string | null;
  arrival: string | null;
  justified: boolean;
  status: string | null;
  lunch_status: string | null;
  lunch_events: { type: "in" | "out"; time: string }[] | null;
  justification_reason: string | null;
  justified_by: string | null;
  justified_at: string | null;
  comments: string | null;
}

function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function at(base: Date, hour: number, minute: number): string {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const JUSTIFIED_REASONS = [
  "Dentist appointment",
  "Family emergency",
  "Travel — informed in advance",
  "Doctor's note on file",
  "Religious observance",
];

// Builds an attendanceMap-shaped object: learnerId → record. The shape mirrors
// what `listAttendance` returns from PB so consumers don't branch.
export function buildDemoAttendanceMap(
  students: RecordModel[],
  when: Date = new Date(),
): Record<string, DemoAttendanceRecord> {
  const map: Record<string, DemoAttendanceRecord> = {};
  for (const s of students) {
    const seed = hash(s.id);
    const bucket = seed % 100;
    const base = blankRecord(s.id);

    if (bucket < 55) {
      // 55% present on time — varied check-in around 8:40–9:05
      const m = 40 + (seed % 26);
      base.time_in = at(when, m < 60 ? 8 : 9, m < 60 ? m : m - 60);
      base.arrival = "present";
      base.status = "present";
    } else if (bucket < 65) {
      // 10% late — checked in 9:10–9:45
      const m = 10 + (seed % 36);
      base.time_in = at(when, 9, m);
      base.arrival = "late";
      base.status = "late";
    } else if (bucket < 75) {
      // 10% currently at lunch — checked in, last lunch event is 'out'
      base.time_in = at(when, 8, 50 + (seed % 10));
      base.arrival = "present";
      base.status = "present";
      base.lunch_events = [{ type: "out", time: at(when, 12, 5 + (seed % 20)) }];
    } else if (bucket < 82) {
      // 7% checked out for the day
      base.time_in = at(when, 8, 55);
      base.time_out = at(when, 15, 0 + (seed % 30));
      base.arrival = "present";
      base.status = "present";
    } else if (bucket < 92) {
      // 10% justified absent with reason
      base.arrival = "absent";
      base.justified = true;
      base.status = "jAbsent";
      base.justification_reason = JUSTIFIED_REASONS[seed % JUSTIFIED_REASONS.length];
      base.justified_at = at(when, 7, 30);
    } else {
      // 8% absent, no check-in (the "missing" group)
      base.arrival = null;
      base.status = null;
    }

    map[s.id] = base;
  }
  return map;
}

function blankRecord(learnerId: string): DemoAttendanceRecord {
  return {
    id: `demo-${learnerId}`,
    learner: learnerId,
    time_in: null,
    time_out: null,
    arrival: null,
    justified: false,
    status: null,
    lunch_status: null,
    lunch_events: null,
    justification_reason: null,
    justified_by: null,
    justified_at: null,
    comments: null,
  };
}
