import { db } from "@/lib/db";
import { createNovelSchema } from "@/lib/novara/schemas";
import { parseBody, validationError } from "@/lib/novara/api-helpers";
import { toSummary } from "@/lib/novara/summary";

export const dynamic = "force-dynamic";

// GET /api/novels — list all novels with aggregate stats
export async function GET() {
  const novels = await db.novel.findMany({
    orderBy: { updatedAt: "desc" },
    include: { chapters: { select: { wordCount: true } } },
  });
  return Response.json({ novels: novels.map(toSummary) });
}

// POST /api/novels — create a novel
export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = createNovelSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const { title, genre, synopsis, targetWords } = schema.data;
  const novel = await db.novel.create({
    data: {
      title,
      genre: genre ?? "",
      synopsis: synopsis ?? "",
      targetWords: targetWords ?? 100000,
    },
    include: { chapters: { select: { wordCount: true } } },
  });
  return Response.json({ novel: toSummary(novel) }, { status: 201 });
}
