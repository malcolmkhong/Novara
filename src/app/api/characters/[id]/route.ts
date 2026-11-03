import { db } from "@/lib/db";
import { characterUpdateSchema } from "@/lib/novara/schemas";
import { jsonError, parseBody, validationError } from "@/lib/novara/api-helpers";
import {
  assetDeleteGate,
  assetGate,
  canonDowngrade,
  canonLock,
} from "@/lib/novara/asset-gate";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/characters/[id]
// Canon gate (Phase 9): a final character is Immutable Canon — the patch is
// refused with 409 unless reopen:true, which archives the final state into
// AssetVersion and downgrades the row to draft in the same request.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  const schema = characterUpdateSchema.safeParse(parsed.data);
  if (!schema.success) return validationError(schema.error);

  const existing = await db.character.findUnique({ where: { id } });
  if (!existing) return jsonError("Character not found", 404);

  const { reopen, status, ...data } = schema.data;
  const gate = await assetGate({
    novelId: existing.novelId,
    assetType: "character",
    assetId: existing.id,
    assetLabel: existing.name,
    lockState: existing.status,
    lockField: "status",
    reopen,
    wantsFinal: status === "final",
    snapshotFields: {
      name: existing.name,
      role: existing.role,
      description: existing.description,
      aliases: existing.aliases,
      status: existing.status,
    },
  });
  if (gate instanceof Response) return gate;

  const character = await db.character.update({
    where: { id },
    data: {
      ...data,
      ...(gate.reopened ? canonDowngrade("status") : {}),
      ...(gate.finalized ? canonLock("status") : {}),
    },
  });
  return Response.json({ character });
}

// DELETE /api/characters/[id] — a locked character refuses deletion unless
// ?reopen=1 is explicit; even then the final state is archived first.
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const existing = await db.character.findUnique({ where: { id } });
  if (!existing) return jsonError("Character not found", 404);

  const gateError = await assetDeleteGate({
    novelId: existing.novelId,
    assetType: "character",
    assetId: existing.id,
    assetLabel: existing.name,
    lockState: existing.status,
    snapshotFields: {
      name: existing.name,
      role: existing.role,
      description: existing.description,
      aliases: existing.aliases,
      status: existing.status,
    },
    reopen: new URL(req.url).searchParams.get("reopen") === "1",
  });
  if (gateError) return gateError;

  await db.character.delete({ where: { id } });
  return Response.json({ ok: true });
}
