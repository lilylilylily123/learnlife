// Client
export { createPBClient } from "./client";
export type { PBClientOptions } from "./client";

// Constants
export { PB_URL, PROGRAM_CODES, ALLOWED_STATUSES, TIME_THRESHOLDS } from "./constants";
export type { ProgramCode, ProgramName, AttendanceStatus } from "./constants";

// Types
export type {
  UserRole,
  User,
  Learner,
  LunchEvent,
  AttendanceRecord,
  CalRecurrence,
  CalRecord,
  CalEvent,
  CreateCalEntryPayload,
  Conversation,
  Message,
  Invite,
  EventRsvp,
  RsvpStatus,
} from "./types";

// Queries
export * as auth from "./queries/auth";
export * as learners from "./queries/learners";
export * as attendance from "./queries/attendance";
export * as calendar from "./queries/calendar";
export * as messages from "./queries/messages";
export * as invites from "./queries/invites";
export * as rsvp from "./queries/rsvp";

// Re-exported query types
export type { MessageableUser } from "./queries/messages";

// Utils
export { withRetry } from "./utils/retry";
