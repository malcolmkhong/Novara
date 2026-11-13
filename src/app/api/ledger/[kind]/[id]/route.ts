import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { ledgerUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; kind: string }> };

const KINDS = new Set(["storyline", "timeline", "arc", "promise", "clue"]);

// Per-kind gate metadata: which column carries the canon lock. The lock
// rides the `lock` column for storyline/promise/clue (their own `status` is
// the lifecycle state) and the `status` column for timeline/arc.
const GATE_META = {
  storyline: { lockField: "lock" },
  timeline: { lockField: "status" },
  arc: { lockField: "status" },
  promise: { lockField: "lock" },
  clue: { lockField: "lock" },
} as const;

type GateKind = keyof typeof GATE_META;

/** The canon lock of a ledger row: "draft" or "final". */
function ledgerLockState(kind: GateKind, row: Record<string, unknown>): string {
  const field = GATE_META[kind].lockField;
  return String(row[field] ?? "") || "draft";
}

/**
 * STEP 79 — the final lock for one ledger row.
 *
 * A final row refuses every mutation with the typed body
 * { error: "asset_finalized", kind, id, reopen } (HTTP 409). The explicit
 * reopen is the one way through it: the lifecycle service archives the final
 * state into AssetVersion, demotes the row to draft and writes the
 * AssetTransition row.
 *
 * Returns the response to send, or null when the row may be mutated.
 */
async function ledgerGuard(
  kind: GateKind,
  row: { id: string; novelId: string },
  lockState: string,
  wantsReopen: boolean,
  req: Request
): Promise<Response | null> {
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind,
      id: row.id,
      novelId: row.novelId,
      status: lockState,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
    return null;
  }
  if (lockState !== "final") return null;
  const reopened = await moveAsset({
    kind,
    assetId: row.id,
    novelId: row.novelId,
    move: "reopen",
    byUid: callerUid(req) ?? "",
    source: "author",
  });
  if (!reopened.ok) return Response.json(reopened.body, { status: reopened.status });
  return null;
}

/**
 * Lock a ledger row through the lifecycle service: it archives the pre-final
 * state, writes the AssetTransition row and retires the facts that name the
 * row. Returns the response to send, or null on success.
 */
async function ledgerFinalize(
  kind: GateKind,
  id: string,
  novelId: string,
  req: Request
): Promise<Response | null> {
  const finalized = await moveAsset({
    kind,
    assetId: id,
    novelId,
    move: "finalize",
    byUid: callerUid(req) ?? "",
    source: "author",
  });
  if (!finalized.ok) return Response.json(finalized.body, { status: finalized.status });
  return null;
}

