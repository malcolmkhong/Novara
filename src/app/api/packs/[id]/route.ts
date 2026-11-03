import { db } from "@/lib/db";
import { packUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/packs/[id] — update one chapter pack (title/content).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = packUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.chapterPack.findUnique({ where: { id } });
  if (!existing) return jsonError("Pack not found", 404);

  const pack = await db.chapterPack.update({
    where: { id },
    data: {
      ...(schema.data.title !== undefined ? { title: schema.data.title } : {}),
      ...(schema.data.content !== undefined ? { content: schema.data.content } : {}),
    },
  });

  return Response.json({
    pack: {
      id: pack.id,
      novelId: pack.novelId,
      kind: pack.kind,
      chapterIndex: pack.chapterIndex,
      title: pack.title,
      content: pack.content,
      updatedAt: pack.updatedAt.toISOString(),
    },
  });
}

// DELETE /api/packs/[id] — remove one chapter pack.
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.chapterPack.findUnique({ where: { id } });
  if (!existing) return jsonError("Pack not found", 404);

  await db.chapterPack.delete({ where: { id } });
  return Response.json({ ok: true });
}
