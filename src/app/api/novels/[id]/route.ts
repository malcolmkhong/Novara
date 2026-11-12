import { db } from "@/lib/db";
import { updateNovelSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { toSummary } from "@/lib/novara/summary";
import type {
  ChapterDTO,
  ChapterPackDTO,
  ChapterVersionSummaryDTO,
  CharacterDTO,
  DigestDTO,
  LedgerView,
  NovelDetail,
  OutlineBeatDTO,
  StoryClueDTO,
  StoryPromiseDTO,
  StorylineDTO,
  TimelineEntryDTO,
  VolumeDTO,
  WorldCategory,
  WorldEntryDTO,
  WorldGroupDTO,
} from "@/lib/novara/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/novels/[id] — full novel detail with all story bible relations
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const novel = await db.novel.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { index: "asc" } },
      characters: { orderBy: { createdAt: "asc" } },
      worldEntries: { orderBy: { createdAt: "asc" } },
      worldGroups: { orderBy: { order: "asc" } },
      outlineBeats: { orderBy: { index: "asc" } },
      volumes: { orderBy: { index: "asc" } },
      contract: true,
      // Phase 8 — the 草稿区 workspace documents + 章摘要 (tree-visible).
      packs: { orderBy: [{ chapterIndex: "asc" }, { kind: "asc" }] },
      digests: { orderBy: { updatedAt: "desc" } },
      // Phase 9 — the five ledgers (tree-visible).
      storylines: { orderBy: { createdAt: "asc" } },
      timelineEntries: { orderBy: { order: "asc" } },
      characterArcs: { orderBy: [{ characterName: "asc" }, { order: "asc" }] },
      promises: { orderBy: { createdAt: "asc" } },
      clues: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!novel) return jsonError("Novel not found", 404);

  // 稿N version summaries (Phase 9) — separate query (ChapterVersion has no
  // Novel back-relation; this keeps the include type straightforward).
  const versions = await db.chapterVersion.findMany({
    where: { novelId: id },
    orderBy: [{ chapterId: "asc" }, { draftNo: "asc" }],
    select: {
      id: true,
      chapterId: true,
      draftNo: true,
      wordCount: true,
      createdBy: true,
      createdAt: true,
    },
  });

  const chapterIndexById = new Map(
    novel.chapters.map((c): [string, number] => [c.id, c.index])
  );

  const ledger: LedgerView = {
    storylines: novel.storylines.map(
      (s): StorylineDTO => ({
        id: s.id,
        novelId: s.novelId,
        name: s.name,
        summary: s.summary,
        status: s.status as StorylineDTO["status"],
        lock: s.lock === "final" ? "final" : "draft",
        updatedAt: s.updatedAt.toISOString(),
      })
    ),
    timeline: novel.timelineEntries.map(
      (t): TimelineEntryDTO => ({
        id: t.id,
        novelId: t.novelId,
        order: t.order,
        label: t.label,
        detail: t.detail,
        chapterIndex: t.chapterIndex,
        status: t.status === "final" ? "final" : "draft",
        updatedAt: t.updatedAt.toISOString(),
      })
    ),
    arcs: novel.characterArcs.map(
      (a): LedgerView["arcs"][number] => ({
        id: a.id,
        novelId: a.novelId,
        characterName: a.characterName,
        order: a.order,
        note: a.note,
        chapterIndex: a.chapterIndex,
        status: a.status === "final" ? "final" : "draft",
        updatedAt: a.updatedAt.toISOString(),
      })
    ),
    promises: novel.promises.map(
      (p): StoryPromiseDTO => ({
        id: p.id,
        novelId: p.novelId,
        content: p.content,
        status: p.status as StoryPromiseDTO["status"],
        lock: p.lock === "final" ? "final" : "draft",
        madeChapter: p.madeChapter,
        dueChapter: p.dueChapter,
        updatedAt: p.updatedAt.toISOString(),
      })
    ),
    clues: novel.clues.map(
      (c): StoryClueDTO => ({
        id: c.id,
        novelId: c.novelId,
        content: c.content,
        status: c.status as StoryClueDTO["status"],
        lock: c.lock === "final" ? "final" : "draft",
        plantChapter: c.plantChapter,
        revealChapter: c.revealChapter,
        updatedAt: c.updatedAt.toISOString(),
      })
    ),
  };

  const detail: NovelDetail = {
    novel: {
      id: novel.id,
      title: novel.title,
      genre: novel.genre,
      synopsis: novel.synopsis,
      targetWords: novel.targetWords,
      status: novel.status as NovelDetail["novel"]["status"],
      // Phase 8 — 构想快照 rides on NovelMeta so the tree can open it.
      conceptSnapshot: novel.conceptSnapshot,
      createdAt: novel.createdAt.toISOString(),
      updatedAt: novel.updatedAt.toISOString(),
    },
    chapters: novel.chapters.map(
      (c): ChapterDTO => ({
        id: c.id,
        novelId: c.novelId,
        index: c.index,
        title: c.title,
        content: c.content,
        wordCount: c.wordCount,
        status: c.status as ChapterDTO["status"],
        brief: c.brief,
        updatedAt: c.updatedAt.toISOString(),
      })
    ),
    characters: novel.characters.map(
      (ch): CharacterDTO => ({
        id: ch.id,
        novelId: ch.novelId,
        name: ch.name,
        role: ch.role,
        description: ch.description,
        aliases: ch.aliases,
        status: ch.status === "final" ? "final" : "draft",
        updatedAt: ch.updatedAt.toISOString(),
      })
    ),
    worldEntries: novel.worldEntries.map(
      (w): WorldEntryDTO => ({
        id: w.id,
        novelId: w.novelId,
        title: w.title,
        category: w.category as WorldCategory,
        content: w.content,
        status: w.status === "final" ? "final" : "draft",
        groupId: w.groupId,
        updatedAt: w.updatedAt.toISOString(),
      })
    ),
    worldGroups: novel.worldGroups.map(
      (g): WorldGroupDTO => ({
        id: g.id,
        novelId: g.novelId,
        name: g.name,
        order: g.order,
      })
    ),
    outlineBeats: novel.outlineBeats.map(
      (b): OutlineBeatDTO => ({
        id: b.id,
        novelId: b.novelId,
        index: b.index,
        title: b.title,
        summary: b.summary,
        volumeId: b.volumeId,
        status: b.status === "final" ? "final" : "draft",
        updatedAt: b.updatedAt.toISOString(),
      })
    ),
    volumes: novel.volumes.map(
      (v): VolumeDTO => ({
        id: v.id,
        novelId: v.novelId,
        index: v.index,
        title: v.title,
        synopsis: v.synopsis,
        status: v.status === "final" ? "final" : "draft",
        updatedAt: v.updatedAt.toISOString(),
      })
    ),
    contract: novel.contract?.content ?? null,
    contractStatus: novel.contract?.status === "final" ? "final" : "draft",
    packs: novel.packs.map(
      (p): ChapterPackDTO => ({
        id: p.id,
        novelId: p.novelId,
        kind: p.kind as ChapterPackDTO["kind"],
        chapterIndex: p.chapterIndex,
        title: p.title,
        content: p.content,
        updatedAt: p.updatedAt.toISOString(),
      })
    ),
    digests: novel.digests.map(
      (d): DigestDTO => ({
        chapterId: d.chapterId,
        chapterIndex: chapterIndexById.get(d.chapterId) ?? 0,
        summary: d.summary,
        updatedAt: d.updatedAt.toISOString(),
      })
    ),
    versions: versions.map(
      (v): ChapterVersionSummaryDTO => ({
        id: v.id,
        chapterId: v.chapterId,
        draftNo: v.draftNo,
        wordCount: v.wordCount,
        createdBy: v.createdBy,
        createdAt: v.createdAt.toISOString(),
      })
    ),
    ledger,
  };
  return Response.json(detail);
}

