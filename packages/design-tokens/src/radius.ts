export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 9999,
} as const;

export type RadiusKey = keyof typeof radius;
