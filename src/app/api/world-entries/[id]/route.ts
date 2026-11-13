import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { worldEntryUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/world-entries/[id]
// Two-level grouping (groupId moves an entry under a group) + the final lock
// (STEP 79): a final entry is immutable canon — the patch is refused with
// HTTP 409 and the typed body { error: "asset_finalized", kind, id, reopen }
// unless `reopen: true` demotes it to draft through the lifecycle service
// (which archives the final state into AssetVersion).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = worldEntryUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.worldEntry.findUnique({ where: { id } });
  if (!existing) return jsonError("World entry not found", 404);

  const { reopen, status, groupId, ...data } = schema.data;
  const wantsReopen = reopen === true;
  const wantsFinal = status === "final";

  // ---- Final lock: a final world entry is immutable canon ----
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "world_entry",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

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

  // ---- Reopen: demote to draft through the lifecycle service ----
  // It runs BEFORE the patch touches the row, so a final asset is never
  // mutated; the service archives the final state and writes the transition.
  let canonMoved = false;
  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "world_entry",
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
  let entry = await db.worldEntry.update({
    where: { id },
    data: {
      ...data,
      ...(nextGroupId !== undefined ? { groupId: nextGroupId } : {}),
    },
  });

  // ---- Finalize: lock the entry through the lifecycle service ----
  // The service archives the pre-final state, writes the AssetTransition row
  // and retires the facts that name the entry. It runs after the patch so the
  // asset is never mutated while it is final.
  if (wantsFinal && !canonMoved) {
    const finalized = await moveAsset({
      kind: "world_entry",
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
    const locked = await db.worldEntry.findUnique({ where: { id } });
    if (locked) entry = locked;
  }

  return Response.json({ entry });
}

// DELETE /api/world-entries/[id] — a final entry is immutable canon: the
// delete is refused with the typed body unless ?reopen=1 is explicit; even
// then the final state is archived and demoted first.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.worldEntry.findUnique({ where: { id } });
  if (!existing) return jsonError("World entry not found", 404);

  const wantsReopen = new URL(req.url).searchParams.get("reopen") === "1";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "world_entry",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "world_entry",
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

  await db.worldEntry.delete({ where: { id } });
  return Response.json({ ok: true });
}
