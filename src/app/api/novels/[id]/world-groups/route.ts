import { db } from "@/lib/db";
import { createWorldGroupSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/world-groups — ordered 世界书 groups
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const groups = await db.worldGroup.findMany({
    where: { novelId: id },
    orderBy: { order: "asc" },
  });
  return Response.json({ groups });
}

// POST /api/novels/[id]/world-groups — create a group (order = last + 1)
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = createWorldGroupSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const name = schema.data.name;
  const clash = await db.worldGroup.findUnique({
    where: { novelId_name: { novelId: id, name } },
    select: { id: true },
  });
  if (clash) return jsonError(`分组「${name}」已存在`, 409);

  const last = await db.worldGroup.findFirst({
    where: { novelId: id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const group = await db.worldGroup.create({
    data: { novelId: id, name, order: (last?.order ?? 0) + 1 },
  });
  return Response.json({ group }, { status: 201 });
}
