import { db } from "@/lib/db";
import { createNovelSchema } from "@/lib/novara/schemas";
import { parseBody, validationError } from "@/lib/novara/api-helpers";
import { toSummary } from "@/lib/novara/summary";
import { recordProvenanceLink } from "@/lib/usage/usage-store";

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

  const { title, genre, synopsis, targetWords, characters, worldEntries, outlineBeats, conceptSnapshot, wizardSessionId } =
    schema.data;

  const novel = await db.novel.create({
    data: {
      title,
      genre: genre ?? "",
      synopsis: synopsis ?? "",
      targetWords: targetWords ?? 100000,
      // Phase 9 — the wizard's vision snapshot lands at creation so the
      // tree shows 已快照 and the runtime has a concept anchor from day one.
      conceptSnapshot: conceptSnapshot ?? "",
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
    },
    include: { chapters: { select: { wordCount: true } } },
  });

  // Phase 9 — wizard-seeded world entries land in a "世界规则" second-level
  // group (DSH 世界书/世界规则 analog), so a new book's tree matches the
  // designed two-level world-bible shape immediately.
  if (worldEntries && worldEntries.length > 0) {
    const group = await db.worldGroup.create({
      data: { novelId: novel.id, name: "世界规则", order: 1 },
    });
    await db.worldEntry.createMany({
      data: worldEntries.map((w) => ({
        novelId: novel.id,
        title: w.title,
        category: w.category ?? "other",
        content: w.content ?? "",
        groupId: group.id,
      })),
    });
  }

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

  // P5 — the retro-tag link (Ruling: provenance created at novel creation):
  // the wizard session's ledger rows (recorded under correlationId) now
  // belong to the created novel. Idempotent per (sessionId, novelId).
  if (wizardSessionId) {
    recordProvenanceLink("wizard", wizardSessionId, novel.id);
  }

  return Response.json({ novel: toSummary(novel) }, { status: 201 });
}
