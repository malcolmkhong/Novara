/**
 * Chapter quality pipeline shared by the Novel Creator studio endpoints and
 * the AI-team task pipeline (Track E: write → review → sediment → final).
 *
 * The E2 gate is absolute: a chapter may only reach `final` when a structured
 * review scored it ≥ REVIEW_GATE_SCORE with ZERO blocking issues. Everything
 * the pipeline reports is measured from the database (E3) — never from model
 * claims.
 */
import { db } from "@/lib/db";

import { emitNovelChange } from "./events";
import { glmJson } from "./glm";
import {
  buildReviewMessages,
  buildSedimentMessages,
  parseReviewResponse,
  parseSedimentResponse,
  type ReviewBrief,
} from "./prompts";
import {
  foreshadowToRef,
  loadNovelDetail,
  parseReviewColumn,
} from "./server";
import type { ChapterReview, SedimentResult } from "./types";

/** E2 gate threshold: reviews below this score block finalization. */
export const REVIEW_GATE_SCORE = 70;
/** Bounded self-repair: at most this many revision rounds per chapter. */
export const MAX_REVISION_ROUNDS = 2;

/** E2 gate: score ≥ threshold AND no blocking issues. */
export function reviewPasses(review: ChapterReview | null): boolean {
  if (!review) return false;
  return (
    review.overallScore >= REVIEW_GATE_SCORE && review.blocking.length === 0
  );
}

/** Exact-then-fuzzy title match against the given foreshadow rows. */
function matchForeshadow(
  rows: { id: string; title: string }[],
  ref: string,
): { id: string; title: string } | null {
  const exact = rows.find((f) => f.title === ref);
  if (exact) return exact;
  const lower = ref.toLowerCase();
  const fuzzy = rows.find(
    (f) =>
      f.title.toLowerCase().includes(lower) ||
      lower.includes(f.title.toLowerCase()),
  );
  return fuzzy ?? null;
}

/**
 * Build the review brief from database state (bible pack, chapter outline,
 * previous summary, open foreshadows). Returns null when the novel/chapter
 * is missing or the chapter has no prose yet.
 */
async function buildReviewBrief(
  novelId: string,
  chapterNumber: number,
): Promise<{ chapterId: string; brief: ReviewBrief } | null> {
  const detail = await loadNovelDetail(novelId);
  if (!detail) return null;
  const chapter = detail.chapters.find((ch) => ch.number === chapterNumber);
  if (!chapter || !chapter.content) return null;
  const prev = detail.chapters
    .filter((ch) => ch.number < chapterNumber && ch.summary)
    .sort((a, b) => b.number - a.number)[0];

  const brief: ReviewBrief = {
    pack: {
      title: detail.title,
      genre: detail.genre,
      logline: detail.logline,
      coreConflict: detail.coreConflict,
      platform: detail.platform,
      bible: detail.bible,
      characters: detail.characters,
      villain: detail.villain,
    },
    chapter: {
      number: chapter.number,
      title: chapter.title,
      goal: chapter.goal,
      mustCover: chapter.mustCover,
      endHook: chapter.endHook,
    },
    prevSummary: prev?.summary ?? null,
    openForeshadows: detail.foreshadows
      .filter((f) => f.status !== "paid")
      .slice(0, 8)
      .map(foreshadowToRef),
    content: chapter.content,
  };
  return { chapterId: chapter.id, brief };
}

/**
 * Structured review, persisted on the chapter row.
 *
 * `force: false` (the AI-team pipeline) reuses an existing review when one
 * is present; `force: true` (the studio review button) always re-reviews.
 * Returns null when the chapter has no prose or GLM could not produce a
 * usable review — callers must treat "no review" as "cannot finalize".
 */
