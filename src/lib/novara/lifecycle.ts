// ---------------------------------------------------------------------------
// Novara AI — the DRAFT/FINAL LIFECYCLE (STEP 79).
//
// ONE RULE, enforced at the route layer:
//
//   A document is editable if and only if its subject is a Draft.
//
// A final asset is Immutable Canon. Every update and every delete of a final
// asset is refused with 409 and a TYPED body, so a curl call fails exactly
// like the UI does:
//
//   { error: "asset_finalized", kind: "character", id: "…", reopen: "…" }
//
// The two moves that change a canon state:
//
//   reopen   → the final state is archived into AssetVersion, the row goes
//              back to draft, and ONE AssetTransition row records the move.
//              NOTHING in the memory layer changes: a reopen is not a settle.
//   finalize → the pre-final state is archived, the row is locked, ONE
//              AssetTransition row records the move, and the memory follows:
//              a chapter projects digest/facts/states/plants in the SAME
//              transaction as the status flip, a canon asset retires the
//              facts that NAME it (the STEP 72 supersede machinery).
//
// Both moves are idempotent: a move that would not change the state writes
// nothing and reports changed: false.
//
// The service is the ONE implementation of the rule. The routes call it; the
// agent runtime calls it; the agent tools call it.
// ---------------------------------------------------------------------------

import { db, warmIdentity } from "@/lib/db";
import {
  archiveAssetVersion,
  buildAssetSnapshot,
  type AssetType,
} from "@/lib/novara/asset-gate";
import { evaluateFinalize, evaluateSettle } from "@/lib/novara/qc";
import {
  extractSediment,
  retireSuperseded,
  writeSedimentProjection,
  type SedimentOutcome,
  type SedimentTx,
} from "@/lib/novara/sediment";

/** Every authored entity the lifecycle covers. */
export type LifecycleKind =
  | "chapter"
  | "contract"
  | "character"
  | "world_entry"
  | "outline_beat"
  | "volume"
  | "pack"
  | "storyline"
  | "timeline"
  | "arc"
  | "promise"
  | "clue";

/** The kinds that live under /api/ledger/<kind>/<id> (their URL family
 *  differs from the novel-scoped kinds). */
export const LEDGER_KINDS = [
  "storyline",
  "timeline",
  "arc",
  "promise",
  "clue",
] as const;

export function isLifecycleKind(value: string): value is LifecycleKind {
  return (
    value === "chapter" ||
    value === "contract" ||
    value === "character" ||
    value === "world_entry" ||
    value === "outline_beat" ||
    value === "volume" ||
    value === "pack" ||
    (LEDGER_KINDS as readonly string[]).includes(value)
  );
}

interface KindSpec {
  /** The AssetVersion type of the archived snapshot (null = the chapter, whose
   *  history lives in ChapterVersion, not AssetVersion). */
  assetType: AssetType | null;
  /** The row field that carries the canon flag: `status` for most assets,
   *  `lock` for the ledger rows whose `status` is a lifecycle state. */
  lockField: "status" | "lock";
  /** The memory categories a finalize of this kind retires facts in. */
  factCategories: string[];
}

/**
 * The canon layer of every authored entity.
 *
 * The memory categories are the ones that can carry a SUBJECT (the model's own
 * name for the thing the fact is about) — the STEP 72 supersede machinery
 * matches on (category, subject), so a fact is only retired when BOTH match.
 */
const KIND_SPECS: Record<LifecycleKind, KindSpec> = {
  // A chapter's memory is re-derived by the settle, never retired by subject.
  chapter: { assetType: null, lockField: "status", factCategories: [] },
  // The contract names no subject — a style fact names the style, not the book.
  contract: { assetType: "contract", lockField: "status", factCategories: ["style"] },
  character: {
    assetType: "character",
    lockField: "status",
    factCategories: ["character_state", "story_fact", "relationship"],
  },
  world_entry: {
    assetType: "world_entry",
    lockField: "status",
    factCategories: ["world_rule", "story_fact"],
  },
  outline_beat: { assetType: "outline_beat", lockField: "status", factCategories: ["story_fact"] },
  volume: { assetType: "volume", lockField: "status", factCategories: ["story_fact"] },
  pack: { assetType: "pack", lockField: "status", factCategories: ["inspiration"] },
  storyline: { assetType: "storyline", lockField: "lock", factCategories: ["story_fact", "open_loop"] },
  timeline: { assetType: "timeline_entry", lockField: "status", factCategories: ["story_fact"] },
  arc: { assetType: "character_arc", lockField: "status", factCategories: ["relationship", "story_fact"] },
  // An open loop fact carries the promise/clue ID as its subject.
  promise: { assetType: "story_promise", lockField: "lock", factCategories: ["open_loop", "story_fact"] },
  clue: { assetType: "story_clue", lockField: "lock", factCategories: ["open_loop", "story_fact"] },
};

