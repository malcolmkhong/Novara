import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { updateVolumeSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/volumes/[id] — update title/synopsis and/or move position.
// Moving renumbers the whole sibling list (same reorder semantics as
// chapters/beats: no unique constraint errors, order stays dense 1..N).
// Final lock (STEP 79): a final volume plan is immutable canon — the patch is
// refused with HTTP 409 and the typed body
// { error: "asset_finalized", kind, id, reopen } unless `reopen: true`
// demotes it to draft through the lifecycle service (which archives the final
// state into AssetVersion).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateVolumeSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.volume.findUnique({ where: { id } });
  if (!existing) return jsonError("Volume not found", 404);

  const { moveTo, reopen, status, ...data } = schema.data;
  const wantsReopen = reopen === true;
  const wantsFinal = status === "final";

  // ---- Final lock: a final volume is immutable canon ----
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "volume",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  // ---- Reopen: demote to draft through the lifecycle service ----
  // It runs BEFORE the patch touches the row, so a final asset is never
  // mutated; the service archives the final state and writes the transition.
  let canonMoved = false;
  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "volume",
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

  if (moveTo !== undefined && moveTo !== existing.index) {
    const siblings = await db.volume.findMany({
      where: { novelId: existing.novelId },
      orderBy: { index: "asc" },
      select: { id: true },
    });
    const clamped = Math.max(1, Math.min(moveTo, siblings.length));
    const without = siblings.filter((v) => v.id !== id);
    without.splice(clamped - 1, 0, { id });
    await db.$transaction(
      without.map((v, i) =>
        db.volume.update({ where: { id: v.id }, data: { index: i + 1 } })
      )
    );
  }

  // The canon flag belongs to the lifecycle service: a reopen writes "draft",
  // a finalize writes "final". The update never writes the status itself.
  let volume = await db.volume.update({
    where: { id },
    data: { ...data },
  });

  // ---- Finalize: lock the volume through the lifecycle service ----
  // The service archives the pre-final state and writes the AssetTransition
  // row. It runs after the patch so the asset is never mutated while it is
  // final.
  if (wantsFinal && !canonMoved) {
    const finalized = await moveAsset({
      kind: "volume",
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
    const locked = await db.volume.findUnique({ where: { id } });
    if (locked) volume = locked;
  }

  return Response.json({ volume });
}

// DELETE /api/volumes/[id] — delete the volume; its beats become unsorted
// (schema-level onDelete: SetNull) so nothing is ever silently destroyed.
// Siblings after it close the index gap. A final volume is immutable canon:
// the delete is refused with the typed body unless ?reopen=1 is explicit
// (archive and demote run first).
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.volume.findUnique({ where: { id } });
  if (!existing) return jsonError("Volume not found", 404);

  const wantsReopen = new URL(req.url).searchParams.get("reopen") === "1";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "volume",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "volume",
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

  const later = await db.volume.findMany({
    where: { novelId: existing.novelId, index: { gt: existing.index } },
    orderBy: { index: "asc" },
    select: { id: true },
  });

  await db.$transaction([
    db.volume.delete({ where: { id } }),
    ...later.map((v, i) =>
      db.volume.update({ where: { id: v.id }, data: { index: existing.index + i } })
    ),
  ]);

  return Response.json({ ok: true });
}
