import { db } from "@/lib/db";
import { updateVolumeSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import {
  assetDeleteGate,
  assetGate,
  canonDowngrade,
  canonLock,
} from "@/lib/novara/asset-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/volumes/[id] — update title/synopsis and/or move position.
// Moving renumbers the whole sibling list (same reorder semantics as
// chapters/beats: no unique constraint errors, order stays dense 1..N).
// Canon gate (Phase 9): a final volume plan is Immutable Canon — 409 unless
// reopen:true (archives the final state, downgrades to draft).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = updateVolumeSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.volume.findUnique({ where: { id } });
  if (!existing) return jsonError("Volume not found", 404);

  const { moveTo, reopen, status, ...data } = schema.data;

  const gate = await assetGate({
    novelId: existing.novelId,
    assetType: "volume",
    assetId: existing.id,
    assetLabel: existing.title,
    lockState: existing.status,
    lockField: "status",
    reopen,
    wantsFinal: status === "final",
    snapshotFields: {
      title: existing.title,
      synopsis: existing.synopsis,
      status: existing.status,
    },
  });
  if (gate instanceof Response) return gate;

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

  const volume = await db.volume.update({
    where: { id },
    data: {
      ...data,
      ...(gate.reopened ? canonDowngrade("status") : {}),
      ...(gate.finalized ? canonLock("status") : {}),
    },
  });
  return Response.json({ volume });
}

// DELETE /api/volumes/[id] — delete the volume; its beats become unsorted
// (schema-level onDelete: SetNull) so nothing is ever silently destroyed.
// Siblings after it close the index gap. Locked volumes refuse deletion
// unless ?reopen=1 is explicit (archive runs first).
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.volume.findUnique({ where: { id } });
  if (!existing) return jsonError("Volume not found", 404);

  const gateError = await assetDeleteGate({
    novelId: existing.novelId,
    assetType: "volume",
    assetId: existing.id,
    assetLabel: existing.title,
    lockState: existing.status,
    snapshotFields: {
      title: existing.title,
      synopsis: existing.synopsis,
      status: existing.status,
    },
    reopen: new URL(req.url).searchParams.get("reopen") === "1",
  });
  if (gateError) return gateError;

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
