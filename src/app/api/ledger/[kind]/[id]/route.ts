import { db } from "@/lib/db";
import { ledgerUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import {
  assetDeleteGate,
  assetGate,
  canonDowngrade,
  canonLock,
  type AssetLockField,
  type AssetType,
} from "@/lib/novara/asset-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; kind: string }> };

const KINDS = new Set(["storyline", "timeline", "arc", "promise", "clue"]);

// Per-kind gate metadata: which table row is the asset, which field carries
// the canon lock, and which fields make up the verbatim snapshot.
const GATE_META = {
  storyline: { assetType: "storyline" as AssetType, lockField: "lock" as AssetLockField },
  timeline: { assetType: "timeline_entry" as AssetType, lockField: "status" as AssetLockField },
  arc: { assetType: "character_arc" as AssetType, lockField: "status" as AssetLockField },
  promise: { assetType: "story_promise" as AssetType, lockField: "lock" as AssetLockField },
  clue: { assetType: "story_clue" as AssetType, lockField: "lock" as AssetLockField },
};

type GateKind = keyof typeof GATE_META;

/** Current lock state + snapshot fields for a ledger row of any kind. */
function ledgerLockSnapshot(
  kind: GateKind,
  row: Record<string, unknown>
): { lockState: string; snapshotFields: Record<string, string | number | null | undefined> } {
  const lockState = String(GATE_META[kind].lockField === "lock" ? row.lock : row.status) || "draft";
  const fields: Record<string, string | number | null | undefined> = {};
  for (const key of ["name", "summary", "status", "lock", "label", "detail", "characterName", "note", "content", "chapterIndex", "order", "madeChapter", "dueChapter", "plantChapter", "revealChapter"]) {
    const value = row[key];
    if (value === undefined) continue;
    fields[key] =
      value === null || typeof value === "string" || typeof value === "number"
        ? (value as string | number | null)
        : String(value);
  }
  return { lockState, snapshotFields: fields };
}

// PATCH /api/ledger/[kind]/[id] — update one ledger row.
// timeline/arc rows support moveTo (renumber the sibling sequence server-side).
// Canon gate (Phase 9): a locked row is Immutable Canon — 409 unless
// reopen:true (archives the final state, downgrades to draft).
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
    const { reopen, lock, ...rest } = schema.data.data;
    const { lockState, snapshotFields } = ledgerLockSnapshot("storyline", existing);
    const gate = await assetGate({
      novelId: existing.novelId,
      assetType: GATE_META.storyline.assetType,
      assetId: existing.id,
      assetLabel: existing.name,
      lockState,
      lockField: "lock",
      reopen,
      wantsFinal: lock === "final",
      snapshotFields,
    });
    if (gate instanceof Response) return gate;
    const row = await db.storyline.update({
      where: { id },
      data: {
        ...rest,
        ...(gate.reopened ? canonDowngrade("lock") : {}),
        ...(gate.finalized ? canonLock("lock") : {}),
      },
    });
    return Response.json({ row });
  }

  if (schema.data.kind === "timeline") {
    const existing = await db.timelineEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("Timeline entry not found", 404);
    const { moveTo, reopen, status, ...rest } = schema.data.data;
    const { lockState, snapshotFields } = ledgerLockSnapshot("timeline", existing);
    const gate = await assetGate({
      novelId: existing.novelId,
      assetType: GATE_META.timeline.assetType,
      assetId: existing.id,
      assetLabel: existing.label,
      lockState,
      lockField: "status",
      reopen,
      wantsFinal: status === "final",
      snapshotFields,
    });
    if (gate instanceof Response) return gate;
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
        ...rest,
        ...(gate.reopened ? canonDowngrade("status") : {}),
        ...(gate.finalized ? canonLock("status") : {}),
      },
    });
    return Response.json({ row });
  }

  // schema.data.kind === "arc"
  if (schema.data.kind === "arc") {
    const existing = await db.characterArc.findUnique({ where: { id } });
    if (!existing) return jsonError("Character arc not found", 404);
    const { moveTo, reopen, status, ...rest } = schema.data.data;
    const { lockState, snapshotFields } = ledgerLockSnapshot("arc", existing);
    const gate = await assetGate({
      novelId: existing.novelId,
      assetType: GATE_META.arc.assetType,
      assetId: existing.id,
      assetLabel: `${existing.characterName} · ${existing.order}`,
      lockState,
      lockField: "status",
      reopen,
      wantsFinal: status === "final",
      snapshotFields,
    });
    if (gate instanceof Response) return gate;
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
        ...rest,
        ...(gate.reopened ? canonDowngrade("status") : {}),
        ...(gate.finalized ? canonLock("status") : {}),
      },
    });
    return Response.json({ row });
  }

  // Phase 8 — promise rows are flat updates (no ordering). Status moves are
  // plain writes: the ledger is plan-level truth curated by author and agent.
  if (schema.data.kind === "promise") {
    const existing = await db.storyPromise.findUnique({ where: { id } });
    if (!existing) return jsonError("Promise not found", 404);
    const { reopen, lock, ...rest } = schema.data.data;
    const { lockState, snapshotFields } = ledgerLockSnapshot("promise", existing);
    const gate = await assetGate({
      novelId: existing.novelId,
      assetType: GATE_META.promise.assetType,
      assetId: existing.id,
      assetLabel: existing.content.slice(0, 40),
      lockState,
      lockField: "lock",
      reopen,
      wantsFinal: lock === "final",
      snapshotFields,
    });
    if (gate instanceof Response) return gate;
    const row = await db.storyPromise.update({
      where: { id },
      data: {
        ...rest,
        ...(gate.reopened ? canonDowngrade("lock") : {}),
        ...(gate.finalized ? canonLock("lock") : {}),
      },
    });
    return Response.json({ row });
  }

  // schema.data.kind === "clue"
  const existingClue = await db.storyClue.findUnique({ where: { id } });
  if (!existingClue) return jsonError("Clue not found", 404);
  const { reopen, lock, ...clueRest } = schema.data.data;
  const { lockState, snapshotFields } = ledgerLockSnapshot("clue", existingClue);
  const gate = await assetGate({
    novelId: existingClue.novelId,
    assetType: GATE_META.clue.assetType,
    assetId: existingClue.id,
    assetLabel: existingClue.content.slice(0, 40),
    lockState,
    lockField: "lock",
    reopen,
    wantsFinal: lock === "final",
    snapshotFields,
  });
  if (gate instanceof Response) return gate;
  const clueRow = await db.storyClue.update({
    where: { id },
    data: {
      ...clueRest,
      ...(gate.reopened ? canonDowngrade("lock") : {}),
      ...(gate.finalized ? canonLock("lock") : {}),
    },
  });
  return Response.json({ row: clueRow });
}

