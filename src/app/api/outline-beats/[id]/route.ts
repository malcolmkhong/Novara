import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { outlineBeatUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/outline-beats/[id]
// Final lock (STEP 79): a final beat is immutable canon — the patch is
// refused with HTTP 409 and the typed body
// { error: "asset_finalized", kind, id, reopen } unless `reopen: true`
// demotes it to draft through the lifecycle service (which archives the
// final state into AssetVersion).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = outlineBeatUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.outlineBeat.findUnique({ where: { id } });
  if (!existing) return jsonError("Outline beat not found", 404);

  const { reopen, status, ...data } = schema.data;
  const wantsReopen = reopen === true;
  const wantsFinal = status === "final";

  // ---- Final lock: a final beat is immutable canon ----
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "outline_beat",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  // Volume grouping (Phase 7 P1): validate the volume belongs to THIS novel.
  let volumeId: string | null | undefined;
  if (schema.data.volumeId !== undefined) {
    if (schema.data.volumeId === null) {
      volumeId = null; // explicit unsort
    } else {
      const volume = await db.volume.findUnique({
        where: { id: schema.data.volumeId },
        select: { id: true, novelId: true },
      });
      if (!volume || volume.novelId !== existing.novelId) {
        return jsonError("Volume does not belong to this novel", 400);
      }
      volumeId = volume.id;
    }
  }

  // ---- Reopen: demote to draft through the lifecycle service ----
  // It runs BEFORE the patch touches the row, so a final asset is never
  // mutated; the service archives the final state and writes the transition.
  let canonMoved = false;
  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "outline_beat",
      assetId: existing.id,
      novelId: existing.novelId,
      move: "reopen",
      byUid: callerUid(req) ?? "",
      source: "author",
    });
    if (!reopened.ok) {
      return Response.json(reopened.body, { status: reopened.status });
    }
    canonMoved = true;
  }

  // The canon flag belongs to the lifecycle service: a reopen writes "draft",
  // a finalize writes "final". The update never writes the status itself.
  let beat = await db.outlineBeat.update({
    where: { id },
    data: {
      ...data,
      ...(volumeId !== undefined ? { volumeId } : {}),
    },
  });

  // ---- Finalize: lock the beat through the lifecycle service ----
  // The service archives the pre-final state, writes the AssetTransition row
  // and retires the facts that name the beat. It runs after the patch so the
  // asset is never mutated while it is final.
  if (wantsFinal && !canonMoved) {
    const finalized = await moveAsset({
      kind: "outline_beat",
      assetId: existing.id,
      novelId: existing.novelId,
      move: "finalize",
      byUid: callerUid(req) ?? "",
      source: "author",
    });
    if (!finalized.ok) {
      return Response.json(finalized.body, { status: finalized.status });
    }
    // The service flipped the canon flag — re-read so the response carries
    // the locked state.
    const locked = await db.outlineBeat.findUnique({ where: { id } });
    if (locked) beat = locked;
  }

  return Response.json({ beat });
}

// DELETE /api/outline-beats/[id] — delete and close the index gap. A final
// beat is immutable canon: the delete is refused with the typed body unless
// ?reopen=1 is explicit (archive and demote run first).
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.outlineBeat.findUnique({ where: { id } });
  if (!existing) return jsonError("Outline beat not found", 404);

  const wantsReopen = new URL(req.url).searchParams.get("reopen") === "1";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "outline_beat",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "outline_beat",
      assetId: existing.id,
      novelId: existing.novelId,
      move: "reopen",
      byUid: callerUid(req) ?? "",
      source: "author",
    });
    if (!reopened.ok) {
      return Response.json(reopened.body, { status: reopened.status });
    }
  }

  await db.$transaction([
    db.outlineBeat.delete({ where: { id } }),
    db.outlineBeat.updateMany({
      where: { novelId: existing.novelId, index: { gt: existing.index } },
      data: { index: { decrement: 1 } },
    }),
  ]);

  return Response.json({ ok: true });
}
