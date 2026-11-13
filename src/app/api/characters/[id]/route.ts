import { db } from "@/lib/db";
import { callerUid } from "@/lib/credits/charge";
import { characterUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import { finalizedRefusal, moveAsset } from "@/lib/novara/lifecycle";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/characters/[id]
// Final lock (STEP 79): a final character is immutable canon — the patch is
// refused with HTTP 409 and the typed body
// { error: "asset_finalized", kind, id, reopen }. The explicit `reopen: true`
// is the one way through it: the lifecycle service archives the final state
// into AssetVersion, downgrades the row to draft and writes the
// AssetTransition row.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = characterUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.character.findUnique({ where: { id } });
  if (!existing) return jsonError("Character not found", 404);

  const { reopen, status, ...data } = schema.data;
  const wantsReopen = reopen === true;
  const wantsFinal = status === "final";

  // ---- Final lock: a final character is immutable canon ----
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "character",
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
      kind: "character",
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
  let character = await db.character.update({
    where: { id },
    data: { ...data },
  });

  // ---- Finalize: lock the character through the lifecycle service ----
  // The service archives the pre-final state, writes the AssetTransition row
  // and retires the facts that name the character. It runs after the patch so
  // the asset is never mutated while it is final.
  if (wantsFinal && !canonMoved) {
    const finalized = await moveAsset({
      kind: "character",
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
    const locked = await db.character.findUnique({ where: { id } });
    if (locked) character = locked;
  }

  return Response.json({ character });
}

// DELETE /api/characters/[id] — a final character is immutable canon: the
// delete is refused with the typed body unless ?reopen=1 is explicit; even
// then the final state is archived and demoted first.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.character.findUnique({ where: { id } });
  if (!existing) return jsonError("Character not found", 404);

  const wantsReopen = new URL(req.url).searchParams.get("reopen") === "1";
  if (!wantsReopen) {
    const refusal = finalizedRefusal({
      kind: "character",
      id: existing.id,
      novelId: existing.novelId,
      status: existing.status,
    });
    if (refusal) return Response.json(refusal, { status: 409 });
  }

  if (existing.status === "final" && wantsReopen) {
    const reopened = await moveAsset({
      kind: "character",
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

  await db.character.delete({ where: { id } });
  return Response.json({ ok: true });
}
