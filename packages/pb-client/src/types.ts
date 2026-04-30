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
  programs?: string[]; // ["chmk", "cre", "exp"] — if set, visible to learners in any of these programs
  // ── RSVP (events only; classes leave these unset) ──────────────────────
  rsvp_enabled?: boolean;
  capacity?: number | null; // null/0 = unlimited
  rsvp_deadline?: string | null; // ISO; null = no deadline
  allow_waitlist?: boolean;
}

export interface CalEvent {
  id: string; // recordId for one-off; "recordId-YEAR-M-D" for recurring
  recordId: string; // original PB record ID (for mutations)
  title: string;
  time: string; // "09:00 AM - 10:30 AM"
  emoji: string;
  color: string;
  createdBy: string; // FK to users — used for client-side edit/delete permission checks
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
  programs?: string[]; // ["chmk", "cre", "exp"] — if set, visible to learners in any of these programs
  rsvp_enabled?: boolean;
  capacity?: number | null;
  rsvp_deadline?: string | null;
  allow_waitlist?: boolean;
}

export type RsvpStatus = "going" | "not_going" | "waitlisted";

/**
 * One user's RSVP for a single calendar event occurrence. Recurring events
 * have one row per (event, occurrence_date, user) — see queries/rsvp.ts.
 */
export interface EventRsvp {
  id: string;
  event: string; // FK to calendar
  occurrence_date: string | null; // "YYYY-MM-DD" for recurring; null for one-off
  user: string; // FK to users
  status: RsvpStatus;
  position: number | null; // waitlist ordinal; null for going/not_going
  responded_at: string;
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  expand?: {
    user?: { id: string; name: string; username: string; avatar: string };
  };
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

export interface Invite {
  id: string;
  code: string;
  learner: string; // FK to learners
  email: string;
  expires_at: string;
  used: boolean;
  used_at: string;
  created_by: string; // FK to users
  collectionId: string;
  collectionName: string;
  created: string;
  updated: string;
  expand?: {
    learner?: Learner;
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
