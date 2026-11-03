import { db } from "@/lib/db";
import { jsonError } from "@/lib/novara/api-helpers";
import { buildMemoryView } from "@/lib/novara/memory";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/memory — the story bible read back: sedimented memory
// items, chapter digests, deterministic doctor checks and counters. Backs the
// workbench Memory tab. Read-only: the sediment pipeline remains the single
// writer of everything this view surfaces.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;

  const exists = await db.novel.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return jsonError("Novel not found", 404);

  try {
    const view = await buildMemoryView(id);
    return Response.json(view);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown memory error";
    return jsonError(`Memory view failed: ${message}`, 500);
  }
}
