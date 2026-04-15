import type { AttendanceStatus, ProgramCode } from "./constants";

export type UserRole = "learner" | "lg" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  username: string;
  avatar: string;
  role: UserRole;
  learner?: string; // FK to learners collection (required for role="learner")
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

export interface Learner {
  id: string;
  name: string;
  email: string;
  dob: string;
  NFC_ID: string | null;
  program: ProgramCode;
  comments?: string;
  user?: string; // back-reference FK to users collection
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
}

export interface LunchEvent {
  type: "out" | "in";
  time: string;
}

export interface AttendanceRecord {
  id: string;
  learner: string; // FK to learners
  date: string;
  time_in: string | null;
  time_out: string | null;
  lunch_out: string | null; // legacy
  lunch_in: string | null; // legacy
  lunch_events: LunchEvent[] | null;
  status: AttendanceStatus | null;
  lunch_status: AttendanceStatus | null;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  expand?: {
    learner?: Learner;
  };
}

export type CalRecurrence = "none" | "weekly";

export interface CalRecord {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
  emoji: string;
  type: "event" | "class";
  recurrence: CalRecurrence;
  recurrence_days: number[]; // 0=Mon ... 6=Sun
  recurrence_end: string;
  created_by: string; // FK to users
}

export interface CalEvent {
  id: string; // recordId for one-off; "recordId-YEAR-M-D" for recurring
  recordId: string; // original PB record ID (for mutations)
  title: string;
  time: string; // "09:00 AM - 10:30 AM"
  emoji: string;
  color: string;
}

export interface CreateCalEntryPayload {
  title: string;
  start: string;
  end: string;
  color: string;
  emoji: string;
  type: "event" | "class";
  recurrence: CalRecurrence;
  recurrence_days: number[];
  recurrence_end: string;
  created_by: string;
}

export interface Conversation {
  id: string;
  participants: string[];
  last_message: string;
  last_message_at: string;
  last_sender: string;
  created: string;
  updated: string;
  expand?: {
    participants?: Array<{ id: string; name: string; username: string; email: string; avatar: string }>;
    last_sender?: { id: string; name: string; username: string };
  };
}

export interface Message {
  id: string;
  conversation: string;
  sender: string;
  body: string;
  read_by: string[];
  created: string;
  expand?: {
    sender?: { id: string; name: string; username: string; avatar: string };
  };
}
