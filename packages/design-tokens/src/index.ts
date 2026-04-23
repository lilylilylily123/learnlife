export {
  colors,
  colorsLight,
  colorsDark,
  type ColorTokens,
  type ColorKey,
} from "./colors";
export {
  fontFamilies,
  fontWeights,
  typeScale,
  type TypeScaleEntry,
  type TypeScaleKey,
} from "./typography";
export { spacing, type SpacingKey } from "./spacing";
export { radius, type RadiusKey } from "./radius";
export { shadow, type ShadowKey } from "./shadow";

import { colors } from "./colors";
import { fontFamilies, fontWeights, typeScale } from "./typography";
import { spacing } from "./spacing";
import { radius } from "./radius";
import { shadow } from "./shadow";

export const tokens = {
  colors,
  fontFamilies,
  fontWeights,
  typeScale,
  spacing,
  radius,
  shadow,
} as const;

export type Tokens = typeof tokens;
