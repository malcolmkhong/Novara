import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { updateNovelSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";
import { toSummary } from "@/lib/novara/summary";
import type {
  ChapterDTO,
  ChapterPackDTO,
  ChapterReviewSummaryDTO,
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

  // STEP 76 — the latest review verdict per chapter. The E2 gate reads the
  // SAME rows (lib/novara/qc.ts evaluateFinalize), so the review document in
  // the tree can never disagree with the gate.
  const reviewRows = await db.chapterReview.findMany({
    where: { novelId: id },
    orderBy: { createdAt: "desc" },
    select: {
      chapterId: true,
      issueCount: true,
      blockingCount: true,
      createdAt: true,
    },
  });
  const latestReviewByChapter = new Map<string, (typeof reviewRows)[number]>();
  for (const row of reviewRows) {
    if (!latestReviewByChapter.has(row.chapterId)) {
      latestReviewByChapter.set(row.chapterId, row);
    }
  }
  const reviews: ChapterReviewSummaryDTO[] = [...latestReviewByChapter.values()].map(
    (row): ChapterReviewSummaryDTO => ({
      chapterId: row.chapterId,
      issueCount: row.issueCount,
      blockingCount: row.blockingCount,
      reviewedAt: row.createdAt.toISOString(),
    })
  );

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
    reviews,
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

  // The story contract obeys the canon lock: a final contract is immutable
  // canon. Any change to it is refused with HTTP 409 and the typed body
  // { error: "asset_finalized", kind: "contract", id, reopen }. The explicit
  // `contractReopen` demotes it to draft through the lifecycle service,
  // which archives the final text into AssetVersion and writes the
  // AssetTransition row before the content is touched.
  if (contract !== undefined || contractStatus !== undefined || contractReopen !== undefined) {
    const existingContract = await db.novelContract.findUnique({ where: { novelId: id } });
    // The contract is 1:1 with the novel, so its asset id IS the novel id.
    const lockState = existingContract?.status ?? "draft";
    const wantsReopen = contractReopen === true;
    const wantsFinal = contractStatus === "final";

    if (!wantsReopen) {
      const refusal = finalizedRefusal({
        kind: "contract",
        id,
        novelId: id,
        status: lockState,
      });
      if (refusal) return Response.json(refusal, { status: 409 });
    }

    // Reopen first: the final text is archived and the contract demoted to
    // draft before any write touches it.
    let canonMoved = false;
    if (lockState === "final" && wantsReopen) {
      const reopened = await moveAsset({
        kind: "contract",
        assetId: id,
        novelId: id,
        move: "reopen",
        byUid: callerUid(req) ?? "",
        source: "author",
        note: "the novel contract",
      });
      if (!reopened.ok) return Response.json(reopened.body, { status: reopened.status });
      canonMoved = true;
    }

    // The canon flag belongs to the lifecycle service — the route writes the
    // content only.
    await db.novelContract.upsert({
      where: { novelId: id },
      create: { novelId: id, content: contract ?? "" },
      update: { ...(contract !== undefined ? { content: contract } : {}) },
    });

    // Finalize after the content is stored, so the archive and the canon
    // flag come from one place.
    if (wantsFinal && !canonMoved) {
      const finalized = await moveAsset({
        kind: "contract",
        assetId: id,
        novelId: id,
        move: "finalize",
        byUid: callerUid(req) ?? "",
        source: "author",
        note: "the novel contract",
      });
      if (!finalized.ok) return Response.json(finalized.body, { status: finalized.status });
    }
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
