// Date utilities
export {
  parsePBDate,
  formatTimeRange,
  makeDateKey,
  prettyTimestamp,
  todayDateStr,
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
} from "./attendance";
export type { AttendanceSummary } from "./attendance";

// Roles
export { isGuide, isAdmin, isLearner } from "./roles";
