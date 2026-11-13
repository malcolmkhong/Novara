// ---------------------------------------------------------------------------
// The Novara AI mark.
//
// A single continuous ribbon: up the left stem, a fold to the right, the
// diagonal down, a second fold, then up the right stem.
//
// It is drawn as a solid stroke rather than an outline. The previous mark was
// the contour of that ribbon, which meant the hollow channel inside it was
// wider than the line itself — the mark turned to mush below about 32px and
// vanished on any dark background. Solid keeps the same silhouette at the
// same visual weight and fixes both.
//
// The left stem carries the brand colour; the diagonal carries the ember
// accent. `variant="dark"` swaps the stem for cream so the mark can sit on
// the near-black hero surfaces.
// ---------------------------------------------------------------------------

import { cn } from "@/lib/utils";

export const BRAND_MARK_COLORS = {
  /** On light surfaces: brand terracotta stem, deep ember diagonal. */
  light: { stem: "#a45120", diagonal: "#d9631a" },
  /** On dark surfaces: cream stem, bright ember diagonal. */
  dark: { stem: "#fdfaf3", diagonal: "#ff9845" },
} as const;

export type BrandMarkVariant = keyof typeof BRAND_MARK_COLORS;

/** The two halves of the ribbon, kept separate so each can carry its own
    colour. They meet exactly at (46, 26), so the join is seamless. */
const STEM_PATH = "M26 102 V46 C26 28 34 22 46 26";
const DIAGONAL_PATH = "M46 26 L82 98 C90 112 102 102 102 86 V26";

export function BrandMark({
  variant = "light",
  weight = 14,
  className,
}: {
  variant?: BrandMarkVariant;
  weight?: 12 | 14 | 16;
  className?: string;
}) {
  const { stem, diagonal } = BRAND_MARK_COLORS[variant];

  return (
    <svg
      viewBox="0 0 128 128"
      className={cn("h-full w-full", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={STEM_PATH}
        fill="none"
        stroke={stem}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={DIAGONAL_PATH}
        fill="none"
        stroke={diagonal}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}