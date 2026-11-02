import { jsonError } from "@/lib/novara/api-helpers";
import { sedimentChapterCore } from "@/lib/novara/sediment";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Params = { params: Promise<{ id: string }> };

// POST /api/chapters/[id]/sediment — author-facing thin shell over the shared
// sediment core (lib/novara/sediment.ts). The same core powers the
// settle_chapter agent tool (Phase 6) — one implementation, two callers.
// The UI only offers this once review reports blocking = 0.
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;

  try {
    const outcome = await sedimentChapterCore(id);
    const ledger = await db.foreshadow.findMany({
      where: { novelId: outcome.novelId },
      orderBy: [{ status: "asc" }, { plantChapter: "asc" }],
      select: {
        id: true,
        content: true,
        plantChapter: true,
        payByChapter: true,
        status: true,
        lastChapter: true,
      },
    });
    return Response.json({
      chapterId: outcome.chapterId,
      sedimentedAt: outcome.sedimentedAt,
      result: outcome.result,
      ledger,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI service error";
    const status = message === "Chapter not found" ? 404 : message === "Chapter has no content to settle" ? 422 : 502;
    return jsonError(`AI sediment failed: ${message}`, status);
  }
}
