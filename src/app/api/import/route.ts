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