/** The typed body every route answers with when a final asset is mutated. */
export interface FinalizedRefusal {
  error: "asset_finalized";
  kind: string;
  id: string;
  reopen: string;
}

/** The URL that reopens an asset (the client follows it). */
export function reopenUrl(kind: string, novelId: string, id: string): string {
  if ((LEDGER_KINDS as readonly string[]).includes(kind)) {
    return `/api/ledger/${kind}/${id}/reopen`;
  }
  return `/api/novels/${novelId}/${kind}/${id}/reopen`;
}

/**
 * The route layer's answer to a mutation of a final asset.
 *
 * Returns null when the asset is editable (draft) — the caller proceeds.
 */
export function finalizedRefusal(input: {
  kind: string;
  id: string;
  novelId: string;
  status: string | null | undefined;
}): FinalizedRefusal | null {
  if (input.status !== "final") return null;
  return {
    error: "asset_finalized",
    kind: input.kind,
    id: input.id,
    reopen: reopenUrl(input.kind, input.novelId, input.id),
  };
}

/** The canonical row as the lifecycle sees it. */
interface CanonRow {
  novelId: string;
  /** The asset id (the contract's id IS the novel id). */
  id: string;
  /** The human label used in the archive and in the chat line. */
  label: string;
  /** The canon flag: "draft" | "final". */
  status: string;
  /** The subject a finalize retires facts by (null = the asset names none). */
  subject: string | null;
  /** The fields archived verbatim into AssetVersion. */
  fields: Record<string, string | number | null | undefined>;
}

/**
 * Load one authored row.
 *
 * The read goes through the ownership extension, so an asset of a novel the
 * caller does not own is simply NOT FOUND (404, never 403).
 */
async function loadRow(kind: LifecycleKind, id: string): Promise<CanonRow | null> {
  switch (kind) {
    case "chapter": {
      const row = await db.chapter.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: `Chapter ${row.index} "${row.title}"`,
        status: row.status,
        subject: null,
        fields: {
          index: row.index,
          title: row.title,
          wordCount: row.wordCount,
          status: row.status,
        },
      };
    }
    case "contract": {
      const row = await db.novelContract.findUnique({ where: { novelId: id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.novelId,
        label: "Book contract",
        status: row.status,
        subject: null,
        fields: { status: row.status, content: row.content },
      };
    }
    case "character": {
      const row = await db.character.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.name,
        status: row.status,
        subject: row.name,
        fields: {
          name: row.name,
          role: row.role,
          description: row.description,
          aliases: row.aliases,
          status: row.status,
        },
      };
    }
    case "world_entry": {
      const row = await db.worldEntry.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.title,
        status: row.status,
        subject: row.title,
        fields: {
          title: row.title,
          category: row.category,
          content: row.content,
          status: row.status,
        },
      };
    }
    case "outline_beat": {
      const row = await db.outlineBeat.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.title,
        status: row.status,
        subject: row.title,
        fields: {
          index: row.index,
          title: row.title,
          summary: row.summary,
          status: row.status,
        },
      };
    }
    case "volume": {
      const row = await db.volume.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.title,
        status: row.status,
        subject: row.title,
        fields: { index: row.index, title: row.title, synopsis: row.synopsis, status: row.status },
      };
    }
    case "pack": {
      const row = await db.chapterPack.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.title,
        status: row.status,
        subject: row.title,
        fields: {
          kind: row.kind,
          chapterIndex: row.chapterIndex,
          title: row.title,
          content: row.content,
          status: row.status,
        },
      };
    }
    case "storyline": {
      const row = await db.storyline.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.name,
        status: row.lock,
        subject: row.name,
        fields: { name: row.name, summary: row.summary, lifecycle: row.status, lock: row.lock },
      };
    }
    case "timeline": {
      const row = await db.timelineEntry.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.label,
        status: row.status,
        subject: row.label,
        fields: { order: row.order, label: row.label, detail: row.detail, status: row.status },
      };
    }
    case "arc": {
      const row = await db.characterArc.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: `${row.characterName} — stage ${row.order}`,
        status: row.status,
        subject: row.characterName,
        fields: {
          characterName: row.characterName,
          order: row.order,
          note: row.note,
          status: row.status,
        },
      };
    }
    case "promise": {
      const row = await db.storyPromise.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.content,
        status: row.lock,
        // An open_loop fact carries the promise id as its subject.
        subject: row.id,
        fields: { content: row.content, lifecycle: row.status, lock: row.lock },
      };
    }
    case "clue": {
      const row = await db.storyClue.findUnique({ where: { id } });
      if (!row) return null;
      return {
        novelId: row.novelId,
        id: row.id,
        label: row.content,
        status: row.lock,
        subject: row.id,
        fields: { content: row.content, lifecycle: row.status, lock: row.lock },
      };
    }
  }
}

