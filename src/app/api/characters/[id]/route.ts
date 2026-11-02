import { db } from "@/lib/db";
import { characterUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/characters/[id]
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = characterUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.character.findUnique({ where: { id } });
  if (!existing) return jsonError("Character not found", 404);

  const character = await db.character.update({ where: { id }, data: schema.data });
  return Response.json({ character });
}

// DELETE /api/characters/[id]
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.character.findUnique({ where: { id } });
  if (!existing) return jsonError("Character not found", 404);

  await db.character.delete({ where: { id } });
  return Response.json({ ok: true });
}
