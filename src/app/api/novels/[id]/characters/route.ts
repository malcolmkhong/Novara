import { db } from "@/lib/db";
import { characterSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/novels/[id]/characters — add a character to the story bible
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = characterSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id } });
  if (!novel) return jsonError("Novel not found", 404);

  const character = await db.character.create({
    data: {
      novelId: id,
      name: schema.data.name,
      role: schema.data.role ?? "",
      description: schema.data.description ?? "",
    },
  });
  await db.novel.update({ where: { id }, data: { updatedAt: new Date() } });

  return Response.json({ character }, { status: 201 });
}
