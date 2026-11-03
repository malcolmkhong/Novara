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

// POST /api/novels — create a novel, optionally with its foundation
// (characters / world entries / outline beats) in the same atomic insert.
// The nested arrays come from the "New with the AI team" wizard; the plain
// manual form simply omits them.
export async function POST(req: Request) {
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = createNovelSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const { title, genre, synopsis, targetWords, characters, worldEntries, outlineBeats } =
    schema.data;

  const novel = await db.novel.create({
    data: {
      title,
      genre: genre ?? "",
      synopsis: synopsis ?? "",
      targetWords: targetWords ?? 100000,
      ...(characters && characters.length > 0
        ? {
            characters: {
              create: characters.map((c) => ({
                name: c.name,
                role: c.role ?? "",
                description: c.description ?? "",
              })),
            },
          }
        : {}),
      ...(worldEntries && worldEntries.length > 0
        ? {
            worldEntries: {
              create: worldEntries.map((w) => ({
                title: w.title,
                category: w.category ?? "other",
                content: w.content ?? "",
              })),
            },
          }
        : {}),
    },
    include: { chapters: { select: { wordCount: true } } },
  });

  // Phase 7 (P1) — wizard-seeded beats land in "Volume 1" so new books match
  // the migrated shape (flat outline = the book's first arc). Two plain
  // inserts keep the create types unambiguous.
  if (outlineBeats && outlineBeats.length > 0) {
    const volume = await db.volume.create({
      data: {
        novelId: novel.id,
        index: 1,
        title: "Volume 1",
        synopsis: "",
      },
    });
    await db.outlineBeat.createMany({
      data: outlineBeats.map((b, i) => ({
        novelId: novel.id,
        volumeId: volume.id,
        index: i + 1,
        title: b.title,
        summary: b.summary ?? "",
      })),
    });
  }

  return Response.json({ novel: toSummary(novel) }, { status: 201 });
}
