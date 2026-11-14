// ---------------------------------------------------------------------------
// Novara — the usage-ledger row, shared by the usage panels.
//
// The ledger tables ("By surface", "By model", "By novel") were written out
// three times in `usage-panel.tsx` and once in `context-usage-panel.tsx`.
// Each copy spelled out the same four-part row: a truncated label, a muted
// call count, a right-aligned token figure, and — on the model table — a
// price column. Every copy was a chance to drift, and they had drifted:
// the token column was `w-14` in one panel and `w-12` in the other.
//
// This module holds the row once. It has no "use client" directive on
// purpose: `usage-panel.tsx` is a server component, so a client-only
// module (such as `ui-bits.tsx`) could not host it.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";

/** The width of the right-aligned token column. */
export type UsageTokenWidth = "w-12" | "w-14";

export interface UsageRowProps {
  /** The row label — a surface, a model, a novel. */
  label: ReactNode;
  /** How many calls the row accounts for. */
  calls: number;
  /** The token figure, already formatted. */
  tokens: ReactNode;
  /** The width of the token column. */
  tokenWidth?: UsageTokenWidth;
  /** Extra content rendered after the call count, inside the count cell. */
  callsSuffix?: ReactNode;
  /** An extra trailing cell, after the token column. */
  trailing?: ReactNode;
}

/**
 * One row of a ledger table: label, call count, token figure.
 */
export function UsageRow({
  label,
  calls,
  tokens,
  tokenWidth = "w-14",
  callsSuffix,
  trailing,
}: UsageRowProps) {
  return (
    <li className="flex items-center gap-2 text-caption">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {label}
      </span>
      <span className="shrink-0 font-mono text-tiny text-muted-foreground/70">
        ×{calls}
        {callsSuffix}
      </span>
      <span className={`${tokenWidth} text-right font-mono`}>{tokens}</span>
      {trailing}
    </li>
  );
}
