import { db } from "@/lib/db";
import { backupFileSchema } from "@/lib/novara/backup-schema";
import { jsonError, parseBody } from "@/lib/novara/api-helpers";
import { countWords } from "@/lib/novara/words";
import { toSummary } from "@/lib/novara/summary";
import type { ImportReport } from "@/lib/novara/types";

export const dynamic = "force-dynamic";

// POST /api/import — validate a backup file and import it as a NEW novel.
// All ids are regenerated server-side; incoming ids are never trusted.
// The response contains an integrity report comparing the imported data
// against the counts declared in the backup file.
export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = backupFileSchema.safeParse(parsed.data);
  if (!schema.success) {
    const issue = schema.error.issues[0];
    const where = issue?.path?.length ? issue.path.join(".") : "file";
    return jsonError(
      issue
        ? `Invalid backup file — ${where}: ${issue.message}`
        : "Invalid backup file",
      400
    );
  }

  const d = schema.data.data;
  const warnings: string[] = [];

  const novel = await db.novel.create({
    data: {
      title: d.novel.title,
      genre: d.novel.genre,
      synopsis: d.novel.synopsis,
      targetWords: d.novel.targetWords,
      status: d.novel.status,
    },
  });

  await db.$transaction([
    db.chapter.createMany({
      data: d.chapters.map((c, i) => ({
        novelId: novel.id,
        index: i + 1,
        title: c.title,
        content: c.content,
        wordCount: countWords(c.content),
        status: c.status,
        brief: c.brief ?? "",
      })),
    }),
    db.character.createMany({
      data: d.characters.map((c) => ({
        novelId: novel.id,
        name: c.name,
        role: c.role,
        description: c.description,
      })),
    }),
    db.worldEntry.createMany({
      data: d.worldEntries.map((w) => ({
        novelId: novel.id,
        title: w.title,
        category: w.category,
        content: w.content,
      })),
    }),
    db.outlineBeat.createMany({
      data: d.outlineBeats.map((b, i) => ({
        novelId: novel.id,
        index: i + 1,
        title: b.title,
        summary: b.summary,
      })),
    }),
  ]);

  // ---- v2 memory layer — the sediment truth travels with the backup ----
  let memoryRestored = { facts: 0, states: 0, foreshadows: 0, digests: 0, versions: 0 };
  if (d.memory) {
    const createdChapters = await db.chapter.findMany({
      where: { novelId: novel.id },
      select: { id: true, index: true },
    });
    const chapterIdByIndex = new Map(createdChapters.map((c) => [c.index, c.id]));

    if (d.memory.storyFacts.length > 0) {
      const r = await db.storyFact.createMany({
        data: d.memory.storyFacts.map((f) => ({
          novelId: novel.id,
          category: f.category,
          content: f.content,
          sourceChapter: f.sourceChapter,
          lastSeenChapter: f.sourceChapter,
        })),
      });
      memoryRestored.facts = r.count;
    }
    if (d.memory.characterStates.length > 0) {
      const r = await db.characterState.createMany({
        data: d.memory.characterStates.map((s) => ({
          novelId: novel.id,
          name: s.name,
          chapterIndex: s.chapterIndex,
          state: s.state,
        })),
      });
      memoryRestored.states = r.count;
    }
    if (d.memory.foreshadows.length > 0) {
      const r = await db.foreshadow.createMany({
        data: d.memory.foreshadows.map((f) => ({
          novelId: novel.id,
          content: f.content,
          plantChapter: f.plantChapter,
          payByChapter: f.payByChapter,
          status: f.status,
          lastChapter: f.lastChapter,
        })),
      });
      memoryRestored.foreshadows = r.count;
    }
    const validDigests = d.memory.digests.filter((dg) => chapterIdByIndex.has(dg.chapterIndex));
    if (validDigests.length > 0) {
      const r = await db.chapterDigest.createMany({
        data: validDigests.map((dg) => ({
          novelId: novel.id,
          chapterId: chapterIdByIndex.get(dg.chapterIndex) as string,
          summary: dg.summary,
        })),
      });
      memoryRestored.digests = r.count;
    }
    const validVersions = d.memory.versions.filter((v) => chapterIdByIndex.has(v.chapterIndex));
    if (validVersions.length > 0) {
      const r = await db.chapterVersion.createMany({
        data: validVersions.map((v) => ({
          novelId: novel.id,
          chapterId: chapterIdByIndex.get(v.chapterIndex) as string,
          draftNo: v.draftNo,
          content: v.content,
          wordCount: v.wordCount,
          createdBy: v.createdBy,
        })),
      });
      memoryRestored.versions = r.count;
    }
  }

  // ---- Integrity verification: re-read what actually landed in the DB ----
  const imported = await db.novel.findUnique({
    where: { id: novel.id },
    include: {
      chapters: { select: { wordCount: true } },
      _count: {
        select: {
          chapters: true,
          characters: true,
          worldEntries: true,
          outlineBeats: true,
        },
      },
    },
  });
  if (!imported) return jsonError("Import failed while verifying data", 500);

  const totalWords = imported.chapters.reduce((s, c) => s + c.wordCount, 0);
  const counts = {
    chapters: imported._count.chapters,
    characters: imported._count.characters,
    worldEntries: imported._count.worldEntries,
    outlineBeats: imported._count.outlineBeats,
  };

  let integrityOk = true;
  const declared = schema.data.integrity;
  if (declared) {
    if (declared.chapterCount !== counts.chapters) {
      integrityOk = false;
      warnings.push(
        `Chapter count mismatch: backup declared ${declared.chapterCount}, imported ${counts.chapters}.`
      );
    }
    if (declared.totalWords !== totalWords) {
      integrityOk = false;
      warnings.push(
        `Word count mismatch: backup declared ${declared.totalWords}, imported ${totalWords}.`
      );
    }
  }

  const emptyChapters = d.chapters.filter((c) => !c.content.trim()).length;
  if (emptyChapters > 0) {
    warnings.push(`${emptyChapters} chapter(s) contain no content.`);
  }
  if (counts.characters === 0) {
    warnings.push("The backup contains no characters.");
  }
  if (counts.outlineBeats === 0) {
    warnings.push("The backup contains no outline beats.");
  }

  // v2 memory-layer report — informational plus mismatch diagnostics.
  if (d.memory) {
    warnings.push(
      `Memory layer restored — ${memoryRestored.facts} fact(s), ${memoryRestored.states} state snapshot(s), ${memoryRestored.foreshadows} foreshadow(s), ${memoryRestored.digests} digest(s), ${memoryRestored.versions} draft version(s).`
    );
    const skippedDigests = d.memory.digests.length - memoryRestored.digests;
    const skippedVersions = d.memory.versions.length - memoryRestored.versions;
    if (skippedDigests > 0 || skippedVersions > 0) {
      warnings.push(
        `Some memory rows referenced chapters missing from the backup and were skipped (digests: ${skippedDigests}, versions: ${skippedVersions}).`
      );
    }
  } else if (schema.data.version === 2) {
    warnings.push("This v2 backup declared no memory layer — the import has an empty memory.");
  }

  const summaryNovel = await db.novel.findUnique({
    where: { id: novel.id },
    include: { chapters: { select: { wordCount: true } } },
  });
  if (!summaryNovel) return jsonError("Import failed while loading novel", 500);

  const report: ImportReport = {
    novelId: novel.id,
    title: imported.title,
    counts,
    totalWords,
    integrityOk,
    warnings,
  };

  return Response.json(
    { novel: toSummary(summaryNovel), report },
    { status: 201 }
  );
}
