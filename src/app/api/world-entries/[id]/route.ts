import { db } from "@/lib/db";
import { worldEntryUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/world-entries/[id]
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = worldEntryUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.worldEntry.findUnique({ where: { id } });
  if (!existing) return jsonError("World entry not found", 404);

  const entry = await db.worldEntry.update({ where: { id }, data: schema.data });
  return Response.json({ entry });
}

// DELETE /api/world-entries/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.worldEntry.findUnique({ where: { id } });
  if (!existing) return jsonError("World entry not found", 404);

  await db.worldEntry.delete({ where: { id } });
  return Response.json({ ok: true });
}
