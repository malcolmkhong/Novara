import { db } from "@/lib/db";
import { jsonError, slugifyFilename } from "@/lib/novara/api-helpers";
import type {
  ChapterStatus,
  NovelBackupFile,
  NovelStatus,
  WorldCategory,
} from "@/lib/novara/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/export — download the novel as a versioned backup file.
// v2 (Phase 7): the memory layer (sediment truth — facts/states/foreshadows/
// digests) + chapter briefs + draft versions now travel with the backup, so
// moving devices no longer amputates the book's memory.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { index: "asc" } },
      characters: { orderBy: { createdAt: "asc" } },
      worldEntries: { orderBy: { createdAt: "asc" } },
      outlineBeats: { orderBy: { index: "asc" } },
      digests: true,
      storyFacts: true,
      characterStates: true,
      foreshadows: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!novel) return jsonError("Novel not found", 404);

  const versions = await db.chapterVersion.findMany({
    where: { novelId: id },
    orderBy: [{ draftNo: "asc" }],
  });
  const chapterIndexById = new Map(novel.chapters.map((c) => [c.id, c.index]));

  const totalWords = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0);

  const backup: NovelBackupFile = {
    format: "novara-novel-backup",
    version: 2,
    application: "Novara AI",
    exportedAt: new Date().toISOString(),
    data: {
      novel: {
        title: novel.title,
        genre: novel.genre,
        synopsis: novel.synopsis,
        targetWords: novel.targetWords,
        status: novel.status as NovelStatus,
      },
      chapters: novel.chapters.map((c) => ({
        title: c.title,
        content: c.content,
        status: c.status as ChapterStatus,
        brief: c.brief,
      })),
      characters: novel.characters.map((c) => ({
        name: c.name,
        role: c.role,
        description: c.description,
      })),
      worldEntries: novel.worldEntries.map((w) => ({
        title: w.title,
        category: w.category as WorldCategory,
        content: w.content,
      })),
      outlineBeats: novel.outlineBeats.map((b) => ({
        title: b.title,
        summary: b.summary,
      })),
      memory: {
        storyFacts: novel.storyFacts.map((f) => ({
          category: f.category,
          content: f.content,
          sourceChapter: f.sourceChapter,
        })),
        characterStates: novel.characterStates.map((s) => ({
          name: s.name,
          chapterIndex: s.chapterIndex,
          state: s.state,
        })),
        foreshadows: novel.foreshadows.map((f) => ({
          content: f.content,
          plantChapter: f.plantChapter,
          payByChapter: f.payByChapter,
          status: f.status as "open" | "advanced" | "paid",
          lastChapter: f.lastChapter,
        })),
        digests: novel.digests
          .map((dg) => {
            const chapterIndex = chapterIndexById.get(dg.chapterId);
            return chapterIndex ? { chapterIndex, summary: dg.summary } : null;
          })
          .filter((d): d is NonNullable<typeof d> => d !== null),
        versions: versions
          .map((v) => {
            const chapterIndex = chapterIndexById.get(v.chapterId);
            return chapterIndex
              ? {
                  chapterIndex,
                  draftNo: v.draftNo,
                  content: v.content,
                  wordCount: v.wordCount,
                  createdBy: v.createdBy as "author" | "agent" | "restore",
                }
              : null;
          })
          .filter((v): v is NonNullable<typeof v> => v !== null),
      },
    },
    integrity: {
      chapterCount: novel.chapters.length,
      characterCount: novel.characters.length,
      worldEntryCount: novel.worldEntries.length,
      outlineBeatCount: novel.outlineBeats.length,
      totalWords,
    },
  };

  const filename = `novara-${slugifyFilename(novel.title)}-v2.json`;
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
