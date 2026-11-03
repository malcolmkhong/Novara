// ---------------------------------------------------------------------------
// Novara AI — one-time migration backfill (Phase 7 / P1 closeout).
//
// DSH 大纲 carries 卷规划 (volume plans); Novara beats were flat before
// Volumes landed. For every novel that has outline beats but no volumes,
// this script creates "Volume 1" and assigns ALL its beats to it — the
// pre-migration outline reads as the book's first arc, which is what it was.
// Idempotent: re-running is a no-op (novels with ≥1 volume are skipped).
//
// Usage: bun scripts/backfill-volumes.ts
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const novels = await db.novel.findMany({
    select: {
      id: true,
      title: true,
      _count: { select: { outlineBeats: true, volumes: true } },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const novel of novels) {
    if (novel._count.volumes > 0 || novel._count.outlineBeats === 0) {
      skipped++;
      continue;
    }

    const volume = await db.volume.create({
      data: {
        novelId: novel.id,
        index: 1,
        title: "Volume 1",
        synopsis: "",
      },
    });
    const r = await db.outlineBeat.updateMany({
      where: { novelId: novel.id },
      data: { volumeId: volume.id },
    });
    created++;
    console.log(
      `  Volume 1 created — "${novel.title}" (${r.count} beat(s) assigned)`
    );
  }

  console.log(
    `\nBackfill complete: ${created} volume(s) created, ${skipped} novel(s) skipped (already has volumes or no beats).`
  );
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
