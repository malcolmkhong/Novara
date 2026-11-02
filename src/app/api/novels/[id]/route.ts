import { db } from "@/lib/db";
import { updateNovelSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { toSummary } from "@/lib/novara/summary";
import type {
  ChapterDTO,
  CharacterDTO,
  NovelDetail,
  OutlineBeatDTO,
  WorldCategory,
  WorldEntryDTO,
} from "@/lib/novara/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id] — full novel detail with all story bible relations
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

  const detail: NovelDetail = {
    novel: {
      id: novel.id,
      title: novel.title,
      genre: novel.genre,
      synopsis: novel.synopsis,
      targetWords: novel.targetWords,
      status: novel.status as NovelDetail["novel"]["status"],
      createdAt: novel.createdAt.toISOString(),
      updatedAt: novel.updatedAt.toISOString(),
    },
    chapters: novel.chapters.map(
      (c): ChapterDTO => ({
        id: c.id,
        novelId: c.novelId,
        index: c.index,
        title: c.title,
        content: c.content,
        wordCount: c.wordCount,
        status: c.status as ChapterDTO["status"],
        updatedAt: c.updatedAt.toISOString(),
      })
    ),
    characters: novel.characters.map(
      (ch): CharacterDTO => ({
        id: ch.id,
        novelId: ch.novelId,
        name: ch.name,
        role: ch.role,
        description: ch.description,
        updatedAt: ch.updatedAt.toISOString(),
      })
    ),
    worldEntries: novel.worldEntries.map(
      (w): WorldEntryDTO => ({
        id: w.id,
        novelId: w.novelId,
        title: w.title,
        category: w.category as WorldCategory,
        content: w.content,
        updatedAt: w.updatedAt.toISOString(),
      })
    ),
    outlineBeats: novel.outlineBeats.map(
      (b): OutlineBeatDTO => ({
        id: b.id,
        novelId: b.novelId,
        index: b.index,
        title: b.title,
        summary: b.summary,
        updatedAt: b.updatedAt.toISOString(),
      })
    ),
  };
  return Response.json(detail);
}

// PATCH /api/novels/[id] — update novel metadata
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateNovelSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.novel.findUnique({ where: { id } });
  if (!existing) return jsonError("Novel not found", 404);

  const novel = await db.novel.update({
    where: { id },
    data: schema.data,
    include: { chapters: { select: { wordCount: true } } },
  });
  return Response.json({ novel: toSummary(novel) });
}

// DELETE /api/novels/[id] — delete novel and (cascade) all its content
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.novel.findUnique({ where: { id } });
  if (!existing) return jsonError("Novel not found", 404);

  await db.novel.delete({ where: { id } });
  return Response.json({ ok: true });
}