/** Write the canon flag of one authored row. */
async function writeCanonStatus(
  tx: SedimentTx,
  kind: LifecycleKind,
  id: string,
  status: "draft" | "final"
): Promise<void> {
  const finalizedAt = status === "final" ? new Date() : null;
  switch (kind) {
    case "chapter":
      await tx.chapter.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "contract":
      await tx.novelContract.update({ where: { novelId: id }, data: { status, finalizedAt } });
      return;
    case "character":
      await tx.character.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "world_entry":
      await tx.worldEntry.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "outline_beat":
      await tx.outlineBeat.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "volume":
      await tx.volume.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "pack":
      await tx.chapterPack.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "storyline":
      await tx.storyline.update({ where: { id }, data: { lock: status, finalizedAt } });
      return;
    case "timeline":
      await tx.timelineEntry.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "arc":
      await tx.characterArc.update({ where: { id }, data: { status, finalizedAt } });
      return;
    case "promise":
      await tx.storyPromise.update({ where: { id }, data: { lock: status, finalizedAt } });
      return;
    case "clue":
      await tx.storyClue.update({ where: { id }, data: { lock: status, finalizedAt } });
      return;
  }
}

/** One row in the transition log. */
async function writeTransition(
  tx: SedimentTx,
  input: {
    novelId: string;
    kind: LifecycleKind;
    assetId: string;
    from: string;
    to: string;
    byUid: string;
    source: string;
    note?: string | null;
  }
): Promise<void> {
  await tx.assetTransition.create({
    data: {
      novelId: input.novelId,
      kind: input.kind,
      assetId: input.assetId,
      from: input.from,
      to: input.to,
      byUid: input.byUid,
      source: input.source,
      at: new Date(),
      note: input.note ?? null,
    },
  });
}

/** The two moves that change a canon state. */
export type LifecycleMove = "reopen" | "finalize";

export interface MoveAssetInput {
  kind: LifecycleKind;
  assetId: string;
  /** The novel of the URL (the ledger routes have none — the row's own). */
  novelId?: string;
  move: LifecycleMove;
  /** Who moved it — the caller's uid. */
  byUid: string;
  /** author | agent:<name> | wizard */
  source: string;
  /** Optional note for the transition row. */
  note?: string;
}

export interface MoveAssetOk {
  ok: true;
  kind: LifecycleKind;
  id: string;
  from: string;
  to: "draft" | "final";
  /** false when the asset was already in the target state (idempotent). */
  changed: boolean;
  /** The facts a canon finalize retired. */
  factsRetired?: number;
  /** The chapter projection outcome (a chapter finalize only). */
  outcome?: SedimentOutcome;
}

