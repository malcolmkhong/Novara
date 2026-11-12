// ---------------------------------------------------------------------------
// Novara AI — sediment windows (STEP 71).
//
// THE EXTRACTOR MUST READ THE WHOLE CHAPTER.
//
// Before STEP 71 the sediment prompt carried `chapter.content.slice(0,
// chapterContextChars)` — one call, one hard cut. Everything past the cut was
// never seen by the model, so its story elements were never recorded: silent,
// permanent memory loss.
//
// This module provides the two halves of the fix:
//
//   buildSedimentWindows — cut the chapter into OVERLAPPING windows whose
//     boundaries land on SENTENCE boundaries (no sentence is ever cut in
//     half) and whose overlap re-reads the sentence around each cut.
//
//   mergeSedimentRecords — merge the per-window records with the SAME dedupe
//     rules the projection already uses, so the merged set is exactly what a
//     single whole-chapter call would have produced (plus what it missed).
//
// The merge happens BEFORE the transaction; the projection still runs once.
// A window that fails fails the whole extraction — never half a projection.
// ---------------------------------------------------------------------------

import type { SedimentRecords } from "@/lib/novara/sediment";

export interface SedimentWindow {
  index: number;
  /** Part number, 1-based. */
  part: number;
  totalParts: number;
  start: number;
  end: number;
  text: string;
}

// Sentence enders for Chinese and English prose. A Chinese full stop /
// question mark / exclamation mark, an ASCII . ! ? ; and a line break.
const SENTENCE_END = /[。！？；…!;?\n]/;

/**
 * The cut point nearest to `index`, snapped to a sentence boundary.
 *
 * Direction: forward first (so no text is lost), then backward (so the
 * window stays useful), then the raw index (a chapter with no sentence
 * punctuation at all — degenerate, but it must not break).
 */
