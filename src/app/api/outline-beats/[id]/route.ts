import { db } from "@/lib/db";
import { outlineBeatUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import {
  assetDeleteGate,
  assetGate,
  canonDowngrade,
  canonLock,
} from "@/lib/novara/asset-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/outline-beats/[id]
// Canon gate (Phase 9): a final beat is Immutable Canon — 409 unless
// reopen:true (archives the final state, downgrades to draft).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = outlineBeatUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.outlineBeat.findUnique({ where: { id } });
  if (!existing) return jsonError("Outline beat not found", 404);

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

  const { reopen, status, ...data } = schema.data;
  const gate = await assetGate({
    novelId: existing.novelId,
    assetType: "outline_beat",
    assetId: existing.id,
    assetLabel: existing.title,
    lockState: existing.status,
    lockField: "status",
    reopen,
    wantsFinal: status === "final",
    snapshotFields: {
      title: existing.title,
      summary: existing.summary,
      volumeId: existing.volumeId,
      status: existing.status,
    },
  });
  if (gate instanceof Response) return gate;

  const beat = await db.outlineBeat.update({
    where: { id },
    data: {
      ...data,
      ...(volumeId !== undefined ? { volumeId } : {}),
      ...(gate.reopened ? canonDowngrade("status") : {}),
      ...(gate.finalized ? canonLock("status") : {}),
    },
  });
  return Response.json({ beat });
}

// DELETE /api/outline-beats/[id] — delete and close the index gap. Locked
// beats refuse deletion unless ?reopen=1 is explicit (archive runs first).
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.outlineBeat.findUnique({ where: { id } });
  if (!existing) return jsonError("Outline beat not found", 404);

  const gateError = await assetDeleteGate({
    novelId: existing.novelId,
    assetType: "outline_beat",
    assetId: existing.id,
    assetLabel: existing.title,
    lockState: existing.status,
    snapshotFields: {
      title: existing.title,
      summary: existing.summary,
      volumeId: existing.volumeId,
      status: existing.status,
    },
    reopen: new URL(req.url).searchParams.get("reopen") === "1",
  });
  if (gateError) return gateError;

  await db.$transaction([
    db.outlineBeat.delete({ where: { id } }),
    db.outlineBeat.updateMany({
      where: { novelId: existing.novelId, index: { gt: existing.index } },
      data: { index: { decrement: 1 } },
    }),
  ]);

  return Response.json({ ok: true });
}
