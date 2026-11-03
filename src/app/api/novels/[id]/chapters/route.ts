import { db } from "@/lib/db";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { z } from "zod";
import type { ChapterDTO } from "@/lib/novara/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createChapterSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

function toDTO(c: {
  id: string;
  novelId: string;
  index: number;
  title: string;
  content: string;
  wordCount: number;
  status: string;
  brief: string;
  updatedAt: Date;
}): ChapterDTO {
  return {
    id: c.id,
    novelId: c.novelId,
    index: c.index,
    title: c.title,
    content: c.content,
    wordCount: c.wordCount,
    status: c.status as ChapterDTO["status"],
    brief: c.brief,
    updatedAt: c.updatedAt.toISOString(),
  };
}

// POST /api/novels/[id]/chapters — append a new chapter
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = createChapterSchema.safeParse(parsed.data ?? {});
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id } });
  if (!novel) return jsonError("Novel not found", 404);

  const last = await db.chapter.findFirst({
    where: { novelId: id },
    orderBy: { index: "desc" },
    select: { index: true },
  });
  const count = await db.chapter.count({ where: { novelId: id } });

  const chapter = await db.chapter.create({
    data: {
      novelId: id,
      index: (last?.index ?? 0) + 1,
      title: schema.data.title ?? `Chapter ${count + 1}`,
      content: "",
      wordCount: 0,
      status: "draft",
    },
  });

  await db.novel.update({ where: { id }, data: { updatedAt: new Date() } });
  return Response.json({ chapter: toDTO(chapter) }, { status: 201 });
}
