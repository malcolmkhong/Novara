import { db } from "@/lib/db";
import { ledgerUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; kind: string }> };

const KINDS = new Set(["storyline", "timeline", "arc", "promise", "clue"]);

// PATCH /api/ledger/[kind]/[id] — update one ledger row.
// timeline/arc rows support moveTo (renumber the sibling sequence server-side).
export async function PATCH(req: Request, { params }: Params) {
  const { id, kind } = await params;
  if (!KINDS.has(kind)) return jsonError(`Unknown ledger kind: ${kind}`, 404);

  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = ledgerUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);
  if (schema.data.kind !== kind) {
    return jsonError("Body kind does not match the URL kind", 400);
  }

  // Branch on the DISCRIMINANT (schema.data.kind), not the URL param — this
  // is what narrows the union member (and its moveTo) for each table.
  if (schema.data.kind === "storyline") {
    const existing = await db.storyline.findUnique({ where: { id } });
    if (!existing) return jsonError("Storyline not found", 404);
    const { name, summary, status } = schema.data.data;
    const row = await db.storyline.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });
    return Response.json({ row });
  }

  if (schema.data.kind === "timeline") {
    const existing = await db.timelineEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("Timeline entry not found", 404);
    const { moveTo, label, detail, chapterIndex } = schema.data.data;
    if (moveTo !== undefined && moveTo !== existing.order) {
      const siblings = await db.timelineEntry.findMany({
        where: { novelId: existing.novelId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const clamped = Math.max(1, Math.min(moveTo, siblings.length));
      const without = siblings.filter((t) => t.id !== id);
      without.splice(clamped - 1, 0, { id });
      await db.$transaction(
        without.map((t, i) =>
          db.timelineEntry.update({ where: { id: t.id }, data: { order: i + 1 } })
        )
      );
    }
    const row = await db.timelineEntry.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(detail !== undefined ? { detail } : {}),
        ...(chapterIndex !== undefined ? { chapterIndex } : {}),
      },
    });
    return Response.json({ row });
  }

  // schema.data.kind === "arc"
  if (schema.data.kind === "arc") {
    const existing = await db.characterArc.findUnique({ where: { id } });
    if (!existing) return jsonError("Character arc not found", 404);
    const { moveTo, characterName, note, chapterIndex } = schema.data.data;
    if (moveTo !== undefined && moveTo !== existing.order) {
      const siblings = await db.characterArc.findMany({
        where: { novelId: existing.novelId, characterName: existing.characterName },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const clamped = Math.max(1, Math.min(moveTo, siblings.length));
      const without = siblings.filter((a) => a.id !== id);
      without.splice(clamped - 1, 0, { id });
      await db.$transaction(
        without.map((a, i) =>
          db.characterArc.update({ where: { id: a.id }, data: { order: i + 1 } })
        )
      );
    }
    const row = await db.characterArc.update({
      where: { id },
      data: {
        ...(characterName !== undefined ? { characterName } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(chapterIndex !== undefined ? { chapterIndex } : {}),
      },
    });
    return Response.json({ row });
  }

  // Phase 8 — promise rows are flat updates (no ordering). Status moves are
  // plain writes: the ledger is plan-level truth curated by author and agent.
if (schema.data.kind === "promise") {
  const existing = await db.storyPromise.findUnique({ where: { id } });
  if (!existing) return jsonError("Promise not found", 404);
  const { content, status, madeChapter, dueChapter } = schema.data.data;
  const row = await db.storyPromise.update({
    where: { id },
    data: {
      ...(content !== undefined ? { content } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(madeChapter !== undefined ? { madeChapter } : {}),
      ...(dueChapter !== undefined ? { dueChapter } : {}),
    },
  });
  return Response.json({ row });
}

// schema.data.kind === "clue"
if (schema.data.kind === "clue") {
  const existingClue = await db.storyClue.findUnique({ where: { id } });
  if (!existingClue) return jsonError("Clue not found", 404);
  const clueData = schema.data.data;
  const clueRow = await db.storyClue.update({
    where: { id },
    data: {
      ...(clueData.content !== undefined ? { content: clueData.content } : {}),
      ...(clueData.status !== undefined ? { status: clueData.status } : {}),
      ...(clueData.plantChapter !== undefined ? { plantChapter: clueData.plantChapter } : {}),
      ...(clueData.revealChapter !== undefined ? { revealChapter: clueData.revealChapter } : {}),
    },
  });
  return Response.json({ row: clueRow });
}

return jsonError(`Unknown ledger kind: ${kind}`, 404);
}

// DELETE /api/ledger/[kind]/[id] — remove one ledger row and close the gap.
export async function DELETE(_req: Request, { params }: Params) {
  const { id, kind } = await params;
  if (!KINDS.has(kind)) return jsonError(`Unknown ledger kind: ${kind}`, 404);

  if (kind === "storyline") {
    const existing = await db.storyline.findUnique({ where: { id } });
    if (!existing) return jsonError("Storyline not found", 404);
    await db.storyline.delete({ where: { id } });
    return Response.json({ ok: true });
  }

  if (kind === "timeline") {
    const existing = await db.timelineEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("Timeline entry not found", 404);
    const later = await db.timelineEntry.findMany({
      where: { novelId: existing.novelId, order: { gt: existing.order } },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    await db.$transaction([
      db.timelineEntry.delete({ where: { id } }),
      ...later.map((t, i) =>
        db.timelineEntry.update({
          where: { id: t.id },
          data: { order: existing.order + i },
        })
      ),
    ]);
    return Response.json({ ok: true });
  }

  // kind === "arc"
  if (kind === "arc") {
    const existing = await db.characterArc.findUnique({ where: { id } });
    if (!existing) return jsonError("Character arc not found", 404);
    const later = await db.characterArc.findMany({
      where: {
        novelId: existing.novelId,
        characterName: existing.characterName,
        order: { gt: existing.order },
      },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    await db.$transaction([
      db.characterArc.delete({ where: { id } }),
      ...later.map((a, i) =>
        db.characterArc.update({
          where: { id: a.id },
          data: { order: existing.order + i },
        })
      ),
    ]);
    return Response.json({ ok: true });
  }

  // Phase 8 — promise / clue rows delete flat (no ordering to repair).
  if (kind === "promise") {
    const existing = await db.storyPromise.findUnique({ where: { id } });
    if (!existing) return jsonError("Promise not found", 404);
    await db.storyPromise.delete({ where: { id } });
    return Response.json({ ok: true });
  }

  // kind === "clue"
  const existingClue = await db.storyClue.findUnique({ where: { id } });
  if (!existingClue) return jsonError("Clue not found", 404);
  await db.storyClue.delete({ where: { id } });
  return Response.json({ ok: true });
}
