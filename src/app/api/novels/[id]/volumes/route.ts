import { db } from "@/lib/db";
import { createVolumeSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/volumes — ordered volumes
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const volumes = await db.volume.findMany({
    where: { novelId: id },
    orderBy: { index: "asc" },
  });
  return Response.json({ volumes });
}

// POST /api/novels/[id]/volumes — append a new volume at the end
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = createVolumeSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const last = await db.volume.findFirst({
    where: { novelId: id },
    orderBy: { index: "desc" },
    select: { index: true },
  });

  const volume = await db.volume.create({
    data: {
      novelId: id,
      index: (last?.index ?? 0) + 1,
      title: schema.data.title,
      synopsis: schema.data.synopsis ?? "",
    },
  });

  return Response.json({ volume }, { status: 201 });
}
