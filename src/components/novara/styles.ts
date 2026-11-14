// ---------------------------------------------------------------------------
// Novara — shared type roles.
//
// The type scale is a design decision, but it was written out by hand at
// every call site: the same "small muted metadata line" appeared as
// `text-xs text-muted-foreground` in 15 files and 36 places, the same
// "muted body paragraph" as `text-sm leading-relaxed text-muted-foreground`
// in 7 files, and so on. Every copy was a chance to drift, and the drift
// was visible — some call sites used `text-caption`, others `text-[11px]`
// for the same role.
//
// These constants are the single place where each role is defined. They
// hold the exact Tailwind utilities that were there before, so swapping a
// literal for its constant changes no rendered output — only the number of
// places the decision is written down.
//
// Two families live here:
//   - type roles  — how a piece of text is sized and coloured;
//   - layout roles — how a row of a panel is arranged.
//
// This module is deliberately class strings only: no JSX, no state, no
// imports. It can be used from a server or a client component.
// ---------------------------------------------------------------------------

/**
 * Small muted metadata — timestamps, counts, secondary facts.
 */
export const TEXT_META = "text-xs text-muted-foreground";

/**
 * Muted body copy in a relaxed measure — the paragraph under a heading.
 */
export const TEXT_PROSE = "text-sm leading-relaxed text-muted-foreground";

/**
 * Caption text at the caption size of the scale.
 */
export const TEXT_CAPTION = "text-caption text-muted-foreground";

/**
 * Micro text — table headers, axis labels, the smallest readable size.
 */
export const TEXT_MICRO = "text-tiny text-muted-foreground";

/**
 * An emphasised label at body size — the title of a row or a panel.
 */
export const TEXT_LABEL = "text-sm font-medium";

/**
 * A display heading at the section size of the scale.
 */
export const TEXT_HEADING = "font-display text-xl font-bold";

/**
 * A panel title — the name of a section inside a settings or usage panel.
 */
export const TEXT_PANEL_TITLE = "text-xs font-semibold";

/**
 * A section sub-head — a small uppercase label above a group of rows.
 */
export const TEXT_SECTION = "text-tiny font-medium uppercase tracking-wide text-muted-foreground";

/**
 * A lead line — the strongest text in a card or a tile: a card title, or
 * the figure a stat tile is about.
 */
export const TEXT_LEAD = "text-lg font-semibold";

/**
 * A value cell — the answer on the right of a label/value pair.
 */
export const TEXT_VALUE = "font-medium text-foreground";

/**
 * A quiet note under a panel row — a caveat or a plain-language line.
 */
export const TEXT_NOTE = "mt-1 text-tiny leading-4 text-muted-foreground";

/**
 * A tile that holds one figure and its label.
 */
export const CELL_TILE = "rounded-md border p-3";

/**
 * A labelled row at the head of a panel — the title on the left, the
 * qualifier on the right, aligned on their baselines.
 */
export const ROW_HEAD = "flex items-baseline justify-between gap-2";
