import { Platform } from "react-native";
import {
  colorsLight,
  colorsDark,
  radius as tokenRadius,
  spacing as tokenSpacing,
  shadow as tokenShadow,
} from "@learnlife/design-tokens";

/**
 * LearnLife Calendar design tokens.
 * Sourced from the unified Heritage × Editorial design system
 * in `@learnlife/design-tokens`.
 *
 * Keeps the legacy `Colors` + `Fonts` exports for compatibility with
 * existing screens, while adding richer `T` for new work.
 */

export const Colors = {
  // Editorial Paper palette
  lime: colorsLight.lime,
  limeDark: "#A8BE6E",
  limeSubtle: "#E2ECC5",
  purple: colorsLight.ink,
  lavender: colorsLight.accent,
  orange: colorsLight.warm,
  green: colorsLight.accent,

  background: colorsLight.bg,
  surface: colorsLight.surface,
  surface2: colorsLight.surface2,
  inputBg: colorsLight.surface2,
  muted: colorsLight.muted,
  mutedLight: "rgba(128,118,99,0.25)",
  textPrimary: colorsLight.ink,
  textSecondary: colorsLight.ink2,
  textMuted: colorsLight.muted,
  textFooter: colorsLight.muted,
  divider: colorsLight.divider,

  accent: colorsLight.accent,
  accentInk: colorsLight.accentInk,
  accentGreen: colorsLight.accent,
} as const;

type PlatformFonts = {
  sans: string;
  serif: string;
  rounded: string;
  mono: string;
  display: string;
  body: string;
};

/**
 * Editorial typography — display uses a high-contrast serif, body uses a
 * humanist sans. Native platforms use system serifs (ui-serif on iOS,
 * "serif" on Android) so we get editorial feel with zero font loading;
 * web strings out a full Fraunces / Inter Tight / JetBrains Mono stack.
 */
export const Fonts: PlatformFonts = (Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
    display: "ui-serif",
    body: "system-ui",
  },
  android: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
    display: "serif",
    body: "normal",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
    display: "serif",
    body: "normal",
  },
  web: {
    sans:
      "'Inter Tight', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    serif: "'Fraunces', Georgia, 'Times New Roman', serif",
    rounded:
      "'Fraunces', 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono:
      "'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    display: "'Fraunces', Georgia, serif",
    body: "'Inter Tight', 'Inter', -apple-system, system-ui, sans-serif",
  },
}) ?? {
  sans: "normal",
  serif: "serif",
  rounded: "normal",
  mono: "monospace",
  display: "serif",
  body: "normal",
}) as PlatformFonts;

export const T = {
  colors: {
    light: colorsLight,
    dark: colorsDark,
  },
  radius: tokenRadius,
  spacing: tokenSpacing,
  shadow: tokenShadow,
  fontFamily: {
    display: Fonts.display,
    body: Fonts.body,
    mono: Fonts.mono,
  },
} as const;

export const c = T.colors.light;