// DELETE /api/ledger/[kind]/[id] — remove one ledger row and close the gap.
// Locked rows refuse deletion unless ?reopen=1 is explicit (archive first).
export async function DELETE(req: Request, { params }: Params) {
  const { id, kind } = await params;
  if (!KINDS.has(kind)) return jsonError(`Unknown ledger kind: ${kind}`, 404);
  const reopen = new URL(req.url).searchParams.get("reopen") === "1";

  if (kind === "storyline") {
    const existing = await db.storyline.findUnique({ where: { id } });
    if (!existing) return jsonError("Storyline not found", 404);
    const { lockState, snapshotFields } = ledgerLockSnapshot("storyline", existing);
    const gateError = await assetDeleteGate({
      novelId: existing.novelId,
      assetType: GATE_META.storyline.assetType,
      assetId: existing.id,
      assetLabel: existing.name,
      lockState,
      snapshotFields,
      reopen,
    });
    if (gateError) return gateError;
    await db.storyline.delete({ where: { id } });
    return Response.json({ ok: true });
  }

  if (kind === "timeline") {
    const existing = await db.timelineEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("Timeline entry not found", 404);
    const { lockState, snapshotFields } = ledgerLockSnapshot("timeline", existing);
    const gateError = await assetDeleteGate({
      novelId: existing.novelId,
      assetType: GATE_META.timeline.assetType,
      assetId: existing.id,
      assetLabel: existing.label,
      lockState,
      snapshotFields,
      reopen,
    });
    if (gateError) return gateError;
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
    const { lockState, snapshotFields } = ledgerLockSnapshot("arc", existing);
    const gateError = await assetDeleteGate({
      novelId: existing.novelId,
      assetType: GATE_META.arc.assetType,
      assetId: existing.id,
      assetLabel: `${existing.characterName} · ${existing.order}`,
      lockState,
      snapshotFields,
      reopen,
    });
    if (gateError) return gateError;
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
    const { lockState, snapshotFields } = ledgerLockSnapshot("promise", existing);
    const gateError = await assetDeleteGate({
      novelId: existing.novelId,
      assetType: GATE_META.promise.assetType,
      assetId: existing.id,
      assetLabel: existing.content.slice(0, 40),
      lockState,
      snapshotFields,
      reopen,
    });
    if (gateError) return gateError;
    await db.storyPromise.delete({ where: { id } });
    return Response.json({ ok: true });
  }

  // kind === "clue"
  const existingClue = await db.storyClue.findUnique({ where: { id } });
  if (!existingClue) return jsonError("Clue not found", 404);
  const { lockState, snapshotFields } = ledgerLockSnapshot("clue", existingClue);
  const gateError = await assetDeleteGate({
    novelId: existingClue.novelId,
    assetType: GATE_META.clue.assetType,
    assetId: existingClue.id,
    assetLabel: existingClue.content.slice(0, 40),
    lockState,
    snapshotFields,
    reopen,
  });
  if (gateError) return gateError;
  await db.storyClue.delete({ where: { id } });
  return Response.json({ ok: true });
}