// PATCH /api/ledger/[kind]/[id] — update one ledger row.
// timeline/arc rows support moveTo (renumber the sibling sequence server-side).
// Final lock (STEP 79): a locked row is immutable canon — the patch is refused
// with HTTP 409 and the typed body
// { error: "asset_finalized", kind, id, reopen } unless `reopen: true`, which
// demotes the row to draft through the lifecycle service (which archives the
// final state into AssetVersion).
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
    const wantsReopen = reopen === true;
    const wantsFinal = lock === "final";
    const lockState = ledgerLockState("storyline", existing);
    // A reopened row is never re-finalized in the same request.
    const canonMoved = lockState === "final" && wantsReopen;

    const guardError = await ledgerGuard("storyline", existing, lockState, wantsReopen, req);
    if (guardError) return guardError;

    // The canon lock belongs to the lifecycle service: the update never
    // writes the lock column itself.
    let row = await db.storyline.update({
      where: { id },
      data: {
        ...rest,
      },
    });

    if (wantsFinal && !canonMoved) {
      const finalizeError = await ledgerFinalize(
        "storyline",
        existing.id,
        existing.novelId,
        req
      );
      if (finalizeError) return finalizeError;
      // The service locked the row — re-read so the response carries the
      // locked state.
      const locked = await db.storyline.findUnique({ where: { id } });
      if (locked) row = locked;
    }

    return Response.json({ row });
  }

  if (schema.data.kind === "timeline") {
    const existing = await db.timelineEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("Timeline entry not found", 404);
    const { moveTo, reopen, status, ...rest } = schema.data.data;
    const wantsReopen = reopen === true;
    const wantsFinal = status === "final";
    const lockState = ledgerLockState("timeline", existing);
    const canonMoved = lockState === "final" && wantsReopen;

    const guardError = await ledgerGuard("timeline", existing, lockState, wantsReopen, req);
    if (guardError) return guardError;

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

    // The canon lock belongs to the lifecycle service: the update never
    // writes the lock column itself.
    let row = await db.timelineEntry.update({
      where: { id },
      data: {
        ...rest,
      },
    });

    if (wantsFinal && !canonMoved) {
      const finalizeError = await ledgerFinalize(
        "timeline",
        existing.id,
        existing.novelId,
        req
      );
      if (finalizeError) return finalizeError;
      // The service locked the row — re-read so the response carries the
      // locked state.
      const locked = await db.timelineEntry.findUnique({ where: { id } });
      if (locked) row = locked;
    }

    return Response.json({ row });
  }

  // schema.data.kind === "arc"
  if (schema.data.kind === "arc") {
    const existing = await db.characterArc.findUnique({ where: { id } });
    if (!existing) return jsonError("Character arc not found", 404);
    const { moveTo, reopen, status, ...rest } = schema.data.data;
    const wantsReopen = reopen === true;
    const wantsFinal = status === "final";
    const lockState = ledgerLockState("arc", existing);
    const canonMoved = lockState === "final" && wantsReopen;

    const guardError = await ledgerGuard("arc", existing, lockState, wantsReopen, req);
    if (guardError) return guardError;

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

    // The canon lock belongs to the lifecycle service: the update never
    // writes the lock column itself.
    let row = await db.characterArc.update({
      where: { id },
      data: {
        ...rest,
      },
    });

    if (wantsFinal && !canonMoved) {
      const finalizeError = await ledgerFinalize("arc", existing.id, existing.novelId, req);
      if (finalizeError) return finalizeError;
      // The service locked the row — re-read so the response carries the
      // locked state.
      const locked = await db.characterArc.findUnique({ where: { id } });
      if (locked) row = locked;
    }

    return Response.json({ row });
  }

  // Phase 8 — promise rows are flat updates (no ordering). Status moves are
  // plain writes: the ledger is plan-level truth curated by author and agent.
  if (schema.data.kind === "promise") {
    const existing = await db.storyPromise.findUnique({ where: { id } });
    if (!existing) return jsonError("Promise not found", 404);
    const { reopen, lock, ...rest } = schema.data.data;
    const wantsReopen = reopen === true;
    const wantsFinal = lock === "final";
    const lockState = ledgerLockState("promise", existing);
    const canonMoved = lockState === "final" && wantsReopen;

    const guardError = await ledgerGuard("promise", existing, lockState, wantsReopen, req);
    if (guardError) return guardError;

    // The canon lock belongs to the lifecycle service: the update never
    // writes the lock column itself.
    let row = await db.storyPromise.update({
      where: { id },
      data: {
        ...rest,
      },
    });

    if (wantsFinal && !canonMoved) {
      const finalizeError = await ledgerFinalize(
        "promise",
        existing.id,
        existing.novelId,
        req
      );
      if (finalizeError) return finalizeError;
      // The service locked the row — re-read so the response carries the
      // locked state.
      const locked = await db.storyPromise.findUnique({ where: { id } });
      if (locked) row = locked;
    }

    return Response.json({ row });
  }

  // schema.data.kind === "clue"
  const existingClue = await db.storyClue.findUnique({ where: { id } });
  if (!existingClue) return jsonError("Clue not found", 404);
  const { reopen, lock, ...clueRest } = schema.data.data;
  const wantsReopen = reopen === true;
  const wantsFinal = lock === "final";
  const lockState = ledgerLockState("clue", existingClue);
  const canonMoved = lockState === "final" && wantsReopen;

  const guardError = await ledgerGuard("clue", existingClue, lockState, wantsReopen, req);
  if (guardError) return guardError;

  // The canon lock belongs to the lifecycle service: the update never writes
  // the lock column itself.
  let clueRow = await db.storyClue.update({
    where: { id },
    data: {
      ...clueRest,
    },
  });

  if (wantsFinal && !canonMoved) {
    const finalizeError = await ledgerFinalize(
      "clue",
      existingClue.id,
      existingClue.novelId,
      req
    );
    if (finalizeError) return finalizeError;
    // The service locked the row — re-read so the response carries the
    // locked state.
    const locked = await db.storyClue.findUnique({ where: { id } });
    if (locked) clueRow = locked;
  }

  return Response.json({ row: clueRow });
}

// DELETE /api/ledger/[kind]/[id] — remove one ledger row and close the gap.
// A locked row is immutable canon: the delete is refused with the typed body
// unless ?reopen=1 is explicit (the archive and the demote run first).
export async function DELETE(req: Request, { params }: Params) {
  const { id, kind } = await params;
  if (!KINDS.has(kind)) return jsonError(`Unknown ledger kind: ${kind}`, 404);
  const reopen = new URL(req.url).searchParams.get("reopen") === "1";

  if (kind === "storyline") {
    const existing = await db.storyline.findUnique({ where: { id } });
    if (!existing) return jsonError("Storyline not found", 404);
    const guardError = await ledgerGuard(
      "storyline",
      existing,
      ledgerLockState("storyline", existing),
      reopen,
      req
    );
    if (guardError) return guardError;
    await db.storyline.delete({ where: { id } });
    return Response.json({ ok: true });
  }

  if (kind === "timeline") {
    const existing = await db.timelineEntry.findUnique({ where: { id } });
    if (!existing) return jsonError("Timeline entry not found", 404);
    const guardError = await ledgerGuard(
      "timeline",
      existing,
      ledgerLockState("timeline", existing),
      reopen,
      req
    );
    if (guardError) return guardError;
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
    const guardError = await ledgerGuard(
      "arc",
      existing,
      ledgerLockState("arc", existing),
      reopen,
      req
    );
    if (guardError) return guardError;
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
    const guardError = await ledgerGuard(
      "promise",
      existing,
      ledgerLockState("promise", existing),
      reopen,
      req
    );
    if (guardError) return guardError;
    await db.storyPromise.delete({ where: { id } });
    return Response.json({ ok: true });
  }

  // kind === "clue"
  const existingClue = await db.storyClue.findUnique({ where: { id } });
  if (!existingClue) return jsonError("Clue not found", 404);
  const guardError = await ledgerGuard(
    "clue",
    existingClue,
    ledgerLockState("clue", existingClue),
    reopen,
    req
  );
  if (guardError) return guardError;
  await db.storyClue.delete({ where: { id } });
  return Response.json({ ok: true });
}
