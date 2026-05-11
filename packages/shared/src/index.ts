// Date utilities
export {
  parsePBDate,
  formatTimeRange,
  makeDateKey,
  toOccurrenceDate,
  dateKeyToOccurrenceDate,
  prettyTimestamp,
  todayDateStr,
  countWeekdays,
} from "./date-utils";

// Calendar
export { expandEvents } from "./calendar";

// Attendance state machine
export { computeCheckInAction } from "./attendance";
export type { AttendanceState, CheckInAction } from "./attendance";

// Attendance aggregation
export {
  summarizeAttendance,
  summarizeByLearner,
  emptySummary,
  formatMinutesOfDay,
  computeAttendanceRates,
} from "./attendance";
export type {
  AttendanceSummary,
  AttendanceCounts,
  SummarizeOptions,
} from "./attendance";

// Roles
export { isGuide, isAdmin, isLearner } from "./roles";

// RSVP state machine
export { computeRsvpAction, promoteFromWaitlist, countRsvps } from "./rsvp";
export type {
  RsvpEntry,
  RsvpRules,
  RsvpDecision,
  RsvpPromotion,
  RsvpCounts,
  ComputeRsvpInput,
} from "./rsvp";
