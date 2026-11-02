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

// GET /api/novels/[id]/export — download the novel as a versioned backup file
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { index: "asc" } },
      characters: { orderBy: { createdAt: "asc" } },
      worldEntries: { orderBy: { createdAt: "asc" } },
      outlineBeats: { orderBy: { index: "asc" } },
    },
  });
  if (!novel) return jsonError("Novel not found", 404);

  const totalWords = novel.chapters.reduce((sum, c) => sum + c.wordCount, 0);

  const backup: NovelBackupFile = {
    format: "novara-novel-backup",
    version: 1,
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
    },
    integrity: {
      chapterCount: novel.chapters.length,
      characterCount: novel.characters.length,
      worldEntryCount: novel.worldEntries.length,
      outlineBeatCount: novel.outlineBeats.length,
      totalWords,
    },
  };

  const filename = `novara-${slugifyFilename(novel.title)}-v1.json`;
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
