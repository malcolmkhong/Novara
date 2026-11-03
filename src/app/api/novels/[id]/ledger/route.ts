import { db } from "@/lib/db";
import { ledgerCreateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import type { LedgerView } from "@/lib/novara/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id]/ledger — the three ledgers (故事线 / 时间线 / 人物弧线).
// Plan-level truth the author curates; sediment memory stays separate.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const [storylines, timeline, arcs] = await Promise.all([
    db.storyline.findMany({ where: { novelId: id }, orderBy: { createdAt: "asc" } }),
    db.timelineEntry.findMany({ where: { novelId: id }, orderBy: { order: "asc" } }),
    db.characterArc.findMany({
      where: { novelId: id },
      orderBy: [{ characterName: "asc" }, { order: "asc" }],
    }),
  ]);

  const view: LedgerView = {
    storylines: storylines.map((sl) => ({
      id: sl.id,
      novelId: sl.novelId,
      name: sl.name,
      summary: sl.summary,
      status: sl.status as LedgerView["storylines"][number]["status"],
      updatedAt: sl.updatedAt.toISOString(),
    })),
    timeline: timeline.map((t) => ({
      id: t.id,
      novelId: t.novelId,
      order: t.order,
      label: t.label,
      detail: t.detail,
      chapterIndex: t.chapterIndex,
      updatedAt: t.updatedAt.toISOString(),
    })),
    arcs: arcs.map((a) => ({
      id: a.id,
      novelId: a.novelId,
      characterName: a.characterName,
      order: a.order,
      note: a.note,
      chapterIndex: a.chapterIndex,
      updatedAt: a.updatedAt.toISOString(),
    })),
  };
  return Response.json(view);
}

// POST /api/novels/[id]/ledger — create a ledger row.
// Body: { kind: "storyline" | "timeline" | "arc", data: {...} }
// Timeline rows append to the end; arc rows insert after the last stage of
// the same character (order maintained server-side, never trusted).
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = ledgerCreateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const novel = await db.novel.findUnique({ where: { id }, select: { id: true } });
  if (!novel) return jsonError("Novel not found", 404);

  const { kind, data } = schema.data;

  if (kind === "storyline") {
    const row = await db.storyline.create({
      data: {
        novelId: id,
        name: data.name,
        summary: data.summary ?? "",
        status: data.status ?? "active",
      },
    });
    return Response.json({ row }, { status: 201 });
  }

  if (kind === "timeline") {
    const last = await db.timelineEntry.findFirst({
      where: { novelId: id },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const row = await db.timelineEntry.create({
      data: {
        novelId: id,
        order: (last?.order ?? 0) + 1,
        label: data.label,
        detail: data.detail ?? "",
        chapterIndex: data.chapterIndex ?? null,
      },
    });
    return Response.json({ row }, { status: 201 });
  }

  // kind === "arc"
  const last = await db.characterArc.findFirst({
    where: { novelId: id, characterName: data.characterName },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const row = await db.characterArc.create({
    data: {
      novelId: id,
      characterName: data.characterName,
      order: (last?.order ?? 0) + 1,
      note: data.note,
      chapterIndex: data.chapterIndex ?? null,
    },
  });
  return Response.json({ row }, { status: 201 });
}
