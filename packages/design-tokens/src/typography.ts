/**
 * Editorial type system: Fraunces (serif display) + Inter Tight (body) + JetBrains Mono (labels).
 *
 * On mobile the family names map to expo-font aliases; on web they're passed to
 * `font-family` directly via the Google Fonts stack.
 */

export const fontFamilies = {
  display:
    "'Fraunces', 'DM Serif Display', Georgia, 'Times New Roman', serif",
  body:
    "'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  mono:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

export type TypeScaleEntry = {
  family: "display" | "body" | "mono";
  size: number;
  weight: 400 | 500 | 600 | 700;
  tracking: number;
  lineHeight: number;
  uppercase?: boolean;
};

export const typeScale = {
  display: {
    family: "display",
    size: 56,
    weight: 600,
    tracking: -0.02,
    lineHeight: 1.0,
  },
  h1: {
    family: "display",
    size: 34,
    weight: 600,
    tracking: -0.02,
    lineHeight: 1.05,
  },
  h2: {
    family: "display",
    size: 26,
    weight: 600,
    tracking: -0.015,
    lineHeight: 1.1,
  },
  h3: {
    family: "display",
    size: 20,
    weight: 600,
    tracking: -0.01,
    lineHeight: 1.15,
  },
  body: {
    family: "body",
    size: 16,
    weight: 400,
    tracking: 0,
    lineHeight: 1.5,
  },
  bodySmall: {
    family: "body",
    size: 14,
    weight: 500,
    tracking: 0,
    lineHeight: 1.5,
  },
  caption: {
    family: "body",
    size: 12,
    weight: 500,
    tracking: 0,
    lineHeight: 1.4,
  },
  kicker: {
    family: "mono",
    size: 11,
    weight: 700,
    tracking: 0.05,
    lineHeight: 1.2,
    uppercase: true,
  },
} as const satisfies Record<string, TypeScaleEntry>;

export type TypeScaleKey = keyof typeof typeScale;
