import { db } from "@/lib/db";
import { jsonError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/chapters/[id]/versions — draft history (newest first).
// Content is included so the editor can preview/restore without a second
// fetch; chapters are small at this scale and history is capped.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const chapter = await db.chapter.findUnique({ where: { id } });
  if (!chapter) return jsonError("Chapter not found", 404);

  const versions = await db.chapterVersion.findMany({
    where: { chapterId: id },
    orderBy: { draftNo: "desc" },
  });

  return Response.json({
    chapterId: chapter.id,
    index: chapter.index,
    versions: versions.map((v) => ({
      id: v.id,
      draftNo: v.draftNo,
      wordCount: v.wordCount,
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
      content: v.content,
    })),
  });
}
