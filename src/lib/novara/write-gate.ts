// ---------------------------------------------------------------------------
// Novara AI — anti-overwrite gate (code-enforced, plan §2.5 / §5.3).
//
// ONE implementation shared by:
//   - PATCH /api/chapters/[id]  (HTTP path, human editor + API clients)
//   - the agent runtime write path (Phase 3 — agents get the same rule)
//
// Rule: replacing NON-EMPTY chapter content requires the client's explicit
// `overwrite: true`. Empty → non-empty is always allowed (fresh drafts).
// The caller decides the response shape (409 + requiresOverwrite for HTTP,
// an approval gate for the agent loop) — this module only adjudicates.
// ---------------------------------------------------------------------------

import { countWords } from "./words";

export interface OverwriteVerdict {
  /** True when the write must be confirmed before it may proceed. */
  blocked: boolean;
  existingWords: number;
  incomingWords: number;
}

export function assessOverwrite(params: {
  existingContent: string;
  incomingContent: string;
  overwrite?: boolean;
}): OverwriteVerdict {
  const existingWords = countWords(params.existingContent);
  const incomingWords = countWords(params.incomingContent);
  const hasText = params.existingContent.trim().length > 0;
  const blocked = hasText && params.overwrite !== true;
  return { blocked, existingWords, incomingWords };
}
