/**
 * LearnLife unified color tokens — "Paper" palette.
 *
 * Warm cream paper + deep ink, muted sage accent, rust warm,
 * calmed-down lime nod to heritage. Editorial + warm.
 *
 * Semantic name: `accent` (sage green). `lavender` kept as an alias
 * for backwards compatibility with earlier code.
 */

export const colorsLight = {
  bg: "#F3EEE5",
  surface: "#FBF8F2",
  surface2: "#EAE3D3",
  ink: "#1F1B16",
  ink2: "#3A342A",
  muted: "#807663",
  divider: "#D9D1BF",

  accent: "#4F6B4A",
  accentInk: "#F3EEE5",
  lime: "#C4D98B",
  limeInk: "#1F1B16",
  warm: "#C26B3C",
  warmInk: "#FBF8F2",

  // Aliases — `lavender` now resolves to the sage accent so pre-existing
  // code keeps working after the palette swap.
  lavender: "#4F6B4A",
  lavenderInk: "#F3EEE5",
} as const;

export const colorsDark = {
  bg: "#16130E",
  surface: "#201C15",
  surface2: "#2A2519",
  ink: "#F0E9D8",
  ink2: "#CBC2AC",
  muted: "#8A8170",
  divider: "#3A3426",

  accent: "#A8C09E",
  accentInk: "#16130E",
  lime: "#DCEC9C",
  limeInk: "#16130E",
  warm: "#E08652",
  warmInk: "#16130E",

  lavender: "#A8C09E",
  lavenderInk: "#16130E",
} as const;

export type ColorTokens = typeof colorsLight;
export type ColorKey = keyof ColorTokens;

export const colors = {
  light: colorsLight,
  dark: colorsDark,
} as const;
