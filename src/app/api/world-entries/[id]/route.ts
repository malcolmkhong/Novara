import { db } from "@/lib/db";
import { worldEntryUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import {
  assetDeleteGate,
  assetGate,
  canonDowngrade,
  canonLock,
} from "@/lib/novara/asset-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/world-entries/[id]
// Phase 9: 世界书 two-level grouping (groupId moves an entry under a group)
// + the canon gate (final = Immutable Canon; reopen archives to AssetVersion).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = worldEntryUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.worldEntry.findUnique({ where: { id } });
  if (!existing) return jsonError("World entry not found", 404);

  const { reopen, status, groupId, ...data } = schema.data;

  // Group move: validate the group belongs to THIS novel (null ungroups).
  let nextGroupId: string | null | undefined;
  if (groupId !== undefined) {
    if (groupId === null) {
      nextGroupId = null;
    } else {
      const group = await db.worldGroup.findUnique({
        where: { id: groupId },
        select: { id: true, novelId: true },
      });
      if (!group || group.novelId !== existing.novelId) {
        return jsonError("World group does not belong to this novel", 400);
      }
      nextGroupId = group.id;
    }
  }

  const gate = await assetGate({
    novelId: existing.novelId,
    assetType: "world_entry",
    assetId: existing.id,
    assetLabel: existing.title,
    lockState: existing.status,
    lockField: "status",
    reopen,
    wantsFinal: status === "final",
    snapshotFields: {
      title: existing.title,
      category: existing.category,
      content: existing.content,
      groupId: existing.groupId,
      status: existing.status,
    },
  });
  if (gate instanceof Response) return gate;

  const entry = await db.worldEntry.update({
    where: { id },
    data: {
      ...data,
      ...(nextGroupId !== undefined ? { groupId: nextGroupId } : {}),
      ...(gate.reopened ? canonDowngrade("status") : {}),
      ...(gate.finalized ? canonLock("status") : {}),
    },
  });
  return Response.json({ entry });
}

// DELETE /api/world-entries/[id] — locked entries refuse deletion unless
// ?reopen=1 is explicit; the final state is archived first either way.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.worldEntry.findUnique({ where: { id } });
  if (!existing) return jsonError("World entry not found", 404);

  const gateError = await assetDeleteGate({
    novelId: existing.novelId,
    assetType: "world_entry",
    assetId: existing.id,
    assetLabel: existing.title,
    lockState: existing.status,
    snapshotFields: {
      title: existing.title,
      category: existing.category,
      content: existing.content,
      groupId: existing.groupId,
      status: existing.status,
    },
    reopen: new URL(req.url).searchParams.get("reopen") === "1",
  });
  if (gateError) return gateError;

  await db.worldEntry.delete({ where: { id } });
  return Response.json({ ok: true });
}
