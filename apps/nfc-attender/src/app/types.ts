import { RecordModel } from "pocketbase";
import type { ArrivalStatus, LunchEvent } from "@learnlife/pb-client";

export type Student = RecordModel & {
  uid: string;
  name: string;
  email: string;
  dob: string;
  NFC_ID: string | null;
  time_in?: string | null;
  time_out?: string | null;
  lunch_in?: string | null;
  lunch_out?: string | null;
  lunch_events?: LunchEvent[] | null;
  status?: string;
  lunch_status?: string;
  // Split-status fields (mirrors the underlying attendance record).
  arrival?: ArrivalStatus | null;
  justified?: boolean;
  justification_reason?: string | null;
  justified_by?: string | null;
  justified_at?: string | null;
  program?: string;
  comments?: string;
};

export type AttendanceFilterKey =
  | "all"
  | "here"
  | "away"
  | "lunch"
  | "out"
  | "present"
  | "late"
  | "absent"
  | "jLate"
  | "jAbsent";

export type AttendanceCounts = Record<AttendanceFilterKey, number>;
