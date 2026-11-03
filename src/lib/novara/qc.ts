// ---------------------------------------------------------------------------
// Novara AI — QC gate decisions (Phase 6, plan §Phase6 "E2 门定稿").
//
// PURE functions — zero I/O, zero AI. The runtime's finalize/settle/repair
// tools adjudicate through these, and the behavioral eval probes (qc-evals)
// exercise the exact same code, so "what the eval verifies" is literally
// "what the gate runs".
//
// Gate family (E2):
//   - evaluateFinalize  — blocking=0 AND non-empty prose required for final
//   - evaluateSettle    — a passing review is required before sedimentation
//   - evaluateRepair    — the per-chapter revision budget (≤2 cycles)
//   - auditReport       — claimed (model) vs verified (measured) reconciliation
// ---------------------------------------------------------------------------

export interface GateVerdict {
  allowed: boolean;
  /** Stable machine-readable reason code for feeds and evals. */
  code:
    | "ok"
    | "no_review"
    | "blocking_open"
    | "empty_chapter"
    | "budget_exhausted";
  /** Human-facing sentence the runtime can feed back verbatim. */
  reason: string;
}

/** The E2 finalize gate: a chapter may become `final` only on a clean review. */
export function evaluateFinalize(params: {
  /** blockingCount of the LATEST ChapterReview row (null = never reviewed). */
  latestBlockingCount: number | null;
  wordCount: number;
}): GateVerdict {
  if (params.latestBlockingCount === null) {
    return {
      allowed: false,
      code: "no_review",
      reason:
        "E2 GATE: no review exists for this chapter — run review_chapter before finalize.",
    };
  }
  if (params.latestBlockingCount > 0) {
    return {
      allowed: false,
      code: "blocking_open",
      reason: `E2 GATE: latest review still has ${params.latestBlockingCount} blocking issue(s) — repair and re-review before finalize.`,
    };
  }
  if (params.wordCount <= 0) {
    return {
      allowed: false,
      code: "empty_chapter",
      reason: "E2 GATE: the chapter has no content — nothing to finalize.",
    };
  }
  return { allowed: true, code: "ok", reason: "clean review, chapter may be final" };
}

/** The settle gate: memory sedimentation requires a passing review too. */
export function evaluateSettle(params: {
  latestBlockingCount: number | null;
  wordCount: number;
}): GateVerdict {
  if (params.latestBlockingCount === null) {
    return {
      allowed: false,
      code: "no_review",
      reason:
        "E2 GATE: no review exists for this chapter — run review_chapter before settle.",
    };
  }
  if (params.latestBlockingCount > 0) {
    return {
      allowed: false,
      code: "blocking_open",
      reason: `E2 GATE: latest review has ${params.latestBlockingCount} blocking issue(s) — settle requires blocking = 0.`,
    };
  }
  if (params.wordCount <= 0) {
    return {
      allowed: false,
      code: "empty_chapter",
      reason: "E2 GATE: the chapter has no content — nothing to settle.",
    };
  }
  return { allowed: true, code: "ok", reason: "clean review, chapter may be settled" };
}

/**
 * The revision budget gate: a repair write (update_chapter) on a chapter
 * whose latest review found blocking issues consumes one revision cycle.
 * Once the budget is spent the runtime refuses further repairs — the issues
 * escalate to the author instead of looping forever.
 */
export function evaluateRepair(params: {
  /** blockingCount of the LATEST ChapterReview row (null = not blocked). */
  latestBlockingCount: number | null;
  /** Revision cycles already used for this chapter in this run. */
  repairRoundsUsed: number;
  maxRevisionRounds: number;
}): GateVerdict {
  if (params.latestBlockingCount === null || params.latestBlockingCount <= 0) {
    // Not a repair — an ordinary (gated) rewrite. The overwrite gate still
    // applies upstream; the revision budget does not.
    return { allowed: true, code: "ok", reason: "no blocking findings against this chapter" };
  }
  if (params.repairRoundsUsed >= params.maxRevisionRounds) {
    return {
      allowed: false,
      code: "budget_exhausted",
      reason: `E2 REVISION BUDGET exhausted (${params.repairRoundsUsed}/${params.maxRevisionRounds} repair rounds after blocking findings) — report the remaining issues to the author instead of repairing again.`,
    };
  }
  return {
    allowed: true,
    code: "ok",
    reason: `repair round ${params.repairRoundsUsed + 1}/${params.maxRevisionRounds} allowed`,
  };
}

/**
 * Run-report digital audit (extracted from the leader loop so evals verify
 * the exact reconciliation the runtime performs). Returns one human-readable
 * issue string per mismatched key — an empty array means every claimed number
 * matched the DB-verified measurement.
 */
export function auditReport(
  claimed: Record<string, number>,
  verified: Record<string, number>
): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(claimed)) {
    const measured = verified[key];
    if (measured === undefined) {
      issues.push(`claimed unknown key "${key}=${value}" — not an audited counter`);
      continue;
    }
    if (value !== measured) {
      issues.push(`claimed ${key}=${value} but measured ${key}=${measured}`);
    }
  }
  return issues;
}
