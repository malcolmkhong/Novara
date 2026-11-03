// ---------------------------------------------------------------------------
// Novara AI — chapter version history (Phase 7).
//
// Every committed content change records a ChapterVersion row snapshotting
// the INCOMING text, so the version list is the full history of committed
// states (webnovel-writer 稿1~稿N analog) and Chapter.content stays the
// newest working copy. Callers: author PATCH, agent create/update commit,
// approval commit, import restore.
//
// Single-writer rule: only this helper writes ChapterVersion.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { countWords } from "@/lib/novara/words";

/** Bound history growth — keep the newest N versions per chapter. */
export const MAX_VERSIONS_PER_CHAPTER = 30;

export type VersionAuthor = "author" | "agent" | "restore";

/**
 * Records one version row for the given content state. Best-effort by
 * design: a failed version record must never fail the content commit that
 * produced it, so callers may fire-and-forget — but the helper itself only
 * swallows errors when `bestEffort` is set (default true for agent paths).
 */
export async function recordChapterVersion(opts: {
  chapterId: string;
  novelId: string;
  content: string;
  createdBy: VersionAuthor;
  bestEffort?: boolean;
}): Promise<void> {
  const { chapterId, novelId, content, createdBy, bestEffort = true } = opts;
  try {
    await db.$transaction(async (tx) => {
      const last = await tx.chapterVersion.findFirst({
        where: { chapterId },
        orderBy: { draftNo: "desc" },
        select: { draftNo: true },
      });
      const draftNo = (last?.draftNo ?? 0) + 1;
      await tx.chapterVersion.create({
        data: { chapterId, novelId, draftNo, content, wordCount: countWords(content), createdBy },
      });
      // Prune history beyond the cap (delete oldest first).
      const stale = await tx.chapterVersion.findMany({
        where: { chapterId, draftNo: { lte: draftNo - MAX_VERSIONS_PER_CHAPTER } },
        select: { id: true },
      });
      if (stale.length > 0) {
        await tx.chapterVersion.deleteMany({ where: { id: { in: stale.map((v) => v.id) } } });
      }
    });
  } catch (error) {
    if (!bestEffort) throw error;
    // History is a safety net, not a hard dependency — log-and-continue.
    console.error("[versions] failed to record chapter version:", error);
  }
}
