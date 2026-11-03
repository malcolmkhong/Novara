import { db } from "@/lib/db";
import { outlineBeatSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/novels/[id]/outline-beats — append an outline beat
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = outlineBeatSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id } });
  if (!novel) return jsonError("Novel not found", 404);

  // Volume grouping (Phase 7 P1): validate the volume belongs to THIS novel.
  let volumeId: string | null = null;
  if (schema.data.volumeId) {
    const volume = await db.volume.findUnique({
      where: { id: schema.data.volumeId },
      select: { id: true, novelId: true },
    });
    if (!volume || volume.novelId !== id) {
      return jsonError("Volume does not belong to this novel", 400);
    }
    volumeId = volume.id;
  }

  const last = await db.outlineBeat.findFirst({
    where: { novelId: id },
    orderBy: { index: "desc" },
    select: { index: true },
  });

  const beat = await db.outlineBeat.create({
    data: {
      novelId: id,
      index: (last?.index ?? 0) + 1,
      title: schema.data.title,
      summary: schema.data.summary ?? "",
      volumeId,
    },
  });
  await db.novel.update({ where: { id }, data: { updatedAt: new Date() } });

  return Response.json({ beat }, { status: 201 });
}
