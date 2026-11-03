import { db } from "@/lib/db";
import { outlineBeatUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/outline-beats/[id]
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = outlineBeatUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.outlineBeat.findUnique({ where: { id } });
  if (!existing) return jsonError("Outline beat not found", 404);

  // Volume grouping (Phase 7 P1): validate the volume belongs to THIS novel.
  let volumeId: string | null | undefined;
  if (schema.data.volumeId !== undefined) {
    if (schema.data.volumeId === null) {
      volumeId = null; // explicit unsort
    } else {
      const volume = await db.volume.findUnique({
        where: { id: schema.data.volumeId },
        select: { id: true, novelId: true },
      });
      if (!volume || volume.novelId !== existing.novelId) {
        return jsonError("Volume does not belong to this novel", 400);
      }
      volumeId = volume.id;
    }
  }

  const beat = await db.outlineBeat.update({
    where: { id },
    data: { ...schema.data, ...(volumeId !== undefined ? { volumeId } : {}) },
  });
  return Response.json({ beat });
}

// DELETE /api/outline-beats/[id] — delete and close the index gap
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.outlineBeat.findUnique({ where: { id } });
  if (!existing) return jsonError("Outline beat not found", 404);

  await db.$transaction([
    db.outlineBeat.delete({ where: { id } }),
    db.outlineBeat.updateMany({
      where: { novelId: existing.novelId, index: { gt: existing.index } },
      data: { index: { decrement: 1 } },
    }),
  ]);

  return Response.json({ ok: true });
}