// PATCH /api/novels/[id] — update novel metadata
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateNovelSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.novel.findUnique({ where: { id } });
  if (!existing) return jsonError("Novel not found", 404);

  const { contract, contractStatus, contractReopen, ...novelData } = schema.data;

  // Phase 9 — the story contract (作品契约) obeys the canon gate: a final
  // contract is Immutable Canon; content changes require contractReopen
  // (the previous final text is archived into AssetVersion first).
  if (contract !== undefined || contractStatus !== undefined || contractReopen !== undefined) {
    const existingContract = await db.novelContract.findUnique({ where: { novelId: id } });
    const locked = existingContract?.status === "final";

    if (locked && !contractReopen) {
      return jsonError(
        "Book contract is locked (Immutable Canon) and cannot be edited directly. Unlock (reopen) first — the original is archived automatically.",
        409
      );
    }

    if (locked && contractReopen && existingContract) {
      await db.assetVersion.create({
        data: {
          novelId: id,
          assetType: "contract",
          assetId: existingContract.novelId,
          assetLabel: "作品契约",
          reason: "reopen",
          snapshot: `[content] ${existingContract.content}\n[status] final`,
          createdBy: "author",
        },
      });
    } else if (!locked && contractStatus === "final" && existingContract) {
      await db.assetVersion.create({
        data: {
          novelId: id,
          assetType: "contract",
          assetId: existingContract.novelId,
          assetLabel: "作品契约",
          reason: "finalize",
          snapshot: `[content] ${existingContract.content}\n[status] ${existingContract.status}`,
          createdBy: "author",
        },
      });
    }

    const nextStatus = locked && contractReopen
      ? "draft"
      : (contractStatus ?? existingContract?.status ?? "draft");
    const nextFinalizedAt = nextStatus === "final" ? new Date() : null;

    await db.novelContract.upsert({
      where: { novelId: id },
      create: {
        novelId: id,
        content: contract ?? "",
        status: nextStatus,
        finalizedAt: nextFinalizedAt,
      },
      update: {
        ...(contract !== undefined ? { content: contract } : {}),
        status: nextStatus,
        finalizedAt: nextFinalizedAt,
      },
    });
  }

  const novel = await db.novel.update({
    where: { id },
    data: novelData,
    include: { chapters: { select: { wordCount: true } } },
  });
  return Response.json({ novel: { ...toSummary(novel), conceptSnapshot: novel.conceptSnapshot } });
}

// DELETE /api/novels/[id] — delete novel and (cascade) all its content
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.novel.findUnique({ where: { id } });
  if (!existing) return jsonError("Novel not found", 404);

  await db.novel.delete({ where: { id } });
  return Response.json({ ok: true });
}
