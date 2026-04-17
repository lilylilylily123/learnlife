export const PB_URL = "https://learnlife.pockethost.io/";

export const PROGRAM_CODES = {
  Changemaker: "chmk",
  Creator: "cre",
  Explorer: "exp",
} as const;

export type ProgramCode = (typeof PROGRAM_CODES)[keyof typeof PROGRAM_CODES];
export type ProgramName = keyof typeof PROGRAM_CODES;

export const ALLOWED_STATUSES = ["present", "late", "absent", "jLate", "jAbsent"] as const;
export type AttendanceStatus = (typeof ALLOWED_STATUSES)[number];

export const TIME_THRESHOLDS = {
  LATE_HOUR: 10,
  LATE_MINUTE: 1,
  LUNCH_START_HOUR: 13,
  LUNCH_END_HOUR: 14,
  LUNCH_LATE_HOUR: 14,
  LUNCH_LATE_MINUTE: 1,
  CHECKOUT_HOUR: 16,
  CHECKOUT_MINUTE: 59,
  FRIDAY_CHECKOUT_HOUR: 14,
  FRIDAY_CHECKOUT_MINUTE: 0,
} as const;