function snapToSentence(text: string, index: number, searchRadius: number): number {
  const len = text.length;
  const from = Math.max(1, Math.min(len, index));
  for (let i = from; i < Math.min(len, from + searchRadius); i++) {
    if (SENTENCE_END.test(text[i])) {
      // Cut AFTER the punctuation (and any closing quote that follows).
      let end = i + 1;
      while (end < len && /["'」』”）)]/.test(text[end])) end += 1;
      return end;
    }
  }
  for (let i = from - 1; i > Math.max(0, from - searchRadius); i--) {
    if (SENTENCE_END.test(text[i])) {
      let end = i + 1;
      while (end < len && /["'」』”）)]/.test(text[end])) end += 1;
      return end;
    }
  }
  // English full stop followed by whitespace.
  for (let i = from; i < Math.min(len, from + searchRadius); i++) {
    if (text[i] === "." && (i + 1 >= len || /\s/.test(text[i + 1]))) return i + 1;
  }
  for (let i = from - 1; i > Math.max(0, from - searchRadius); i--) {
    if (text[i] === "." && (i + 1 >= len || /\s/.test(text[i + 1]))) return i + 1;
  }
  return from;
}

/**
 * The start of the sentence that contains `index` — i.e. the position right
 * after the previous sentence end. A window that starts here never begins
 * mid-sentence.
 */
function snapBackToSentenceStart(text: string, index: number, searchRadius: number): number {
  if (index <= 0) return 0;
  const from = Math.min(text.length, index);
  for (let i = from - 1; i > Math.max(0, from - searchRadius); i--) {
    if (SENTENCE_END.test(text[i]) || (text[i] === "." && (i + 1 >= text.length || /\s/.test(text[i + 1])))) {
      let end = i + 1;
      while (end < text.length && /["'」』”）)]/.test(text[end])) end += 1;
      return end;
    }
  }
  return index;
}

/**
 * Split the chapter into overlapping, sentence-aligned windows.
 *
 * · A chapter that fits in ONE window returns exactly one window covering the
 *   whole text — the pre-STEP-71 behaviour, byte for byte.
 * · Otherwise the interior cut points are snapped to sentence boundaries and
 *   every window after the first starts `overlapChars` BEFORE the previous
 *   cut (snapped back to a sentence start), so the sentence around the cut is
 *   read by both windows.
 * · No window ever starts or ends mid-sentence, and no window leaves a gap.
 */
export function buildSedimentWindows(
  content: string,
  windowChars: number,
  overlapChars: number
): SedimentWindow[] {
  const len = content.length;
  if (len <= windowChars) {
    return [{ index: 0, part: 1, totalParts: 1, start: 0, end: len, text: content }];
  }

  // n windows so that every window (overlap included) stays within windowChars.
  const stepSize = Math.max(1, windowChars - overlapChars);
  const totalParts = Math.max(2, Math.ceil(len / stepSize));

  // Nominal cut points, then snapped to sentence boundaries.
  const cuts: number[] = [0];
  for (let i = 1; i < totalParts; i++) {
    const nominal = Math.round((i * len) / totalParts);
    const snapped = snapToSentence(content, nominal, Math.floor(windowChars / 2));
    // Keep the cuts strictly increasing and inside the text.
    const previous = cuts[cuts.length - 1];
    const next = Math.min(len - 1, Math.max(previous + 1, snapped));
    cuts.push(next);
  }
  cuts.push(len);

  const windows: SedimentWindow[] = [];
  for (let i = 0; i < totalParts; i++) {
    const rawStart = i === 0 ? 0 : Math.max(0, cuts[i] - overlapChars);
    const start = i === 0 ? 0 : snapBackToSentenceStart(content, rawStart, overlapChars);
    const end = i === totalParts - 1 ? len : cuts[i + 1];
    windows.push({
      index: i,
      part: i + 1,
      totalParts,
      start,
      end,
      text: content.slice(start, end),
    });
  }
  return windows;
}

/**
 * Merge the per-window records with the SAME dedupe rules the projection uses:
 *
 * · digest   — one row per chapter (upsert by chapterId): the window
 *   summaries in order, clipped to the same cap a single call applies.
 * · facts    — dedupe on (category, content); the first occurrence wins.
 * · states   — one row per character per chapter (replace per chapterIndex):
 *   the LAST window that saw the character wins (that is the chapter-end
 *   state, which is what the projection stores).
 * · plants   — dedupe on content; the first occurrence wins.
 * · ledger   — dedupe on id (the same ids are advanced/paid twice when two
 *   windows share the overlap).
 * · loops    — dedupe on id (PAID_LOOP ids).
 */
export function mergeSedimentRecords(windows: SedimentRecords[]): SedimentRecords {
  if (windows.length === 0) {
    throw new Error("mergeSedimentRecords: no windows to merge");
  }
  if (windows.length === 1) return windows[0];

  const first = windows[0];
  const summary = windows
    .map((w) => w.summary.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 6000);

  const facts: SedimentRecords["facts"] = [];
  const seenFacts = new Set<string>();
  for (const w of windows) {
    for (const fact of w.facts) {
      const key = `${fact.category}\u0000${fact.content}`;
      if (seenFacts.has(key)) continue;
      seenFacts.add(key);
      facts.push(fact);
    }
  }

  // States: one per character — the LAST window that saw them wins (that is
  // the chapter-end state, which is what the projection stores).
  const stateByName = new Map<string, SedimentRecords["characterStates"][number]>();
  for (const w of windows) {
    for (const state of w.characterStates) {
      stateByName.set(state.name, state);
    }
  }
  const characterStates = [...stateByName.values()];

  const plants: SedimentRecords["plants"] = [];
  const seenPlants = new Set<string>();
  for (const w of windows) {
    for (const plant of w.plants) {
      if (seenPlants.has(plant.content)) continue;
      seenPlants.add(plant.content);
      plants.push(plant);
    }
  }

  const validAdvance = dedupeIds(windows.flatMap((w) => w.validAdvance));
  const validPaid = dedupeIds(windows.flatMap((w) => w.validPaid));

  const paidPromises: SedimentRecords["paidPromises"] = [];
  const seenLoops = new Set<string>();
  for (const w of windows) {
    for (const paid of w.paidPromises) {
      if (seenLoops.has(paid.id)) continue;
      seenLoops.add(paid.id);
      paidPromises.push(paid);
    }
  }

  return {
    chapterId: first.chapterId,
    novelId: first.novelId,
    chapterIndex: first.chapterIndex,
    summary,
    facts: facts.slice(0, 24),
    characterStates: characterStates.slice(0, 24),
    plants: plants.slice(0, 12),
    validAdvance: validAdvance.slice(0, 12),
    validPaid: validPaid.slice(0, 12),
    paidPromises: paidPromises.slice(0, 12),
  };
}

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
