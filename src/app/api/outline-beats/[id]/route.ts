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

  const beat = await db.outlineBeat.update({ where: { id }, data: schema.data });
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