export async function ensureChapterReview(
  novelId: string,
  chapterNumber: number,
  options?: { force?: boolean },
): Promise<{ review: ChapterReview; chapterId: string } | null> {
  const ctx = await buildReviewBrief(novelId, chapterNumber);
  if (!ctx) return null;

  if (!options?.force) {
    const existing = await db.novelChapter.findUnique({
      where: { id: ctx.chapterId },
      select: { review: true },
    });
    const parsed = parseReviewColumn(existing?.review ?? null);
    if (parsed) return { review: parsed, chapterId: ctx.chapterId };
  }

  const review = await glmJson(buildReviewMessages(ctx.brief), {
    label: "chapter-review",
    parse: parseReviewResponse,
    // P5 — review spend lands on the novel in the ledger.
    ledger: { novelId },
  });
  if (review === null) return null;
  await db.novelChapter.update({
    where: { id: ctx.chapterId },
    data: { review: JSON.stringify(review) },
  });
  emitNovelChange("chapter", novelId, "pipeline-review");
  return { review, chapterId: ctx.chapterId };
}

/**
 * Persist a sediment result: chapter memory (summary/facts/charStates) +
 * foreshadow ledger actions (plant/advance/pay) + status=final.
 * Called ONLY after the E2 gate passes — this is the single place a
 * chapter becomes final.
 */
export async function applySedimentResult(
  novelId: string,
  chapterId: string,
  chapterNumber: number,
  result: SedimentResult,
): Promise<string[]> {
  await db.novelChapter.update({
    where: { id: chapterId },
    data: {
      summary: result.summary,
      facts: JSON.stringify(result.facts),
      charStates: JSON.stringify(result.charStates),
      status: "final",
    },
  });

  const ledgerNotes: string[] = [];
  for (const action of result.foreshadows) {
    if (action.action === "plant") {
      const existing = await db.foreshadow.findFirst({
        where: { novelId, title: action.ref },
      });
      if (existing) {
        // Duplicate plant — treat as an advance on the existing entry.
        await db.foreshadow.update({
          where: { id: existing.id },
          data: {
            lastTouched: chapterNumber,
            status: existing.status === "open" ? "advanced" : existing.status,
            description: action.note || existing.description,
          },
        });
        ledgerNotes.push(`推进既有伏笔《${action.ref}》`);
      } else {
        await db.foreshadow.create({
          data: {
            novelId,
            title: action.ref,
            description: action.note || "（见正文）",
            plantedAt: chapterNumber,
            status: "open",
          },
        });
        ledgerNotes.push(`埋设伏笔《${action.ref}》`);
      }
    } else {
      const current = await db.foreshadow.findMany({
        where: { novelId, status: { not: "paid" } },
      });
      const target = matchForeshadow(current, action.ref);
      if (!target) {
        ledgerNotes.push(
          `未找到可${action.action === "pay" ? "回收" : "推进"}的伏笔《${action.ref}》`,
        );
        continue;
      }
      await db.foreshadow.update({
        where: { id: target.id },
        data:
          action.action === "pay"
            ? { status: "paid", paidAt: chapterNumber, lastTouched: chapterNumber }
            : { status: "advanced", lastTouched: chapterNumber },
      });
      ledgerNotes.push(
        action.action === "pay"
          ? `回收伏笔《${target.title}》`
          : `推进伏笔《${target.title}》`,
      );
    }
  }

  emitNovelChange("chapter", novelId, "pipeline-sediment");
  return ledgerNotes;
}

/**
 * Sediment a chapter into memory and finalize it (status=final).
 * The E2 gate must already have passed — callers' responsibility.
 * Returns null when the chapter has no prose or GLM failed; the chapter
 * stays untouched (drafted) in that case.
 */
export async function sedimentChapter(
  novelId: string,
  chapterNumber: number,
): Promise<{ ledgerNotes: string[]; wordCount: number } | null> {
  const detail = await loadNovelDetail(novelId);
  const chapter = detail?.chapters.find((ch) => ch.number === chapterNumber);
  if (!detail || !chapter?.content) return null;

  const openRows = await db.foreshadow.findMany({
    where: { novelId, status: { not: "paid" } },
    orderBy: { plantedAt: "asc" },
  });

  const result = await glmJson<SedimentResult>(
    buildSedimentMessages(
      chapterNumber,
      chapter.content,
      openRows.map(foreshadowToRef),
    ),
    { label: "chapter-sediment", parse: parseSedimentResponse },
  );
  if (result === null) return null;

  const ledgerNotes = await applySedimentResult(
    novelId,
    chapter.id,
    chapterNumber,
    result,
  );
  return { ledgerNotes, wordCount: chapter.wordCount };
}
