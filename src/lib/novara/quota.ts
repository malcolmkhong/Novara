// ---------------------------------------------------------------------------
// Novara AI — chapter word-quota math, shared by the draft route and the
// agent runtime (single implementation; numbers from budgets.yaml).
//
// Algorithm (established in Phase 2, behavior-preserving):
//   remaining = targetWords − totalWords
//   chapter quota = remaining ÷ beatsAhead        (beats from this chapter on)
//                 else avgChapterWords            (only if ≥ signal threshold)
//                 else fallback range midpoint
//   clamped to [quotaMinWords, quotaMaxWords]
//   append mode: passQuota = max(appendFloor, quota − alreadyInChapter)
// ---------------------------------------------------------------------------

import { getBudgets } from "./content";

export interface QuotaInput {
  targetWords: number;
  totalWords: number;
  beatsAhead: number;
  chapterCount: number;
  /** Append mode: words already present in the chapter being extended. */
  existingChapterWords?: number;
  append?: boolean;
}

export interface QuotaResult {
  chapterQuota: number;
  passQuota: number;
  remainingWords: number;
  /** Which signal produced the quota — surfaced to the model and reports. */
  basis: "beats_ahead" | "avg_chapter" | "fallback";
}

export function computeChapterQuota(input: QuotaInput): QuotaResult {
  const { quotaMinWords, quotaMaxWords, avgChapterWordsSignal, fallbackChapterWords, appendFloorWords } =
    getBudgets().draft;

  const remainingWords = Math.max(0, input.targetWords - input.totalWords);
  const avgChapterWords =
    input.chapterCount > 0 ? Math.floor(input.totalWords / input.chapterCount) : 0;

  let chapterQuota: number;
  let basis: QuotaResult["basis"];

  if (input.beatsAhead > 0 && remainingWords > 0) {
    chapterQuota = Math.floor(remainingWords / input.beatsAhead);
    basis = "beats_ahead";
  } else if (avgChapterWords >= avgChapterWordsSignal) {
    chapterQuota = avgChapterWords;
    basis = "avg_chapter";
  } else {
    chapterQuota = Math.floor(
      (fallbackChapterWords[0] + fallbackChapterWords[1]) / 2
    );
    basis = "fallback";
  }

  chapterQuota = Math.min(quotaMaxWords, Math.max(quotaMinWords, chapterQuota));

  const passQuota = input.append
    ? Math.max(appendFloorWords, chapterQuota - (input.existingChapterWords ?? 0))
    : chapterQuota;

  return { chapterQuota, passQuota, remainingWords, basis };
}

/** Human-readable LENGTH PLAN block for prompts (bilingual-neutral layout). */
export function quotaPromptBlock(result: QuotaResult, novelTitle: string): string {
  const lines = [
    `LENGTH PLAN for ${novelTitle}:`,
    `- Book target words: ${result.remainingWords === 0 ? "already reached" : `remaining ≈ ${result.remainingWords}`}`,
    `- This chapter's quota: ~${result.passQuota} words (basis: ${result.basis})`,
    `- Stay within ±20% of the quota; do not pad.`,
  ];
  return lines.join("\n");
}
