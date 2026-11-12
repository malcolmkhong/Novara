import { db } from "@/lib/db";
import { jsonError } from "@/lib/novara/api-helpers";
import { buildMemorySyncReport } from "@/lib/novara/memory";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/memory/status — per-chapter "is my memory healthy?"
// report: for every chapter of the novel, whether its memory projection
// (digest + facts) is settled, plus a summary that tallies only the FINAL
// chapters. Read-only: the sediment pipeline remains the single writer of
// the memory tables.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;

  const exists = await db.novel.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return jsonError("Novel not found", 404);

  return Response.json(await buildMemorySyncReport(id));
}
