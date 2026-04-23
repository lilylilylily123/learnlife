/**
 * Subtle card shadow — no heavy drop shadows; prefer 1px dividers instead.
 */

export const shadow = {
  card: {
    css: "0 2px 10px rgba(45, 27, 78, 0.06)",
    rn: {
      shadowColor: "#2D1B4E",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
  },
  pop: {
    css: "0 4px 20px rgba(45, 27, 78, 0.12)",
    rn: {
      shadowColor: "#2D1B4E",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
      elevation: 6,
    },
  },
} as const;

export type ShadowKey = keyof typeof shadow;
