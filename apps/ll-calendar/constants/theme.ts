import { Platform } from "react-native";

/**
 * Luminous Scholar design tokens.
 * Sourced from the Stitch mockups — lime/purple/orange palette.
 */

export const Colors = {
  /** Core brand */
  lime: "#C4F34A",
  limeDark: "#A8D62C",
  limeSubtle: "#D9FB86",
  purple: "#2D1B4E",
  lavender: "#B892FF",
  orange: "#FF6B35",
  green: "#4ADE80",

  /** Neutrals */
  background: "#F9FAFC",
  surface: "#FFFFFF",
  inputBg: "#F3F5F0",
  muted: "#8A7E9E",
  mutedLight: "rgba(138,126,158,0.25)",
  textPrimary: "#2D1B4E",
  textSecondary: "#6B7280",
  textMuted: "#8A7E9E",
  textFooter: "#9CA3AF",
  divider: "rgba(138,126,158,0.1)",

  /** Semantic */
  accent: "#8D67FF",
  accentGreen: "#8AC300",
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
