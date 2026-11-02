import { db } from "@/lib/db";
import { updateChapterSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { countWords } from "@/lib/novara/words";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/chapters/[id] — update title/content/status.
// wordCount is ALWAYS recomputed server-side from content (never trusted).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateChapterSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.chapter.findUnique({ where: { id } });
  if (!existing) return jsonError("Chapter not found", 404);

  const data: { title?: string; content?: string; status?: string; wordCount?: number } = {
    ...schema.data,
  };
  if (schema.data.content !== undefined) {
    data.wordCount = countWords(schema.data.content);
  }

  const [chapter] = await db.$transaction([
    db.chapter.update({ where: { id }, data }),
    db.novel.update({
      where: { id: existing.novelId },
      data: { updatedAt: new Date() },
    }),
  ]);

  return Response.json({
    chapter: {
      id: chapter.id,
      novelId: chapter.novelId,
      index: chapter.index,
      title: chapter.title,
      content: chapter.content,
      wordCount: chapter.wordCount,
      status: chapter.status,
      updatedAt: chapter.updatedAt.toISOString(),
    },
  });
}

// DELETE /api/chapters/[id] — delete and close the index gap
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.chapter.findUnique({ where: { id } });
  if (!existing) return jsonError("Chapter not found", 404);

  await db.$transaction([
    db.chapter.delete({ where: { id } }),
    db.chapter.updateMany({
      where: { novelId: existing.novelId, index: { gt: existing.index } },
      data: { index: { decrement: 1 } },
    }),
    db.novel.update({
      where: { id: existing.novelId },
      data: { updatedAt: new Date() },
    }),
  ]);

  return Response.json({ ok: true });
}
