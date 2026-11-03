import { db } from "@/lib/db";
import { updateWorldGroupSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/world-groups/[id] — rename and/or move position. Moving
// renumbers the sibling list server-side (dense 1..N, same as volumes).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateWorldGroupSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.worldGroup.findUnique({ where: { id } });
  if (!existing) return jsonError("World group not found", 404);

  const { name, moveTo } = schema.data;

  if (name !== undefined && name !== existing.name) {
    const clash = await db.worldGroup.findUnique({
      where: { novelId_name: { novelId: existing.novelId, name } },
      select: { id: true },
    });
    if (clash && clash.id !== id) return jsonError(`分组「${name}」已存在`, 409);
  }

  if (moveTo !== undefined && moveTo !== existing.order) {
    const siblings = await db.worldGroup.findMany({
      where: { novelId: existing.novelId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    const clamped = Math.max(1, Math.min(moveTo, siblings.length));
    const without = siblings.filter((g) => g.id !== id);
    without.splice(clamped - 1, 0, { id });
    await db.$transaction(
      without.map((g, i) =>
        db.worldGroup.update({ where: { id: g.id }, data: { order: i + 1 } })
      )
    );
  }

  const group = await db.worldGroup.update({
    where: { id },
    data: { ...(name !== undefined ? { name } : {}) },
  });
  return Response.json({ group });
}

// DELETE /api/world-groups/[id] — the group's entries fall back to ungrouped
// (schema-level onDelete: SetNull) so nothing is ever silently destroyed.
// Siblings after it close the order gap.
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.worldGroup.findUnique({ where: { id } });
  if (!existing) return jsonError("World group not found", 404);

  const later = await db.worldGroup.findMany({
    where: { novelId: existing.novelId, order: { gt: existing.order } },
    orderBy: { order: "asc" },
    select: { id: true },
  });

  await db.$transaction([
    db.worldGroup.delete({ where: { id } }),
    ...later.map((g, i) =>
      db.worldGroup.update({ where: { id: g.id }, data: { order: existing.order + i } })
    ),
  ]);

  return Response.json({ ok: true });
}