export interface MoveAssetFail {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

export type MoveAssetResult = MoveAssetOk | MoveAssetFail;

/**
 * THE MOVE. Reopen or finalize one authored asset.
 *
 * Reopen: archive the final state, go back to draft, log the transition.
 * NOTHING in the memory pool changes — a reopen is not a settle.
 *
 * Finalize: archive the pre-final state, lock the row, log the transition,
 * and let the memory follow (a chapter projects inside the same transaction,
 * a canon asset retires the facts that name it).
 */
export async function moveAsset(input: MoveAssetInput): Promise<MoveAssetResult> {
  const spec = KIND_SPECS[input.kind];
  const row = await loadRow(input.kind, input.assetId);
  if (!row) {
    return {
      ok: false,
      status: 404,
      body: { error: "asset_not_found", kind: input.kind, id: input.assetId },
    };
  }
  // The novel of the URL must be the novel of the row — a mismatch is a
  // request for an asset that does not exist (404, never 403).
  if (input.novelId && row.novelId !== input.novelId) {
    return {
      ok: false,
      status: 404,
      body: { error: "asset_not_found", kind: input.kind, id: input.assetId },
    };
  }
  const target = input.move === "reopen" ? "draft" : "final";
  // Idempotent: the asset is already in the target state — no archive, no
  // transition row, no memory write.
  if (row.status === target) {
    return { ok: true, kind: input.kind, id: row.id, from: row.status, to: target, changed: false };
  }
  if (input.kind === "chapter" && input.move === "finalize") {
    // A chapter finalizes through its own gate (the E2 review gate and the
    // settle precondition) and projects its memory inside the same
    // transaction as the status flip.
    const chapterResult = await finalizeChapter({
      chapterId: row.id,
      byUid: input.byUid,
      source: input.source,
      note: input.note,
    });
    if (!chapterResult.ok) {
      return { ok: false, status: chapterResult.status, body: chapterResult.body };
    }
    return {
      ok: true,
      kind: "chapter",
      id: chapterResult.chapterId,
      from: chapterResult.from,
      to: "final",
      changed: chapterResult.changed,
      outcome: chapterResult.outcome,
    };
  }
  // Resolve the ownership identity BEFORE the interactive transaction
  // (DATABASE_URL carries connection_limit=1 — a base-client query from inside
  // the transaction would have nowhere to run).
  await warmIdentity();
  const createdBy = input.source.startsWith("agent") ? "agent" : "author";
  if (input.move === "reopen") {
    await db.$transaction(async (tx) => {
      if (spec.assetType) {
        await archiveAssetVersion({
          novelId: row.novelId,
          assetType: spec.assetType,
          assetId: row.id,
          assetLabel: row.label,
          reason: "reopen",
          snapshot: buildAssetSnapshot(row.fields),
          createdBy,
          tx,
        });
      }
      await writeCanonStatus(tx, input.kind, row.id, "draft");
      await writeTransition(tx, {
        novelId: row.novelId,
        kind: input.kind,
        assetId: row.id,
        from: row.status,
        to: "draft",
        byUid: input.byUid,
        source: input.source,
        note: input.note ?? null,
      });
    });
    return { ok: true, kind: input.kind, id: row.id, from: row.status, to: "draft", changed: true };
  }
  // Finalize a canon asset: lock it and retire the facts that NAME it.
  const factsRetired = await db.$transaction(async (tx) => {
    if (spec.assetType) {
      await archiveAssetVersion({
        novelId: row.novelId,
        assetType: spec.assetType,
        assetId: row.id,
        assetLabel: row.label,
        reason: "finalize",
        snapshot: buildAssetSnapshot(row.fields),
        createdBy,
        tx,
      });
    }
    await writeCanonStatus(tx, input.kind, row.id, "final");
    let retired = 0;
    if (row.subject) {
      for (const category of spec.factCategories) {
        retired += await retireSuperseded(tx, {
          novelId: row.novelId,
          category,
          subject: row.subject,
        });
      }
    }
    await writeTransition(tx, {
      novelId: row.novelId,
      kind: input.kind,
      assetId: row.id,
      from: row.status,
      to: "final",
      byUid: input.byUid,
      source: input.source,
      note:
        input.note ??
        (row.subject
          ? `retired ${retired} fact(s) naming "${row.subject}"`
          : `no fact names this asset — nothing retired`),
    });
    return retired;
  });
  return {
    ok: true,
    kind: input.kind,
    id: row.id,
    from: row.status,
    to: "final",
    changed: true,
    factsRetired,
  };
}

/** Reopen one authored asset (status → draft). Never touches the memory. */
export async function reopenAsset(input: Omit<MoveAssetInput, "move">): Promise<MoveAssetResult> {
  return moveAsset({ ...input, move: "reopen" });
}

/** Finalize one authored asset (status → final) and let the memory follow. */
export async function finalizeAsset(input: Omit<MoveAssetInput, "move">): Promise<MoveAssetResult> {
  return moveAsset({ ...input, move: "finalize" });
}

export interface FinalizeChapterInput {
  chapterId: string;
  byUid: string;
  source: string;
  note?: string;
}

export interface FinalizeChapterOk {
  ok: true;
  changed: boolean;
  chapterId: string;
  from: string;
  to: "final";
  /** The projection written in the same transaction as the status flip. */
  outcome?: SedimentOutcome;
  /** The blocking count of the review the gate read. */
  blockingCount: number | null;
}

export interface FinalizeChapterFail {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

export type FinalizeChapterResult = FinalizeChapterOk | FinalizeChapterFail;

/**
 * Finalize a chapter: the E2 gate, the settle and the transition, in that
 * order and in ONE transaction for the writes.
 *
 * The model call happens FIRST and OUTSIDE the transaction (a slow AI call
 * must never hold a database connection). The transaction then flips the
 * chapter to final AND writes the whole memory projection — so a chapter can
 * NEVER be final with unprojected memory: any failure rolls the
 * finalization back with it.
 */
export async function finalizeChapter(
  input: FinalizeChapterInput
): Promise<FinalizeChapterResult> {
  const chapter = await db.chapter.findUnique({ where: { id: input.chapterId } });
  if (!chapter) {
    return { ok: false, status: 404, body: { error: "chapter_not_found", id: input.chapterId } };
  }
  // Idempotent: the chapter is already final — the commit landed before the
  // interruption. Adopt, don't re-commit.
  if (chapter.status === "final") {
    return {
      ok: true,
      changed: false,
      chapterId: chapter.id,
      from: "final",
      to: "final",
      blockingCount: null,
    };
  }
  // The gate reads the LATEST PERSISTED review, never the model's claim.
  const latest = await db.chapterReview.findFirst({
    where: { chapterId: chapter.id },
    orderBy: { createdAt: "desc" },
  });
  const blockingCount = latest ? latest.blockingCount : null;
  const finalizeVerdict = evaluateFinalize({
    latestBlockingCount: blockingCount,
    wordCount: chapter.wordCount,
  });
  if (!finalizeVerdict.allowed) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "finalize_blocked",
        code: finalizeVerdict.code,
        reason: finalizeVerdict.reason,
      },
    };
  }
  // The settle precondition (qc.ts evaluateSettle): a persisted review with 0
  // blocking and a non-empty chapter. The projection is a CONSEQUENCE of the
  // finalization, so the same gate guards both.
  const settleVerdict = evaluateSettle({
    latestBlockingCount: blockingCount,
    wordCount: chapter.wordCount,
  });
  if (!settleVerdict.allowed) {
    return {
      ok: false,
      status: 409,
      body: { error: "settle_blocked", code: settleVerdict.code, reason: settleVerdict.reason },
    };
  }
  let records: Awaited<ReturnType<typeof extractSediment>>;
  try {
    records = await extractSediment(chapter.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "the memory step failed";
    return { ok: false, status: 502, body: { error: "settle_failed", reason: message } };
  }
  await warmIdentity();
  const outcome = await db.$transaction(async (tx) => {
    await tx.chapter.update({
      where: { id: chapter.id },
      data: { status: "final", finalizedAt: new Date() },
    });
    const result = await writeSedimentProjection(tx, records);
    await writeTransition(tx, {
      novelId: chapter.novelId,
      kind: "chapter",
      assetId: chapter.id,
      from: chapter.status,
      to: "final",
      byUid: input.byUid,
      source: input.source,
      note:
        input.note ??
        `projected ${result.factsCreated} fact(s), ${result.characterStates} state(s), ${result.plantsCreated} plant(s)`,
    });
    return result;
  });
  return {
    ok: true,
    changed: true,
    chapterId: chapter.id,
    from: chapter.status,
    to: "final",
    outcome,
    blockingCount,
  };
}
