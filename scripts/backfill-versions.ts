// ---------------------------------------------------------------------------
// Novara AI — one-time migration backfill (Phase 7 / P0 closeout).
//
// Chapters that existed before ChapterVersion history landed have no baseline
// snapshot. Without one, the first post-migration edit would be recorded as
// 稿1 and the pre-migration original text would be silently lost from
// history. This script records the CURRENT state as the baseline row
// (createdBy="restore") for every chapter that has content but zero version
// rows — idempotent: re-running is a no-op.
//
// Usage: bun scripts/backfill-versions.ts
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";
import { countWords } from "../src/lib/novara/words";

const db = new PrismaClient();

async function main() {
  const chapters = await db.chapter.findMany({
    orderBy: [{ novelId: "asc" }, { index: "asc" }],
    select: { id: true, novelId: true, title: true, index: true, content: true },
  });

  let created = 0;
  let skipped = 0;

  for (const ch of chapters) {
    const existing = await db.chapterVersion.count({ where: { chapterId: ch.id } });
    if (existing > 0 || !ch.content.trim()) {
      skipped++;
      continue;
    }

    await db.chapterVersion.create({
      data: {
        chapterId: ch.id,
        novelId: ch.novelId,
        draftNo: 1,
        content: ch.content,
        wordCount: countWords(ch.content),
        createdBy: "restore",
      },
    });
    created++;
    console.log(`  baseline 稿1 recorded — ch.${ch.index} ${ch.title} (${countWords(ch.content)} words)`);
  }

  console.log(
    `\nBackfill complete: ${created} baseline row(s) created, ${skipped} chapter(s) skipped (already has history or empty).`
  );
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
